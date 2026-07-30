---
title: Handler geometry
description: "Where you install a handler decides what it catches — a handler body escalates from its install site, so the order of a stack of handlers is load-bearing. The rules for reading and arranging one, and the convention that follows from them: a request answers with its own failure, because the performer cannot catch it."
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
wins; the outer never sees it. A `prelude.throw` handler additionally selects by payload type — but
**not by naming a subset of it.** The clause must accept the _whole_ union its block can throw:
`request prelude.throw(error: not_found)` in front of a body that throws `not_found | denied` does
not catch the one and let the other travel past, it fails to typecheck, because a clause that cannot
accept everything reaching it is not a handler for that request. Catch the union, then split it
**inside** the clause with a `match`, re-raising the arm you are not answering — `case rest ->
{ prelude.throw(error = rest) }`, which rethrows the residual exactly as bound, with no
reconstruction. `guarded_notify` below is that shape in full. Position still decides among handlers
that _could_ match.

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

## Performing is a hole in your own guard

Read from the handler, the install-site rule says where a clause body's own requests resolve. Read from the
**performer**, the same rule says something sharper:

> **Every request you perform is a hole in your own failure handling, the exact size of the handler that
> answers it.**

A `prelude.throw` guard bounds **your frame**. The clause that answers your request does not run in your
frame — it runs at its install site, above you — so a throw it lets fly is raised _past_ you, and your
guard's dynamic extent never contains it. Wrapping the performing code more tightly cannot help: there is
nothing in that frame left to catch. And the hole is widest exactly where the layering is most correct. A
fiber forked into a nursery owns no policy by design, so the calls likeliest to fail — putting a question to
a person, resolving a credential, posting to a chat platform — sit in handler bodies above the `watch`,
which is to say above the fiber's own guard. [Approval gates]({docs}/{currentVersion}/guides/approval-gates)
shows the guard that _does_ hold, the one covering a fiber's own frame; this section is about everything
that guard cannot reach.

**And the performer's row is not wrong to omit it.** Nothing is thrown in the performer's frame, so no
`prelude.throw[...]` belongs on its row, and `katari check` is right to accept it. Note what that costs:
`prelude.throw[T]` reads identically whether a frame can _catch_ `T` or `T` is raised above it by a handler
that frame installed, and only the shape of the signature tells the two apart. What no row expresses is
this — **performing a request may simply not return**, because the handler above it failed.

## Answer with the failure

The convention that pays for the hole:

> **A request whose handler body touches anything that can fail recoverably answers with a SUM that
> includes its own failure.**

A value travels back through the escalation the performer is already waiting on, so a value is the one form
of failure a performer can act on at all. A throw from the same body travels the other way.

This is the house style rather than advice — the stdlib and the packages are already written in it:

- **`store.get` answers `found | absent`.** A missing key is a value you match on, never an error you catch
  ([Store]({docs}/{currentVersion}/guides/store)).
- **`ai.take_turn` answers `session_turn | failed_turn`.** A provider failure at any step comes back as a
  value, so a resident event loop absorbs a model outage as one match arm instead of unwinding a
  conversation it spent a week building.
- **`e2b`'s provider answers `session_ready | session_unavailable`**, and its own comment gives this guide's
  reason: _"the provider's deep handler cannot throw back into the tool that performed `session`, so the
  tool must be able to READ the failure."_

The shape, whole. The failing call inside the handler body is wrapped in a guard of its **own**, and that
guard converts rather than hides:

```katari
@"A bad address: the same answer tomorrow, so no retry fixes it."
data address_rejected(message: string)

@"The upstream was briefly unreachable — waiting is a real remedy."
data upstream_unavailable(message: string)

// What handing one line to the upstream can fail with. (Type synonyms take no docs.)
type delivery_error = address_rejected | upstream_unavailable

@"Stand-in for the one call that can fail — a real one is an `http.fetch` or a package's send."
agent hand_to_upstream(line: string) -> null with prelude.throw[delivery_error] {
  if (string.is_blank(value = line)) {
    prelude.throw(error = address_rejected(message = "an empty line has nowhere to go"))
  } else {
    null
  }
}

@"The line reached the upstream."
data sent()

@"It did not, and this is why — carried back as a VALUE, because the performer cannot catch a throw raised above it."
data not_sent(reason: string)

// What performing `notify` answers with. (Type synonyms take no docs.)
type notify_outcome = sent | not_sent

@"Deliver one line. Served ABOVE whoever performs it, so it answers with its own failure."
request notify(line: string) -> notify_outcome

@"The handler's whole body: hand the line over, and answer with what happened. A self-healing failure becomes the `not_sent` VALUE; the non-self-healing half RE-RAISES and still stops the run loudly."
agent guarded_notify(line: string) -> notify_outcome with prelude.throw[address_rejected] {
  use handler {
    request prelude.throw(error: delivery_error) -> never {
      match (error) {
        case address_rejected(message => message) -> { prelude.throw(error = address_rejected(message = message)) }
        case upstream_unavailable(message => message) -> { break not_sent(reason = message) }
      }
    }
  }
  hand_to_upstream(line = line)
  sent()
}

@"The performer: it holds no guard, because a guard here could not see the handler's failure anyway. It READS the outcome instead."
agent report(line: string) -> string with prelude.throw[address_rejected] {
  use handler {
    request notify(line: string) { next guarded_notify(line = line) }
  }
  match (notify(line = line)) {
    case sent(_) -> "delivered"
    case not_sent(reason => reason) -> f"not delivered: ${reason}"
  }
}
```

