---
title: Syntax
description: Module declarations, let / match / for / parallel / use / finally, the partial application hole _, and reserved words.
---

Katari is brace-delimited and largely free-form, but a newline acts as a statement separator (a
Go-style "virtual semicolon"). Statements in a block are separated by a newline or a `;`, and a
line ending in an operator continues onto the next line.

## Modules

There is **no `module` keyword**. Each file is one module, and the module name is determined by
the package name plus the file path (`ffi.ktr` is the `ffi` module, and the `greet` defined there
is `ffi.greet`). An import brings names from another module into scope.

```katari
import { area, type shape } from basics   // Bring in individual names (values / types)
import basics                              // Bring in the whole module, referenced as basics.area
import basics as shapes                    // Alias
```

`import module.path` can take a dot-separated path. Name resolution requires an explicit import,
except for `prelude` (and its submodules `json` / `http` / `record` / ...), which is imported by
default.

## Top-level declarations

| Declaration                                                      | Meaning                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------ |
| `agent name[generics](params) -> T [with E] { body }`            | A callable agent (function)                            |
| `private agent ...`                                              | An agent that cannot be called from outside the module |
| `request name[generics](params) -> T`                            | A request (effect declaration only, no body)           |
| `effect name[generics]`                                          | A marker effect (described below)                      |
| `external agent name[generics](params) -> T [with E] [from "R"]` | An agent whose destination is a reactor / FFI sidecar  |
| `primitive agent name[generics](params) -> T [with E]`           | A compiler builtin agent (for the stdlib)              |
| `data name[generics](params)`                                    | One constructor of a sum type                          |
| `type name[generics] = T`                                        | A type synonym                                         |
| `import ...`                                                     | Brings names from another module into scope            |

A `@"..."` doc annotation can precede `agent` / `request` / `external agent` / `primitive agent` /
`data`. It becomes the description in the generated JSON Schema, appearing in tool definitions
shown to an AI and in the `description` returned by `reflection.get_metadata`.

```katari
@"A single circle, represented by its radius."
data circle(radius: number)

@"The area of a circle."
agent area(value: circle) -> number {
  3.14159 * value.radius * value.radius
}
```

The `from "reactor"` clause on an `external agent` names the destination reactor. In a user
module, the only options are to omit it, meaning it targets the FFI sidecar (implemented by a
same-named `.ts` module such as
[`ffi.ktr`]({docs}/{currentVersion}/katari-toolchains/runtime)), or to write `from "ffi"`
explicitly. The builtin reactor names (`"http"` / `"webhook"` / `"mcp"` / `"time"`) are reserved
for the compiled stdlib's externals; writing one of them in a user module's `from` is rejected
with **K3022**, because the call would otherwise arrive at the reactor tagged with a key it
doesn't recognize.

## Blocks and statements

A block `{ ... }` consists of a sequence of statements followed by an expression whose value
becomes the block's value. Statements include `let` / `var` (state for `for` / handlers), local
`agent` declarations, `return`, `next`, `break`, `finally`, and `use`; anything else is an
expression statement.

```katari
agent example() -> integer {
  let a = 1        // let: immutable binding
  let b = a + 1
  b                // the trailing expression is the block's value
}
```

## match

`match (subject) { case pattern -> body ... }` dispatches on the constructor. The patterns are:

| Pattern                        | Meaning                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `_` / `_: T`                   | Wildcard (can narrow by type)                                                                                                   |
| `42` / `"s"` / `true` / `null` | Literal                                                                                                                         |
| `n` / `n: T`                   | Variable binding                                                                                                                |
| `[p1, p2, ...]`                | Tuple pattern                                                                                                                   |
| `{ x, y => p }`                | Record pattern (`x` is sugar for `x => x`)                                                                                      |
| `point(x => px, y => py)`      | Constructor pattern (destructures fields)                                                                                       |
| `point()`                      | Constructor pattern with no fields                                                                                              |
| `integer(n)`                   | Type filter (primitive tags only: `null` / `boolean` / `integer` / `number` / `string` / `file` / `array` / `record` / `agent`) |

```katari
data circle(radius: number)
data rect(width: number, height: number)
type shape = circle | rect

agent area(value: shape) -> number {
  match (value) {
    case circle(radius => r) -> 3.14159 * r * r
    case rect(width => w, height => h) -> w * h
  }
}
```

## for / parallel

`for (pattern in source [, var name [: T] = init]...) { body } [then [(pattern)] { ... }]` is
sequential iteration. Inside the body, `next value [with { name = expr, ... }]` advances to the
next element (updating the accumulator `var`s), and `break value` terminates the loop. The `then`
clause receives the final result.

```katari
agent sum(values: array[integer]) -> integer {
  for (let value in values, var total: integer = 0) {
    next with { total = total + value }
  } then (_elements) { total }
}
```

`parallel for (...) { ... }` uses the same syntax but evaluates each element on an independent
thread, in parallel. `parallel [e1, e2, ...]` evaluates a tuple of expressions in parallel (a
fixed number of elements, not a `for`).

```katari
agent squares(count: integer) -> array[integer] {
  parallel for (let n in array.range(start = 1, end = count + 1)) {
    next n * n
  }
}
```

## forever

`forever [(var name [: T] = initial, ...)] { <block> }` is an unending loop expression — the
unbounded sibling of the sequential `for`, in fact `for` minus its `{source, per-iteration value
collection, then clause}`, with the **same** `{var state, next … with (…), break}` machinery. It
runs the body as a child thread and, once it completes, **discards** its value and starts the next
iteration. Because it is a single iterating thread within one instance, the frame of each completed
iteration is reclaimed, so **durable state stays flat regardless of the number of iterations**
(looping via recursion instead would accumulate a persistent frame per iteration; this syntax
exists to prevent that).

