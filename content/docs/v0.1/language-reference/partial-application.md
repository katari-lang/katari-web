---
title: Partial Application
description: Fixing some arguments now and leaving the rest as holes `_` produces a residual agent.
---

Fixing some of an agent call's arguments in the current scope and leaving the rest as holes (`_`)
produces a **residual agent** that takes only those holes as parameters. This is used for
composition such as binding configuration values or a handler ahead of time, then passing the
result as a callback that gets called repeatedly.

## Syntax

Among the named arguments, the ones given a value are **fixed now**, and the ones written as `_`
become **holes**. The result is a new agent that takes only the parameters left as holes.

```katari title="scale.ktr"
@"Multiplies a factor and a value."
agent scale(factor: number, value: number) -> number {
  factor * value
}

@"`scale(factor = 2.0, value = _)` fixes factor now and returns
a residual `agent (value: number) -> number`. Later calls pass only the hole."
agent doubles(values: array[number]) -> array[number] {
  let double = scale(factor = 2.0, value = _)
  for (let value in values) { next double(value = value) }
}
```

The type of `scale(factor = 2.0, value = _)` is `agent (value: number) -> number`. The fixed
`factor` is evaluated at binding time, and is not re-evaluated no matter how many times the
residual is called.

## Optional parameters

An optional parameter left neither a hole nor a value is **omitted and stays defaulted**. The
residual does not carry that parameter at all; the callee's default fills it in through the
residual on every call.

```katari title="decorate.ktr"
@"Decorates `body` with `prefix` and a `suffix` that defaults to `\"!\"`."
agent decorate(prefix: string, body: string, suffix: string ?= "!") -> string {
  f"${prefix}${body}${suffix}"
}

@"Fixes `prefix`, holes `body`, and leaves `suffix` omitted (neither hole nor value).
The residual carries only `body`; the callee's default fills in `suffix`."
agent marked() -> string {
  let mark = decorate(prefix = ">> ", body = _)
  mark(body = "hello")   // ">> hello!"
}
```

- Arguments given a value: fixed at binding time.
- Arguments written as `_`: become parameters of the residual.
- Omitted optional arguments: stay defaulted. They do not appear in the residual; the default
  fills them in on each call.

## Related

<DocCards>
  <DocCard href="{docs}/{currentVersion}/language-reference/providers" />
  <DocCard href="{docs}/{currentVersion}/language-reference/effects" />
</DocCards>
