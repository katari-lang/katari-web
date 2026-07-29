---
title: "A second agent: desks and mail"
description: Growing one resident into two. A desk is a request plus a sequential handler; mail between desks is a fiber whose whole body is one perform — which is what keeps two agents from deadlocking on each other.
---

[The tutorial's last chapter]({docs}/{currentVersion}/tutorial/a-discord-bot) leaves you with one
resident: a nursery, a source fiber that reports what it hears, and one handler that serves those
reports in order. This guide adds the second agent, and the whole of it is two ideas:

> **A desk is one request plus one sequential handler** — a serialization domain, with its own state
> and its own FIFO.
>
> **Mail between desks is a fiber whose whole body is one perform** — never a direct call.

Everything else follows, including why the second one has to be true.

The example below is deliberately package-free: the two desks do arithmetic instead of running a
model turn, so the mechanism is the only thing on the page. Swap a desk body for
`ai.advance_desk(...)` and it is the real thing.

## A desk is a request plus a sequential handler

Two agents that share a bus need to be told apart, and the thing that tells them apart is **which
request their events arrive on**. One request per agent:

```katari
@"The front desk's inbox. @hop@ counts how many agent-to-agent hops this message has taken."
request front_message(source: string, content: string, hop: integer ?= 0) -> null

@"The back desk's inbox."
request back_message(source: string, content: string, hop: integer ?= 0) -> null
```

Each is served by its own **sequential** handler — one with `var` state. Here is a whole one-desk
program, which is the tutorial's shape with everything but the desk taken away:

```katari
request desk_message(source: string, content: string) -> null

effect desk_scope

type desk_ceiling = desk_message | io

agent one_source(input: null) -> never with desk_ceiling {
  forever {
    time.sleep(milliseconds = 200.0)
    desk_message(source = "world", content = "tick")
  }
}

agent one_desk() -> never with io {
  use handler (var transcript: array[string] = []) {
    request desk_message(source: string, content: string) {
      // one turn, start to finish — nothing else runs at this desk while it does
      next null with { transcript = array.append(target = transcript, value = f"${source}: ${content}") }
    }
  }
  let nursery: region.nursery[desk_scope, desk_ceiling] = use region.provide[desk_scope, desk_ceiling]
  use handler {
    request region.crashed(id: string, name: string, message: string) { next null }
    request region.failed(id: string, name: string, error: unknown) { next null }
  }
  let _source = region.fork(nursery = nursery, task = one_source, argument = null, name = "source")
  region.watch(nursery = nursery)
}
```

A sequential handler serves its requests at a FIFO, in arrival order, so its `var` is an actor's
state: no two turns of the same desk ever overlap, and nothing else can write it. That is the whole
serialization story, and it is **per desk, not global** — `region.watch` re-emits every fiber's
escalation concurrently and imposes no ordering of its own, so a slow turn at the back desk never
stalls the front one. Extra `watch` calls buy nothing; **the desks are told apart by their handlers,
not by more watches.**

The corollary is a rule you should apply before writing any code: **one desk per thing that must not
interleave with itself.** A conversation, a worker, a per-user inbox. If two streams may safely run at
once, they want two desks — not one desk with a bigger record.

`use parallel handler` is exactly the wrong tool here, and the compiler says so
([K3025]({docs}/{currentVersion}/toolchain/error-codes)): a parallel handler dispatches its bodies
concurrently, so two overlapping turns would each advance the state from the same value and one write
would silently vanish.

## Mail is a fiber, not a call

Now the front desk wants to hand something to the back desk. The obvious spelling is a direct
perform:

```katari
// DOES NOT COMPILE — this is the mistake, not the fix.
back_message(source = "front", content = content, hop = hop + 1)
```

It does not compile, and the diagnostic is worth reading in full because it names the real problem:

```text
office:33:1 K3001: Left effect performs a request not present in the right effect: office.back_message
  Note: `office.back_message` is served by the handler installed at line 82, but a handler body's
  performs escalate from its own install site and reach only handlers installed ABOVE it — move that
  handler earlier, or this perform later.
  expected: io
  actual:   back_message | io
```

A handler body's own performs escalate from **the handler's install site** — see
[Handler geometry]({docs}/{currentVersion}/guides/handler-geometry) — so a desk can only reach desks
installed above it. Two desks that mail each other need each to be above the other, which is not a
thing. And even if you could arrange it, a direct perform would be wrong: the front desk would be
holding its own FIFO while synchronously waiting inside the back desk's, and a reply addressed back to
the front desk would deadlock against the turn that sent it.

The fix is to stop performing and start **posting**:

```katari
let _mail = region.post(
  nursery = nursery,
  task = agent () -> null with back_message { back_message(source = "front", content = content, hop = hop) },
  name = "front->back",
)
```

`region.post` forks a fiber whose whole body is that one perform. Three consequences, and they are the
reason this shape exists:

- **It leaves the current turn.** The perform now happens in a fiber, so its escalation joins the
  region's mailbox and surfaces at `region.watch` — **below every desk**, which is why it can reach
  any of them regardless of install order. Mail is order-free; a direct perform is not.
- **It queues behind the current turn.** A mid-turn send cannot re-enter its own sequential desk,
  because the fiber's escalation lands in the mailbox and the desk is still busy with the turn that
  sent it. No deadlock, and FIFO ordering for free.
- **It does not widen the sender's row.** `post`'s own effect is `Scope | io`; the desk request lives
  in the _task's_ row, not the caller's. So sending mail to a desk costs the sender nothing in its
  signature — which is exactly why the geometry stops mattering.

The nursery is the message queue, and it is durable: escalations survive a restart and drain in
arrival order. There is no new machinery here at all.

There is **no synchronous ask between agents.** A question is a send; the answer is a later send back.
If you want a reply, mail one.

## One bridge, so the desks never hold the handle

`region.post` needs the nursery handle, and the handle is minted by `region.provide` — which sits
_below_ the desks in the block. A desk body cannot see it. So the desks perform one more request, and
one handler installed between the nursery and the desks turns it into mail:

```katari
@"Mail one agent from another. The only request a desk body performs to reach another desk."
request send(to: string, content: string, hop: integer) -> null
```

That handler is the **mail bridge**. It is the single place the addressee string is dispatched onto a
desk request — one flat `match`, written once — and it is the reason a desk body never touches
`region.post`, the nursery, or the name of any other desk's request.

The install order for the whole block falls out of one test — _if handler A's body performs request R,
then R's handler must be above A_:

| Position (outermost first)                   | Why there                                                                                       |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Providers, and any adapter a fiber may reach | A fiber's perform surfaces at `region.watch`, so anything a fiber needs must enclose the watch. |
| `use region.provide[…]`                      | Everything below it may hold the nursery handle.                                                |
| **The mail bridge**                          | Below the nursery (it needs the handle), above the desks (their bodies perform `send`).         |
| **The desks**, in any order                  | Their bodies reach nothing but the bridge, so nothing orders them relative to each other.       |
| `region.crashed` / `region.failed`           | Below the desks, so its body may address them directly.                                         |
| `region.fork(…)`, then `region.watch(…)`     | The sources, and the one pump that re-emits their escalations.                                  |

"**The desks, in any order**" is the payoff. In a program where agents call each other directly, every
new agent re-opens the ordering question for every existing one. Here the mail bridge absorbs it.

## The whole program

Two desks, mutual mail, a source, and a crash policy — a complete `src/office.ktr` that
`katari check` accepts as written:

```katari
// ── the bus: one request per serialization domain ─────────────────────────────────────

@"The front desk's inbox. @hop@ counts how many agent-to-agent hops this message has taken."
request front_message(source: string, content: string, hop: integer ?= 0) -> null

@"The back desk's inbox."
request back_message(source: string, content: string, hop: integer ?= 0) -> null

@"Mail one agent from another. The only request a desk body performs to reach another desk."
request send(to: string, content: string, hop: integer) -> null

@"The region's scope marker: one nullary phantom per nursery."
effect office_scope

// Everything a fiber of this nursery may raise.
type office_ceiling = front_message | back_message | io

data done(transcript: string)

// ── a source: the world, arriving as escalations ──────────────────────────────────────

agent world(input: null) -> never with office_ceiling {
  for (let word in ["katari", "desk", "mail"]) {
    time.sleep(milliseconds = 200.0)
    front_message(source = "world", content = word)
    next null
  }
  forever { time.sleep(milliseconds = 1000.0) }
}

// ── the office ────────────────────────────────────────────────────────────────────────

agent office() -> string with io {
  use handler {
    request prelude.throw(error: done) -> never {
      match (error) { case done(transcript => text) -> { break text } }
    }
  }

  let nursery: region.nursery[office_scope, office_ceiling] = use region.provide[office_scope, office_ceiling]

  // THE MAIL BRIDGE. Below the nursery, because it needs the handle; above the desks,
  // because their bodies perform it.
  use handler {
    request send(to: string, content: string, hop: integer) {
      match (to) {
        case "back" -> {
          let _mail = region.post(
            nursery = nursery,
            task = agent () -> null with back_message { back_message(source = "front", content = content, hop = hop) },
            name = "front->back",
          )
          next null
        }
        case _ -> {
          let _mail = region.post(
            nursery = nursery,
            task = agent () -> null with front_message { front_message(source = "back", content = content, hop = hop) },
            name = "back->front",
          )
          next null
        }
      }
    }
  }

  // DESK ONE — the front. Sequential, so its `var` state is sound.
  use handler (var transcript: array[string] = []) {
    request front_message(source: string, content: string, hop: integer) {
      let line = f"front <- ${source}#${string.to_string(value = hop)}: ${content}"
      let grown = array.append(target = transcript, value = line)
      if (array.length(target = grown) >= 6) {
        prelude.throw(error = done(transcript = string.join(parts = grown, separator = " | ")))
      } else {
        if (hop < 2) { send(to = "back", content = content, hop = hop + 1) } else { null }
        next null with { transcript = grown }
      }
    }
  }

  // DESK TWO — the back. Its own state, its own FIFO, interleaved with the front's.
  use handler (var seen: record[integer] = record.empty()) {
    request back_message(source: string, content: string, hop: integer) {
      let count = match (record.get(target = seen, key = content)) {
        case null -> 1
        case previous -> previous + 1
      }
      send(to = "front", content = f"${content} x${string.to_string(value = count)}", hop = hop + 1)
      next null with { seen = record.set(target = seen, key = content, value = count) }
    }
  }

  // The crash policy, below the desks: its body may mail them directly.
  use handler {
    request region.crashed(id: string, name: string, message: string) {
      send(to = "front", content = f"fiber ${name} panicked: ${message}", hop = 2)
      next null
    }
    request region.failed(id: string, name: string, error: unknown) {
      send(to = "front", content = f"fiber ${name} threw", hop = 2)
      next null
    }
  }

  let _world = region.fork(nursery = nursery, task = world, argument = null, name = "world")
  region.watch(nursery = nursery)
}
```

The `done` throw is only there to make the example terminate — a real resident's `watch` never
returns. Everything else is load-bearing.

Note the two death events. `region.crashed` reports a fiber that **panicked** (a defect: it can only
carry a message); `region.failed` reports a fiber whose **throw** escaped (a value a correct program
can reason about). Both ride `watch`'s row, so `katari check` will not let you forget either — and
neither needs a guard at the fork, because the watch boundary traps the throw for you.

## Hops, and not talking to yourself

Two agents that can mail each other can mail each other **forever**. Nothing in the mechanism stops a
polite exchange from becoming an infinite one, and if the desks are model turns, each round trip costs
real money.

The damping is one field, carried on the bus and defaulted at the edge:

```katari
request front_message(source: string, content: string, hop: integer ?= 0) -> null
```

A message from the outside world arrives at `hop = 0` — the default does that, so a source never
thinks about it. Every desk that mails onward stamps `hop + 1`, and every desk refuses to mail onward
past a ceiling:

```katari
if (hop < 2) { send(to = "back", content = content, hop = hop + 1) } else { null }
```

Three properties are worth having on purpose. **The hop is a field, not a parsed prefix** — the moment
a display string becomes load-bearing, a rendering change becomes a routing bug. **The ceiling is per
desk**, so the desk that answers may still answer while the desk that initiates stops initiating.
And **exceeding the ceiling is not an error** — the message still lands, it just does not bounce
again; a conversation that runs out of hops should go quiet, not throw.

## Reading the escalation report

`katari check` ends with a report that is the fastest way to see what a new desk actually did to your
program:

```text
OK — 21 module(s), no errors
Entry points (requests that escalate to the run root):
  office.world
    escalates: office.back_message, office.front_message, io
  office.office
    escalates: (nothing but io)
```

Read it as **"what would reach a human"**. Two lines, two different questions:

- **`office.office` — `(nothing but io)`.** The office is closed. Every desk request raised anywhere
  inside it is served inside it, so nothing escalates and no human is ever asked about the bus. This
  is the line to check after adding a desk.
- **`office.world` — `office.back_message, office.front_message, io`.** That is the fiber's
  **ceiling**: the set of things this source is permitted to put on the bus. A fiber is not an entry
  point you run, but the report lists it as one, and reading it as a capability is the right instinct
  — this source may address either desk.

Now the useful part. Delete the back desk's handler and the report changes like this:

```text
  office.office
    escalates: office.back_message, io
```

Nothing failed. The program still compiles — it just quietly grew a **question for a human**: every
`back_message` now parks the run and waits for someone to answer it. That is the correct default (an
unhandled request is a question, which is
[the whole escalation model]({docs}/{currentVersion}/concepts/escalation)) and it is exactly the wrong
thing for a bus. So the discipline for adding an agent is:

1. Add its request and its sequential handler.
2. Add its addressee arm to the mail bridge's `match`.
3. Add its request to the nursery ceiling, so fibers may address it.
4. **Check that the composition root's `escalates` line did not grow.** If it did, you added a desk
   and forgot its desk.

## Where to go next

- [Handler geometry]({docs}/{currentVersion}/guides/handler-geometry) — the install-site rule this
  page leans on, and how to read a stack of handlers.
- [Parallelism]({docs}/{currentVersion}/concepts/parallelism#regions-fork-without-join) — regions,
  fibers, and why `watch` is transparent.
- [Asking a human]({docs}/{currentVersion}/guides/asking-a-human) — the other thing a desk must never
  block on. A question is a fiber too.
- [Error codes]({docs}/{currentVersion}/toolchain/error-codes) — K3001's geometry note, K3025, and
  the rest of what a misplaced handler looks like.