`guarded_notify` is the handler's body, so it runs at the install site and is the last frame that can still
turn a failure into something the performer will see. `report` is the performer, and it holds no guard at
all — it dispatches on `notify_outcome` like any other value, which is what makes it total. The escalation
report states the whole convention in three rows: `hand_to_upstream` escalates
`prelude.throw[address_rejected | upstream_unavailable]`, while `guarded_notify` and `report` both escalate
only `prelude.throw[address_rejected]`. The self-healing half left the throw row and became a value.

**Where the line falls.** Not every failure should become a value.

- **Self-healing failures become values.** A transient 5xx, a rate limit, a dropped connection, a platform
  refusing one over-long field — waiting or asking again is a real remedy, so the program should live to
  try. This is the case the convention exists for.
- **Non-self-healing failures still throw, loudly.** A revoked token, a missing secret, a defect no retry
  will fix — nothing in the program's future changes the answer. Absorb one of those and a long-running
  program degrades in silence: it runs, it looks alive, and everything arriving at it is quietly dropped.
  For a failure that will never heal that is strictly worse than a stopped run, because a stopped run is a
  fact somebody notices. Distrust the middle road especially — turning such a failure into a _restart_
  reason yields a crash loop, and a supervisor's repeat-suppression then quiets that loop down to nothing.

**The handler decides, once.** The verdict belongs to the handler serving the request and not to each
caller, because a caller cannot tell whether the upstream is having a bad minute or has been switched off.
Put it in ONE agent returning a sum (the reference bot's `classify_crash` returns `must_stop |
restartable`), and let every frame that needs the same opinion dispatch on that sum. Then a supervisor, a
fiber's guard and a request's answer cannot drift on what "fatal" means, and widening the fatal set is one
edit in one place.

## Never synthesize an answer to make the type fit

The failure arm **names the failure**. It must never be a plausible-looking success.

The temptation is real, because a forged success is often the shortest path to a signature that checks. A
request answering `granted | refused`, whose handler could not put the question in front of anybody, has a
`refused` arm sitting right there — and filling it in with a synthesized operator action would put words in
a person's mouth so that a type would check. The program would then be told a human declined when no human
ever saw the question, and nothing downstream could tell the difference.

The correct answer is a variant that says what actually happened: nobody was asked. Every reader folds it
into "not approved" **at that failure's own reason**, which makes fail-closed structural instead of a rule
someone has to remember — nothing was approved, because nobody was asked.

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

A multi-agent resident Discord bot (the tsukasa reference program, which is not public) is the
worked example; every one of its handler positions falls out of the test above. For a smaller
instance of the same geometry that you can read and run, see
[concierge](https://github.com/katari-lang/examples/tree/main/concierge): two desks, one bus,
and the same reasoning at a quarter of the size.

| Handler                                          | Position                                | Why                                                                                                                                                                                                                                               |
| ------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The **core desk** (a sequential message handler) | Highest of the desks                    | The worker desk's undeliverable-mail bounce and the `crashed` / `failed` handlers all perform `core_message` from their bodies; a body reaches only handlers installed earlier, so core's must be first.                                                     |
| The **`region.crashed`** / **`region.failed`** interpreters | Below the desks              | Their bodies mail core (`core_message`) — which the core desk above them serves. Both ride `watch`'s row, so both must be installed.                                                                                                              |
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
- [FFI sidecars]({docs}/{currentVersion}/guides/ffi-sidecars) — the same outcome-as-value convention at
  the TypeScript boundary, where a raw exception is not even a throw.
- [Parallelism]({docs}/{currentVersion}/concepts/parallelism) — regions, fibers, and the `watch` this
  guide's serialization story rides on.
- The `prelude.region` and `prelude.store` modules in the [reference](/packages/prelude) — the
  stdlib handlers whose geometry these rules describe.
