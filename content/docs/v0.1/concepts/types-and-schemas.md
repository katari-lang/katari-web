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

You construct an object value with an **object literal** — the same `{ field = value }`
form you may have met building HTTP request bodies, with `=` where the type writes `:` —
and an optional field may simply be omitted:

```katari
@"An object literal denotes an object type directly; the optional field is omitted."
agent draft(title: string) -> { title: string, content?: string } {
  { title = title }
}

@"The same literal with the optional field supplied."
agent full_draft(title: string, content: string) -> { title: string, content?: string } {
  { title = title, content = content }
}
```

This is how you reach an object-typed parameter of a generated
[MCP binding]({docs}/{currentVersion}/guides/mcp) — or of any agent — from hand-written
code: build the literal, omit what you do not have.

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

`match` also dispatches on **literal patterns** — string and number literals match exactly,
and a binder arm catches everything else — so a dispatch over a small closed set of strings
is a flat match, not an `if` pyramid:

```katari
@"Literal patterns match exact strings; the binder arm is the fallback."
agent route(to: string) -> string {
  match (to) {
    case "core" -> "the private channel"
    case "herald" -> "the public stage"
    case other -> f"unknown addressee: ${other}"
  }
}
```

Number literals work the same way (`case 1 -> ...`, `case n -> ...`).

**The binder arm is not optional here, and this is where literals differ from constructors.**
Listing every constructor of a `data` union IS exhaustive — that is the check that breaks a
`match` when you add a third shape. Listing every member of a literal union is NOT: a closed
`"page" | "ticket" | "noise"` is closed for assignment but open for `match`, so covering all
three still leaves a residual and `check` reports `expected: never` against what is left. Write
the binder arm, and put in it whatever an unforeseen value should mean.

Relatedly, the comparison operators order strings too: `<` on strings is lexicographic by Unicode code
point, so `"2026-07-01" < "2026-08-01"` is `true`.

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
agent read_pick(reply: string) -> string with prelude.throw[json.parse_error | json.validation_error] {
  let picked = json.parse_as[{ tool: string, arguments: record[unknown] }](text = reply)
  picked.tool
}
```

`json.parse_as[T]` parses a document and validates it against `T`'s schema in one step — sugar
for `json.parse` then `json.validate[T]`. Malformed text throws `json.parse_error`; a value that
does not conform throws `json.validation_error`, naming the offending path. It is the right tool
when you know the shape you expect — an AI reply, a webhook body you re-read. `json.validate[T]`
is that check on its own: it takes an `unknown`, returns it unchanged when it conforms to `T`
(otherwise `json.validation_error`), and rewrites nothing. Validation is one of only **two**
places a type is enforced at runtime — the other is `reflection.call_agent`, which checks a
delegation's arguments against the callee's schema the same way; everywhere else your types are
settled at compile time. Reserved wire keys all live in the `$katari_` namespace, disjoint from
anything a real document carries, so a `$`-prefixed key like `$ref` stays an ordinary field.

For a document of unknown or irregular shape, `json.parse` yields a plain value (`unknown`) —
a record / array / string / integer / number / boolean / null (or a `file`, where the text
carried a `$katari_ref` handle) — already an ordinary Katari value with no dedicated JSON tree
type. That marker interpretation is unconditional: `parse` reads a `$katari_` key the same way
whether or not a schema is in play. You traverse it with shape filters (`case record(r)`,
`case array(a)`) and the total readers (`json.field`, `json.element`, `json.text`,
`json.entries`, `json.items`), each of which returns a harmless default rather than throwing
when a key is missing or a shape is wrong — so probes chain freely and absence is checked once,
at the end, where it matters.

Going the other way, **`json.stringify` is the one writer** — total and canonical, one value to
one text, so it never throws. A document round-trips (`json.stringify(json.parse(s))` is `s` up
to whitespace); a `file` renders as its `{ "$katari_ref": … }` handle object and a `data` value
nests its fields under `$katari_value` as `{ "$katari_constructor": name, "$katari_value": { … } }`.
Nothing is escaped, which is why `stringify` doubles as the read channel that shows a model a
handle or a `data` value verbatim. See the [reference](/packages) for the surface and its laws.

You build a document with ordinary record and array literals — there is no constructor to call.
A record key is normally a bare identifier, but **any key can be quoted**: `{ "type" = "message",
"$ref" = id }` is how you write a key that is a reserved word (`type`), `$`-prefixed, or otherwise
not an identifier (a hyphen, a space). Quoted or bare, the key reaches the wire exactly as
written.

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
agent inspect() -> unknown {
  reflection.get_metadata(value = invite).input
}
```

Every agent's input, output, and request schemas are derived from its declaration. The
`@"..."` annotation on the agent becomes its description; a `@"..."` before a parameter
becomes that property's `description` in the input schema — which is exactly what an AI
model reads when it decides how to call your tool, so write them for that reader. On the
wire, a `data` value carries its constructor under a `$katari_constructor` marker with its
fields nested under `$katari_value`, and a `file` under a `$katari_ref` handle, so unions of
`data` types survive the round trip unambiguously. Turning those marked forms back into values
is unconditional — the same codec `json.parse` runs, with or without a schema: a
`{ "$katari_ref": … }` becomes a `file` every time. So when an AI replays a `{ "$katari_ref": … }`
into a tool argument, it is already a `file` by the time `reflection.call_agent` sees it —
`call_agent`'s job is to _check_ that value against the callee's input schema and throw
`call_error` on a mismatch, never to lift a bare record into a handle. `reflection.get_metadata`
hands you the derived schemas as `unknown` values at runtime — the building block of a tool list —
and dynamic dispatch validates arguments against the same schemas
([Giving the model tools]({docs}/{currentVersion}/tutorial/giving-the-model-tools)
puts the loop together).

## Where to go next

- [Agents and delegation]({docs}/{currentVersion}/concepts/agents-and-delegation) — where
  these boundaries live.
- [Escalation]({docs}/{currentVersion}/concepts/escalation) — answer schemas at work.
- [MCP]({docs}/{currentVersion}/guides/mcp) — the same schemas, served to and consumed from
  MCP.
