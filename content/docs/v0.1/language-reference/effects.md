---
title: Effects
description: request and use handler, escalation (parking as an open question), and the throw / panic split.
---

Katari's side effects surface through the request/handler model: a `request` declares an effect,
a `use handler` introduces its implementation, and a request that is declared but not discharged
locally propagates as an **escalation** to the caller, and ultimately out of the run.

## Declaring a request

```katari
@"A capability that returns the next counter value each time it is called."
request tick() -> integer
```

`request name[generics](params) -> T` has no body; its implementation is supplied by a
`use handler` in the calling scope. It appears in the declaring agent's signature as, for example,
`with tick`, which is an entry in the **effect row**.

## Implementing with a handler

```katari
request tick() -> integer

agent count_three() -> array[integer] with tick {
  use handler (var counter = 0) {
    request tick() { next counter with { counter = counter + 1 } }
  }
  [tick(), tick(), tick()]
}
```

`use handler { request name(params) [-> T] { body } ... }` introduces a capability to the block
that follows (the continuation). `(var counter = 0)` is the handler's own state variable: the body
runs each time it is called, and `next value [with { counter = ... }]` returns a value to the
caller while updating the state in preparation for the next call. `break value` discharges the
handler and terminates the block itself (or goes to `then`, if present). A handler with no state
may omit `(var ...)`, as `tick` does above.

`use` is a general construct defined as a single application of a provider, and the `handler`
literal is one form of it. See [Providers]({docs}/{currentVersion}/language-reference/providers)
for the generalization to provider agents that take configuration.

## marker effect

```katari
effect scoped[resource]
```

`effect name[generics]` is a capability marker **with no operations**: it is never performed,
never handled, and disappears during lowering. It rides on the effect row to represent a static
gate meaning "can only be called within this scope" (used purely to decide whether a call is
permitted, and does nothing at runtime). `scope[URL]` in
[`prelude.mcp`]({docs}/{currentVersion}/standard-library/mcp) is a concrete example: `provide`
mints it onto the continuation's row and discharges it from its own result row, so once the scope
closes, a call carrying that marker no longer passes type checking.

## escalation

A request not discharged by a `use handler` remains on the enclosing effect row and propagates
upward. If it reaches the run's root without any agent handling it, it exits the run as an
**escalation**: the run parks while holding an "open question," and waits there until it is
answered from the runtime console (the Escalations inbox) or with `katari answer` (see
[CLI]({docs}/{currentVersion}/katari-toolchains/cli) for details). Multiple delegations running
concurrently can each hold their own independent escalation.

```katari
request ask(question: string) -> string

agent consult(topic: string) -> string with ask {
  let advice = ask(question = f"What should we consider about ${topic}?")
  f"${topic}: ${advice}"
}

agent panel(first: string, second: string) -> array[string] with ask {
  parallel [consult(topic = first), consult(topic = second)]
}
```

Running `panel` causes each of the two parallel `consult`s to park on `ask`. The run page's
delegation tree shows exactly which agent is asking what (`main`, then `panel`, then the two
`consult`s). Answering both allows the run to complete.

## throw[T]: typed errors

```katari
request throw[T](error: T) -> never
```

`throw` is a single generic request in the prelude, and its payload type `T` is a domain-specific
`data` declared next to the operation that fails (`json.parse_error`, `http.fetch_error`,
`env.missing_secret`, and so on). `-> never` guarantees at the type level that it "cannot be
resumed": a handler cannot `next`; it can only exit the handle with `break`, or re-throw
(catch-and-break).

```katari
data not_even(value: integer)

agent half(value: integer) -> integer with prelude.throw[not_even] {
  if (value % 2 == 0) {
    math.floor(value = value / 2)
  } else {
    prelude.throw(error = not_even(value = value))
  }
}

agent describe_half(value: integer) -> string {
  use handler {
    request prelude.throw(error: not_even) -> never {
      break f"${string.to_string(value = error.value)} is odd, no half"
    }
  }
  f"half=${string.to_string(value = half(value = value))}"
}
```

Even if multiple `throw`s occur within the same scope, the row still merges to one entry: mixing
`throw[a]` and `throw[b]` produces `throw[a | b]`. A handler declares, through its payload
annotation, which type it discharges, and there are only two options: **handle the entire merged
union, or handle none of it** (to handle only part of it and re-throw the rest, branch with
`match` and call `prelude.throw` again). A `throw` that is not caught fails the run.

## panic: the runtime's own failure channel

`panic` has **no declaration** in the prelude, so a program cannot raise it. The runtime raises it
for invariant violations that indicate "the program or the deployment is broken," such as a
non-exhaustive `match`, division by zero, an FFI infrastructure failure, or an engine backstop. If
it is not handled, the run fails outright.

Even without a declaration, it can be caught under the **reserved handler name** `panic` (it is
ambient: it cannot be raised, but it can be handled):

```katari
agent survive_panic() -> string {
  use handler {
    request panic(msg: string) { break f"panic caught: ${msg}" }
  }
  let boom = 1 / 0   // Division by zero is a panic, not a throw
  "unreachable"
}
```

The choice between `throw` and `panic` is decided by whether "a correct program that encounters
this failure at runtime can meaningfully continue." If it can (invalid text for `json.parse`, a
broken connection for `http.fetch`), attach a domain-error `data` to a `throw`. If it cannot (a
broken invariant), leave it as a panic.

| Operation                               | Failure                          | Path                                      |
| --------------------------------------- | -------------------------------- | ----------------------------------------- |
| `json.parse` / `parse_as`               | Invalid text / schema mismatch   | `throw[json.parse_error \| decode_error]` |
| `http.fetch`                            | Connection does not complete     | `throw[http.fetch_error]`                 |
| `env.get_secret`                        | Key not set                      | `throw[env.missing_secret]`               |
| `reflection.call_agent`                 | Not callable / argument mismatch | `throw[reflection.call_error]`            |
| Division by zero (`/` `%`)              | N/A                              | panic                                     |
| Non-exhaustive `match`, engine backstop | N/A                              | panic                                     |

## Related

<DocCards>
  <DocCard href="{docs}/{currentVersion}/language-reference/providers" />
  <DocCard href="{docs}/{currentVersion}/language-reference/finally" />
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/runtime" />
</DocCards>
