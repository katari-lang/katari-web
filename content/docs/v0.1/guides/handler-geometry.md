---
title: Handler geometry
description: Arranging a stack of handlers — which one answers, what a clause body can reach, and where a provider, a fold and a stateful clause each belong.
---

`use handler` installs its clauses for the rest of the block, so a program that installs several
builds a stack, and a performed request travels outward through it until a clause serves it. The
machinery is in [Effects and handlers]({docs}/{currentVersion}/concepts/effects-and-handlers); what
the rows do not show is the reason each handler sits where it sits.

## A handler's body runs at its install site

A clause is ordinary code and may perform requests of its own. Those performs escalate from the
clause's own `use handler` — the ordinary semantics of algebraic effects — so a clause body reaches
exactly the handlers installed above itself, and never the ones in scope at the distant perform
that triggered it.

```katari
@"Record one audited line." request audit(line: string) -> null

@"Do a named thing; the clause that serves it performs `audit`." request act(name: string) -> null

agent run() -> null {
  use handler {                            // installed first, so it is the outer one
    request audit(line: string) { next null }
  }
  use handler {
    request act(name: string) {
      audit(line = f"did ${name}")         // escalates from here, `act`'s install site
      next null
    }
  }
  act(name = "deploy")
}
```

`act`'s clause performs `audit`, and that perform does not look at `run`'s body where
`act(name = "deploy")` was called. It escalates from the `act` handler's own position and finds the
`audit` handler installed above it, so `act` is discharged, `audit` rides its row one level up, and
`run` ends pure. Written the other way round, `audit` would ride all the way to the run root and sit
in `run`'s row — reported at the `audit(...)` perform inside the clause, not at the `use` line.

## Reading a stack

Selection is nearest-enclosing. Two handlers for one request: the inner one answers and the outer
never sees it.

```katari
@"Tag one line." request wrap(line: string) -> string

agent stacked() -> string {
  use handler { request wrap(line: string) { next f"[outer ${line}]" } }
  use handler { request wrap(line: string) { next f"[inner ${line}]" } }
  wrap(line = "x")                         // "[inner x]": the nearest handler answers
}
```

The first `use` in a block is therefore the outermost, and each later one nests inside it. Together
with the install-site rule that gives one test for every position: if a clause of handler A performs
request R, then R's handler is above A. A handler whose clauses are also tools — agent values a
model calls inside a dispatched turn — is a case of the same test, and sits above the dispatcher.

## Where a provider goes

A middleware answers a request by re-performing it, and that re-perform escalates from the
middleware's own install site. So whatever it re-performs to is installed first, and the middleware
nests inside:

```katari
@"One question, with the notes index injected fresh at every model step."
agent ask_model(question: string) -> string {
  use anthropic.provider(source = credentials.env(key = "ANTHROPIC_API_KEY"))
  use ai.with_context(inject = memory.index_note)
  ai.infer(history = [types.turn(role = types.user_role(), text = question, files = [])])
}
```

`ai.with_context` computes its note and re-performs `ai.infer_step`; that perform reaches
`anthropic.provider`, installed one line earlier. Stack more middleware at the same seam and each
one's re-perform lands in the one above it. In a program with a route, the same reading puts the
whole stack above `use ai.route` — see [Residents]({docs}/{currentVersion}/guides/residents).

## Answer with the failure

Read from the performer's side, the install-site rule says something sharper: the clause answering
your request runs above you, so a throw it lets fly is raised past your frame and a guard wrapped
around the perform has nothing left to catch. What does come back to a performer is the answer. So
a request whose handler body touches anything that can fail recoverably answers with a sum that
includes its own failure — `store.get` answers `found | absent`, `ai.infer_step` answers
`inferred | inference_failed`, and an app's own requests are written the same way.

```katari
@"A bad address: the same answer tomorrow, so no retry fixes it."
data address_rejected(message: string)

@"The upstream was briefly unreachable — waiting is a real remedy."
data upstream_unavailable(message: string)

// What handing one line to the upstream can fail with. (Type synonyms take no docs.)
type delivery_error = address_rejected | upstream_unavailable

@"The line reached the upstream." data sent()

@"It did not, and this is why — a value, because the performer cannot catch a throw raised above it."
data not_sent(reason: string)

// What performing `notify` answers with. (Type synonyms take no docs.)
type notify_outcome = sent | not_sent

@"Deliver one line; served above whoever performs it, so it answers with its own failure."
request notify(line: string) -> notify_outcome
```

