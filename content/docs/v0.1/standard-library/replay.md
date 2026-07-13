---
title: prelude.replay
description: The retry mechanism, split cleanly from the failure policy — a provider re-runs a block, a converter decides which failures replay.
---

`prelude.replay` is the retry **mechanism**, split cleanly from the failure **policy**. A `replay`
provider re-runs the rest of a block, but it knows nothing about what counts as a retriable
failure: it catches exactly one request, `interrupted`, and re-runs after applying its delay
policy. Deciding _which_ failures become an `interrupted` is user code — an ordinary `use handler`
(a "converter") installed between the provider and the body that turns the throws and panics it
chooses into `replay.interrupted`. Written in plain Katari over durable
[`time.sleep`]({docs}/{currentVersion}/standard-library/time); no new reactor is involved.

```katari
use replay.exponential(initial_delay_milliseconds = 1000.0, factor = 2.0, max_attempts = 5.0)
use handler {
  // POLICY: this converter decides. Only transient errors become a replay; the rest rethrow.
  request prelude.throw(error: fetch_error | auth_error) -> never {
    match (error) {
      case fetch_error(_) -> { replay.interrupted(failure = error) } // transient -> replay
      case auth_error(_) -> { prelude.throw(error = error) } // fatal -> rethrow (proxies up)
    }
  }
}
// <the rest of the block> — it performs interrupted via the converter, the provider sleeps and re-runs it
```

## Why the split

The predecessor (`prelude.retry`) folded the failure decision _into_ the mechanism: an internal
`attempt` caught both a typed `throw` and a `panic` indiscriminately, so `retry.forever` spun
forever on a revoked-credential `auth_error` exactly as on a transient `fetch_error` — there was no
way to retry one and escalate the other. Moving the catch out of the mechanism and into a
user-written converter makes three things fall out:

- **Selective retry is an ordinary `match`.** The converter's one boundary dispatches on the error
  sum: the transient arm signals `replay.interrupted`, the fatal arm rethrows and leaves the loop.
- **Retrying a `panic` is an explicit opt-in in source.** A converter with no `panic` clause does
  not retry panics; a broken invariant is no longer silently re-run forever.
- **The "a caught panic cannot be re-raised" problem dissolves.** By the time control reaches a
  provider, every failure is already an `interrupted[F]` whose `F` the converter chose as a plain
  value, so exhaustion re-raises a **typed `throw[F]`** and never needs to re-panic.

## The seam: one signal request

```katari
request interrupted[F](failure: F) -> never
```

This is the entire interface between policy and mechanism, and the **only performable request the
module exports**. A converter performs `interrupted`; a provider catches it. The `-> never` return
means performing it transfers control to the provider (which applies its delay policy and re-runs)
and does not return. A provider reasons only about `interrupted`; it never mentions `throw` or
`panic`.

`F` is the converter's own choice of failure representation: often the throw's payload directly
(`interrupted(failure = error)`), or — when a converter retries on both channels (a typed throw and
a panic) — its own locally declared sum, so the two settle to one type. There is deliberately no
`replay.failure` / `thrown` / `panicked` fold in the prelude; a convenience sum shipped by the
mechanism would re-bake the exact policy-in-mechanism coupling this design removed.

Because `interrupted` is a `-> never` control channel like `throw` / `panic`, an **orphan**
`interrupted` performed with no provider in scope **fails the run** — its answer type is `never`, so
it never opens an un-answerable escalation at the run root. The runtime lists it in its
failure-request set alongside `throw` and `panic`.

## The providers

All three are ordinary [`forever { ... }`]({docs}/{currentVersion}/language-reference/syntax#forever)
loops, so durable state stays **flat** no matter how many times the block has replayed: each
finished iteration's frames are reclaimed, and what persists is the loop thread plus its `var`
state. The evolving state (the attempt count, the backoff delay) is the `forever`'s own `var` (one
owner); a `next … with (…)` advances it and a `break` carries the success value out. The `use`
form is unchanged from `retry`.

### `replay.immediate`

```katari
agent immediate[R, F, effect E](
  continuation: agent (value: null) -> R with {...E, interrupted[F]},
) -> R with E
```

Replays on every `interrupted`, unbounded and with **no artificial delay**: it re-runs at once, so
it adds neither `io` nor a `var`. The retry cadence is set entirely by whatever the converter does
_before_ it signals — for example, a converter that parks on a human before signalling gives the
attended / re-auth loop, human-paced with no polling (see below). It never re-raises and never
returns on its own; a converter that rethrows instead of signalling is how a failure leaves the
loop. Written `use replay.immediate()`.

### `replay.forever`

