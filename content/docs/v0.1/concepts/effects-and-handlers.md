---
title: Effects and handlers
description: Requests declare capabilities, effect rows make them visible in signatures, and handlers decide what they mean.
---

A request is an operation declared without an implementation, and the implementation comes
from whichever handler is nearest up the call chain. So one agent can log to a counter in one
caller, to a real sink in another, and to a human in a third, with no change to its body — and
its signature says which of those substitutions are even possible.

## Declaring a request

```katari
@"Record one line of activity. A request is declared, never implemented here."
request log(line: string) -> null

@"`with log` — this agent may perform `log`; whoever runs it decides what that means."
agent greet(name: string) -> string with log {
  log(line = f"greeting ${name}")
  f"hello, ${name}"
}
```

Performing `log(...)` looks like a call, and with a handler in scope it behaves like one.
The row `with log` is part of `greet`'s type: a caller either handles `log`, carries it in
its own row, or — if it reaches the run root unhandled — the request
[escalates]({docs}/{currentVersion}/concepts/escalation) to a human.

## Handlers

```katari
@"A stateful handler: `next value with { ... }` answers the request, resumes the
performer, and advances the handler's state."
agent counted() -> string {
  use handler (var lines = 0) {
    request log(line: string) { next null with { lines = lines + 1 } }
  }
  greet(name = "katari")
}
```

`use handler` installs handler clauses for the rest of the block and discharges the handled
requests from that block's row — `counted` has a pure signature. A handler clause ends in one
of three ways:

- `next value` answers the request with `value` and resumes the performer where it left off.
  `next value with { ... }` also updates the handler's `var` state, which lives across
  requests (the `(var lines = 0)` head declares it).
- `break value` does not resume the performer: it aborts the whole handled block and makes
  `value` its result.
- A clause body may perform a `-> never` request of its own, which transfers control outward
  from the clause's install site. That is how a converter relabels one failure channel as
  another: `supervise.signal_throws` serves `prelude.throw` with a clause that performs
  `supervise.interrupted`.

Katari's typed errors are exactly this machinery, not a separate feature. `prelude.throw` is
a request whose answer type is `never`, so the only useful handler clause is a `break`:

```katari
@"The typed error `parse_minutes` raises on non-numeric text."
data not_a_number(text: string)

@"Parse a minutes count; non-numeric text raises the typed error."
agent parse_minutes(text: string) -> integer with prelude.throw[not_a_number] {
  match (string.to_integer(value = text)) {
    case null -> prelude.throw(error = not_a_number(text = text))
    case value -> value
  }
}

@"`break value` aborts the handled block with that value — this is how a throw is caught."
agent minutes_or_zero(text: string) -> integer {
  use handler {
    request prelude.throw(error: not_a_number) -> never { break 0 }
  }
  parse_minutes(text = text)
}
```

The clause's `error: not_a_number` selects by payload type: a `throw` carrying anything else
passes through to an outer handler.

## Providers

A handler is the inline form. A **provider** packages the same idea as an agent you `use` —
it receives the rest of the block as a continuation and runs it with a capability served:

```katari
@"A capability a provider serves for the extent of a block."
request emit(line: string) -> null

@"A provider: it receives the rest of the block as `continuation` and runs it with
`emit` handled. `{...E, emit}` overwrites the row: the continuation performs the
caller's effects E plus `emit`, and this agent discharges `emit` — its own row is E."
agent quietly[R, effect E](
  continuation: agent (value: null) -> R with {...E, emit},
) -> R with E {
  use handler {
    request emit(line: string) { next null }
  }
  continuation(value = null)
}

@"`use` a provider: everything after the `use` becomes its continuation."
agent report() -> string {
  use quietly()
  emit(line = "starting")
  emit(line = "still going")
  "done"
}
```

