---
title: Language reference
description: Every legal form of Katari syntax, one minimal example each — declarations, patterns, loops, handlers, regions — plus the forms people assume exist and do not.
---

A catalogue, not a tutorial. Each entry is the smallest legal spelling of one construct with a line
saying what it does; the surrounding pages explain **why**. Every example on this page compiles.

If you are looking for meaning rather than shape:
[Agents and delegation]({docs}/{currentVersion}/concepts/agents-and-delegation),
[Effects and handlers]({docs}/{currentVersion}/concepts/effects-and-handlers),
[Types and schemas]({docs}/{currentVersion}/concepts/types-and-schemas),
[Parallelism]({docs}/{currentVersion}/concepts/parallelism).

## Modules and imports

**There is no module declaration.** A file's module name is its path under `src/`, prefixed by the
package: `src/bot/mail.ktr` in package `bot` is module `bot.mail`. A file outside the package's own
namespace is rejected before compilation.

```katari
import prelude.json                                   // whole module, referenced as `json.…`
import { parse, type parse_error } from prelude.json  // selected names; `type` picks the type namespace
import prelude.string as text                         // aliased, referenced as `text.…`
```

A module is referenced by its **last segment**: `import ai.anthropic` is used as `anthropic.provider`.
The `type` prefix exists because values and types are separate namespaces, so a constructor and its
type share a name and must be imported separately. The `prelude` root is imported for you.

## Declarations

Every declaration is top-level. `@"..."` before one is its **documentation**, and it is not a comment:
the text becomes part of the schema a model sees. `@name@` inside it refers to a parameter.

### `agent`

```katari
@"Scale a value by a factor."
agent scale(factor: number, value: number) -> number {
  factor * value
}
```

An agent is a function. The body's last expression is its result; there is no `return` needed.

```katari
@"@suffix@ defaults, so a caller may omit it."
agent decorate(prefix: string, body: string, suffix: string ?= "!") -> string {
  f"${prefix}${body}${suffix}"
}
```

`?=` gives a parameter a default. **Arguments are always named** — `decorate(prefix = ">> ", body = "hi")`
— so there are no positional calls to keep in order.

```katari
agent nothing_in() -> string {
  "no parameters, but the parens are required"
}

private agent signing_secret() -> string {
  "not exported from this module"
}
```

`private` keeps a declaration inside its module.

```katari
agent label[T extends { name: string }](value: T) -> string {
  value.name
}

agent tap[R, effect E](action: agent (value: null) -> R with E) -> R with E {
  action(value = null)
}
```

Generic parameters go in brackets **before** the parameter list. Four kinds exist: a plain type (`T`),
an effect (`effect E`), a literal (`literal name extends string`), and an attribute (`attribute A`);
`extends` bounds any of them. Generic arguments are inferred **only at call sites** — a generic value
used as a value must be applied by name (`label[T]`), which is [K3015]({docs}/{currentVersion}/toolchain/error-codes).

The effect row is the `with` clause, and it is where an agent says what it may perform. Five
spellings, all legal in the same position:

| Row                            | Reads as                                                                 |
| ------------------------------ | ------------------------------------------------------------------------ |
| `with tick`                    | May perform the `tick` request.                                          |
| `with ask \| note \| io`       | Any of these — rows union with `\|`.                                     |
| `with prelude.throw[not_even]` | A request at a type argument.                                            |
| `with conversation`            | A row named once by a `type` synonym (below).                            |
| `with {...E, credential}`      | A caller's row `E` **overridden** — see the table under [Types](#types). |
| `with pure` / `with all`       | Nothing at all / anything at all.                                        |

Omitting `with` entirely on a declaration lets the checker infer the row.

A row that outgrows its line may **wrap**: a newline is legal before `with`, and after any `|` — in
an effect row and in a union return type alike. The body's `{` must still sit on the same line as the
signature's last token, so there is no Allman-brace form.

