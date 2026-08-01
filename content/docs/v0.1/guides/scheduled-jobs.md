---
title: Scheduled jobs
description: Run agents on an interval or a cron schedule with time.watch, and compose retry policies around them with supervise.
---

The delivered agent is ordinary code: its effects flow to your handlers unchanged, so what it may do
is whatever the calling block serves. `time.watch` itself holds only the timer, which is durable —
the next occurrence is persisted, and a restart re-arms it.

## Run on a cron schedule

```katari
@"Called once per occurrence; @time@ is the occurrence's scheduled epoch millisecond."
agent send_daily_summary(time: number) -> null with io | prelude.throw[http.fetch_error] {
  let _response = http.fetch(
    url = "https://api.example.com/daily-summary",
    method = "POST",
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

`time.cron` takes a standard 5-field expression (or the 6-field form with a leading seconds field)
and an IANA timezone name. The timezone is required and explicit: "every day at 09:00" is a
different instant in every zone, and a durable scheduler must not guess which one you meant.

The other schedule is `time.interval(milliseconds = ...)`: an occurrence every interval after the
watch starts (the first one is one interval in, not at the start). `watch` never resolves on its own
(`-> never`); it runs until the run is cancelled.

## Keep a job alive across failures

A `deliver_to` that throws or panics propagates and ends the watch, exactly as an uncaught failure
in any callee does. Resilience is composed at the call site, from two pieces:

- a **`supervise` provider** — the mechanism. It re-runs the rest of the block whenever the
  `supervise.interrupted` signal is performed, applying its delay policy. It knows nothing about
  what counts as a retriable failure.
- a **converter** — the policy. An ordinary handler you install between the provider and the
  body, turning exactly the failures you choose into `supervise.interrupted`.

```katari
@"The resilient daemon: a failed delivery re-runs the block after a capped exponential backoff,
opening a fresh watch."
agent main() -> never with io {
  use supervise.forever()
  use handler {
    request prelude.throw(error: http.fetch_error) -> never {
      supervise.interrupted(failure = error)
    }
  }
  time.watch(schedule = time.interval(milliseconds = 300000), deliver_to = poll_upstream)
}

@"One poll; a downstream outage surfaces as `http.fetch_error` and kills the watch — by design."
agent poll_upstream(time: number) -> null with io | prelude.throw[http.fetch_error] {
  let _response = http.fetch(url = "https://api.example.com/poll")
  null
}
```

`supervise.forever`'s cadence is defaulted — one second, doubling, capped at fifteen minutes — so
the bare `use supervise.forever()` is the ordinary form and a named argument means you disagree with
one of the three.

When a poll fails, the converter performs `supervise.interrupted`, the provider sleeps its current
backoff (durably — the delay survives a restart) and re-runs the block. The durable footprint stays
flat no matter how many failures the daemon has survived. `supervise.interrupted` with no provider in
scope fails the run, so the composition is explicit in source.

A re-run unwinds the failed `time.watch` call and evaluates the expression again, which opens a new
watch whose first occurrence is computed from the clock at that moment. An `interval` therefore takes
its phase from the re-run rather than from the original start, and the occurrences that would have
fallen during the failure and the backoff do not fire. Re-arming from a persisted cursor is what a
runtime restart does to a watch that is still alive; a supervised re-run is a new call.

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
    body = http.json(value = { scheduled = time }),
  )
  null
}

@"Attempt one delivery at most five times with exponential backoff, but only on transport errors.
The fatal arm rethrows, leaving the loop immediately; exhaustion re-raises the last failure typed."
agent deliver_with_retry(time: number) -> null with io | prelude.throw[http.fetch_error | invalid_payload] {
  use supervise.exponential(max_attempts = 5)
  use handler {
    request prelude.throw(error: http.fetch_error | invalid_payload) -> never {
      match (error) {
        case http.fetch_error(_) -> { supervise.interrupted(failure = error) }
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

`watch`'s durability contract is **serialized, with a single catch-up**:

- **The next occurrence is persisted.** A restart re-arms it; a deadline that passed while the
  runtime was down fires immediately on recovery.
- **Missed occurrences collapse into one catch-up.** Down across ten interval boundaries, the
  watch fires exactly once on recovery (with the earliest missed occurrence's scheduled time),
  then continues on its original phase. It never backfills every missed tick — a scheduler that
  replayed an outage would stampede its downstream.
- **Deliveries are serialized.** The next occurrence is not armed until the current delivery
  settles, so a `deliver_to` slower than the interval rate-limits the ticks rather than queueing
  them.
- **The cursor advances with the delivery.** Advancing to the next occurrence and opening the
  delivery happen in one turn and commit together, and a delivery still in flight across a restart
  resumes as ordinary durable work rather than being re-delivered. `deliver_to` receives the
  occurrence's **scheduled** epoch millisecond, not the delivery instant, so it is a stable key
  wherever the downstream effect needs one.

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

A watch that reports to an AI rather than to an API is the same call with a `deliver_to` that mails:
that is what a resident's `sources` entries are.

<DocCards>
  <DocCard href="{docs}/{currentVersion}/guides/residents" />
  <DocCard href="{docs}/{currentVersion}/concepts/durable-execution" />
  <DocCard href="{docs}/{currentVersion}/guides/webhooks" />
</DocCards>

The `time` and `supervise` modules' own signatures are in the [reference](/packages).
