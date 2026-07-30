---
title: Error codes
description: Every diagnostic the compiler can print, by code — what the message means, what usually caused it, and the edit that fixes it. Written to be read one code at a time.
---

`katari check` prints one line per diagnostic, and every diagnostic carries a stable code:

```text
bot:12:5 K3001: The actual type can be a number, which the expected type does not admit
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

Two codes are **warnings** — **K1002** and **K3028**. The compilation still succeeds; everything
else stops it. A warning raised inside a **dependency** is withheld from your build and replaced by
a count, because a warning you cannot act on teaches you to stop reading warnings:

```text
note: 2 warning(s) from dependency packages hidden; `katari check --dependency-warnings` shows them
```

Errors are never withheld, wherever they come from.

There is no K3002, K3003 or K3004. They were retired; nothing emits them.

## One mistake, several lines

The compiler does not stop at the first error — it reports everything it found, and one real mistake
often produces several lines. When an expression fails to check, the checker gives it the type
`never` and carries on, so a line further down can be a **consequence** of one further up.

The commonest instance of this is handled for you. A misspelled name used to print a derived
`has type never` line _above_ the diagnostic that named the typo; since 0.1.1, when a file reports an
unresolved name the compiler drops the `never` lines it caused, so what you see is the mistake
itself, with a suggestion:

```text
bot:2:10 K2002: Module prelude.string has no exported member `jion`; did you mean `join`?
```

The rule still holds for every other cascade: **a K3014 that says `has type never` is a symptom, not
a cause.** Look for the earlier error on the same expression, fix that, and the `never` line goes
with it. See [When a type is `never`](#when-a-type-is-never).

## K1xxx — the parser

| Code      | What it says                                       | Usually                                                                                                                                          | Fix                                                                                                                                                                                                                                                                                  |
| --------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **K1001** | `unexpected "…"` / `expecting …`                   | A syntax error. The `expecting` list is the set of things that were legal at that column, which is often more useful than the `unexpected` half. | Read the column, not just the line. Two common shapes: two statements crammed onto one line (statements are newline-separated), and `break` / `next` written outside a `for`, a `forever` or a request handler — the parser rejects those by position, before the checker sees them. |
| **K1002** | `Integer literal … exceeds the safe integer range` | A literal beyond ±(2^53 − 1). The runtime's number is a double, so the value would silently lose precision.                                      | **A warning — the program still compiles.** If the magnitude is real (an ID, a nanosecond timestamp), carry it as a `string` instead of a number.                                                                                                                                    |

## K2xxx — names and modules

| Code      | What it says                                      | Usually                                                                                                             | Fix                                                                                                                                                                                               |
| --------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **K2001** | ``Nothing in scope is named `x` ``                | A typo, or a name that lives in a module you did not import.                                                        | Import it (`import prelude.json`), or qualify it. The prelude and its sub-modules (`array`, `record`, `string`, `time`, `region`, …) are in scope everywhere; nothing else is.                    |
| **K2002** | ``Module M has no exported member `x` ``          | `M.x` where `M` resolved but has no `x`. A misremembered API name — the single most common AI-written error.        | Look the module up in the [package reference](/packages) (or the `packages` MCP tool) and use the real name.                                                                                      |
| **K2003** | `Duplicate declaration of x`                      | Two top-level declarations claiming one name in one namespace.                                                      | Rename one. Note that values and types are **separate** namespaces, so an agent and a type may share a name; a `request` or `data` declaration occupies both.                                     |
| **K2004** | `x is not a module`                               | `x.y` in a **type** position where `x` resolves to something that is not a module — an agent, a data type, a local. | You wanted a field access (an expression) or a different qualifier. In type position only a module name may precede the dot.                                                                      |
| **K2005** | `Imported module does not exist: M`               | An import of a module no package in the closure provides.                                                           | Check the spelling, and check that the package is in `katari.toml` — `katari add <pkg>`. A module's name is its path under the package: `src/bot/mail.ktr` in package `bot` is module `bot.mail`. |
| **K2006** | ``Module M does not export `x` ``                 | `import { x } from M` where `M` has no `x` — the selective-import form of K2002.                                    | Fix the name, or add `type` for a type-namespace item: `import { parse, type parse_error } from prelude.json`.                                                                                    |
| **K2007** | `` `x` is not a loop or handler state variable `` | `next with { x = … }` naming something that is not a `var` of the enclosing `for` or handler.                       | `with { … }` may only update the enclosing construct's own `var` bindings. Declare it — `for (… , var x: T = init)` — or assign an ordinary local instead.                                        |
| **K2008** | `Module name M is reserved by the compiler`       | A user module named exactly like a stdlib module, or anything under `primitive.*`.                                  | Rename the file. The module would otherwise shadow the stdlib for every program in the closure, so it is excluded rather than merged.                                                             |

### These five suggest

K2001, K2002, K2005, K2006 and K2007 look for a near miss and name it, drawing candidates from the
namespace the lookup actually failed in — locals for a bare name, that module's exports for a member,
the enclosing `var` bindings for a `next with`:

```text
bot:2:10 K2002: Module prelude.string has no exported member `jion`; did you mean `join`?
bot:5:3 K2007: `totl` is not a loop or handler state variable; did you mean `total`?
```

With more than one candidate the tail reads ``did you mean one of `join`, `joins`?`` — at most three,
nearest first. The distance measure counts a swapped pair of letters as one edit, so `jion` still
finds `join`. Names under three characters get no suggestion, and neither does a name with nothing
near it — those print a longer tail instead, naming what would bring the name into scope.

**A suggestion is a guess, not a resolution.** It is computed from spelling alone, so it can offer a
real name with the wrong meaning. For a member of a package, confirm against the
[package reference](/packages) (or the `packages` MCP tool) before taking it.

## K3xxx — types and effects

### The two you will meet most

| Code      | What it says                                        | Usually                                                                                                                                                                           | Fix                                                                                                                                                                                                          |
| --------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **K3001** | `<reason>` + an `expected:` / `actual:` pair        | **The whole subtype check.** A wrong argument type, a return that does not fit, a leaked private value, and — most importantly — an effect row that does not fit its declaration. | The reason is a sentence: it says which part disagreed and what edit closes it, and the two lines under it are the types. [Reading a K3001](#reading-a-k3001) is the tour.                                   |
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
| **K3013** | `<what> requires a type annotation` / `requires an explicit return type`            | A position the checker does not infer: an agent parameter, a `use` binder, or an agent in a **recursive** group.                                               | Write it. For a long ceiling row, name it once as an effect-row synonym — `type bot_ceiling = ai.observation \| discord.credential \| io` — and use the name.                                 |
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

### K3028 — a statement that answered, and nothing read it

The one warning in the K3xxx range, and the one an AI author trips most:

```text
bot:16:3 K3028: This statement produces a value and nothing reads it. Bind what it answers (`let outcome = ...`) and act on it, or write `let _ = ...` to say the discard is deliberate.
  discarded: sent