```katari
@"A row too long for one line."
agent broadcast(message: string) -> null
  with post |
    prelude.throw[string] |
    io {
  post(message = message)
}
```

### Anonymous agents, agents as values, partial application

```katari
agent anonymous() -> number {
  tap[number, pure](action = agent (value: null) -> number { 1.0 })
}
```

`agent (…) -> T with E { … }` with no name is an expression. It **cannot** declare generic parameters
(there is no name to instantiate them through). A nullary one is written `agent () -> T { … }`.

```katari
agent bump(value: number) -> number { value + 1.0 }

agent as_a_value(values: array[number]) -> array[number] {
  array.map(target = values, transform = bump)
}
```

A name with no parentheses is the agent **as a value**. Adding `(…)` calls it — that is the only
difference.

```katari
agent partial() -> number {
  let double = scale(factor = 2.0, value = _)
  double(value = 21.0)
}
```

`label = _` leaves a hole and yields a **residual agent** whose parameters are exactly the holes. A
defaulted parameter that is neither supplied nor holed keeps its default through the residual.

### `request`

```katari
@"A capability: each call yields the next counter value."
request tick() -> integer

request ask(question: string) -> string
request note(message: string) -> null
```

A request declaration has no body — it names an operation and its signature. Performing one looks
exactly like a call. With no handler in scope it
[escalates]({docs}/{currentVersion}/concepts/escalation) to a human.

### `effect` — a marker

```katari
@"A pure scope capability: carried in rows, never performable, never handleable."
effect reviewed

effect scoped[resource]
```

A marker effect has no operations. It exists to be carried in a row — a scope tag that only its
`provide` can discharge.

### `data`

```katari
@"A circle, by radius."
data circle(radius: number)

@"An axis-aligned rectangle."
data rect(width: number, height: number)

data enough()
```

One `data` declaration is **one constructor**. The empty parens on a nullary one are required. A sum
is a `type` union of constructors.

### `type`

```katari
type shape = circle | rect                                         // a sum
type contact = { name: string, email: string, tags: array[string] } // a record shape
type maybe_name = { name: string, nickname?: string }               // `?:` is an optional field
type pair[A, B] = [A, B]                                            // generic, and a tuple type
type conversation = ask | note                                      // an EFFECT ROW
```

`type` synonyms **take no `@"..."` documentation** — writing one is a syntax error.

The last line is the form most often missed: **a synonym can name an effect row, not just a data
type.** `conversation` then stands in wherever a row is expected — after `with`, and as an `effect`
type argument:

```katari
agent greeter(name: string) -> string with conversation {
  let mood = ask(question = f"how is ${name}?")
  note(message = f"greeted ${name}")
  f"${name} is ${mood}"
}
```

A row and a data union are written identically; which one a synonym is depends on where it is used.
Naming a long ceiling row once is the standard answer to
[K3013]({docs}/{currentVersion}/toolchain/error-codes).

### `external` and `primitive`

```katari
data bad_port(text: string)

@"Implemented in `ffi.ts` beside this module; the key is `<module>.greet`."
external agent greet(name: string) -> string

external agent parse_port(text: string) -> integer with prelude.throw[bad_port]
```

`external` declares a signature implemented outside Katari — see
[FFI sidecars]({docs}/{currentVersion}/guides/ffi-sidecars). An optional `from "reactor"` clause names
the runtime channel; user modules may only name `ffi`, which is also the default. `primitive agent` is
the same shape for compiler built-ins and appears only in the stdlib.

## Types