The handler's body holds a guard of its own, and that guard converts rather than hides.
`hand_to_upstream` below stands for the one call that can fail — a real one is an `http.fetch` or a
package's send:

```katari
@"The handler's body: hand the line over and answer with what happened. A self-healing failure
becomes the `not_sent` value; the other half re-raises and still stops the run loudly."
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
```

```katari
@"The performer holds no guard: it reads the outcome instead."
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

`guarded_notify` runs at the install site, so it is the last frame that can turn a failure into
something the performer will see. `report` dispatches on `notify_outcome` like any other value,
which is what makes it total. Note the throw clause catches the whole union its block can raise and
splits it inside with a `match`, re-raising the arm it is not answering exactly as bound.

Which failures become values: the self-healing ones — a 5xx, a rate limit, a dropped connection, a
platform refusing one over-long field — because waiting or asking again is a real remedy. A failure
nothing in the program's future changes, such as a revoked token or a missing secret, still throws,
so the run stops where somebody notices rather than degrading in silence. The verdict belongs to the
handler serving the request and lives in one agent returning a sum, so a supervisor, a fiber's guard
and a request's answer cannot drift on what fatal means.

The failure arm names the failure. A request answering `granted | refused` whose handler never got
the question in front of anybody answers with a variant saying nobody was asked, and every reader
folds that into "not approved" at its own reason — which makes fail-closed structural.

## Sequential or parallel

A handler carrying `var` state runs its invocations one at a time, through a FIFO, in arrival order.
It is an actor, and its state is sound precisely because no two clause bodies run at once.

```katari
@"Announce one arrival; the answer is how many have arrived." request seen(what: string) -> integer

agent tally() -> integer {
  use handler (var count: integer = 0) {
    request seen(what: string) { next count + 1 with { count = count + 1 } }
  }
  let _first = parallel [seen(what = "a"), seen(what = "b")]
  seen(what = "c")                         // 3: the FIFO ordered the three arrivals
}
```

A `parallel handler` dispatches its clause bodies concurrently and therefore carries no `var`: the
compiler rejects that at the entrance (K3025), the same lost update it rejects on a `parallel for`
(K3024). Use it for stateless clauses that should run at once.

```katari
@"Decorate one line." request decorate(line: string) -> string

agent decorated() -> array[string] {
  use parallel handler {
    request decorate(line: string) { next f"· ${line}" }
  }
  parallel [decorate(line = "a"), decorate(line = "b")]
}
```

The handler is the only serialization point under a region.
[`region.watch`]({docs}/{currentVersion}/concepts/parallelism) re-emits every fiber's escalation
concurrently and adds no ordering of its own, so two escalations reaching different handlers always
run concurrently — one handler blocked on a human-latency answer never starves another — while two
reaching the same sequential handler queue at its FIFO. That is why one AI's conversation stays in
order for free while independent ones keep flowing.

## When the geometry is wrong

There is no dedicated diagnostic for a misplaced handler in 0.1. It surfaces as an ordinary row
mismatch — a K3001 subtype error — reported at the perform site rather than at the handler you
moved, because the perform is where a request now sits in a row that cannot discharge it. Read the
install-site rule backwards from there: which handler serves this request, and is it above this code?

Two more show up while spelling the rows a stack needs, and neither is about position. K3011: an
effect override `{...E, ...}` may only name requests, so the built-in `io` unions on outside —
`{...E, my_request} | io`. K3013: a recursive agent's row is not inferred, so spell it, and name a
long ceiling once as an effect-row type synonym rather than writing it twice.

## Where to go next

<DocCards>
  <DocCard href="{docs}/{currentVersion}/concepts/effects-and-handlers" />
  <DocCard href="{docs}/{currentVersion}/concepts/parallelism" />
  <DocCard href="{docs}/{currentVersion}/guides/residents" />
  <DocCard href="{docs}/{currentVersion}/guides/ffi-sidecars" />
</DocCards>
