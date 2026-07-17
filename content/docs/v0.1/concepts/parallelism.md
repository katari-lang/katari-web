---
title: Parallelism
description: parallel for and parallel blocks fan work out to concurrent threads; results join in source order, and escalations park per thread.
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
flows down. There is no detached spawn: every thread has a place in the tree, which is why
the run page can always show you what, exactly, is still running.

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

## Where to go next

- [Durable execution]({docs}/{currentVersion}/concepts/durable-execution) — what a parked
  thread costs and how it survives.
- [Agents and delegation]({docs}/{currentVersion}/concepts/agents-and-delegation) — the tree
  the branches live in.
- [A Discord bot]({docs}/{currentVersion}/tutorial/a-discord-bot) — concurrency serving real
  traffic.