| Form                  | Example                                                  |
| --------------------- | -------------------------------------------------------- |
| Scalars               | `null`, `boolean`, `integer`, `number`, `string`, `file` |
| Top and bottom        | `unknown`, `never`                                       |
| Literal type          | `"fast" \| "slow"`                                       |
| Union                 | `circle \| rect`, `string \| null`                       |
| Array                 | `array[string]`                                          |
| Record (dynamic keys) | `record[integer]`                                        |
| Object (fixed shape)  | `{ name: string, nickname?: string }`                    |
| Tuple                 | `[string, integer]`                                      |
| Agent                 | `agent (value: T) -> U with E`                           |
| Attributed            | `string of private`                                      |
| Effect row            | `ask \| note \| io`, `pure`, `all`                       |
| Row override          | `{...E, credential}`, `{...E lacks throw}`               |

`array[T]` is a homogeneous sequence, `record[T]` a homogeneous string-keyed map with **dynamic** keys,
and `{ … }` an object with a **fixed** set of keys. Reach for `record[T]` when the keys are data.

## Expressions and statements

### `let`, and blocks

```katari
agent remember[literal name extends string](value: name) -> name { value }

agent bindings() -> number {
  let double = scale(factor = 2.0, value = _)
  let mode : "fast" | "slow" = remember["fast"](value = "fast")
  let _note = "a leading underscore is the convention for a discarded binding"
  double(value = 21.0)
}
```

There is **no assignment statement**. A `let` binding never changes; the only mutable state is a `var`
of a `for`, a `forever` or a handler, and it advances only through `next with { … }`.

A `{ … }` block is an expression: its value is its last expression. Statements are separated by
newlines.

### `if`

```katari
agent operators(a: integer, b: integer) -> string {
  if (a % 2 == 0 && !(b < 0)) { "even" } else if (a > b) { "left" } else { "right" }
}
```

Condition parens and both braces are required. Operators, loosest to tightest: `||`, `&&`,
`==` `!=`, `<= >= < >`, `++` (string concatenation) `+` `-`, `*` `/` `%`, then prefix `!` and `-`.

### `match`

```katari
agent literals(colour: string) -> string {
  match (colour) {
    case "red" -> "stop"
    case "green" -> "go"
    case other -> f"unknown signal: ${other}"       // a bare name binds — the catch-all
  }
}
```

```katari
data found(value: string)
data absent(key: string)
type lookup = found | absent

agent constructors(result: lookup) -> string {
  match (result) {
    case found(value => value) -> value             // bind a field with `=>`
    case absent(_) -> "(absent)"                    // match the constructor, bind nothing
  }
}
```

```katari
agent nullable(value: string | null) -> string {
  match (value) {
    case null -> "(none)"                           // a literal pattern
    case present -> present                         // narrowed: `null` is already covered
  }
}
```

A bare name in the last arm binds **everything the earlier arms did not cover**, narrowed to exactly
that residual — so it carries the residual's fields and goes wherever the residual's type is accepted,
with no destructure-and-rebuild:

```katari
data alpha(x: integer)
data beta(x: integer, y: integer)
data gamma(x: integer)
type shape = alpha | beta | gamma

agent takes_beta(value: beta) -> integer { value.y }
agent takes_beta_or_gamma(value: beta | gamma) -> integer { value.x }

agent one_left(value: alpha | beta) -> integer {
  match (value) {
    case alpha(_) -> 0
    case rest -> takes_beta(value = rest) + rest.y   // residual is `beta`: its fields, its type
  }
}

agent two_left(value: shape) -> integer {
  match (value) {
    case alpha(_) -> 0
    case rest -> takes_beta_or_gamma(value = rest) + rest.x   // residual is `beta | gamma`
  }
}
```

This is what makes "handle these, pass the rest on" a one-liner — the shape a `prelude.throw` guard
uses to fold the failures it owns and re-raise the others as `prelude.throw(error = rest)`.

```katari
agent by_type(value: unknown) -> string {
  match (value) {
    case integer(n) -> f"integer ${n}"              // a type filter: null boolean integer
    case string(s) -> s                             // number string file array record agent
    case _ -> "something else"                      // the wildcard
  }
}
```

