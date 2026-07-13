---
title: Types
description: Basic types, record/union types, effect rows, never, private/public attributes, and how subtyping actually works.
---

## Basic types

The scalars are `null` / `boolean` / `integer` / `number` / `string` / `file`. `integer` is a
subtype of `number`, and arithmetic operators preserve `integer` when both operands are `integer`
(a generic bound such as `prelude.add[T extends number]` expresses this). `file` is a thin
reference into the project's blob store; read its contents with
[`prelude.file`]({docs}/{currentVersion}/standard-library/file).

## Containers

- `array[T]`: an array. Its literal is `[e1, e2, ...]`, and operations are in
  [`prelude.array`]({docs}/{currentVersion}/standard-library/array).
- `record[T]`: a homogeneous string-keyed map. It has no literal; it is built with operations from
  [`prelude.record`]({docs}/{currentVersion}/standard-library/record) (the entries of a JSON
  object, or a list of env vars, take this shape).
- `[T1, T2, ...]`: a tuple type. Values look like `[e1, e2]`, and patterns look like `[p1, p2]`.
  Empty `[]` and single-element `[T]` are also tuples; `()` is plain grouping and does not create
  a tuple.

## Object types

```katari
type point = { x: number, y: number, label?: string }
```

`{ label: T, ... }` is a structural type with width and depth subtyping, and `label?: T` is an
optional field (it may be absent). An agent's parameter list is sugar for this:
`agent (label: T, ...) -> R` desugars to a single object-typed parameter record (an empty `()` is
an empty object).

## data and sum types

`data name(label: T, ...)` declares a single constructor, usable both to construct a value
(`name(label = ...)`) and as a pattern (`name(label => p)`). Bundling multiple `data` declarations
with a `type` synonym forms a sum type.

```katari
data circle(radius: number)
data rect(width: number, height: number)
type shape = circle | rect
```

`type union = a | b | c` denotes a union type in general, a union of any types, not only sum
types.

## Agent types

```katari
type transform = agent (value: number) -> number
type handler_of[T] = agent (value: T) -> T with io
```

`agent Param -> Return [with Effect]`, where `Param` is a type expression that includes the
object-type sugar described above. See [Effects]({docs}/{currentVersion}/language-reference/effects)
for the effect clause. There are three kinds of callable values (a named reference to a compiled
agent, a closure, and a runtime-minted reactor-backed tool), and this type accepts all three
uniformly.

## never / unknown / all / io / pure

- `never`: the type with no values. It is the return type of `throw` / `panic`, the type of calls
  that "never return" such as `time.watch`, and the type of a
  [`forever { ... }`]({docs}/{currentVersion}/language-reference/syntax#forever) loop that has no
  `break` (a `forever` with `break value`s types as the union of those values instead); an
  expression that reaches `never` does not contribute when joined with other branches.
- `unknown`: the top type that accepts anything (the value must be narrowed before it can be
  used).
- `all`: the top of effect rows ("allows any request"). The argument type of
  `reflection.get_metadata`, `agent never -> unknown with all`, is an example: it accepts a
  callable with any input/output and any effect.
- `io`: a marker effect that indicates a side effect is present (introduced by calls to an
  `external agent`), but that cannot be discharged. It appears on a row as `with io | ...`.
- `pure`: has no effects at all (an empty row).

## String literal types and `literal` generics

`"fast"` in type position is **the singleton type of that exact string** (`"fast" <: string`).
`[literal name extends string]` binds a generic function's call argument to its singleton type
when that argument is a literal (an analogue of a TypeScript `const` type parameter):

```katari
agent remember[literal name extends string](value: name) -> name { value }

agent main() -> string {
  let mode: "fast" | "slow" = remember(value = "fast")   // returns the singleton "fast"
  let widened: string = mode                              // literal types widen to string (subtyping)
  widened
}
```

A dynamic (non-literal) argument binds to plain `string`.
[`prelude.mcp`]({docs}/{currentVersion}/standard-library/mcp)'s `provide[literal URL, ...]` uses
this to give a literal `url` a per-server scope.

## private / public attributes and information flow

`T of private` / `T of public` are **attributes** attached to a value, with `public <: private`
(a public value can be passed anywhere private is required, but not the reverse). Private marks a
value as "tainted as a secret," and a composite value that contains even one private value
becomes private as a whole. A private value can leave the runtime only by passing through an
intentional submission surface to the destination server, such as the header values or `body` of
`http.fetch`. The rule is that sinks that could leak a value, such as `url` / `method`, stay
public.

```katari
agent fetch_with_key() -> string with io | prelude.throw[env.missing_secret | http.fetch_error] {
  let key = env.get_secret(key = "API_KEY")   // string of private
  let response = http.fetch(
    url = "https://api.example.com",           // url stays public (not a type error)
    method = "GET",
    headers = record.set(target = record.empty(), key = "Authorization", value = "Bearer " ++ key),
    body = "",
  )
  response.body
}
```

`env.get_secret`, the value of `mcp.headers`, and HTTP header/body values are the representative
private-capable positions. See [`prelude.env`]({docs}/{currentVersion}/standard-library/env) and
[`prelude.http`]({docs}/{currentVersion}/standard-library/http) for details. The third generic
kind, `[attribute T]`, exists for the rare case of wanting to quantify over the attribute itself
rather than a type.

## effect row (overview)

`with req1 | req2` is "the set of requests this agent may perform." A row is a map keyed by
request name, and multiple instantiations of the same name merge into one entry by union (mixing
`throw[a]` and `throw[b]` produces `throw[a | b]`, still a single entry). The form
`{...E, request[args]}` does not join by union; it overrides that one entry entirely. See
[Effects]({docs}/{currentVersion}/language-reference/effects) and
[Providers]({docs}/{currentVersion}/language-reference/providers) for details.

## The current state of inference

A call's generic instantiation is inferred from its arguments, but **a generic that appears only
in the result type cannot be inferred** (as with `json.decode[T]` / `json.parse_as[T]` and some of
`reflection`). The caller must write it explicitly as `foo[T](...)`; omitting it is rejected with
K3016. Binding the result of `use provider(...)` (`let x = use provider(...)`) requires a type
annotation for the same reason (K3013): the provider's result type is determined by the
continuation's type, so without the annotation on the binding side, the dependency would run in
both directions at once.

## Related

<DocCards>
  <DocCard href="{docs}/{currentVersion}/language-reference/effects" />
  <DocCard href="{docs}/{currentVersion}/language-reference/providers" />
  <DocCard href="{docs}/{currentVersion}/standard-library/json" />
</DocCards>
