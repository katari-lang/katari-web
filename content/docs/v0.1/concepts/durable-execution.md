---
title: Durable execution
description: Snapshots, runs, and threads — every step persists, so programs sleep for days, survive restarts, and resume where they parked.
---

The Katari runtime is a persistent server, and execution state lives in PostgreSQL, not in
process memory. A program can sleep for a week, wait on a human, or watch a cron schedule,
and a runtime restart in the middle changes nothing observable: the run reloads and resumes
from its last committed step.

Three nouns organize everything:

- A **snapshot** is one immutable version of your compiled program. `katari apply` compiles
  the project and deploys it as a new snapshot; older snapshots stay runnable, so rollback
  is picking one.
- A **run** is one execution of an entry agent against one snapshot. Applying a newer
  snapshot never disturbs a running run — it keeps the code it started with.
- A **thread** is a running instance of one block inside a run. A `parallel for` holds one
  thread per element; a parked escalation blocks exactly the thread that asked.

```bash
katari apply                   # compile + deploy: a new snapshot
katari run hello.main          # start a run (Ctrl-C detaches; the run keeps going)
katari ls snapshots
katari ls runs --state running
```

## Surviving a restart

```katari
@"Sleep across a deploy: the wake deadline is persisted, so a restart mid-sleep
wakes no earlier — and a deadline that passed while the runtime was down wakes at once."
agent slow_echo(message: string) -> string with io {
  let before = time.now()
  time.sleep(milliseconds = 60000)
  f"${message} (slept ${string.to_string(value = time.now() - before)}ms)"
}
```

`time.sleep` does not spin a timer in memory: it persists the wake deadline and parks the
thread. `time.now` reads the clock through the runtime too, and the instant becomes durable
together with the first step that observes it — so a recovered run agrees with itself about
what time it was, and no replayed step ever sees a different clock. This is the general
contract: effects happen through the runtime, the runtime commits them, and recovery replays
from committed state instead of re-running your effects.

## Schedules

```katari
@"Deliver one reminder occurrence; @time@ is the scheduled epoch millisecond."
agent remind(time: number) -> null {
  null
}

@"Every weekday at 09:00 in Tokyo. The next occurrence is persisted; a restart re-arms it."
agent weekday_mornings() -> never with io {
  time.watch(
    schedule = time.cron(expression = "0 9 * * 1-5", timezone = "Asia/Tokyo"),
    deliver_to = remind,
  )
}
```

`time.watch` calls `deliver_to` once per occurrence of a schedule — a fixed
`time.interval(...)` or a `time.cron(...)` with an explicit IANA timezone — forever. The
next occurrence is persisted; if occurrences were missed while the runtime was down, the
watch fires exactly once on recovery (the earliest missed one), then continues on schedule.
Deliveries are serialized, so a slow delivery rate-limits the ticks rather than queueing
them. A delivery that throws kills the watch by design — resilience is composed around it
with a replay provider, below. See
[Scheduled jobs]({docs}/{currentVersion}/guides/scheduled-jobs) for the operational side.

## Looping forever

```katari
@"The deadline has passed."
data ready(elapsed: number)
@"Not yet."
data pending()

@"One classification boundary: is the deadline past?"
agent check(deadline: number) -> ready | pending with io {
  let now = time.now()
  if (now >= deadline) { ready(elapsed = now - deadline) } else { pending() }
}

@"Poll once a second until the deadline passes. The loop repeats in place: its durable
state is the `var` values plus the one in-flight iteration, flat no matter how long it runs."
agent poll_until(deadline: number) -> number with io {
  forever (var polls = 0) {
    match (check(deadline = deadline)) {
      case ready(elapsed => elapsed) -> { break elapsed }
      case pending(_) -> {
        time.sleep(milliseconds = 1000)
        next with { polls = polls + 1 }
      }
    }
  }
}
```

`forever { ... }` is the unbounded loop, and it exists for a durability reason: recursion is
a real delegation, so a self-recursive daemon parks one permanent frame chain per iteration.
`forever` repeats in place — each iteration's threads are reclaimed when it completes, and
the loop's whole durable footprint is the `var` state plus the in-flight iteration. `break
value` exits the loop with that value; `next with { ... }` advances the loop-carried `var`s
and starts the next iteration (falling off the body's end is a `next` with the state
unchanged). A loop with no `break` types as `never`, which fits any declared return.

## Replay: mechanism and policy

```katari
@"A transient failure: a retry may fix it."
data transient(message: string)

@"A fatal failure: no retry will."
data fatal(message: string)

@"A downstream call that can fail either way."
agent connect() -> string with prelude.throw[transient | fatal] {
  prelude.throw(error = transient(message = "still warming up"))
}

