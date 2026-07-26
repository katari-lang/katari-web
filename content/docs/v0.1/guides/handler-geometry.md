---
title: Handler geometry
description: Where you install a handler decides what it catches — a handler body escalates from its install site, so the order of a stack of handlers is load-bearing. The rules for reading and arranging one.
---

Handlers stack. `use handler` installs its clauses for the rest of the block, so a program that
installs several builds a **stack**: outer handlers wrap inner ones, and a performed request travels
outward through that stack until one catches it. The machinery is covered in
[Effects and handlers]({docs}/{currentVersion}/concepts/effects-and-handlers); this guide is about the
one thing that machinery does not put on the page — **where** each handler goes, and why moving one
breaks a program somewhere else.

The rows are checked, so the _obligations_ are enforced: a request your code can perform must be
handled or carried, and `katari check` will not let you forget one. What is **not** marked in the
source is the reason a handler sits where it sits. That is convention, held together by the rule below.

## Discharge is extraction, inside-out

A request escalates **outward**. Performing `R` inside a block looks for the nearest handler that
serves `R` in the enclosing stack; found, that handler answers and `use handler` **discharges** `R`
from the block's row. Unhandled all the way to the run root, `R`
[escalates]({docs}/{currentVersion}/concepts/escalation) to a human. So a stack of handlers peels a
run's effects off from the **inside out**: the innermost handler that serves a request is the one that
gets it, and every handler discharges exactly the requests it names, leaving the rest to travel past.

"Nearest enclosing" is the whole selection rule. Two handlers for the same request — the inner one
wins; the outer never sees it. A `prelude.throw` handler additionally selects by payload type
(`request prelude.throw(error: not_found)` catches only that error and lets others pass), but position
still decides among handlers that _could_ match.

## The install-site rule

The rule that makes the geometry non-obvious is this:

> **A handler body's own performs escalate from the handler's install site — not from where the
> request it is answering was performed.**

A handler clause is ordinary code, and it may perform requests of its own. When it does, those
requests do **not** resolve against whatever handlers were in scope at the distant perform site that
triggered the clause. They resolve against the handlers installed **above the clause's own `use
handler`**. A handler body can only reach handlers installed _earlier than itself_.

```katari
@"Record one audited line — served at the TOP of the block."
request audit(line: string) -> null

@"Do a named thing — served in the MIDDLE; its body performs `audit`."
request act(name: string) -> null

