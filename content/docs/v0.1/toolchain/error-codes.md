---
title: Error codes
description: Every diagnostic the compiler can print, by code — what the message means, what usually caused it, and the edit that fixes it. Written to be read one code at a time.
---

`katari check` prints one line per diagnostic, and every diagnostic carries a stable code:

```text
bot:12:5 K3001: Number layers are incompatible
  expected: string
  actual:   integer
```

That is **module**, **line**, **column**, **code**, **message** — and, for the errors that can say
more, indented detail lines under it. The code never changes meaning between releases, so it is the
right thing to search for.

The ranges say which phase rejected the program, which is also the order the phases run in:

| Range     | Phase             | What it was doing                                               |
| --------- | ----------------- | --------------------------------------------------------------- |
| **K1xxx** | Parser            | Turning characters into declarations.                           |
| **K2xxx** | Names             | Resolving every identifier to the thing it names.               |
| **K3xxx** | Types and effects | Checking what each expression is and what performing it may do. |
| **K4xxx** | Lowering          | Turning the checked program into the IR the runtime executes.   |

Almost everything is a **K3xxx**, because almost everything Katari checks is a type or an effect.

Every code is an error except **K1002**, which is a warning: the compilation still succeeds.

There is no K3002, K3003 or K3004. They were retired; nothing emits them.

## Read the bottom of the list first

The compiler does not stop at the first error — it reports everything it found, and one real mistake
often produces several lines. When a name fails to resolve, the checker gives the expression the type
`never` and carries on, so the **first** line you see can be a consequence of the **last** one:

```text
bot:2:25 K3014: Expected a callable agent, but the expression has type never
bot:2:30 K2002: Module prelude.json has no exported member no_such_thing
```