```katari
agent forever[R, F, effect E](
  initial_delay_milliseconds: number,
  factor: number,
  max_delay_milliseconds: number,
  continuation: agent (value: null) -> R with {...E, interrupted[F]},
) -> R with E | io
```

Replays on every `interrupted`, unbounded, with exponential backoff capped at
`max_delay_milliseconds`. For daemons that must stay up across transient failures (for example,
keeping a [`time.watch`]({docs}/{currentVersion}/standard-library/time) alive); it never re-raises
and never returns on its own. The backoff delay lives in the loop's own `delay` var and grows by
`factor` per replay up to the cap. Written
`use replay.forever(initial_delay_milliseconds = ..., factor = ..., max_delay_milliseconds = ...)`.

### `replay.exponential`

```katari
agent exponential[R, F, effect E](
  initial_delay_milliseconds: number,
  factor: number,
  max_attempts: number,
  continuation: agent (value: null) -> R with {...E, interrupted[F]},
) -> R with E | io | prelude.throw[F]
```

Replays on `interrupted` with exponential backoff, up to `max_attempts` times. On the n-th (1-based)
`interrupted` with n < `max_attempts`, it durably sleeps `initial_delay_milliseconds` ×
`factor`^(n-1) then re-runs. When the budget is spent (the `max_attempts`-th `interrupted`), it
re-raises that failure as a **typed `throw[F]`** — `F` is the converter's chosen failure
representation, so exhaustion keeps the error typed end to end and never needs to re-panic. The
exhausted-vs-continue decision is genuine sum dispatch: the one comparison of the count to the
budget mints a verdict sum matched once, not a counter re-tested throughout.

- **Throws** `throw[F]` — the failure the converter chose, re-raised when the budget is exhausted,
  catchable by payload exactly as without the replay.

## The converter

A converter is an ordinary `use handler` installed **between** the provider and the body. It rests
on three behaviors.

