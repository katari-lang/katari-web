---
title: prelude.reflection
description: Treats agents as first-class, inspectable values, get_metadata / call_agent.
---

Two primitives that treat agents as first-class, inspectable values: `get_metadata` reads a
callable's public signature, and `call_agent` dispatches a callable value with runtime-built
arguments. Called qualified as `reflection.` via the default import. Tools minted by the runtime,
such as MCP tools from `prelude.mcp`, participate in both the same way a compiled agent does: a
tool is an agent.

## Types

### `reflection.agent_metadata`

```katari
data agent_metadata(
  name: string,
  description: string,
  input: json.json,
  output: json.json,
  requests: json.json,
)
```

The public metadata of one callable: its qualified name, its `@"..."` description, and the JSON
Schema for its input / output / requests (each schema is a `json` value that can be embedded
directly in an AI tool list). A local (closure) callable has an empty name.

### `reflection.call_error`

```katari
data call_error(message: string)
```

Dynamic dispatch failed before the target executed: the target is not callable, or `args` does not
conform to the input schema (`message` indicates the offending path). Thrown by `call_agent`.

## Agents

### `reflection.get_metadata`

```katari
primitive agent get_metadata(value: agent never -> unknown with all) -> agent_metadata
```

Derives `agent_metadata` from a callable value: a top-level agent, a data constructor, a request,
an external, a local closure, or a runtime-minted tool such as an MCP server tool. A generic
callable instantiated with `[T]` returns a schema specialized to that instantiation. A
runtime-minted tool returns the name / description / input schema declared by its provider.

### `reflection.call_agent`

```katari
primitive agent call_agent[R, effect E](target: agent never -> R with E, args: unknown)
  -> R with E | prelude.throw[call_error]
```

Dispatches a callable **value** with a runtime-built argument record. This is the dynamic
counterpart to a static call, used to invoke a target an AI selected from a tool list. `args` is
validated against the target's input schema at the delegation boundary; a mismatch throws
`call_error` at this call site (catch it to let the model retry). The target's effect passes
through unchanged.

- **Throws** `call_error` (the target is not callable, or `args` does not conform to the input
  schema).

## Related

<DocCards>
  <DocCard href="{docs}/{currentVersion}/standard-library/mcp" />
  <DocCard href="{docs}/{currentVersion}/guides/mcp" />
</DocCards>
