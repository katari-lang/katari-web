---
title: Providers (use)
description: The use statement introduces a capability, a single application form spanning handler literals up through provider agents that take arguments.
---

`use handler { ... }` introduces a capability to the block that follows. Parameterizing that same
introduction and factoring it out into a function (a provider) lets capabilities with
configuration be stacked and composed at the app's root, as in
`use gemini_provider(model = ..., api_key = ...)`.

## use is an application form

The provider in `use <provider>` may take one of four forms, and the meaning is always the same:
**the provider is applied once to "the written arguments union the continuation."** The
continuation is the rest of the block that follows the `use`.

| Form                        | Example                                                |
| --------------------------- | ------------------------------------------------------ |
| Handler literal             | `use handler { request tick() -> integer { next 0 } }` |
| (Qualified) name            | `use my_provider`                                      |
| Explicit instantiation      | `use my_provider[integer]`                             |
| Application `callee(args…)` | `use my_provider(base = 1)`                            |

The bare forms (name, instantiation) are applications with zero arguments. Any other expression,
such as a field read or a `match`, is rejected with **K3011**. Bind it to `let p = <expr>` and
then write `use p`, or rewrite it as `use <expr>(args…)`. There is no room for the meaning to vary
by form.

## A provider is just an agent

A provider is an ordinary agent with a `continuation` parameter. `continuation` is a **reserved
label** within a `use` application, and passing it explicitly is rejected (K3019). The simplest
provider only supplies a value to the continuation, and can be written generically over the
result type R and effect E.

```katari title="supply.ktr"
@"Provider with a config argument plus continuation, in a single parameter record."
agent supply[R, effect E](
  base: integer,
  continuation: agent (value: integer) -> R with E,
) -> R with E {
  continuation(value = base)
}

agent supplied() -> integer {
  let start: integer = use supply(base = 10)
  start + 1
}
```

`use supply(base = 10)` is applied once, as `supply(base = 10, continuation = <the rest of the
block>)`. The continuation's result type R and effect E are inferred from this single call site.
Requests the continuation performs ride on the inferred E and flow to the enclosing agent.

## A provider that introduces a capability

When a provider discharges, with a handler, a request that the continuation uses, the provider
introduces a capability. The request is declared on the continuation's signature, and handled
inside the provider.

```katari title="key_provider.ktr"
request get_key() -> string of private

@"Provider that introduces api_key to the continuation as the `get_key` capability."
agent key_provider(
  api_key: string of private,
  continuation: agent (value: null) -> string with get_key,
) -> string {
  use handler (var key = api_key) {
    request get_key() -> string of private { next key }
  }
  continuation(value = null)
}

agent client() -> string {
  use key_provider(api_key = env.get_secret(key = "SERVICE_KEY"))
  let key = get_key()
  "Bearer " ++ key
}
```

The block after `use key_provider(api_key = ...)` becomes the continuation, and `get_key` can be
used within it. The provider's handler discharges it, so it does not escalate outside `client`.

## Binding and annotating use

`let x = use provider(...)` binds the continuation's **value** (the `value` the continuation
receives). This form requires a type annotation; without one, it is **K3013**.

```katari
let start: integer = use supply(base = 10)   // OK
// let start = use supply(base = 10)          // K3013: annotation required
```

## Related

<DocCards>
  <DocCard href="{docs}/{currentVersion}/language-reference/effects" />
  <DocCard href="{docs}/{currentVersion}/language-reference/finally" />
  <DocCard href="{docs}/{currentVersion}/guides/mcp" />
</DocCards>
