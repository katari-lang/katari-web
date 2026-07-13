---
title: prelude.time
description: Durable wall-clock time, now / sleep / sleep_until, plus watch for observing a schedule.
---

Durable wall-clock time. Calls route to the runtime's `time` reactor (in-runtime, the same as
`http.fetch`; no FFI sidecar). Called qualified as `time.` via the default import. Because these
are external calls they perform `io`, adding `io` to the caller's effect row. All times are
`number`s in **epoch milliseconds** (whole milliseconds since 1970-01-01T00:00:00Z).

## Why the clock goes through a reactor (the replay problem)

The runtime's replay contract states that a turn is a deterministic function of durable inputs: an
uncommitted turn re-executes from the same inputs after a restart. A bare primitive that reads
`Date.now()` would break this contract, because a replayed turn would observe a **different** time
than the first execution. Routing `now` through a reactor moves the clock read **outside** the
turn: the time arrives as an event that the calling turn merely consumes, and the commit that
consumes it makes the value durable along with everything else it observed, so no later replay
recomputes it. A restart before that commit resolves a new time from the current clock, which is
sound because nothing had yet durably observed a first time. The same reactor also owns the
`sleep` / `watch` timers, so deadlines are persisted and re-armed across restarts.

## Types

### `time.interval`

```katari
data interval(milliseconds: number)
```

A fixed interval: an occurrence every `milliseconds` from the start of the watch (the first
occurrence is one interval after the start, not at the start itself). `milliseconds` must be
positive.

### `time.cron`

```katari
data cron(expression: string, timezone: string)
```

A cron schedule: occurrences of a standard cron `expression` (the 5-field form, or a 6-field form
with a leading seconds field), read against an IANA `timezone` (for example `"Asia/Tokyo"`,
`"UTC"`). **The timezone is required; there is no ambient default.** "Every day at 09:00" means a
different instant in each zone, and a durable scheduler must not guess.

### `time.schedule`

```katari
type schedule = interval | cron
```

When each occurrence fires. Passed to `watch`.

## Agents

### `time.now`

```katari
external agent now() -> number from "time"
```

Returns the current wall-clock time in epoch milliseconds. The time becomes durable together with
the processing that first observed it, so once something downstream has seen the value, it never
changes across replay or recovery.

### `time.sleep`

```katari
external agent sleep(milliseconds: number) -> null from "time"
```

Waits `milliseconds` and then resolves with `null`. The wake deadline (now + `milliseconds`) is
persisted: a restart re-arms the timer, and a deadline that passed while the runtime was down
resolves immediately at recovery. `milliseconds` of 0 or less resolves immediately.

### `time.sleep_until`

```katari
external agent sleep_until(time: number) -> null from "time"
```

Waits until the absolute epoch millisecond `time` and then resolves with `null`. The deadline is
durable in the same way as `sleep`, but it is pinned to an absolute instant rather than a relative
delay; a `time` already in the past resolves immediately.

```katari
agent timed() -> string {
  let before = time.now()
  time.sleep(milliseconds = 1000)
  let after = time.now()
  f"slept for ${string.to_string(value = after - before)}ms"
}
```

### `time.watch`

```katari
external agent watch[effect E](
  schedule: schedule,
  deliver_to: agent (time: number) -> null with E,
) -> never with E | io from "time"
```

Calls `deliver_to` once per occurrence of `schedule`, passing the occurrence's scheduled epoch
millisecond as `time`. `watch` never resolves on its own (`-> never`): it runs until the run is
canceled. Cancellation cancels any in-flight delivery and folds up the watch. The effect `E` of
`deliver_to` flows through unchanged to the caller's handler.

```katari
agent daily_report(time: number) -> null with io | prelude.throw[http.fetch_error] {
  let response = http.fetch(
    url = "https://example.com/report",
    method = "POST",
    headers = record.empty(),
    body = json.to_text(value = { scheduled = time }),
  )
  null
}

agent report_daemon() -> never with io | prelude.throw[http.fetch_error] {
  time.watch(
    schedule = time.cron(expression = "0 9 * * *", timezone = "Asia/Tokyo"),
    deliver_to = daily_report,
  )
}
```

**Durability semantics:**

- **Restart re-arm.** The next occurrence is persisted, and a restart re-arms it.
- **A missed tick catches up exactly once.** If one or more occurrences were missed while the
  runtime was down, recovery fires **exactly once** immediately (passing the scheduled time of the
  earliest missed occurrence), then resumes the original schedule. It does not backfill every
  missed occurrence; replaying every missed tick would flood downstream.
- **Ticks are at-least-once.** The boundary between delivery and advancing the cursor is a commit,
  and a crash in that window causes recovery to redeliver the same occurrence. `deliver_to` must
  tolerate repeats of the same scheduled time; the scheduled epoch millisecond is passed precisely
  so it can dedupe if needed.
- **Delivery is serial.** The next occurrence is not armed until the current delivery settles. A
  `deliver_to` slower than the interval is rate-limited rather than queued (at most one delivery is
  ever in flight).
- **A failure kills the watch.** A `deliver_to` that throws or panics is **not** retried. The
  failure propagates and kills the watch, the same as any unhandled failure in a callee. Resilience
  is composed at the call site: wrapping with
  [`replay.forever`]({docs}/{currentVersion}/standard-library/replay) plus a converter that turns
  the failure into `replay.interrupted` is the standard pattern (the replay page has a complete
  composition example).
- **An invalid schedule panics.** A malformed cron expression or timezone, or a non-positive
  interval, is a panic rather than a typed error, consistent with the
  [throw / panic distinction]({docs}/{currentVersion}/language-reference/effects) that a correct
  program passes a valid schedule.

## Related

<DocCards>
  <DocCard href="{docs}/{currentVersion}/standard-library/replay" />
  <DocCard href="{docs}/{currentVersion}/language-reference/effects" />
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/runtime" />
</DocCards>