`forever` owns exactly the two jumps a `for` body owns, resolving to the loop as their nearest
target:

- **`break value` exits the loop with that value** — the built-in exit, the same `break` machinery
  a `for` uses. It is a lexical jump, not a performable request, so nothing outside the loop can
  name or trigger it.
- **`next [with (mods)]` advances to the next iteration**, updating the loop's `var` state through
  the modifiers. Unlike `for`'s `next` it collects **no** value (there is no output array); falling
  off the end of the body is an implicit `next` with the state unchanged.

The expression **types as the union of its `break` values — `never` when it has none.** With no
`break` the loop never yields, so `forever { ... }` fits anywhere a call to `-> never` would
(including an agent body's trailing expression for any declared return); a `break value` makes the
loop's type that value's.

```katari
data ready(value: integer)
data pending()
request check() -> ready | pending

agent poll_until_ready() -> integer with check | io {
  forever (var waited = 0) {
    match (check()) {
      case ready(value => value) -> { break value } // exit with the value
      case pending() -> {
        time.sleep(milliseconds = 1000)
        next with { waited = waited + 1 } // re-iterate, advancing state
      }
    }
  }
}
```

`forever` is **not a reserved word**. It is recognized positionally as the loop only when
immediately followed by `{`, so an identifier like `replay.forever(...)` or an agent declaration
named `forever` remains valid as before. The providers in
[`prelude.replay`]({docs}/{currentVersion}/standard-library/replay) are exactly this shape: the
loop's `var` holds the backoff delay and attempt count, `next … with (…)` advances them, and
`break` carries the success value out.

## use / handler

`use provider` applies the provider once, with the rest of the block that follows as its
continuation. See [Providers]({docs}/{currentVersion}/language-reference/providers) for details.
The most basic provider is the handler literal itself:

```katari
request tick() -> integer

agent count_three() -> array[integer] with tick {
  use handler (var counter = 0) {
    request tick() { next counter with { counter = counter + 1 } }
  }
  [tick(), tick(), tick()]
}
```

`handler [generics](var state = init, ...) { request handler... } [then ...]` builds a handler as
an expression (with state variables, multiple request clauses, and a `then` clause that receives
the final state). `parallel handler` builds a handler that runs in parallel. Inside a request
clause, if the enclosing construct is a `for`, its `next` / `break` apply; if the enclosing
construct is a handler, the handler's `next` (resume) / `break` (discharge) apply. Which meaning
applies is determined by the position of the nearest enclosing `for` / handler.

## finally

`finally { <block> }` is a statement and returns no value. Evaluating it pushes the block onto the
current instance's finalizer stack (arming). See
[finally]({docs}/{currentVersion}/language-reference/finally) for details.

## Partial application: `_`

Among a call's named arguments, the ones given a value are fixed now, the ones written as `_`
become holes, and the remaining optional arguments are omitted and stay defaulted. See
[Partial Application]({docs}/{currentVersion}/language-reference/partial-application) for details.

```katari
agent scale(factor: number, value: number) -> number { factor * value }

agent doubles(values: array[number]) -> array[number] {
  let double = scale(factor = 2.0, value = _)   // agent (value: number) -> number
  for (let value in values) { next double(value = value) }
}
```

## f-strings

`f"...${expression}..."` is a template string: literal fragments and `${...}` expressions
alternate.

```katari
agent greeting(name: string, count: integer) -> string {
  f"Hello, ${name}! (${string.to_string(value = count)})"
}
```

## Literals and expressions

- A numeric literal is `number` if it has a fractional part or exponent, and `integer` otherwise.
- A string literal is `"..."` (escapes: `\n` `\t` `\r` `\"` `\\` `\$` `\/`).
- Booleans `true` / `false`, and `null`.
- Tuples `[e1, e2, ...]` (empty `[]` and single-element `[e]` are also valid).
- Record literals `{ label = expr, ... }` (keys are identifiers, or a quoted string such as
  `"Content-Type"`).
- Operators follow the usual precedence: `!` / unary `-` (can be stacked) > `* / %` > `++ + -` >
  comparison (`<= >= < >`) > `== !=` > `&&` > `||`.

## generics

Generics take the form `[A, effect E, attribute T, literal L extends Bound]`, and there are four
kinds: unmarked (a type), `effect` (an effect row variable), `attribute` (an attribute variable,
like `public` / `private`), and `literal` (binds the caller's string literal argument to its
singleton type, equivalent to a TypeScript `const` type parameter). `extends` writes an upper
bound (`[T extends number]`).

## Reserved words

```
agent request external primitive data type import from as use handler
for parallel if else match case return next break var let finally then in with of
true false null
```

Type-only words (`integer` `array` `record` `never` `unknown` `all` `io` `pure` ...) are not
reserved words. The type parser recognizes them positionally, so they can also be used as
expression identifiers or module names (the `array` in `array.get` is a module name).

## Related

<DocCards>
  <DocCard href="{docs}/{currentVersion}/language-reference/types" />
  <DocCard href="{docs}/{currentVersion}/language-reference/effects" />
  <DocCard href="{docs}/{currentVersion}/language-reference/partial-application" />
  <DocCard href="{docs}/{currentVersion}/language-reference/providers" />
</DocCards>
