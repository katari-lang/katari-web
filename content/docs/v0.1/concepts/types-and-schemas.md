---
title: Types and schemas
description: Katari's type system — sums, unions, generics, privacy — and the JSON schemas it derives at every agent boundary.
---

Katari's types do double duty. Inside a program they are checked the usual way; at every
agent boundary they are also **schemas** — JSON Schema derived from the declaration, read by
the runtime to validate dynamic calls and by AI models to understand your agents as tools.
You never write a schema by hand.

## Scalars

| Type      | Values                                                               |
| --------- | -------------------------------------------------------------------- |
| `integer` | whole numbers (a subtype of `number`)                                |
| `number`  | floating-point numbers                                               |
| `string`  | text                                                                 |
| `boolean` | `true` / `false`                                                     |
| `null`    | the single value `null`                                              |
| `never`   | no values — the type of a call that does not return                  |
| `unknown` | any value — the top type                                             |
| `file`    | a blob handle whose bytes ride the runtime's blob store              |
| `"fast"`  | a string literal is a type: exactly that string (`"fast" <: string`) |

## Containers

```katari
@"Containers: array (ordered), record (string-keyed map), object type (fixed labels)."
agent owner_of(
  tags: array[string],
  scores: record[integer],
  owner: { name: string, email: string },
) -> string {
  owner.name
}
```

`array[T]` is an ordered sequence, `record[T]` a string-keyed map with uniform values, and
`{ label: T, ... }` an object type with fixed labels (`label?: T` marks one optional —
reading it types `T | null`). Agent types — `agent (value: number) -> number with E` — are
ordinary types too; see
[Agents and delegation]({docs}/{currentVersion}/concepts/agents-and-delegation).

## Sums: data, unions, match

```katari
@"A circle, by radius."
data circle(radius: number)

@"An axis-aligned rectangle."
data rect(width: number, height: number)

// One shape: a union synonym over the two constructors. (Type synonyms take no `@"..."` docs.)
type shape = circle | rect

@"Constructor dispatch with `match`; field patterns bind with `=>`."
agent area(value: shape) -> number {
  match (value) {
    case circle(radius => r) -> 3.14159 * r * r
    case rect(width => w, height => h) -> w * h
  }
}
```

`data` declares one constructor with named fields; a union of constructors is a sum type,
and `match` is its dispatch — the compiler checks exhaustiveness, so adding a third shape
breaks every `match` that forgot it. `type` names any type; it is a synonym, not a new type.

Unions work over any types, not just constructors, and matching narrows:

```katari
@"`array.get` types `string | null`; matching the `null` arm narrows the fallthrough to `string`."
agent first_or(values: array[string], fallback: string) -> string {
  match (array.get(target = values, index = 0)) {
    case null -> fallback
    case value -> value
  }
}
```

Absence is `| null` everywhere in the stdlib — there is no separate option type.

## Generics

```katari
@"A bounded type generic: any T that has a `name` field can be labelled."
agent label[T extends { name: string }](value: T) -> string {
  value.name
}

@"A literal generic binds the argument at its singleton type:
`pick(value = \"fast\")` returns `\"fast\"`, not `string`."
agent pick[literal name extends string](value: name) -> name { value }

@"The singleton fits a literal union — and widens to plain `string`."
agent chosen() -> "fast" | "slow" {
  pick(value = "fast")
}

@"An effect generic: whatever `action` performs, this performs."
agent tap[R, effect E](action: agent (value: null) -> R with E) -> R with E {
  action(value = null)
}

@"An attribute generic ranges over public / private; the label flows through unchanged."
agent tag[attribute A](secret: string of A, label: string) -> string of A {
  prelude.concat(left = label, right = secret)
}
```

Generic parameters live in `[...]` before the parameter list and are inferred at the call
site. Four kinds exist: plain **type** generics (optionally bounded with `extends`),
**literal** generics (which bind a string-literal argument at its singleton type — how a
scoped provider pins a resource name in the row), **effect** generics (rows as parameters —
see [Effects and handlers]({docs}/{currentVersion}/concepts/effects-and-handlers)), and
**attribute** generics (privacy labels as parameters). A type that appears only in the
result cannot be inferred and is instantiated explicitly: `json.parse_as[T](...)`.

## Private values

```katari
@"A secret is a `string of private`: it may flow only toward a submission sink,
like the `Authorization` header `http.fetch` sends to the destination server."
agent authorized_headers() -> record[string of private] with prelude.throw[env.missing_secret] {
  record.set(
    target = record.empty(),
    key = "Authorization",
    value = prelude.concat(left = "Bearer ", right = env.get_secret(key = "api.token")),
  )
}
```

`T of private` attaches the privacy attribute: the value is a secret. Privacy is
information flow, not encryption — `public <: private`, so a public value fits anywhere a
private one is expected, but a private value may leave the program only through a
deliberate **submission sink** typed to absorb it: `http.fetch`'s header values and body
(which go to the one server the program named), never its `url` (which leaks into logs and
proxies — a private value there is a `K3001` type error). Everything derived from a secret
is tainted private, and a private value is redacted at every user-facing boundary — run
results, the trace, escalation answers. The values behind `env.get_secret` and
`oauth.token` are private by declaration; a `private agent`'s handle and result are the
same machinery applied to callables. Schemas ignore the attribute — privacy has no JSON
counterpart.

## The JSON boundary

```katari
@"Read an AI reply through the typed text boundary: parsed and validated against
the type's derived schema in one step."
agent read_pick(reply: string) -> string with prelude.throw[json.parse_error | json.decode_error] {
  let picked = json.parse_as[{ tool: string, arguments: record[unknown] }](text = reply)
  picked.tool
}
```

`json.parse_as[T]` parses a document and validates it against `T`'s schema in one step:
malformed text throws `json.parse_error`, a shape mismatch throws `json.decode_error` naming
the offending path. It is the right tool when you know the shape you expect — an AI reply, a
webhook body you re-read. For documents of unknown shape, `json.parse` yields the `json`
tree (a sum with one constructor per JSON shape) to traverse with `match`, and `json.encode`
/ `json.decode[T]` / `json.to_text` round-trip any value through its wire form. See the
[reference](/reference) for the full codec surface and its laws.

## Schemas from types

```katari
@"Send a calendar invitation to one attendee."
agent invite(
  @"The attendee's email address." email: string,
  @"The meeting length, in minutes." minutes: integer,
) -> null {
  null
}

@"Read a callable's derived schemas back at runtime."
agent inspect() -> json.json {
  reflection.get_metadata(value = invite).input
}
```

Every agent's input, output, and request schemas are derived from its declaration. The
`@"..."` annotation on the agent becomes its description; a `@"..."` before a parameter
becomes that property's `description` in the input schema — which is exactly what an AI
model reads when it decides how to call your tool, so write them for that reader. On the
wire, a `data` value carries its constructor under a `$constructor` discriminator with its
fields nested under `value`, so unions of `data` types survive the round trip unambiguously.
`reflection.get_metadata` hands you the derived schemas as `json` values at runtime — the
building block of a tool list — and dynamic dispatch validates arguments against the same
schemas ([Giving the model tools]({docs}/{currentVersion}/tutorial/giving-the-model-tools)
puts the loop together).

## Where to go next

- [Agents and delegation]({docs}/{currentVersion}/concepts/agents-and-delegation) — where
  these boundaries live.
- [Escalation]({docs}/{currentVersion}/concepts/escalation) — answer schemas at work.
- [MCP]({docs}/{currentVersion}/guides/mcp) — the same schemas, served to and consumed from
  MCP.
