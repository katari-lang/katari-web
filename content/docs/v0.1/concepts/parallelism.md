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
writes would not accumulate, so do not combine `parallel` with `var` — collect the branch
results and fold after the join instead.

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
external calls, and survives restarts independently. The join is structural — the parallel
expression is a node in the delegation tree, and its parent suspends until every child
settles. If one branch fails (an uncaught throw or a panic), the failure unwinds the
parallel expression and the still-running siblings are cancelled — failure flows up, cancel
flows down. There is no fully detached spawn: every thread has a place in the tree — even a
[region's]({docs}/{currentVersion}/concepts/parallelism#regions-fork-without-join) fibers
live under the `provide` that opened their nursery — which is why the run page can always
show you what, exactly, is still running.

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

## Regions: fork without join

`parallel` is the fork-**join** story: structured children, awaited, results as values. A
**region** is the fork-**escalate** story — detached children (**fibers**) that outlive the
turn that forked them, heard through their escalations. In one line: parallel waits, a
region listens. That is the shape of a resident program: a chat watcher, a cron, a
background worker — sources that run forever and report events, while the program serves
them.

```katari
@"A fiber reports through its escalations; the report is fire-and-forget."
request tick_seen(at: number) -> null

@"The region's scope marker: a nullary phantom, one per nursery."
effect clock_scope

// The fiber ceiling: everything a fiber of this nursery may raise.
type clock_ceiling = tick_seen | io

@"A detached ticker: report forever. Results ride escalations, so the task is `-> null`
(`-> never` fits by subtyping); the parameter is named `input` because parameter names
are part of an agent's type, and `fork` declares its task as `agent (input: A) -> null`."
agent ticker(input: number) -> never {
  forever {
    time.sleep(milliseconds = input)
    tick_seen(at = time.now())
  }
}

@"Open a nursery, fork a named ticker, and serve its reports at `watch`: the handler
counts three ticks, then `break` ends the block — closing the nursery cancels the fiber."
agent three_ticks() -> integer with io {
  use handler (var seen: integer = 0) {
    request tick_seen(at: number) {
      if (seen + 1 >= 3) { break 3 } else { next null with { seen = seen + 1 } }
    }
    request region.crashed(id: string, name: string, message: string) { break seen }
  }
  let nursery: region.nursery[clock_scope, clock_ceiling] = use region.provide[clock_scope, clock_ceiling]
  let _ticker = region.fork(nursery = nursery, task = ticker, argument = 200.0, name = "ticker")
  region.watch(nursery = nursery)
}
```

`use region.provide[Scope, E]` opens a **nursery** for the rest of the block; `fork` spawns
a fiber into it and returns immediately with a handle. There is deliberately **no join**: a
fiber carries no result — its task is `-> null`, and everything it produces leaves through
its escalations, which surface at `watch`. `watch`'s row is `E | region.crashed | Scope`:
`E` is the **ceiling** the nursery fixed up front (a child that raises more is a type
error), and `crashed` is the runtime's own event — a fiber's panic re-emitted as typed
data, so what a crash _means_ (restart the fiber, report it, bring the region down) is your
handler's decision, and handling it is part of the region's total obligation, checked by
`katari check`. The scope marker makes the lifetime static: a fiber cannot escape its
`provide` (returning one is a type error), and when the block ends, still-running fibers
are cancelled. Declare one marker per nursery when you nest them.

The nursery is also its own **registry**: `fork` takes an optional `name` tag,
`region.roster` reads the live set straight from the runtime (one `fiber_info` — id and
name — per running fiber, never stale), `region.cancel_by_id` tears one down by the
runtime-minted id and answers `cancelled | unknown_fiber` (a stale id is data to render,
not an error), and `region.fiber_id` reads a handle's id for a log or a model. One `watch` is
enough: it is a transparent white hole, re-emitting every fiber's escalation
concurrently the instant it arrives — the only serialization point is the
_handler_ around it, so a sequential (`var`) handler serves escalations at its
own FIFO in arrival order while a `parallel handler` serves them at once (extra
watches buy nothing; the desks are told apart by their handlers, not by more
watches). And a fiber need not wait for its watch: escalations it raises before
one is installed buffer in the nursery's durable mailbox and drain in arrival
order the moment a `watch` registers, so a fiber may report the instant it forks
and the `watch` may be set up arbitrarily late. The `prelude.region` module's
[reference](/packages) tells the full story.

## Where to go next

- [Durable execution]({docs}/{currentVersion}/concepts/durable-execution) — what a parked
  thread costs and how it survives.
- [Agents and delegation]({docs}/{currentVersion}/concepts/agents-and-delegation) — the tree
  the branches live in.
- [A Discord bot]({docs}/{currentVersion}/tutorial/a-discord-bot) — concurrency serving real
  traffic.