```

A statement in the middle of a block threw its value away, and the detail line names the discarded
value's type. The build still succeeds — this is a warning — but the value is usually the answer to
the question the call was making. The motivating
case is exactly that: an agent that changed from returning nothing to reporting whether its post
landed, and a dozen call sites that kept compiling while dropping the report on the floor.

Two fixes, and the choice between them is the point:

```katari
let outcome = post(message = text)   // read the answer, and act on it
let _ = post(message = text)         // say the discard is deliberate
```

It does **not** fire when there is nothing to read. `null` and `never` are exempt, and so are
containers of them — an effect-only `for` evaluates to `array[null]`, so loops for their effects
alone stay quiet. **Callables are exempt too**: a capability says what you _may_ do, never what
happened, so `region.fork`'s fiber handle discards without complaint. A block's trailing expression
is the block's value, not a discard, so `if` and `match` arms are unaffected.

## K4xxx — lowering

| Code      | What it says                                   | Usually                                                                                                                             | Fix                                                                                 |
| --------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **K4001** | An unsupported construct, named in the message | A well-typed program the IR has no encoding for. You should not normally see one — lowering runs **after** type checking succeeded. | Treat it as a compiler limitation and report it, with the program that produced it. |

## Reading a K3001

K3001 is one code covering the entire subtype relation, so its message is assembled from a **reason**
plus an `expected` / `actual` pair. Two things are worth knowing before you read one.

**`actual` is what your code produces; `expected` is what the position wants.** Every reason is
phrased from that pair, so it always names the actual side first. (Before 0.1.1 these were called
_left_ and _right_ and the reasons spoke of _layers_ and _subtypes_; if you are reading an old
transcript, `left` is `actual` and `right` is `expected`.) Names in the two lines are printed bare
unless two modules claim the same one, in which case both lines qualify it.

**The reason usually contains the fix.** It is a sentence, not a label:

```text
bot:6:1 K3001: The actual type can be a number, which the expected type does not admit
  expected: string
  actual:   integer
