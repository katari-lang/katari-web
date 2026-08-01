---
title: Parallelism
description: parallel for and parallel blocks fan work out to concurrent threads and join in source order; regions fork detached fibers whose reports surface at watch.
---

Concurrency in Katari is a keyword, not a library. Prefix a `for` or an array literal with
`parallel` and its parts run concurrently, each on its own thread; the expression's value is
the joined result, in source order. Because execution is durable, "concurrently" includes
waiting — three branches sleeping a day each cost three rows in a database, not three
processes.

## parallel for

```katari
@"Three staggered sleeps run concurrently: the total wait is the longest, not the sum.
The result array is in source order regardless of completion order."
agent staggered() -> array[number] with io {
  parallel for (let delay in [300, 200, 100]) {
    time.sleep(milliseconds = delay)
    next time.now()
  }
}
```

`parallel for` is the concurrent map: one thread per element, `next value` contributes that
iteration's element, and the whole expression completes when every branch has. Drop the
`parallel` and the same loop runs sequentially — the value and types are identical; only the
scheduling changes. A `var` accumulator (`for (let v in vs, var total = 0)`) belongs to the
sequential form: each arm of a `parallel for` would start from the initial value and the
writes would not accumulate, so collect the branch results and fold after the join instead.

## parallel blocks

```katari
@"Ask the operator about one topic; unhandled, this parks its thread."
request ask(question: string) -> string

@"Consult on one topic — one node of the delegation tree."
agent consult(topic: string) -> string with ask {
  let advice = ask(question = f"What should we consider about ${topic}?")
  f"${topic}: ${advice}"
}

@"Both consultations park in parallel; each answer resumes its own thread."
agent panel(first: string, second: string) -> array[string] with ask {
  parallel [consult(topic = first), consult(topic = second)]
}
```

`parallel [ ... ]` runs a fixed set of expressions — they need not be calls to the same
agent — and yields their results in source order.

## Threads

A **thread** is a running instance of one block inside an agent instance; `parallel` spawns
one per branch. Threads are the unit the runtime persists and the unit that parks: each
branch performs its own effects against the same handlers up the chain, waits on its own
external calls, and survives restarts independently.