```katari
agent tuples(entry: [string, integer]) -> string {
  match (entry) {
    case [key, value] -> f"${key}=${value}"         // a tuple / array pattern
  }
}
```

```katari
agent subset(person: { name: string, email: string }) -> string {
  match (person) {
    case { name } -> name                           // `{ name }` is sugar for `{ name => name }`
  }
}
```

A qualified constructor works too — `case store.found(value => v) -> …`. Matches must be exhaustive;
the checker tells you what is uncovered.

**There are no rest patterns.** `case { name, ...others }` and `case [first, ...tail]` do not exist,
and this is deliberate for the record case: a record pattern is already a **subset** match, so
`{ name }` accepts any object that has a `name`, and there is nothing left to bind. `...` is a
record-**literal** form only (below).

### Records, arrays, and field access

```katari
agent literal(name: string, email: string) -> contact {
  { name = name, email = email, tags = ["new"] }
}
```

An object literal is `{ field = value, … }` — `=`, where the _type_ uses `:`. This is the second form
newcomers assume is absent; it is not.

```katari
agent spread(base: contact) -> contact {
  { ...base, tags = array.append(target = base.tags, value = "seen") }
}
```

`...base` splices every field of `base` in at that position; later entries override earlier ones. Do
not confuse it with `{...E, request}`, the effect-row override — same three dots, different construct.

```katari
agent quoted_keys(id: string) -> record[string] {
  { "type" = "message", "$ref" = id }
}

agent every_literal() -> array[unknown] {
  [1, 2.5, "text", true, null, [1, 2], { a = 1 }]
}

agent read(person: contact) -> string {
  f"${person.name} <${person.email}> [${string.join(parts = person.tags, separator = ",")}]"
}
```

Quote a key that is not an identifier. Field access is `.field`.

**There is no indexing syntax.** `values[0]` is a _generic instantiation_, not a subscript. Element
access is a call that answers `T | null`, so the absent case is a value you must handle:

```katari
agent element(values: array[string]) -> string {
  match (array.get(target = values, index = 0)) {
    case null -> "(empty)"
    case first -> first
  }
}
```

### f-strings

```katari
agent interpolated(name: string, count: integer) -> string {
  f"${name} has ${string.to_string(value = count)} item(s) — ${string.to_upper(value = "done")}"
}
```

`f` immediately before the quote; `${ … }` holds any expression, including nested quotes. A `$` not
followed by `{` is literal.

### `for`

```katari
agent mapped(values: array[number]) -> array[number] {
  for (let value in values) { next value * 2.0 }
}
```

A `for` **is** the map: it collects each iteration's `next` value into an array, which is the loop's
value. `let` in the binder is an optional readability marker.

```katari
agent folded(values: array[integer]) -> integer {
  for (let value in values, var total: integer = 0) {
    next with { total = total + value }
  } then (_elements) { total }
}
```

`var` declares loop-carried state inside the header parens; `next with { … }` advances it; `then`
runs once after the loop with the collected array bound, and its value becomes the loop's value.
`next value with { … }` does both:

```katari
agent both(values: array[integer]) -> integer {
  for (let value in values, var running: integer = 0) {
    next value * value with { running = running + value }
  } then (_squares) { running }
}
```

`break` leaves early with a value:

```katari
agent first_match(values: array[string], wanted: string) -> string {
  for (let value in values, var seen: string = "(none)") {
    if (value == wanted) { break value } else { next with { seen = value } }
  } then (_elements) { seen }
}
```

A binder may be a pattern, and `array.range` is the counted loop:

```katari
agent tuple_binder(entries: array[[string, integer]]) -> array[string] {
  for (let [key, _value] in entries) { next key }
}

agent counted(count: integer) -> array[integer] {
  for (let n in array.range(start = 0, end = count)) { next n * n }
}
```

`return` also exists, for an early exit from the whole agent:

```katari
agent early(values: array[string]) -> string {
  for (let value in values) {
    if (value != "") { return value }
    next null
  }
  "(none)"
}
```

