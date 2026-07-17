---
title: prelude.mcp
description: Scoped connections to MCP servers (provide / call), publishing one (serve), the auth sum type, and typed errors.
---

Handles MCP in both directions. Calls route to the runtime's `mcp` reactor (no FFI sidecar).
Called qualified as `mcp.` via the default import. See
[Guides › MCP]({docs}/{currentVersion}/guides/mcp) for a walkthrough.

The external calls (`provide` / `call` / `serve`) perform `io`, adding `io` to the caller's effect
row.

## Types

### `mcp.auth`

```katari
type auth = headers | oauth
```

How `provide` / `call` authenticate to the server: explicit headers, or a named OAuth credential.

### `mcp.headers`

```katari
data headers(values: record[string of private])
```

Header-based access. `values` is attached to every request. Each value may be a secret
(`string of private`), such as a bearer key. Anonymous access is
`mcp.headers(values = record.empty())`.

### `mcp.oauth`

```katari
data oauth(name: string)
```

A named OAuth credential. References a credential established out-of-band with
`katari mcp login --url <server> --name <name>` and stored server-side. The runtime injects and
refreshes the token. `name` is not a secret.

### `mcp.scope`

```katari
effect scope[URL]
```

A phantom marker effect keyed on a url. It rides in a tool's effect row but has no operation: it is
never performed or handled, and it disappears at lowering. `provide` mints it into the
continuation's row and discharges it from its own result row, so a tool tagged `scope[URL]` cannot
outlive `provide`. `URL` is phantom and **covariant**: `scope["x"]` conforms to `scope[string]`,
but never to `scope["y"]`. A literal url gives a per-url scope; a dynamic url gives the widest
scope, `scope[string]`.

### `mcp.tool`

```katari
type tool[URL] = agent never -> unknown with io | scope[URL] | prelude.throw[server_error | auth_error]
```

An ordinary agent value representing one server tool, gated by `scope[URL]`. It also serves as the
top type for a self-contained callable: any agent that has handled all its effects coerces to
`tool[string]` (used for `serve`'s parameter).

### `mcp.toolbox`

```katari
type toolbox[URL] = record[tool[URL]]
```

A record of tools keyed by tool name, where `URL` is the scope gating the tools. Call one by key,
or use `record.values(target = ...)` to get a flat array of tools to pass together into an AI
loop.

### `mcp.server_error`

```katari
data server_error(message: string)
```

The server refused a list or tool call, or the transport failed. Catch it to control retry; a
retried call reconnects. A tool called outside its closed scope is also rejected with this,
carrying the name of the closed scope.

### `mcp.auth_error`

```katari
data auth_error(message: string)
```

An `oauth` credential is absent, or expired in a way token refresh cannot fix. Retry does not fix
this; a human must re-run `katari mcp login`. Kept as a distinct type from `server_error`.

## Agents

### `mcp.provide`

```katari
external agent provide[literal URL, R, effect E](
  url: URL,
  auth: auth,
  continuation: agent (value: toolbox[URL]) -> R with E | scope[URL],
) -> R with E
```

A [`use` provider]({docs}/{currentVersion}/language-reference/providers) that plugs in the tools
of the server at `url` as a scope living only for the extent of `continuation`. The runtime lists
the server and passes `continuation` a `toolbox[URL]`: one runtime-minted agent per tool, each
carrying the server-declared name / description / input schema (for `reflection.get_metadata` and
for call-site validation) and the server descriptor `url` + `auth` from the time it was listed.
`scope[URL]` rides in the continuation's row (it is what a tool call raises) and is discharged
from `provide`'s own row, so a tool cannot escape the block: once the continuation returns, the
scope closes, and any later tool call against that descriptor is rejected with a typed
`server_error`. A literal `url` binds `URL` to that string's singleton (a per-url scope); a
dynamic `url` widens `URL` to `string` (the broadest scope). No connection management is required;
the runtime lazily (re)connects per descriptor.

- **Throws** `server_error` (listing refused / transport failure), `auth_error` (`oauth`
  credential absent or expired).

### `mcp.call`

```katari
external agent call[literal URL, T](url: URL, auth: auth, tool: string, arguments: json.json)
  -> T with scope[URL] | prelude.throw[server_error | auth_error | json.decode_error]
```

Calls one server tool directly. This is the static counterpart to `provide`, with no listing and
no minted agent value (the basis of the bindings `katari mcp pull` generates). `tool` is the
server-declared tool name; `arguments` is a literal `json` tree (built per parameter with
`json.encode`). The return value is **decoded by the runtime against `T`**, using the same
mechanism as `json.decode[T]`: it reconstructs `structuredContent` as the wire form of `T` (a
`$ref` handle becomes a real `file` value; records / arrays / scalars become values), and throws
`json.decode_error` if it does not conform to `T`. Setting `T` to `json.json` receives the
response as a raw `json` tree. Because `T` appears only in the result and cannot be inferred,
**explicit instantiation is required** (K3016); `URL` is inferred from the arguments but still
counts toward the arity of an explicit `[...]` (mixing the two is not allowed, K3009), so a call
site writes both: `mcp.call[url_literal, T](url = url_literal, ...)`. Scope gating is at the type
level (the `scope[URL]` in the row); a generated binding is called only inside the `provide` scope
for the same descriptor. **Unlike a minted tool, arguments are not validated before the call**; a
rejection is a `server_error`.

- **Throws** `server_error`, `auth_error`, `json.decode_error` (the return value does not conform
  to `T`).

### `mcp.serve`

```katari
external agent serve[R, effect E](
  tools: toolbox[string],
  subscriber: agent (url: string) -> R with E,
) -> R with E
```

Publishes `tools` as an MCP server that is live for as long as `subscriber` runs. The runtime
mints an unguessable capability URL and serves each record key as a public tool name, with each
agent's declared signature as the advertised schema. Possessing the URL is the only credential.
`subscriber` receives the URL, hands it to whoever should call it, and stays alive for as long as
serving should continue. When it returns, the URL is revoked and its result becomes `serve`'s
result. Canceling the run cancels `subscriber` and revokes the URL through the same path.
`subscriber`'s effect flows through unchanged to the caller's handler. A served agent must be
self-contained (`tool[string]`, meaning its effects are already handled).

## Related

<DocCards>
  <DocCard href="{docs}/{currentVersion}/standard-library/reflection" />
  <DocCard href="{docs}/{currentVersion}/guides/mcp" />
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/cli" />
</DocCards>
