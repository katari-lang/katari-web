---
title: MCP Integration
description: Call an MCP server's tools with scopes, and publish an agent as an MCP server.
---

Integrating [Model Context Protocol](https://modelcontextprotocol.io) is the standard way to
compose external tools into an AI flow. MCP support in Katari is built into the runtime: like
`http.fetch`, the runtime's `mcp` reactor acts as both an MCP client and an MCP server, so no SDK
needs to be installed. Both directions are supported: outbound, `mcp.provide` plugs a server's
tools into a program; inbound, `mcp.serve` publishes an agent as an MCP server.

For the exact signature of each agent, see
[Standard Library › mcp]({docs}/{currentVersion}/standard-library/mcp); for the CLI subcommands,
see [CLI › mcp]({docs}/{currentVersion}/katari-toolchains/cli#mcp).

## Connecting to a server

A tool is a **live capability, not a value**, and must not outlive the connection: it exists only
while `provide` is running. This is why `mcp.provide(url, auth)` is a
[`use` provider]({docs}/{currentVersion}/language-reference/providers), not a plain function: it
lists the server and passes a **toolbox** (a record of agents keyed by tool name) into the
following block as a scope, closing the scope when the block exits. Returning a tool out of the
block leaves nowhere for the scope it carries to be discharged, which is a **type error**.

```katari title="connect.ktr"
// Anonymous access, with empty headers.
let tools : mcp.toolbox[string] = use mcp.provide(url = url, auth = mcp.headers(values = record.empty()))

// Bearer key: the secret goes into a header value (the secret stays private all the way into the tool value).
let headers = record.set(target = record.empty(), key = "Authorization", value = "Bearer " ++ key)
let tools : mcp.toolbox[string] = use mcp.provide(url = url, auth = mcp.headers(values = headers))

// OAuth: just references a named credential established out-of-band with `katari mcp login`.
let tools : mcp.toolbox[string] = use mcp.provide(url = url, auth = mcp.oauth(name = "github"))
```

The `use` binder (`tools`) requires an **explicit type annotation**; without one it is **K3013**
(the general rule for `use`). The `auth` parameter is a sum type that selects the authentication
method: `mcp.headers` allows a secret (`string of private`) as a header value, and both anonymous
access and bearer keys are represented with this single constructor. The secret stays private
inside the tool value (sealed at rest, redacted at any user-visible boundary) and is revealed only
to the server. The token material that `mcp.oauth` references never appears in the program at all;
only a name is passed.

In the type `mcp.toolbox[URL]`, `URL` represents a **scope**. A literal url gives a per-url scope
(`mcp.scope["https://..."]`); a dynamic (non-literal) url is downgraded to the broadest scope,
`mcp.scope[string]`. In the example above, `url` is a variable, so the result is
`mcp.toolbox[string]`. A per-url scope is the key to composing multiple servers without collision
(covered below).

## Calling tools dynamically

A tool is an agent value minted by the runtime, carrying the name, description, and input schema
declared by the server: **a tool is an agent**. It can therefore be handled directly with the two
primitives in `prelude.reflection`: `get_metadata` reads the public signature, and `call_agent`
dispatches it with runtime-built arguments. Arguments are validated against the input schema
before they reach the server; a mismatch throws `reflection.call_error`. This is the same
mechanism an AI tool loop uses against a compiled agent, so MCP tools flow through it
indistinguishably.

```katari title="mcp_demo.ktr"
@"Lists the server, reports the tool names, and calls the `add` tool via dynamic dispatch; all of
this happens inside the `provide` scope."
agent main(url: string) -> string {
  use handler {
    request prelude.throw(error: mcp.server_error | mcp.auth_error | reflection.call_error) -> never {
      break f"mcp failed: ${json.to_text(value = error)}"
    }
  }
  let tools : mcp.toolbox[string] = use mcp.provide(url = url, auth = mcp.oauth(name = "github"))
  let names = for (let tool in record.values(target = tools)) {
    next reflection.get_metadata(value = tool).name
  }
  let added = match (record.get(target = tools, key = "add")) {
    case null -> "(no add tool)"
    case tool -> json.to_text(value = reflection.call_agent(target = tool, args = { x = 19, y = 23 }))
  }
  f"tools=${string.join(parts = names, separator = ",")}; add=${added}"
}
```

`record.values(target = tools)` returns the toolbox's tools as a flat array, the form used to pass
them all to an AI loop together. All the calls above sit inside the `provide` block: calling a
tool raises `mcp.scope`, and it is discharged when `provide` returns, so a tool cannot escape the
block.

## Composing multiple servers

Nesting `provide` calls merges the inner and outer scopes as a **union**: tools from both servers
live in the same block, and each tool runs against its own server. This is the purpose of per-url
scopes: because each literal url has its own distinct scope, two `provide` calls do not collide.

```katari title="two_servers.ktr"
@"Composes two MCP servers into one scope: nesting `provide` merges the scopes as a union, so
tools from either server run. A literal url gives each server its own per-url scope."
agent main() -> string {
  use handler {
    request prelude.throw(error: mcp.server_error | mcp.auth_error | reflection.call_error) -> never {
      break f"mcp failed: ${json.to_text(value = error)}"
    }
  }
  let github : mcp.toolbox["https://github.example.com/mcp"] =
    use mcp.provide(url = "https://github.example.com/mcp", auth = mcp.oauth(name = "github"))
  let linear : mcp.toolbox["https://linear.example.com/mcp"] =
    use mcp.provide(url = "https://linear.example.com/mcp", auth = mcp.oauth(name = "linear"))
  let title = match (record.get(target = github, key = "get_issue")) {
    case null -> "(no get_issue)"
    case tool -> json.to_text(value = reflection.call_agent(target = tool, args = { owner = "katari-lang", repo = "katari", number = 1 }))
  }
  let ticket = match (record.get(target = linear, key = "create_ticket")) {
    case null -> "(no create_ticket)"
    case tool -> json.to_text(value = reflection.call_agent(target = tool, args = { title = title }))
  }
  f"github=${title}; linear=${ticket}"
}
```

## Calling tools directly

For static calls that need neither listing nor minting, use `mcp.call`. This is also the
underlying mechanism for the bindings generated by
[`katari mcp pull`](#generating-typed-bindings). `mcp.call[literal URL, T]` takes two generics: a
literal `URL` (which binds the scope per url), and `T`, the **decode target** for the return
value. `arguments` is a literal `json` tree (built per parameter with `json.encode`), and the
return value **decodes the server's response against `T`**: like `json.decode[T]`, it reads
`structuredContent` as the wire form of `T` (restoring files to real `file` handles), throwing
`json.decode_error` on mismatch. `T` appears only in the result and cannot be inferred, so it
**must be instantiated explicitly**; `URL` is inferred from the arguments but still counts toward
the arity of the explicit `[...]` (all-or-nothing), so callers write both. The scope rides on this
agent's own line: the caller must run it inside a `provide` scope for the same url.

```katari title="direct.ktr"
type get_issue_output = { title: string, number: integer, state: string }

agent get_issue(number: integer) -> get_issue_output with io | mcp.scope["https://github.example.com/mcp"] | prelude.throw[mcp.server_error | mcp.auth_error | json.decode_error] {
  let arguments = json.json_object(entries = { number = json.encode(value = number) })
  mcp.call["https://github.example.com/mcp", get_issue_output](
    url = "https://github.example.com/mcp",
    auth = mcp.oauth(name = "github"),
    tool = "get_issue",
    arguments = arguments,
  )
}
```

Instantiating `T` as `json.json` receives the response as a raw `json` tree (the choice codegen
falls back to when it cannot map `outputSchema`). Arguments are not validated before the call
(unlike a minted tool), so a rejection surfaces as `server_error`.

## Publishing an agent

`mcp.serve` is the MCP counterpart of `webhook.inbound`: it publishes a group of agents passed to
it as an MCP server. The runtime mints an unguessable capability URL and serves tools there for as
long as `subscriber` is alive. The record's keys become the published tool names, and each agent's
declared signature becomes the advertised schema. Possession of the URL is the sole credential: it
is mounted outside the bearer-authenticated API surface, and the URL expires when `subscriber`
returns (or the run is canceled).

```katari title="serve.ktr"
agent double(value: integer) -> integer {
  value * 2
}

@"Receives the URL, hands it to whoever should call it (an AI session, a teammate's MCP client),
and stays alive for as long as it should be served. Returning makes its result the result of
`serve`."
agent publisher(url: string) -> string {
  f"serving at ${url}"
}

agent main() -> string {
  mcp.serve(tools = { double = double }, subscriber = publisher)
}
```

`serve` requires a `toolbox[string]`. The entry type `tool[string]` is the **top type for
self-contained callables**, so **any agent whose effects have already been handled coerces to it
directly**, with no ceremony required on the user's side. To publish an agent that has a request
escalating outward, handle it first, then place it into the record.

## Generating typed bindings

To fix tools as a typed Katari module **at compile time**, instead of minting them dynamically at
runtime, use `katari mcp pull`. The output is a single self-contained `.ktr` module: one typed
wrapper agent per tool on the server, plus a `with_tools` provider that closes them into a
`provide` scope. Regenerating overwrites the file (the output is a build artifact and is not
hand-edited).

```sh
katari mcp pull --url https://github.example.com/mcp --out src/github.ktr --oauth
```

`with_tools` is also a `use` provider, so consuming it takes the same form as `mcp.provide`:
annotate the binder's type, then use the typed `tools` in the following block. Each wrapper calls
`mcp.call` through the static path, so the scope opens and closes inside `with_tools`, and
`tools.get_issue(...)` is typed as an ordinary dot access.

```katari title="src/main.ktr"
import github   // module generated by `--out src/github.ktr`

agent main() -> string {
  let tools : {
    get_issue: agent(owner: string, repo: string, number: integer) -> github.get_issue_output with io | mcp.scope["https://github.example.com/mcp"] | prelude.throw[mcp.server_error | mcp.auth_error | json.decode_error],
  } = use github.with_tools(auth = mcp.oauth(name = "github"))
  let issue = tools.get_issue(owner = "katari-lang", repo = "katari", number = 1)
  issue.title
}
```

Parameters and outputs whose JSON Schema fully maps become typed (as with `get_issue_output`
above); any that include an unmappable part fall back to `json.json`. For flags and mapping rules,
see [CLI › mcp pull]({docs}/{currentVersion}/katari-toolchains/cli#mcp-pull).

## Errors

External MCP calls are unified under two typed throws (a typed `mcp.call` additionally has
`json.decode_error`). `server_error` and `auth_error` differ in kind.

| Error              | Contract                                                                                                                                                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mcp.server_error` | A rejected list/tool call, or a transport failure. **Retrying reconnects** (this covers a dropped connection or a restart interruption). A tool called outside its now-closed scope is also rejected with this error, naming the closed scope. |
| `mcp.auth_error`   | A missing `oauth` credential, or an expiry that a refresh cannot fix. **Retrying does not fix this**; re-run `katari mcp login`.                                                                                                               |

```katari
use handler {
  request prelude.throw(error: mcp.server_error) -> never { break retry() }
  request prelude.throw(error: mcp.auth_error) -> never { break f"re-run katari mcp login" }
}
```

## Related

<DocCards>
  <DocCard href="{docs}/{currentVersion}/standard-library/mcp" />
  <DocCard href="{docs}/{currentVersion}/standard-library/reflection" />
  <DocCard href="{docs}/{currentVersion}/language-reference/providers" />
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/cli" />
</DocCards>