### `forever`

```katari
agent looping(limit: integer) -> integer {
  forever (var n: integer = 0) {
    if (n >= limit) { break n } else { next with { n = n + 1 } }
  }
}

agent unending() -> never with io {
  forever {
    time.sleep(milliseconds = 1000.0)
  }
}
```

`forever` repeats in place and collects nothing, so its `next` carries no value. A `forever` with no
`break` has type `never`, which fits any declared return.

### `parallel`

```katari
agent fanned(count: integer) -> array[integer] {
  parallel for (let n in array.range(start = 1, end = count + 1)) {
    next n * n
  }
}

agent echo(text: string) -> string { text }

agent both_at_once(a: string, b: string) -> array[string] {
  parallel [echo(text = a), echo(text = b)]
}
```

`parallel for` runs the iterations concurrently and joins their results **in source order**;
`parallel [a, b]` does the same for a fixed list. Neither may declare `var` state
([K3024]({docs}/{currentVersion}/toolchain/error-codes)) — collect and fold after the join instead.

### `use handler`

```katari
request log(line: string) -> null

agent stateless() -> integer with io {
  use handler {
    request log(line: string) -> null { next null }
  }
  log(line = "hello")
  0
}
```

`use handler` installs clauses for **the rest of the enclosing block** — the continuation. `next`
resumes the performer with a value; `break` abandons the block and makes its value the result.

```katari
agent stateful() -> integer {
  use handler (var counter: integer = 0) {
    request tick() { next counter with { counter = counter + 1 } }
  }
  let _first = tick()
  tick()
}
```

A sequential handler may carry `var` state, and serves its requests at a FIFO in arrival order — it
is an actor.

```katari
data too_big(value: integer)

agent aborting(values: array[integer]) -> string {
  use handler {
    request prelude.throw(error: too_big) -> never { break "too big" }
  }
  for (let value in values) {
    if (value > 100) { prelude.throw(error = too_big(value = value)) } else { next null }
  }
  "all small"
}

agent catching_panic() -> string {
  use handler {
    request panic(msg: string) { break f"panic caught: ${msg}" }
  }
  let _boom = 1 / 0
  "unreachable"
}
```

A clause may name a **qualified** request, and a `prelude.throw` clause additionally selects by
**payload type**. The `panic` clause is special: `panic` is undeclared and never appears in a row, its
parameter must be spelled `msg`, and only an explicit `break` recovers.

```katari
request shared(task: agent (value: null) -> null with io) -> null

agent concurrent() -> null with io {
  use parallel handler {
    request shared(task: agent (value: null) -> null with io) {
      next task(value = null)
    }
  }
  null
}
```

`use parallel handler` dispatches its bodies concurrently, and therefore **cannot** carry `var` state
([K3025]({docs}/{currentVersion}/toolchain/error-codes)). Where handlers go relative to one another is
[Handler geometry]({docs}/{currentVersion}/guides/handler-geometry).

### `use` with any provider

```katari
agent provider[R, effect E](continuation: agent (value: string) -> R with E) -> R with E {
  continuation(value = "provided")
}

agent using_a_provider() -> string {
  let token = use provider
  token
}
```

Any agent whose last parameter is a `continuation` is a provider, and `use` applies it to the rest of
the block. `let x = use p` binds what the provider hands over. Write the provider bare, as a call
(`use store.workspace(path = "…")`), or with generic arguments
(`use region.provide[Scope, Ceiling]`) — but never write `continuation` yourself
([K3019]({docs}/{currentVersion}/toolchain/error-codes)).

### `region`

