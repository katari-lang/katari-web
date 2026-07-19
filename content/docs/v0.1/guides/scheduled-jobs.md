---
title: Scheduled jobs
description: Run agents on an interval or a cron schedule with time.watch, and compose retry policies around them with replay.
---

`time.watch` calls an agent once per schedule occurrence, forever, with durable timers: the next
occurrence is persisted, so a restart re-arms it instead of forgetting it. Retry is deliberately
**not** built in — you compose it around the watch with a `replay` provider, which is why one
small surface covers cron jobs, pollers, and resilient daemons alike.

## Run on a cron schedule

```katari
@"Called once per occurrence; @time@ is the occurrence's scheduled epoch millisecond."
agent send_daily_summary(time: number) -> null with io | prelude.throw[http.fetch_error] {
  let _response = http.fetch(
    url = "https://api.example.com/daily-summary",
    method = "POST",
    headers = record.empty(),
    body = http.json(value = { scheduled = time }),
  )
  null
}

@"Fire every day at 09:00 Tokyo time, forever. The timezone is required — there is no default."
agent main() -> never with io | prelude.throw[http.fetch_error] {
  time.watch(
    schedule = time.cron(expression = "0 9 * * *", timezone = "Asia/Tokyo"),
    deliver_to = send_daily_summary,
  )
}
```

`time.cron` takes a standard 5-field expression (or the 6-field form with a leading seconds
field) and an IANA timezone name. The timezone is required and explicit: "every day at 09:00" is
a different instant in every zone, and a durable scheduler must not guess which one you meant. A
malformed expression or an unknown zone is a panic — a correct program never supplies one.

The other schedule is `time.interval(milliseconds = ...)`: an occurrence every interval after the
watch starts (the first one is one interval in, not at the start).

`watch` never resolves on its own (`-> never`); it runs until the run is cancelled. The delivered
agent's effects flow to your handlers unchanged — which is exactly what the next section exploits.

## Keep a job alive across failures

A `deliver_to` that throws or panics is **not retried** — the failure propagates and kills the
watch, exactly as an uncaught failure in any callee does. Resilience is composed at the call
site, from two pieces:

- a **`replay` provider** — the mechanism. It re-runs the rest of the block whenever the
  `replay.interrupted` signal is performed, applying its delay policy. It knows nothing about
  what counts as a retriable failure.
- a **converter** — the policy. An ordinary handler you install between the provider and the
  body, turning exactly the failures you choose into `replay.interrupted`.

```katari
@"The resilient daemon: a failed delivery re-runs the watch after a capped exponential backoff,
and the watch re-arms from its persisted next occurrence."
agent main() -> never with io {
  use replay.forever(initial_delay_milliseconds = 1000, factor = 2, max_delay_milliseconds = 60000)
  use handler {
    request prelude.throw(error: http.fetch_error) -> never {
      replay.interrupted(failure = error)
    }
  }
  time.watch(
    schedule = time.interval(milliseconds = 300000),
    deliver_to = poll_upstream,
  )
}

@"One poll; a downstream outage surfaces as `http.fetch_error` and kills the watch — by design."
agent poll_upstream(time: number) -> null with io | prelude.throw[http.fetch_error] {
  let _response = http.fetch(
    url = "https://api.example.com/poll",
    method = "GET",
    headers = record.empty(),
    body = http.text(content = ""),
  )
  null
}
```

When a poll fails, the converter performs `replay.interrupted`, `replay.forever` sleeps its
current backoff (durably — the delay survives a restart) and re-runs the block, and `watch`
re-arms from its persisted next occurrence. The durable footprint stays flat no matter how many
failures the daemon has survived. `replay.interrupted` with no provider in scope fails the run,
so the composition is explicit in source.

## Retry selectively, with a bound

Because the converter is ordinary code, "retry transport errors, fail fast on a broken payload"
is a `match` at one boundary — and a bounded provider re-raises the failure **typed** when the
budget is spent:

```katari
data invalid_payload(message: string)

@"One delivery attempt: transient transport failures and a fatal payload error are different throws."
agent push_report(time: number) -> null with io | prelude.throw[http.fetch_error | invalid_payload] {
  let _response = http.fetch(
    url = "https://api.example.com/report",
    method = "POST",
    headers = record.empty(),
    body = http.json(value = { scheduled = time }),
  )
  null
}

@"Retry ONE delivery up to five times with exponential backoff — but only on transport errors.
The fatal arm rethrows, leaving the loop immediately; exhaustion re-raises the last failure typed."
agent deliver_with_retry(time: number) -> null with io | prelude.throw[http.fetch_error | invalid_payload] {
  use replay.exponential(initial_delay_milliseconds = 1000, factor = 2, max_attempts = 5)
  use handler {
    request prelude.throw(error: http.fetch_error | invalid_payload) -> never {
      match (error) {
        case http.fetch_error(_) -> { replay.interrupted(failure = error) }
        case invalid_payload(_) -> { prelude.throw(error = error) }
      }
    }
  }
  push_report(time = time)
}
```

Pass `deliver_with_retry` as the watch's `deliver_to` and each occurrence gets its own bounded
retry, while the daemon pattern above owns whatever still escapes. The two compose freely because
each is just an agent.

## What the runtime guarantees

`watch`'s durability contract is **at-least-once, serialized, with a single catch-up**:

- **The next occurrence is persisted.** A restart re-arms it; a deadline that passed while the
  runtime was down fires immediately on recovery.
- **Missed occurrences collapse into one catch-up.** Down across ten interval boundaries, the
  watch fires exactly once on recovery (with the earliest missed occurrence's scheduled time),
  then continues on its original phase. It never backfills every missed tick — a scheduler that
  replayed an outage would stampede its downstream.
- **Deliveries are serialized.** The next occurrence is not armed until the current delivery
  settles, so a `deliver_to` slower than the interval rate-limits the ticks rather than queueing
  them.
- **Ticks are at-least-once, not exactly-once.** A crash in the window between a delivery and the
  commit that advances the cursor re-delivers the same occurrence on recovery. `deliver_to`
  receives the occurrence's **scheduled** epoch millisecond (not the delivery instant) precisely
  so it can deduplicate on it when the downstream effect must not repeat.

## One-shot timers

For a single durable delay, `time.sleep` (relative) and `time.sleep_until` (absolute) persist
their deadline the same way, and `time.now` reads a wall clock that stays consistent under
replay and recovery:

```katari
@"Sleep a second, timing it with the durable clock either side. The deadline is persisted, so even
a restart mid-sleep wakes no earlier."
agent main() -> string {
  let before = time.now()
  time.sleep(milliseconds = 1000)
  let after = time.now()
  f"slept for ${string.to_string(value = after - before)}ms"
}
```

## Where to go next

- [Durable execution]({docs}/{currentVersion}/concepts/durable-execution) — why a clock read has
  to be durable at all.
- [Webhooks]({docs}/{currentVersion}/guides/webhooks) — push instead of poll, with the same
  lifetime patterns.
- The `time` and `replay` modules in the [reference](/reference).