agent run() -> null {
  use handler {                                  // installed FIRST — outermost
    request audit(line: string) { next null }
  }
  use handler {                                  // installed SECOND — inside `audit`
    request act(name: string) {
      audit(line = f"did ${name}")               // escalates from HERE, `act`'s install site
      next null
    }
  }
  act(name = "deploy")                           // the perform that starts it all
}
```

`act`'s clause performs `audit`. That `audit` does not look at `run`'s body where `act(name =
"deploy")` was called — it escalates from the `act` handler's own position, and finds the `audit`
handler installed above it. The `act` handler discharges `act`; its body's `audit` rides its row up to
the `audit` handler; `run` ends pure.

Swap the two `use handler` blocks — `act` above `audit` — and it stops compiling. Now `act`'s body
performs `audit` from a position with no `audit` handler above it, so `audit` rides all the way to the
run root and `run`'s row can no longer be pure. The error lands on the **`audit(...)` perform inside
the `act` clause**, not on the `use handler` you moved (see [When the geometry is
wrong](#when-the-geometry-is-wrong)).

## Sequential or parallel: the handler is the only serialization point

A handler is either **sequential** or **parallel**, and that choice is orthogonal to position but
often decided together with it.

A **sequential** handler carries `var` state (`use handler (var count = 0) { ... }`). Its invocations
run one at a time, through a FIFO, in arrival order — it is an **actor**, and its `var` is that actor's
private state, sound precisely because no two clause bodies run at once. A **parallel** handler (`use
parallel handler { ... }`) dispatches its clause bodies concurrently and therefore **cannot** hold
`var` state: two overlapping bodies would read the same value, each advance it, and the later write
would silently drop the earlier — a lost update. The compiler rejects `var` on a `parallel handler` at
the entrance (K3025), the same way it rejects `var` on a `parallel for` (K3024). Use a sequential
handler when clause bodies share state or must not interleave; use a parallel handler for stateless
clauses that should run concurrently.

This matters most under a region's `watch`.
[`region.watch`]({docs}/{currentVersion}/concepts/parallelism#regions-fork-without-join) is
**transparent**: it re-emits every fiber's escalation concurrently, the instant it arrives, and
imposes no ordering of its own. So the **only** serialization point is the receiving handler. Two
escalations routed to _different_ handlers always run concurrently — a handler blocked on one (a
human-latency approval, say) never starves another. Two escalations routed to the _same_ sequential
handler serialize at that handler's FIFO. This is why a resident chat loop keeps one `var` handler per
conversation stream: the handler _is_ the actor, and it stays in order for free while independent
streams keep flowing.

## Reading a stack: up or down

Putting the two rules together gives a decision procedure for every handler:

- A handler must be installed **above** any code whose escalations it must catch — and by the
  install-site rule, that includes the **bodies of handlers installed below it**.
- The concrete test: **if handler A's body performs request R, then R's handler must be above A.**
- A handler whose clauses are also **tools** — agent values handed to a model or a dispatched turn,
  which mutate its `var` state — must sit **above** the dispatcher that runs those turns, because the
  tool call happens inside the dispatched turn, below the dispatcher.

A resident Discord bot (the tsukasa reference program) is the worked example; every one of its
handler positions falls out of the test above:

| Handler                                          | Position                                | Why                                                                                                                                                                                                                                               |
| ------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The **core desk** (a sequential message handler) | Highest of the desks                    | The worker desk's undeliverable-mail bounce and the `crashed` handler both perform `core_message` from their bodies; a body reaches only handlers installed earlier, so core's must be first.                                                     |
| The **`region.crashed`** interpreter             | Below the desks                         | Its body mails core (`core_message`) — which the core desk above it serves.                                                                                                                                                                       |
| The **worker table** (`var workers`)             | Above the dispatcher                    | Its mutators are tools that run inside a dispatched turn, so the table must enclose the turn.                                                                                                                                                     |
| The **ask adapter** (`ask_operator`)             | Above the desks _and_ above the `watch` | Both a desk _tool_ and a gate _fiber_ perform `ask_operator`, and a fiber's perform surfaces at `region.watch` — so the adapter must enclose the watch as well as the desks. See [Approval gates]({docs}/{currentVersion}/guides/approval-gates). |
| The **gate bridge** (`spawn_gate`)               | Below the nursery, above the desks      | It forks into the nursery, so it needs the handle in scope; its clauses are reached from desk tools, so it must still enclose the desks.                                                                                                          |

Read a stack this way — "what does each clause body perform, and is that handler above it?" — and the
order stops being arbitrary.

## When the geometry is wrong

There is, in v0.1.0, **no dedicated diagnostic for a misplaced handler**. A handler in the wrong
position surfaces as an ordinary row mismatch — a **K3001** subtype error — reported at the **perform
site**, not at the handler you moved. A body that performs a request whose handler is now below it
leaves that request in a row where it cannot be discharged, and the checker points at the perform. The
fix is to read the install-site rule backwards from there: _which handler serves this request, and is
it above this code?_

Two related diagnostics show up while spelling the rows a handler stack needs, and neither is a
geometry error — they are about _naming_ the effects, and the messages now teach the fix:

- **K3011** — an effect override `{...E, ...}` may only name **requests**. The built-in `io` effect is
  not a request, so it cannot ride inside the override braces; union it on outside as `| io`
  (`{...E, my_request} | io`). The message names the offending effect and the `| io` form.
- **K3013** — a `use provider[Scope, Row]` install needs its row spelled, and writing a long ceiling
  row twice (once as the binder annotation, once as the type argument) invites drift. Name it once as
  an **effect-row type synonym** — `type my_ceiling = request_a | request_b | io` — and use the
  synonym in both places. The message shows this synonym form.

## Where to go next

- [Effects and handlers]({docs}/{currentVersion}/concepts/effects-and-handlers) — the request /
  handler machinery this guide arranges.
- [Approval gates]({docs}/{currentVersion}/guides/approval-gates) — the idiom that most depends on
  getting a handler's position right: an ask adapter above the watch, a spawn handler below the
  nursery.
- [Parallelism]({docs}/{currentVersion}/concepts/parallelism) — regions, fibers, and the `watch` this
  guide's serialization story rides on.
- The `prelude.region` and `prelude.store` modules in the [reference](/packages/prelude) — the
  stdlib handlers whose geometry these rules describe.