The join is structural — the parallel expression is a node in the delegation tree, and its
parent suspends until every child settles. If one branch fails (an uncaught throw or a
panic), the failure unwinds the parallel expression and the still-running siblings are
cancelled: failure flows up, cancel flows down. Every thread has a place in the tree, and a
[region's]({docs}/{currentVersion}/concepts/parallelism#regions-and-fibers) fibers live
under the `provide` that opened their nursery, which is why the run page can always show
you what, exactly, is still running.

## Parking in parallel

Run `panel` with nothing handling `ask` and both branches escalate: two open questions,
side by side, each blocking only its own thread. The run page shows the tree — `panel`
holding two `consult` children, each parked on its question. Answer one and that branch
resumes, computes its result, and waits at the join; the other stays parked for as long as
it takes. Combined with a fan-out, this is the pattern from the
[front page]({docs}/{currentVersion}/getting-started):

```katari
@"Fan out over a whole array, then join the findings into one report."
agent survey(topics: array[string]) -> string with ask {
  let notes = parallel for (let topic in topics) {
    next consult(topic = topic)
  }
  string.join(parts = notes, separator = "\n")
}
```

Ten topics open ten questions at once; the report assembles itself as answers arrive, in
whatever order humans get to them — minutes or days later, across restarts. Parallelism and
[escalation]({docs}/{currentVersion}/concepts/escalation) compose without any code
acknowledging the other, because both are just threads parking and resuming.

## Regions and fibers

`parallel` waits; a region listens. A **region** is a nursery holding detached children —
**fibers** — that outlive the turn that forked them and are heard through their escalations.
That is the shape of a resident program: a chat watcher, a cron, a background worker, each
running for as long as the program does and reporting what it sees.

`use region.provide[Scope, E]` opens a nursery for the rest of the block, `region.fork` puts
a fiber into it and returns immediately with a handle, and `region.watch` re-emits the
fibers' escalations into the enclosing program. A fork is a deferred call: `task` is
`agent A -> null`, `argument` is the whole parameter record of the call the fiber will make,
and a nullary task is forked with `argument = {}`. The task keeps its own parameter names,
and a wider record fits.

```katari
@"A fiber reports through its escalations; the report is fire-and-forget."
request tick_seen(at: number) -> null

@"The region's scope marker: a nullary phantom, one per nursery."
effect clock_scope

// The fiber ceiling: everything a fiber of this nursery may raise.
type clock_ceiling = tick_seen | io

@"A detached ticker: report forever. A fiber carries no result, so the task is `-> null`
(`-> never` fits by subtyping) and everything it produces leaves through its escalations."
agent ticker(every_milliseconds: number) -> never {
  forever {
    time.sleep(milliseconds = every_milliseconds)
    tick_seen(at = time.now())
  }
}

@"A nullary task: forked with `argument = {}`."
agent heartbeat() -> never {
  forever {
    time.sleep(milliseconds = 60000.0)
    tick_seen(at = time.now())
  }
}

@"Open a nursery, fork two fibers, and serve their reports at `watch`: the handler counts three
ticks, then `break` ends the block — closing the nursery cancels whatever is still running."
agent three_ticks() -> integer with io {
  use handler (var seen: integer = 0) {
    request tick_seen(at: number) {
      if (seen + 1 >= 3) { break 3 } else { next null with { seen = seen + 1 } }
    }
    request region.crashed(id: string, name: string, message: string) { break seen }
    request region.failed(id: string, name: string, error: unknown) { break seen }
  }
  let nursery: region.nursery[clock_scope, clock_ceiling] = use region.provide[clock_scope, clock_ceiling]
  let _ticker = region.fork(nursery = nursery, task = ticker, argument = { every_milliseconds = 200.0 }, name = "ticker")
  let _heartbeat = region.fork(nursery = nursery, task = heartbeat, argument = {}, name = "heartbeat")
  region.watch(nursery = nursery)
}
```

A fiber runs under the region's `watch`: its escalations surface there and nowhere else.
`watch`'s row is `E | crashed | failed | Scope | io`, where `E` is the ceiling the nursery
fixed up front — a fiber that raises more is a type error — so a row covering
`E | crashed | failed` around the watch covers everything any fiber can surface, and one
handler wrapping the watch covers every fiber at once.

The two endings a task cannot report itself arrive as data. `crashed` carries a panic's
message, `failed` carries the value the fiber threw exactly as it was thrown, so a handler
`match`es it as any other value — and what a death means (report it, fork a replacement,
bring the region down) is that handler's decision. Serving both is part of the region's
obligation, checked by `katari check`. A normal completion and a cancellation are silent.

The scope marker makes the lifetime static: a fiber cannot escape its `provide` (returning
one is a type error), and when the block ends, still-running fibers are cancelled. Declare
one marker per nursery when you nest them. A fiber need not wait for its watch either —
escalations raised before one is installed are held durably and drain in arrival order the
moment one registers, so a fiber may report the instant it forks.

## The nursery is the registry

`fork` takes an optional `name` tag, which `roster`, `crashed` and `failed` all echo back.
`region.roster` reads the live set straight from the runtime — one `fiber_info`, id and
name, per running fiber, so a settled fiber is simply absent — and `region.cancel_by_id`
tears one down by its runtime-minted id, answering `cancelled` or `unknown_fiber`. An id is
plain data, which is what lets it survive a store round-trip or ride into a model-facing
stop tool, and a stale one is a value to render rather than an error.

```katari
@"Cancel every fiber the runtime still reports as running, and count the live ones."
agent stop_all(nursery: region.nursery[clock_scope, clock_ceiling]) -> integer with clock_scope | io {
  for (let running in region.roster(nursery = nursery), var stopped: integer = 0) {
    match (region.cancel_by_id(nursery = nursery, id = running.id)) {
      case region.cancelled(id => _) -> { next with { stopped = stopped + 1 } }
      case region.unknown_fiber(id => _) -> { next with { stopped = stopped } }
    }
  } then (_fibers) { stopped }
}
```

One `watch` is enough: it re-emits every fiber's escalation concurrently the instant it
arrives and adds no ordering of its own, so the only serialization point is the receiving
handler — a sequential (`var`) one serves escalations at its own FIFO in arrival order while
a `parallel handler` serves them at once. A second watch buys no concurrency.

## Where to go next

<DocCards>
  <DocCard href="{docs}/{currentVersion}/guides/residents" />
  <DocCard href="{docs}/{currentVersion}/guides/handler-geometry" />
  <DocCard href="{docs}/{currentVersion}/concepts/durable-execution" />
  <DocCard href="{docs}/{currentVersion}/concepts/agents-and-delegation" />
</DocCards>