@"Retry with exponential backoff — but only what deserves retrying."
agent resilient() -> string {
  // The fallback: reached on a fatal error, or when the retry budget is spent.
  use handler {
    request prelude.throw(error: transient | fatal) -> never {
      break f"gave up: ${json.stringify(value = error)}"
    }
  }
  // MECHANISM: re-run the rest of the block each time `replay.interrupted` is performed.
  use replay.exponential(initial_delay_milliseconds = 1000.0, factor = 2.0, max_attempts = 5.0)
  // POLICY: a converter — an ordinary handler — decides which failures replay.
  use handler {
    request prelude.throw(error: transient | fatal) -> never {
      match (error) {
        case transient(_) -> { replay.interrupted(failure = error) }
        case fatal(_) -> { prelude.throw(error = error) }
      }
    }
  }
  connect()
}
```

Retry is split into two parts that compose. A **replay provider**
(`replay.immediate` / `replay.forever` / `replay.exponential`) is the mechanism: it re-runs
the rest of the block whenever the `replay.interrupted` request is performed, sleeping its
policy's delay durably in between — and it knows nothing about what counts as retriable. A
**converter** — an ordinary handler you install between the provider and the body — is the
policy: it catches the failures you choose and turns exactly those into `interrupted`,
rethrowing the rest. Here `transient` replays with backoff and `fatal` leaves immediately
for the fallback; when a bounded provider exhausts its budget, it re-raises the last failure
as a typed `throw`, so the error stays typed end to end. Wrap `time.watch`'s delivery in
`replay.forever` plus a converter and you have a daemon that survives transient failures
with flat durable state.

### What a replay rebuilds, and what it keeps

A replay provider is ordinary Katari — a `forever` loop whose body **delegates** the rest of the
block once per attempt. Nothing unwinds the enclosing agent's frame, which gives the base rule:

> State installed _above_ the replay scope lives in the caller's frame and survives every attempt;
> everything the supervised block installs is rebuilt per attempt.

A provider installed inside is therefore re-established each time — exactly what you want when the
thing being rebuilt is a connection whose handle went stale. And a stateful `var` handler could in
principle be hoisted above the `use` to keep its state across replays. But that hoist has a strict
precondition:

> **A handler may be hoisted above a supervision boundary only if its body performs nothing that is
> served inside that boundary** — otherwise the requests it performs escape the program.

A handler that only keeps a count hoists safely. A desk whose clause runs a model turn
(`ai.infer_step`) or posts on a chat gateway (`discord.connection`) does not: the provider serving it
lives _inside_ the scope, so above the scope nothing answers, and the request travels out of the
program to park as an escalation waiting for a human instead of reaching the model.

**A passing `katari check` does not validate a hoist.** The mistake typechecks — the row is satisfied
by letting the request escalate. What exposes it is the **escalation report** `check` prints, read as a
capability diff: hoisting a model desk adds a line to it.

```text
  escalates: ai.infer_step, prelude.throw[...], io
```

`ai.infer_step` there means every model turn now leaves the program. Diff the report across the move;
if a hoist added a request, put the handler back.

For the common resident — a desk that talks to a model or a chat gateway — that settles it: **its
state genuinely is rebuilt per attempt.** Keeping it across a restart means persisting it in the
[store]({docs}/{currentVersion}/guides/store), or introducing an app-level request pair the supervised
block serves as a proxy. Either way, the state and whatever consumes it must end up on the same side
of the boundary: hoist a collecting desk but leave the fiber that _closes_ its window inside, and the
rebuilt fiber re-arms on the next occurrence while the surviving entries pile up in a window nobody
will ever close.

## Finalizers

```katari
@"`finally` arms a finalizer: it runs right before this instance acknowledges its
terminal — a normal completion or a cancellation — and never on a panic."
agent guarded() -> string {
  finally { let _note = "cleanup ran" }
  "work complete"
}
```

`finally { ... }` arms a finalizer of the current agent instance, Go-`defer` style: armed
blocks run in reverse arming order on completion or cancellation. A finalizer runs while the
parent may already be tearing this instance down, so its net effect must stay within `io` —
a request it raises and handles locally is fine, but a request that would escape to the
parent is rejected at compile time (`K3021`).

## Where to go next

- [Escalation]({docs}/{currentVersion}/concepts/escalation) — the other way a run parks.
- [Parallelism]({docs}/{currentVersion}/concepts/parallelism) — threads, in the plural.
- [Runtime]({docs}/{currentVersion}/toolchain/runtime) — operating the server that keeps all
  of this.
