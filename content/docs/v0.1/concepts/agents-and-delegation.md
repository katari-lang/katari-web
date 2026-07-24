---
title: Agents and delegation
description: Agents are Katari's functions — typed, schema-carrying, first-class — and every call is a delegation the runtime tracks.
---

An agent is Katari's unit of execution: what a function is in other languages. It takes a
labelled record in, returns one value out, and declares the requests it may perform. The
compiler derives a JSON schema for both sides, so anything can call an agent — another agent,
`katari run`, an HTTP client, or an AI model that discovered it as a tool.

## Labelled records in, one value out

```katari
@"The area of one rectangular room."
agent area(width: number, height: number) -> number {
  width * height
}

@"Total floor area. Every call names its arguments; every call is a delegation."
agent floor_area(rooms: array[{ width: number, height: number }]) -> number {
  for (let room in rooms, var total: number = 0.0) {
    next with { total = total + area(width = room.width, height = room.height) }
  } then (_rooms) { total }
}
```

There are no positional arguments: a call names every parameter, and the parameter list is
the input record's shape. The `@"..."` annotation is not a comment — it is the agent's
description, carried into the derived schema that an AI or the admin console reads (see
[Types and schemas]({docs}/{currentVersion}/concepts/types-and-schemas)). The stdlib names
its primary argument by one rule, so you never memorize it per module: `value` when the
agent reads a **scalar** as a whole (`string.trim(value = ...)`, `math.floor(value = ...)`),
`target` when it reaches **into a structure** (`array.length(target = ...)`,
`record.get(target = ..., key = ...)`); packages follow the same split.

A parameter can carry a default with `?=`; a call that omits it gets the default:

```katari
@"`suffix` is optional: a call may omit it and the default fills in."
agent decorate(body: string, suffix: string ?= "!") -> string {
  f"${body}${suffix}"
}

@"One call supplies the suffix, one leaves it to the default."
agent both_forms() -> string {
  f"${decorate(body = "hi", suffix = "?")} ${decorate(body = "hi")}"
}
```

The default is not limited to scalars: `?=` takes a whole literal tree, typed against the
declared parameter — an empty array, an object with its fields filled in:

```katari
@"Container defaults: a call that omits `tags` or `options` gets the literal trees."
agent notify(text: string, tags: array[string] ?= [], options: { urgent: boolean } ?= { urgent = false }) -> string {
  if (options.urgent) {
    f"URGENT ${text} [${string.join(parts = tags, separator = ",")}]"
  } else {
    f"${text} [${string.join(parts = tags, separator = ",")}]"
  }
}
```

## Every call is a delegation

When `floor_area` calls `area`, the runtime spawns a child instance for the callee and
suspends the caller until the child's result arrives. That tree of instances is the
**delegation tree**, and it is the thing you see on a run's page in the admin console: which
agent called which, which one is blocked, and on what. A direct, compiled call needs no
runtime validation — the type system already guarantees the argument fits. Dynamic calls
(an AI picking a tool, an inbound webhook) are validated against the callee's input schema at
the boundary instead.

Delegation is real, not inlined: a recursive agent parks one durable frame per level. For an
unbounded loop, use `forever`, which repeats in place — see
[Durable execution]({docs}/{currentVersion}/concepts/durable-execution).

## Agents are values

```katari
@"Apply a transform twice. An agent is a value, so it can be a parameter."
agent twice(transform: agent (value: number) -> number, start: number) -> number {
  transform(value = transform(value = start))
}

@"Double a number."
agent double(value: number) -> number { value * 2.0 }

@"`double` is passed as a value, not called: no parentheses."
agent twelve() -> number {
  twice(transform = double, start = 3.0)
}
```

An agent's type is written `agent (label: T, ...) -> R with E` — parameters, result, and the
effect row all part of the type. Because agents are ordinary values you can put them in
arrays, return them, hand them to `time.watch` as a delivery target, or expose them to an AI
as tools ([reflection](/packages) reads their metadata back at runtime).

## Partial application

```katari
@"Scale a value by a factor."
agent scale(factor: number, value: number) -> number { factor * value }

@"`_` holes a parameter: the call fixes `factor` now and yields a residual
`agent (value: number) -> number`; each later call supplies only the hole."
agent doubles(values: array[number]) -> array[number] {
  let double = scale(factor = 2.0, value = _)
  for (let value in values) { next double(value = value) }
}
```

A call with `_` in some argument positions does not run the agent — it fixes the supplied
arguments and yields a residual agent whose parameters are exactly the holes. A defaulted
parameter that is neither supplied nor holed stays defaulted: the callee's default fills it
on each residual call.

## Private agents

```katari
@"A private agent: its handle belongs to the private world."
private agent signing_secret() -> string {
  "k-2f9a-secret"
}

@"Another private agent's body is a private world, so the secret is ordinary here."
private agent signature(payload: string) -> string {
  f"${payload}.${signing_secret()}"
}
```

`private agent` marks the agent's handle private. Its result is a private value: inside a
private world — the body of another private agent — it is ordinary, but in a public world
anything derived from the call stays private and cannot be laundered back to public (the
compiler rejects the leak with `K3001`). The runtime treats the handle the same way: a
private agent cannot be started as a run's entry point. Use it for helpers that mint or
combine secrets, and keep the public surface to agents that absorb those secrets into a
submission sink — see the `of private` semantics in
[Types and schemas]({docs}/{currentVersion}/concepts/types-and-schemas).

## Where to go next

- [Effects and handlers]({docs}/{currentVersion}/concepts/effects-and-handlers) — the `with`
  row and what it buys you.
- [Parallelism]({docs}/{currentVersion}/concepts/parallelism) — fanning delegations out.
- [Giving the model tools]({docs}/{currentVersion}/tutorial/giving-the-model-tools) — agents
  as an AI's tools, end to end.