```katari
request tick_seen(at: number) -> null

effect clock_scope

// A `type` synonym takes no `@"..."` doc.
type clock_ceiling = tick_seen | io

agent ticker(input: number) -> never with clock_ceiling {
  forever {
    time.sleep(milliseconds = input)
    tick_seen(at = time.now())
  }
}

agent three_ticks() -> integer with io {
  use handler {
    request prelude.throw(error: enough) -> never { break 3 }
  }
  use handler (var seen: integer = 0) {
    request tick_seen(at: number) {
      if (seen >= 2) { prelude.throw(error = enough()) } else { next null with { seen = seen + 1 } }
    }
    request region.crashed(id: string, name: string, message: string) { next null }
    request region.failed(id: string, name: string, error: unknown) { next null }
  }
  let nursery: region.nursery[clock_scope, clock_ceiling] = use region.provide[clock_scope, clock_ceiling]
  let _ticker = region.fork(nursery = nursery, task = ticker, argument = 200.0, name = "ticker")
  let _mail = region.post(nursery = nursery, task = agent () -> null with clock_ceiling { tick_seen(at = 0.0) }, name = "one-shot")
  region.watch(nursery = nursery)
}
```

`region.provide[Scope, Ceiling]` opens a **nursery** for the rest of the block; `fork` spawns a
detached fiber into it; `post` is `fork` for a task that is one inline perform; `watch` re-emits every
fiber's escalations, and returns `never`. There is no join — a fiber reports through its escalations.
`crashed` and `failed` ride `watch`'s row, so the compiler makes you handle them. See
[Parallelism]({docs}/{currentVersion}/concepts/parallelism#regions-fork-without-join) and
[A Second Agent]({docs}/{currentVersion}/tutorial/a-second-agent).

### `finally`

```katari
agent guarded() -> string with io {
  finally {
    let _note = "bookkeeping done"
    null
  }
  "worked"
}
```

`finally` arms a finalizer on the current agent instance, running on completion **and** on
cancellation, never on a panic; arming order is reversed at run time. Its body's net effect must be
within `io` ([K3021]({docs}/{currentVersion}/toolchain/error-codes)).

### `throw` and `panic`

```katari
data not_even(value: integer)

agent half(value: integer) -> number with prelude.throw[not_even] {
  if (value % 2 == 0) { value / 2 } else { prelude.throw(error = not_even(value = value)) }
}

agent halved(value: integer) -> string {
  use handler {
    request prelude.throw(error: not_even) -> never { break "odd" }
  }
  string.to_string(value = half(value = value))
}
```

**`throw` is not a keyword.** It is `prelude.throw`, an ordinary generic request returning `never`, so
it rides the effect row like anything else and is caught with an ordinary handler clause.

**`panic` cannot be raised from Katari.** It is the runtime's own failure channel (division by zero, a
broken invariant). It never appears in a row, and the only thing you can write about it is the handler
clause above.

## Things that look like they should exist, and do not

| Assumed                   | Reality                                                                         |
| ------------------------- | ------------------------------------------------------------------------------- |
| `module foo` header       | A module's name is its file path under `src/`.                                  |
| `x = value` assignment    | Only `var` state exists, and only `next with { … }` advances it.                |
| `values[0]`               | `[…]` is generic instantiation. Use `array.get(…)`, which answers `T \| null`.  |
| `case [first, ...rest]`   | No rest patterns. Record patterns are already subset matches.                   |
| Positional arguments      | Every argument is named: `f(x = 1)`.                                            |
| `region.join(handle)`     | There is no join. A fiber reports through escalations, heard at `region.watch`. |
| `@"doc"` on a `type`      | Only `agent`, `request`, `effect`, `data` and `external` take documentation.    |
| `throw` / `try` / `catch` | `prelude.throw` is a request; a handler clause is the catch.                    |

## Where to go next

- [Error codes]({docs}/{currentVersion}/toolchain/error-codes) — when `katari check` disagrees with
  something you wrote here.
- [Package reference](/packages) — every declaration of every published package, with signatures.
- [Tutorial]({docs}/{currentVersion}/tutorial) — the same forms, in the order you would meet them.
