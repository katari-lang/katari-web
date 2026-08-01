---
title: Durable execution
description: Snapshots, runs, and threads — every step persists, so programs sleep for days, survive restarts, and resume where they parked.
---

The Katari runtime is a persistent server. A run's live state is warm in the process that executes
it, and every step it takes is journalled to PostgreSQL, so nothing is lost when the process is —
recovery reloads the journal and carries on. Work inside the runtime is re-executed freely from that
journal; work outside it, an HTTP call or an FFI handler, is at-most-once and is never re-run.

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

`time.sleep` parks the thread against an absolute deadline held in the database; the in-memory timer
is only how a live process notices, and a restart re-arms it from the persisted instant. `time.now`
reads the clock through the runtime rather than as a primitive, and the instant becomes durable
together with the first step that observes it — so a recovered run agrees with itself about what
time it was, and no re-executed step ever sees a different clock.

That is the general shape. A step's own work may be re-executed from the journal, so anything whose
answer must not move — a clock read, a random value, an outside call — goes through the runtime,
which records the answer once. An `http` or FFI call interrupted by a restart is not resumed and not
retried: it surfaces as a panic in the frame that held it, which `supervise.signal_panics` turns
into a supervision signal an ordinary retry policy can answer. `time` and `webhook` calls carry no
outside process, so they do survive a restart whole.

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
with a supervise provider, below. See
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
  // The mechanism: re-run the rest of the block each time `supervise.interrupted` is performed.
  use supervise.exponential(max_attempts = 5)
  // The policy: a converter — an ordinary handler — decides which failures re-run.
  use handler {
    request prelude.throw(error: transient | fatal) -> never {
      match (error) {
        case transient(_) -> { supervise.interrupted(failure = error) }
        case fatal(_) -> { prelude.throw(error = error) }
      }
    }
  }
  connect()
}
```

Retry is split into two parts that compose. A **supervise provider**
(`supervise.immediate` / `supervise.forever` / `supervise.exponential`) is the mechanism: it
re-runs the rest of the block whenever `supervise.interrupted` is performed, and it knows nothing
about what counts as retriable. `forever` and `exponential` sleep their policy's delay durably in
between; `immediate` adds no delay of its own and re-runs at once, so its cadence is whatever the
converter does before it signals — parking on a human's answer, for instance. The delays are
defaulted, so `supervise.forever()` and `supervise.exponential(max_attempts = 5)` are the ordinary
spellings.

A **converter** — an ordinary handler installed between the provider and the body — is the
policy: it catches the failures you choose and turns exactly those into `interrupted`,
rethrowing the rest. Here `transient` re-runs with backoff and `fatal` leaves at once for the
fallback; a bounded provider that spends its budget re-raises the last failure as a typed
`throw`, so the error stays typed end to end. Wrap `time.watch`'s delivery in
`supervise.forever()` plus a converter and you have a daemon that survives transient failures
with flat durable state.

Put that pair inside a fiber and you have a supervisor: the fiber answers its own interruption,
the budget bounds it, and only a budget it could not keep escapes — as a throw, which the region
reports as `failed`. There is no separate supervision API to learn. A supervisor restarts a
fiber with a budget; a `supervise` provider re-runs a block with a budget; a fiber's body is a
block.

### What a re-run rebuilds, and what it keeps

A supervise provider is ordinary Katari — a `forever` loop whose body **delegates** the rest of the
block once per attempt. Nothing unwinds the enclosing agent's frame, which gives the base rule:

> State installed _above_ the supervised scope lives in the caller's frame and survives every attempt;
> everything the supervised block installs is rebuilt per attempt.

A provider installed inside is therefore re-established each time. Sometimes that is the point —
an attempt that must start from fresh setup, a new idempotency key, a credential re-resolved after
a rotation — and sometimes it is pure cost, in which case the provider belongs above the scope. An
FFI reference is never what a re-run is for: a call that takes the remote name and the credential
has nothing to re-establish
([FFI sidecars]({docs}/{currentVersion}/guides/ffi-sidecars#what-may-cross-the-boundary)).

A stateful `var` handler can be hoisted above the `use` to keep its state across attempts, under
one condition:

> A handler may be hoisted above a supervision boundary only if its body performs nothing that is
> served inside that boundary.

A handler that only keeps a count qualifies. One whose clause runs a model turn (`ai.infer_step`)
or posts on a chat surface (`discord.credential`) does not: the provider serving those lives
inside the scope, so above it nothing answers and the request leaves the program to park as an
escalation. The row typechecks either way, because escalating satisfies it. The difference shows
in the escalation report `katari check` prints, read as a capability diff:

```text
  escalates: ai.infer_step, prelude.throw[...], io
```

Diff the report across the move; a hoist that added a request goes back.

So a resident that talks to a model or a chat surface has its state rebuilt per attempt. Keeping
it means persisting it in the [store]({docs}/{currentVersion}/guides/store), or serving an
app-level request pair as a proxy from inside the supervised block — and the state and whatever
consumes it belong on the same side of the boundary.

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

<DocCards>
  <DocCard href="{docs}/{currentVersion}/concepts/escalation" />
  <DocCard href="{docs}/{currentVersion}/concepts/parallelism" />
  <DocCard href="{docs}/{currentVersion}/toolchain/runtime" />
  <DocCard href="{docs}/{currentVersion}/guides/scheduled-jobs" />
</DocCards>