`use quietly()` rewrites the rest of `report` into the `continuation` argument. This is the
shape every stdlib and package provider uses: `use supervise.exponential(max_attempts = 5)`
serves the supervision signal, `use mcp.provide[mcp.scope](url = ..., auth = ...)` serves an MCP
server's tools for the extent of the block (and `let tools = use mcp.provide[mcp.scope](...)` binds
the value the provider passes to its continuation). The scoping is the point — the capability exists exactly for the
block, and the provider's own row proves it discharged what it served.

Two row spellings appear in provider signatures, and they differ:

- `with E | emit` is a **union** row: `emit` merges with whatever `E` already carries.
- `with {...E, emit}` is an **overwrite** row: the entry for `emit` is pinned exactly, on top
  of `E`. A provider uses it for the request it intends to discharge, so the subtraction in
  its result row (`-> R with E`) is honest.

## Effect polymorphism

```katari
@"Effect-polymorphic: whatever `action` performs, `timed` performs — E flows through,
and `timed` adds `io` of its own for the clock reads."
agent timed[R, effect E](
  action: agent (value: null) -> R with E,
) -> { result: R, elapsed: number } with E | io {
  let before = time.now()
  let result = action(value = null)
  { result = result, elapsed = time.now() - before }
}
```

`[effect E]` declares an effect generic: `timed` works over an action with any row and
propagates it unchanged, adding `io` — the built-in, un-dischargeable effect every external
call (HTTP, the clock, an FFI sidecar) performs. Higher-order agents in the stdlib
(`time.watch`, `supervise.*`, `reflection.call_agent`) all have this shape; see the
[reference](/packages) for their rows.

## Marker effects

```katari
@"A marker effect: a pure capability. It rides effect rows and gates calls, but can
never be performed or handled — it vanishes at lowering."
effect reviewed

@"Only callable from a row that carries `reviewed`."
agent delete_project(name: string) -> null with reviewed {
  null
}

@"The caller's own row covers the marker, so the call typechecks."
agent cleanup() -> null with reviewed {
  delete_project(name = "old-prototype")
}
```

An `effect` declaration with no request is a pure capability: it gates who may call what,
entirely at compile time. Markers are also how a **scoped provider** — `mcp.provide`,
`region.provide` — makes a lifetime static: the provider is generic over a nullary marker
it mints for its block and discharges from its own row, and the marker rides everything
the block is handed (a minted tool, a forked fiber), so none of it can escape the block
that provided it. Declare one marker per connection or nursery; distinct markers never
merge.

## Environment vs operation

Three kinds of thing hide behind an effect, and they differ by lifetime. **Environment** is what
is _given_ to a run, and the [store]({docs}/{currentVersion}/guides/store) is its request form:
`get`, `set`, `delete` and `list` are requests, so any handler in between serves them first (a
test stub, a sandboxed subtree), and unhandled they escalate to the run's outermost environment,
the runtime, which machine-answers them against the project's durable rows.

**Operations with a lifetime** — `http.fetch`, `oauth.token`, a timer, a `watch` — are not
requests waiting for an answer. They go straight to a dedicated reactor that owns the in-flight
work and wakes the run when it completes, and they ride the un-dischargeable `io` effect rather
than a catchable request: a direct line to the same outermost handler, reached without stopping
at any handler on the way.

**Primitives** are the third shape and the smallest. `env.get_secret` and `env.get_or` are host
primitives, bound to the project's env entries when the runtime boots; a primitive runs inline in
the turn that calls it, with no request and no reactor. To give a subtree its own answer for one,
wrap it in a request you declare and serve that.

## Where to go next

<DocCards>
  <DocCard href="{docs}/{currentVersion}/concepts/escalation" />
  <DocCard href="{docs}/{currentVersion}/guides/handler-geometry" />
  <DocCard href="{docs}/{currentVersion}/concepts/durable-execution" />
  <DocCard href="{docs}/{currentVersion}/tutorial/effects-and-escalation" />
</DocCards>