**A `throw` handler performs `interrupted`.** A `request prelude.throw(…) -> never` handler may
perform `replay.interrupted(…)` (also `-> never`) as its divergent tail instead of `break` / `next`.
The rethrow arm re-performs `throw` from inside the `throw` handler; the **self-catch rule** (a
request from a handler's own body escapes past that handle) proxies it up to an outer handler rather
than looping on itself, and the `interrupted` it performs likewise proxies past the converter to the
provider.

```katari
request prelude.throw(error: warming_up | unauthorized) -> never {
  match (error) {
    case warming_up(_) -> { replay.interrupted(failure = error) } // retry this one
    case unauthorized(_) -> { prelude.throw(error = error) } // rethrow: leaves the loop
  }
}
```

**A panic converter is explicit.** Retrying a panic is opt-in, in source. `panic` is undeclared, so
its parameter name is wired in as `msg` (the message); a bare `panic` handler whose parameter is
named anything else is rejected with a targeted **K3023** rather than a cryptic subtype mismatch.
The converter folds the panic into its own `F`:

```katari
data crashed(message: string)

request panic(msg: string) {
  replay.interrupted(failure = crashed(message = msg))
}
```

**A human-in-the-loop escalation is the converter's own request.** A converter that parks for a
human performs an escalation _it_ declares (`-> null`) — nothing replay-specific about it — and, on
the answer, signals:

```katari
data session_expired(scope: string)
request needs_reauth(detail: session_expired) -> null // the converter's module declares this

request prelude.throw(error: session_expired) -> never {
  needs_reauth(detail = error) // unhandled: escalates to an open question; resolves null on the answer
  replay.interrupted(failure = error) // then re-run the block against the restored credential
}
```

## Selective retry, end to end

The converter's `match` is where "retry the transient failure, escalate the fatal one" lives. A
`warming_up` throw becomes a replay; an `unauthorized` throw is rethrown, so it leaves the provider
immediately — no backoff, no attempts spent — and an outer handler catches it.

```katari
data warming_up(attempt: integer)
data unauthorized(reason: string)

request warmup() -> integer

data not_ready(attempt: integer)
data ready(attempt: integer)
agent readiness(attempt: integer) -> not_ready | ready {
  if (attempt < 3) { not_ready(attempt = attempt) } else { ready(attempt = attempt) }
}

agent connect() -> string with warmup | prelude.throw[warming_up | unauthorized] {
  match (readiness(attempt = warmup())) {
    case not_ready(attempt => a) -> { prelude.throw(error = warming_up(attempt = a)) }
    case ready(attempt => a) -> { f"connected on attempt ${string.to_string(value = a)}" }
  }
}

agent main() -> string {
  // The exhaustion / fatal fallback: an outer handler catches whatever leaves the provider.
  use handler {
    request prelude.throw(error: warming_up | unauthorized) -> never {
      match (error) {
        case warming_up(attempt => a) -> { break f"gave up warming up (attempt ${string.to_string(value = a)})" }
        case unauthorized(reason => r) -> { break f"unauthorized: ${r}" }
      }
    }
  }
  // An ambient counter OUTSIDE the provider, so it survives the re-runs and counts across them.
  use handler (var attempts = 0) {
    request warmup() { next attempts + 1 with { attempts = attempts + 1 } }
  }
  use replay.exponential(initial_delay_milliseconds = 5.0, factor = 2.0, max_attempts = 5.0)
  // THE POLICY: transient replays, fatal rethrows past this handler to the fallback above.
  use handler {
    request prelude.throw(error: warming_up | unauthorized) -> never {
      match (error) {
        case warming_up(_) -> { replay.interrupted(failure = error) }
        case unauthorized(_) -> { prelude.throw(error = error) }
      }
    }
  }
  f"result: ${connect()}"
}
```

## The human in the loop (the former `attended`)

There is **no `attended` provider and no `replay.attention` request**. The attended behavior —
failure → escalate to a human → park → re-run on the answer — is exactly `use replay.immediate()`
plus a converter that performs an ordinary escalation the application declares itself. Unhandled,
that request [escalates]({docs}/{currentVersion}/language-reference/effects) to a durable open
question that parks the run until `katari answer`; an application may instead install its own handler
for it above the provider (post to a chat, wait on a reaction) and `next null` to trigger the
replay, or `break` to give up with a value. Default (escalate-and-park) and interception
(handle-in-process) are the same request, chosen by whether a handler is in scope — nothing branches
on it, and none of it is coupled to `replay`.

```katari
data session_expired(scope: string)
request needs_reauth(detail: session_expired) -> null

request warmup() -> integer
data expired(attempt: integer)
data valid(attempt: integer)
agent token_state(attempt: integer) -> expired | valid {
  if (attempt < 2) { expired(attempt = attempt) } else { valid(attempt = attempt) }
}

agent refresh() -> string with warmup | prelude.throw[session_expired] {
  match (token_state(attempt = warmup())) {
    case expired(_) -> { prelude.throw(error = session_expired(scope = "calendar")) }
    case valid(attempt => a) -> { f"calendar loaded on attempt ${string.to_string(value = a)}" }
  }
}

agent reauth() -> string with needs_reauth {
  use handler (var attempts = 0) {
    request warmup() { next attempts + 1 with { attempts = attempts + 1 } }
  }
  use replay.immediate()
  use handler {
    request prelude.throw(error: session_expired) -> never {
      needs_reauth(detail = error) // park for a human; resolves null on the answer
      replay.interrupted(failure = error) // then re-run against the fresh token
    }
  }
  f"session: ${refresh()}"
}
```

## The flagship composition — a resilient daemon

[`time.watch`]({docs}/{currentVersion}/standard-library/time) ships with no built-in retry: a
`deliver_to` that throws kills the watch. A converter turns that typed failure into
`replay.interrupted`, and `replay.forever` catches it, backs off, and re-runs `watch`, which re-arms
from its persisted next occurrence — resilience composed _around_ the watch, and flat in durable
footprint however many deliveries have failed.

```katari
data delivery_failed(scheduled: number)

agent flaky_deliver(time: number) -> null with prelude.throw[delivery_failed] {
  prelude.throw(error = delivery_failed(scheduled = time))
}

agent daemon() -> never with io {
  use replay.forever(initial_delay_milliseconds = 100.0, factor = 2.0, max_delay_milliseconds = 5000.0)
  use handler {
    request prelude.throw(error: delivery_failed) -> never {
      replay.interrupted(failure = error)
    }
  }
  time.watch(schedule = time.interval(milliseconds = 1000), deliver_to = flaky_deliver)
}
```

## Choosing a provider

| provider      | Cadence between replays                                                     | How it ends                                                        |
| ------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `immediate`   | None — re-runs at once (the converter paces it, e.g. by parking on a human) | Success, or a converter rethrow leaves the loop; never on its own  |
| `forever`     | Exponential backoff, capped at `max_delay_milliseconds`                     | Success, or a converter rethrow; never on its own — for daemons    |
| `exponential` | Exponential backoff for a bounded budget                                    | Success, or the failure re-raised as a typed `throw[F]` when spent |

Which failures replay is entirely the converter's decision. A failure that should not be retried is
one the converter rethrows (or never catches) — it leaves the provider and proxies up to an outer
handler.

## Related

<DocCards>
  <DocCard href="{docs}/{currentVersion}/standard-library/time" />
  <DocCard href="{docs}/{currentVersion}/language-reference/providers" />
  <DocCard href="{docs}/{currentVersion}/language-reference/effects" />
  <DocCard href="{docs}/{currentVersion}/language-reference/syntax" />
</DocCards>