```

### When a type does not fit

The type reasons all follow one shape — _the actual type can be X, which the expected type does not
admit_ — with X being a number, a string, a boolean, a file, an agent, an array or tuple, an object
or record, or null. Read it as "you produced an `integer` where a `string` was wanted"; the two
lines below carry the whole types. The ones that say more than that:

| Reason                                                                                               | What it means                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ``Required argument `x` is missing``                                                                 | A call left out a parameter that has no default. The commonest K3001 there is, and it lands on the call.                                                                                        |
| ``Required field `x` is missing from the actual type``                                               | The record you built lacks a field the position requires.                                                                                                                                       |
| ``Field `x` is optional in the actual type but required in the expected type``                       | The field exists but may be absent, and the position needs it present.                                                                                                                          |
| ``The actual agent requires the parameter `x`, but the expected agent type does not always pass it`` | An agent passed as a value wants an argument its callers will not supply. Give the parameter a default (`?=`), or widen the expected agent type.                                                |
| ``The expected type is an `integer`, but the actual type is a `number`, which may carry a fraction`` | `integer` is the narrower slot. Round or truncate first.                                                                                                                                        |
| `The expected type admits only the string literals it lists, and the actual type is not within them` | A literal type is a set of permitted strings, and this is not one of them. The `expected` line lists them.                                                                                      |
| `The actual type has fewer fixed positions than the expected type requires`                          | A tuple is too short. An absent position is not `null`.                                                                                                                                         |
| ``The actual type can be `x`, which the expected type does not admit``                               | A `data` constructor reached a position that does not accept it. **If this is a `match`, add an arm for it** — the message says so.                                                             |
| ``The actual type is `unknown`, so nothing is known about the value``                                | Usually a field or key that the type does not declare — check the name. Otherwise narrow the value with a `match` before using it.                                                              |
| `The actual value is private (a secret), but this position accepts only a public value`              | A value derived from a secret reached a position not marked private. Mark it `of private`, or keep the secret out. See [Types and schemas]({docs}/{currentVersion}/concepts/types-and-schemas). |

### When an effect row does not fit

When the disagreement is in an **effect row**, the reason starts with `The actual effect`:

```text
bot:4:1 K3001: The actual effect performs `bot.audit`, which the expected effect does not allow. Either name that request in the expected `with` row, or serve it here with a `use handler` clause.
  expected: io
  actual:   audit
```

Those two edits are the whole design decision: **handle** the request (a `use handler` above the
perform) or **carry** it (add it to the row after `with`). The variants:

| Reason                                                                               | What it means                                                                                                                               |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| ``performs `R`, which the expected effect does not allow``                           | `R` is performed and not admitted. Handle it or declare it.                                                                                 |
| ``performs io (an `external` call), which the expected effect does not allow``       | The body touches the outside world and the signature claims it does not. `io` has no handler — it can only be declared, so write `with io`. |
| `carries a control escape … that the expected effect does not carry`                 | A `return` / `break` / `next` aimed at an enclosing boundary the target row does not carry.                                                 |
| `carries an effect parameter that the expected effect does not declare`              | A row variable `E` appears on the actual side and not on the expected one — usually a forwarded row dropped from the signature.             |
| ``carries an effect parameter … and that parameter has no `extends` bound``          | An unconstrained `E` can carry anything, so it fits no concrete row. Bound it (`E extends …`) or name the requests.                         |
| ``The actual effect is `all` — it may perform ANY request — so no row can cover it`` | The `all` effect met a concrete row. Narrow the source.                                                                                     |

### The geometry note

When the request **does** have a handler but that handler is installed in the wrong place, K3001
appends a note naming the line:

```text
bot:4:1 K3001: The actual effect performs `bot.audit`, which the expected effect does not allow. …
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
bot:7:15 K3014: Expected a callable agent, but the expression has type never
```

**When a K3014 says `has type never`, do not fix the line it points at.** Look for the earlier error
on the same expression, fix that, and the whole cascade goes.

For the commonest source of these — a name that does not resolve — the compiler now does the
filtering itself: when a file reports a K2001, K2002, K2004, K2005 or K2006, every derived
`has type never` line in that file is dropped from the report, leaving only the misspelling (with a
suggestion). So a run of bare `never` lines with no name error above them means the cause is a
**type** error further up, not a typo.

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

| Message                                                         | What happened                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Package p provides module m, which is outside its p namespace` | A file under `src/` whose module name does not start with the package name. `src/mail.ktr` in package `bot` is module `mail`, which package `bot` may not provide. **This is the first error a new project hits**, because `katari init` names the entry module after the package and a second file added beside it lands outside the namespace. The message carries the move on its own `Fix:` line — `move src/mail.ktr to src/bot/mail.ktr, so the module becomes bot.mail`. |
| `katari.lock no longer matches katari.toml: …`                  | The lock and the manifest disagree. Every offline load **refuses** rather than compiling the wrong closure. The fix is always `katari lock`; the block lists each disagreement.                                                                                                                                                                                                                                                                                                 |
| `Module m is provided by two packages: a and b`                 | Two packages in the closure claim one module name. One of them is misnamed.                                                                                                                                                                                                                                                                                                                                                                                                     |
| ``Dependency d is not in the cache (…); run `katari lock` ``    | A locked dependency's source is not on disk. `katari lock` fetches it.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `Package name p is reserved by the compiler`                    | The K2008 check, raised early where you can act on it — a package named after the stdlib.                                                                                                                                                                                                                                                                                                                                                                                       |

## Where to go next

- [The CLI]({docs}/{currentVersion}/toolchain/cli) — `katari check` is the loop these come from.
- [Handler geometry]({docs}/{currentVersion}/guides/handler-geometry) — where most K3001 effect-row
  errors are actually decided.
- [Effects and handlers]({docs}/{currentVersion}/concepts/effects-and-handlers) — what an effect row
  is, if the `with` clause is new.
- [Language reference]({docs}/{currentVersion}/concepts/language-reference) — every legal form, when
  a K1001 means you have guessed at syntax.