There is one mistake here (a misspelled member), and the diagnostic naming it is second. The rule
that follows: **a K3014 that says `has type never` is a symptom, not a cause.** Fix the K2xxx line,
or whatever error precedes it, and the `never` line goes with it. See
[When a type is `never`](#when-a-type-is-never).

## K1xxx — the parser

| Code      | What it says                                       | Usually                                                                                                                                          | Fix                                                                                                                                                                                                                                                                                  |
| --------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **K1001** | `unexpected "…"` / `expecting …`                   | A syntax error. The `expecting` list is the set of things that were legal at that column, which is often more useful than the `unexpected` half. | Read the column, not just the line. Two common shapes: two statements crammed onto one line (statements are newline-separated), and `break` / `next` written outside a `for`, a `forever` or a request handler — the parser rejects those by position, before the checker sees them. |
| **K1002** | `Integer literal … exceeds the safe integer range` | A literal beyond ±(2^53 − 1). The runtime's number is a double, so the value would silently lose precision.                                      | **A warning — the program still compiles.** If the magnitude is real (an ID, a nanosecond timestamp), carry it as a `string` instead of a number.                                                                                                                                    |

## K2xxx — names and modules

| Code      | What it says                                | Usually                                                                                                             | Fix                                                                                                                                                                                                      |
| --------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **K2001** | `Undefined name: x`                         | A typo, or a name that lives in a module you did not import.                                                        | Import it (`import prelude.json`), or qualify it. The prelude and its sub-modules (`array`, `record`, `string`, `time`, `region`, …) are in scope everywhere; nothing else is.                           |
| **K2002** | `Module M has no exported member x`         | `M.x` where `M` resolved but has no `x`. A misremembered API name — the single most common AI-written error.        | Look the module up in the [package reference](/packages) (or the `packages` MCP tool) and use the real name. Expect a K3014 saying `has type never` on the same expression; it disappears with this one. |
| **K2003** | `Duplicate declaration of x`                | Two top-level declarations claiming one name in one namespace.                                                      | Rename one. Note that values and types are **separate** namespaces, so an agent and a type may share a name; a `request` or `data` declaration occupies both.                                            |
| **K2004** | `x is not a module`                         | `x.y` in a **type** position where `x` resolves to something that is not a module — an agent, a data type, a local. | You wanted a field access (an expression) or a different qualifier. In type position only a module name may precede the dot.                                                                             |
| **K2005** | `Imported module does not exist: M`         | An import of a module no package in the closure provides.                                                           | Check the spelling, and check that the package is in `katari.toml` — `katari add <pkg>`. A module's name is its path under the package: `src/bot/mail.ktr` in package `bot` is module `bot.mail`.        |
| **K2006** | `Module M does not export x`                | `import { x } from M` where `M` has no `x` — the selective-import form of K2002.                                    | Fix the name, or add `type` for a type-namespace item: `import { parse, type parse_error } from prelude.json`.                                                                                           |
| **K2007** | `x is not a loop or handler state variable` | `next with { x = … }` naming something that is not a `var` of the enclosing `for` or handler.                       | `with { … }` may only update the enclosing construct's own `var` bindings. Declare it — `for (… , var x: T = init)` — or assign an ordinary local instead.                                               |
| **K2008** | `Module name M is reserved by the compiler` | A user module named exactly like a stdlib module, or anything under `primitive.*`.                                  | Rename the file. The module would otherwise shadow the stdlib for every program in the closure, so it is excluded rather than merged.                                                                    |

## K3xxx — types and effects

### The two you will meet most

| Code      | What it says                                        | Usually                                                                                                                                                                           | Fix                                                                                                                                                                                                          |
| --------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **K3001** | `<reason>` + an `expected:` / `actual:` pair        | **The whole subtype check.** A wrong argument type, a return that does not fit, a leaked private value, and — most importantly — an effect row that does not fit its declaration. | Read the `expected` / `actual` pair first; the reason names which part disagreed. The vocabulary is decoded in [Reading a K3001](#reading-a-k3001).                                                          |
| **K3014** | `Expected <shape>, but the expression has type <T>` | An expression used in a position that needs a particular shape: called (`a callable agent`), iterated (`a sequence (array or tuple)`), spread or dotted (`an object`).            | If `<T>` is `never`, this is a cascade — fix the earlier error instead ([below](#when-a-type-is-never)). Otherwise the value genuinely is not the shape: you probably forgot a call, or dotted a non-record. |

### Types and annotations

| Code      | What it says                                                                        | Usually                                                                                                                                                        | Fix                                                                                                                                                                                           |
| --------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **K3005** | `Invariant generic arguments must be identical to be unioned`                       | Two instantiations of an **invariant** generic met at a join — the branches of an `if`, the arms of a `match`.                                                 | An invariant parameter (one appearing in both an argument and a result) admits no widening. Make both sides the same instantiation, or give the type a variance-friendly shape.               |
| **K3006** | `Invariant generic arguments must be identical to be intersected`                   | The meet counterpart of K3005 — narrowing (a `match` extracting a constructor) reached two different instantiations.                                           | Same fix. There is no surface `&` operator, so this only arises from inference; the branch you are narrowing is over-constrained.                                                             |
| **K3007** | `This expression has the wrong kind (expected type, actual effect)` (or vice versa) | An **effect** generic used where a **type** is expected, or the reverse — usually `E` written as a parameter's type, or a data type listed inside `{...E, …}`. | Effect parameters are declared `[effect E]` and used only in rows (after `with`, or inside `{ … }`). Types go everywhere else.                                                                |
| **K3008** | `Generic arguments do not match the declaration of M.x`                             | A generic value applied with the wrong **named** parameters.                                                                                                   | Supply exactly the declared names, in declaration order; the message prints both lists.                                                                                                       |
| **K3009** | `Wrong number of type arguments for H (expected n, actual m)`                       | `array[a, b]`, `record[]`, a synonym applied with the wrong count.                                                                                             | Count the brackets against the declaration. `array` and `record` take exactly one.                                                                                                            |
| **K3010** | `Type synonym M.x expands to itself (cyclic synonym)`                               | A synonym that refers to itself, directly or through others. Expansion would not terminate.                                                                    | Break the cycle. A **recursive** shape needs a `data` declaration (a real nominal type), not a synonym.                                                                                       |
| **K3011** | A malformed type annotation; the specific failure is in the message                 | Most often an effect override `{...E, …}` containing something that is not a request: `io`, `pure`, or a data type.                                            | `io` and `pure` are unioned, not overridden — write `{...E, my_request} \| io`. See [When the geometry is wrong]({docs}/{currentVersion}/guides/handler-geometry#when-the-geometry-is-wrong). |
| **K3013** | `<what> requires a type annotation` / `requires an explicit return type`            | A position the checker does not infer: an agent parameter, a `use` binder, or an agent in a **recursive** group.                                               | Write it. For a long ceiling row, name it once as an effect-row synonym — `type bot_ceiling = ai.observation \| discord.connection \| io` — and use the name.                                 |
| **K3012** | `` `x` is only valid inside <context> ``                                            | A `return` / `break` / `next` whose target construct does not enclose it.                                                                                      | Rare in practice: the parser rejects most misplaced jumps first, with K1001. Same fix — move it inside the `for`, `forever` or handler it belongs to.                                         |
| **K3015** | `This generic value is used without type arguments and is not in a call`            | A generic agent passed **as a value** (as a tool, a `deliver_to`, an array element) without being applied.                                                     | Generic arguments are inferred at call sites only. Apply it at the use site: `identity[string]`.                                                                                              |
| **K3016** | `Could not infer the type argument(s) [T] from this application`                    | A call whose arguments do not mention `T` — nothing constrains it. `array.empty()`-shaped calls do this.                                                       | Supply it explicitly: `make[string]()`. An annotation on the binding is not enough; the arguments are what inference reads.                                                                   |
| **K3017** | `` `x` is not a request `` (or `not a constructor (data type)`)                     | A `use handler` clause naming a `data` type or a synonym, or a `case` pattern naming an agent.                                                                 | Handlers serve `request` declarations; constructor patterns match `data` declarations. Namespaces overlap, so this is caught here rather than at resolution.                                  |
| **K3027** | ``An `agent` expression cannot declare generic parameters``                         | Generic brackets on an anonymous `agent (…) -> … { … }`.                                                                                                       | Type arguments arrive through a value's **name**, and an expression has none. Declare it as a named agent and pass that, or write the anonymous one at concrete types.                        |

### Handlers, `use`, and effect placement

| Code      | What it says                                                | Usually                                                                                                                                           | Fix                                                                                                                                                                                                                                                                                                   |
| --------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **K3019** | Three messages, one per way a `use` is misshapen            | Writing `continuation = …` yourself; a provider that is not a handler, a name or a call; a `_` hole in the provider.                              | `use` passes the continuation itself, and applies the provider exactly once. Bind anything else first: `let p = f(x = _, …)` then `use p`.                                                                                                                                                            |
| **K3020** | `` `label = _` does not name a parameter of the callee ``   | A typo in a partial application's hole label. The message lists the real parameters.                                                              | Use one of the listed labels. Distinct from K3001: the hole is **extra**, not missing.                                                                                                                                                                                                                |
| **K3021** | ``A `finally` finalizer's net effect must be within `io` `` | A finalizer body that performs a request — including a `throw`.                                                                                   | A finalizer runs at instance termination, when the parent may already be awaiting this instance's cancellation, so an escalation would deadlock. Handle the request **inside** the `finally` body, or perform only `io`. See [Durable execution]({docs}/{currentVersion}/concepts/durable-execution). |
| **K3023** | `` A `panic` handler's parameter must be named `msg` ``     | `request panic(message: string) { … }`.                                                                                                           | Rename it: `request panic(msg: string) { … }`. `panic` is undeclared, so its parameter name is wired in.                                                                                                                                                                                              |
| **K3024** | ``A `parallel for` cannot declare `var` state``             | Trying to fold across concurrent iterations. The iterations all start from the same value, so only one write survives — a silent last-write-wins. | Drop the `var`: `next` each iteration's contribution and fold the collected array afterwards, in the `then` clause. See [Parallelism]({docs}/{currentVersion}/concepts/parallelism).                                                                                                                  |
| **K3025** | ``A `parallel handler` cannot declare `var` state``         | The same lost update, on a handler. A parallel handler dispatches its bodies concurrently.                                                        | Drop `parallel` — a sequential handler's FIFO is exactly what makes its state sound — or drop the `var`. See [Handler geometry]({docs}/{currentVersion}/guides/handler-geometry#sequential-or-parallel-the-handler-is-the-only-serialization-point).                                                  |
| **K3026** | ``A `lacks` entry must be a bare request name``             | `lacks throw[error]` — an applied form.                                                                                                           | The constraint is name-level: it excludes **every** instantiation of the request. Write `lacks prelude.throw`.                                                                                                                                                                                        |

### Externals

| Code      | What it says                                                     | Usually                                                                                                        | Fix                                                                                                                                                                                                                            |
| --------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **K3018** | ``Unknown reactor `x` in a `from` clause``                       | A typo. The message lists the reactors that exist: `ffi`, `http`, `webhook`, `mcp`, `time`, `oauth`, `region`. | Use one of them — for your own code that is `ffi`.                                                                                                                                                                             |
| **K3022** | ``The `http` reactor serves only the compiled stdlib externals`` | A user module claiming a built-in reactor.                                                                     | Those reactors dispatch on stdlib keys, so a user-declared external would arrive with a key they cannot serve. Omit the `from` clause, or write `from "ffi"`. See [FFI sidecars]({docs}/{currentVersion}/guides/ffi-sidecars). |

## K4xxx — lowering

| Code      | What it says                                   | Usually                                                                                                                             | Fix                                                                                 |
| --------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **K4001** | An unsupported construct, named in the message | A well-typed program the IR has no encoding for. You should not normally see one — lowering runs **after** type checking succeeded. | Treat it as a compiler limitation and report it, with the program that produced it. |

## Reading a K3001

K3001 is one code covering the entire subtype relation, so its message is assembled from a **reason**
plus an `expected` / `actual` pair. The reason is written in the checker's own vocabulary, and two of
its habits are worth learning once.

### "Layers"

A Katari type is a set of independent **layers** — the null layer, the number layer, the string layer,
the boolean layer, the file layer, the function layer, the sequence layer, the object layer — and a
subtype check compares them one at a time. So the reason names the layer that disagreed, not the type:

```text
bot:2:25 K3001: Number layers are incompatible
  expected: string
  actual:   integer
```

**Read it as: "you passed an `integer` where a `string` was wanted."** The layer name is only saying
which of the eight comparisons failed first. `String layers are incompatible` between two string
literal types means the same thing at a finer grain (a literal type is a set of permitted strings);
`Object layers are incompatible` means two record shapes disagree, and the `expected` / `actual` lines
below carry the fields. In every case the two lines under the reason are the message.

One layer reason is not about shape at all: `Private attribute cannot be a subtype of public
attribute` means a value derived from a secret reached a position that is not marked private. See
[Types and schemas]({docs}/{currentVersion}/concepts/types-and-schemas).

### "Left effect"

When the disagreement is in an **effect row**, the reason starts with `Left effect`. "Left" is the
`actual` side — what the code does — and "right" is `expected`, what the signature permits:

```text
bot:4:1 K3001: Left effect performs a request not present in the right effect: bot.audit
  expected: io
  actual:   audit
```

**Read it as: "this body performs `audit`, and its declared row does not include `audit`."** Two
edits close it, and choosing between them is the whole design decision: **handle** the request (add a
`use handler` above the perform) or **carry** it (add it to the row after `with`).

The variants, all in the same voice:

| Reason                                                                           | What it means                                                                                                              |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `performs a request not present in the right effect: R`                          | `R` is performed and not admitted. Handle it or declare it.                                                                |
| `performs io, which the right effect does not allow (io cannot be discharged)`   | The body touches the outside world and the signature claims it does not. `io` has no handler — it can only be declared.    |
| `carries a global escape not present in the right effect`                        | A `break` / `next` crossing a boundary the target row does not carry.                                                      |
| `has an effect generic not present in the right effect`                          | A row variable `E` appears on the left and not on the right — usually a forwarded row that was dropped from the signature. |
| `A left-only effect generic is unbounded, so the left effect is effectively any` | An unconstrained `E` can carry anything, so it fits no concrete row. Bound it (`E extends …`) or name the requests.        |
| `Any effect cannot be a subtype of a known effect`                               | The `all` effect met a concrete row. Narrow the source.                                                                    |

### The geometry note

When the request **does** have a handler but that handler is installed in the wrong place, K3001
appends a note naming the line:

```text
bot:4:1 K3001: Left effect performs a request not present in the right effect: bot.audit
  Note: `bot.audit` is served by the handler installed at line 11, but a handler body's
  performs escalate from its own install site and reach only handlers installed ABOVE it — move that
  handler earlier, or this perform later.
  expected: io
  actual:   audit
```

This is the one diagnostic that tells you a **position** is wrong rather than a type. There is no
dedicated code for a misplaced handler, and the error lands on the **perform site**, not on the
`use handler` you would move. [Handler geometry]({docs}/{currentVersion}/guides/handler-geometry) is
the whole subject.

## When a type is `never`

`never` is the type with no values. It appears legitimately — an agent that always throws, a `forever`
loop with no `break` — but in a diagnostic it is nearly always **error recovery**. When the checker
cannot work out what an expression is, it gives it `never` and keeps going, so the rest of the module
still gets checked instead of the compile stopping at the first mistake.

`never` is the **bottom** type, so it fits every position that wants a value: passing it as an
argument or returning it never fails a subtype check, and it produces no K3001. What it cannot do is
be **used** — called, iterated, dotted — because those need a shape, and `never` has none. So the
cascade is always K3014, one per use site:

```text
bot:6:16 K3014: Expected a callable agent, but the expression has type never
bot:6:21 K2002: Module prelude.json has no exported member parse_json
bot:7:15 K3014: Expected a callable agent, but the expression has type never
```

Three lines, one misspelling, and the one that names it is in the middle. **When a K3014 says
`has type never`, do not fix the line it points at.** Look for a K2xxx — an undefined name or an
undefined member — or an earlier K3xxx on the same expression, fix that, and the whole cascade goes.

Two `never`s that are **not** cascades, and mean what they say:

- `expected: never` — something is being pushed into a position that admits no value at all. Nothing
  is a subtype of `never` except `never`.
- `never` in a signature you are reading — `agent never -> null` is how a **nullary** agent is spelled
  as a type (`region.fiber` is one), and `-> never` is an agent that never returns normally, like
  `prelude.throw` or a `watch`.

## Errors with no code

Before the compiler runs at all, the project layer assembles the package closure, and its failures
print without a K code — they are about `katari.toml` and `katari.lock`, not about your source. The
ones you are most likely to meet:

| Message                                                         | What happened                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Package p provides module m, which is outside its p namespace` | A file under `src/` whose module name does not start with the package name. `src/mail.ktr` in package `bot` is module `mail`, which package `bot` may not provide — move it to `src/bot/mail.ktr` (module `bot.mail`), or rename it `src/bot.ktr`. **This is the first error a new project hits**, because `katari init` names the entry module after the package and a second file added beside it lands outside the namespace. |
| `katari.lock no longer matches katari.toml: …`                  | The lock and the manifest disagree. Every offline load **refuses** rather than compiling the wrong closure. The fix is always `katari lock`; the block lists each disagreement.                                                                                                                                                                                                                                                  |
| `Module m is provided by two packages: a and b`                 | Two packages in the closure claim one module name. One of them is misnamed.                                                                                                                                                                                                                                                                                                                                                      |
| ``Dependency d is not in the cache (…); run `katari lock` ``    | A locked dependency's source is not on disk. `katari lock` fetches it.                                                                                                                                                                                                                                                                                                                                                           |
| `Package name p is reserved by the compiler`                    | The K2008 check, raised early where you can act on it — a package named after the stdlib.                                                                                                                                                                                                                                                                                                                                        |

## Where to go next

- [The CLI]({docs}/{currentVersion}/toolchain/cli) — `katari check` is the loop these come from.
- [Handler geometry]({docs}/{currentVersion}/guides/handler-geometry) — where most K3001 effect-row
  errors are actually decided.
- [Effects and handlers]({docs}/{currentVersion}/concepts/effects-and-handlers) — what an effect row
  is, if the `with` clause is new.
- [Language reference]({docs}/{currentVersion}/concepts/language-reference) — every legal form, when
  a K1001 means you have guessed at syntax.
