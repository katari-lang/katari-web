---
title: MCP
description: Consume any MCP server's tools as typed agents — dynamically or through generated bindings — and serve your own agents as an MCP server.
---

There is no client library to install and no connection object to hold. `mcp.provide` mints one agent
per server tool for the extent of a block, `katari mcp pull` freezes the same listing into a typed
module at dev time, and `mcp.serve` mints a capability URL for the outbound direction. Every call is
validated against a schema on the way through, so a server's tool is as safe to hand a model as an
agent you wrote yourself.

## Connect to a server

One line lists the server and hands you its tools for the extent of the block:

```katari
agent main(url: string) -> string {
  use handler {
    request prelude.throw(error: mcp.server_error | mcp.auth_error | reflection.call_error) -> never {
      break f"mcp failed: ${json.stringify(value = error)}"
    }
  }
  let tools : mcp.toolbox[mcp.scope] = use mcp.provide[mcp.scope](url = url, auth = mcp.headers(values = {}))
  match (record.get(target = tools, key = "add")) {
    case null -> "(no add tool)"
    case tool -> json.stringify(value = reflection.call_agent(target = tool, args = { x = 19, y = 23 }))
  }
}
```

Each entry in the toolbox is an agent, minted by the runtime with the server-declared name,
description, and input schema: `reflection.get_metadata` reads them, and a call is validated against
the schema before the server is ever contacted. There is no connection to manage — the runtime
connects lazily, reuses the connection across calls, and reconnects transparently after a failure or
a restart. Pass `prefix = "notion"` to publish the server's `search` as `notion_search`, which is
what keeps two servers' identically named tools apart in front of a model.

The tools are scoped: a tool's effect row carries a scope marker, which only `provide`'s block
discharges, so a tool cannot outlive its connection — returning one out of the block is a type error.
You pass the marker in the `[...]` (`mcp.provide[mcp.scope]` above) and it rides the toolbox type.
`mcp.scope` is the built-in marker for direct, dynamic connections; a `katari mcp pull` binding
declares its own instead.

Declare one marker per logical connection. Sharing one across two connections merges their scopes at
the type level, so the two servers' tools become interchangeable in any row carrying that marker.
That is a type distinction only: routing follows each tool value's own `{url, auth}` descriptor, so a
call never reaches the wrong server, and a tool whose `provide` has closed fails with a typed
`mcp.server_error`. Generated bindings mint a distinct marker (`github.connection`) per connection
automatically.

When the toolbox would never be read — you call tools statically through `mcp.call` rather than
handing minted agents to a loop — `mcp.open` is the listing-free form of the same scoped contract: it
registers the connection's scope and starts the block immediately, with no server round-trip at open,
so the first tool call is the first contact. It is what a generated binding's `connect` uses. Because
nothing is contacted at open, authentication surfaces at the first call, and a missing OAuth
credential parks that call on the authorization escalation.

## Hand the tools to a model

The toolbox is a `record`, and the `ai` package's loop takes an array, so one comprehension over
`record.entries` carries the values across. The model sees each tool's server-declared schema and
calls them like any other agent:

```katari
import ai
import ai.types
import ai.gemini

@"Hand every tool an MCP server publishes to the model loop, for one task."
agent main(url: string, task: string) -> string with io {
  use handler {
    request prelude.throw(error: ai.step_error | ai.duplicate_tool | env.missing_secret | oauth.server_error | mcp.server_error | mcp.auth_error) -> never {
      break f"failed: ${json.stringify(value = error)}"
    }
  }
  use gemini.provider(model = "gemini-3.5-flash", source = credentials.env(key = "GEMINI_API_KEY"))
  let tools : mcp.toolbox[mcp.scope] = use mcp.provide[mcp.scope](url = url, auth = mcp.headers(values = {}))
  ai.infer_with_tools(
    history = [types.turn(role = types.user_role(), text = task, files = [])],
    tools = for (let [_name, tool] in record.entries(target = tools)) { next tool },
    max_steps = 8,
  )
}
```

## Generate a typed binding

Dynamic tools are `unknown`-shaped until runtime. When you know the server at dev time,
`katari mcp pull` lists it once and generates a module in which every tool is a **top-level typed
agent**:

```sh
katari mcp pull --url https://mcp.example.test/mcp --out src/myapp/github.ktr
```

A project named `myapp` must keep every module inside its namespace, so the binding
lands at `src/myapp/github.ktr` — module `myapp.github`.

Authenticate the listing with `--header KEY=VALUE` (repeatable) or `--oauth` (an ephemeral
dev-time browser login; add `--scope` if the server needs one). Re-running overwrites the file —
the generated module is an artifact, not something you edit.

The module contains one `connect` provider plus one agent per tool. `connect` opens the
connection over `mcp.open` — listing-free, so opening costs no server round-trip and the
first tool call is the first contact (a binding pulled before `mcp.open` existed still opens
via `provide`; re-running the pull adopts it). You open the connection as a bare `use`
statement and call the tools directly:

```katari
import myapp.github

@"Open the connection once, then call the pulled tools like ordinary agents."
agent main() -> string with io {
  use handler {
    request prelude.throw(error: mcp.server_error | mcp.auth_error | json.validation_error) -> never {
      break f"mcp failed: ${json.stringify(value = error)}"
    }
  }
  use github.connect(auth = mcp.oauth(name = "github"))
  let issue = github.get_issue(owner = "katari-lang", repo = "katari")
  issue.title
}
```

Inside the generated module, each tool's JSON Schema is mapped to Katari types — scalars, arrays,
objects (non-required properties become optional parameters), `additionalProperties` records, and
mappable `anyOf` unions; anything else (enums, `allOf` / `oneOf`, tuples, open schemas) falls
back to a raw `unknown` document. A tool with a fully mapped `outputSchema` gets a typed result
(validated in the runtime, `json.validation_error` on a mismatch); otherwise the result is the raw
reply as `unknown`. Two generated modules compose in one block — their scopes and `credentials`
requests are namespaced per module, so nothing collides.

## Authenticate

`provide`, `mcp.call`, and every generated `connect` take the same two-variant `auth` sum.

**Headers** cover anonymous access (an empty record), bearer keys, and any custom scheme
uniformly — the values ride on every request, and each value may be a secret:

```katari
@"Connect with a bearer key from the env store; the value stays private inside the tool values."
agent main(url: string) -> string with io {
  use handler {
    request prelude.throw(error: env.missing_secret | mcp.server_error | mcp.auth_error) -> never {
      break f"failed: ${json.stringify(value = error)}"
    }
  }
  let key = env.get_secret(key = "MCP_BEARER_KEY")
  let tools : mcp.toolbox[mcp.scope] = use mcp.provide[mcp.scope](
    url = url,
    auth = mcp.headers(values = { "Authorization" = "Bearer " ++ key }),
  )
  f"connected: ${string.to_string(value = record.size(target = tools))} tools"
}
```

If the server rejects the key material, the call throws a typed `mcp.auth_error` — retrying with
the same material does not help; a human must fix the key.

**OAuth** names a credential the runtime stores and refreshes server-side; no token ever enters
the program:

```katari
@"Connect with a stored OAuth credential; a missing one parks the run on an authorization escalation."
agent main() -> string with io {
  use handler {
    request prelude.throw(error: mcp.server_error | mcp.auth_error | reflection.call_error) -> never {
      break f"mcp failed: ${json.stringify(value = error)}"
    }
  }
  let tools : mcp.toolbox[mcp.scope] =
    use mcp.provide[mcp.scope](url = "https://mcp.notion.com/mcp", auth = mcp.oauth(name = "notion"))
  f"the server publishes ${string.to_string(value = record.size(target = tools))} tools"
}
```

When the named credential is missing — or dies beyond what a refresh can fix, even mid-run — the
program does **not** fail. The run parks on a `prelude.oauth.authorize`
[escalation]({docs}/{currentVersion}/concepts/escalation); the admin console and `katari answer`
render it as an authorization request, and completing the browser flow resumes the run exactly
where it stopped. `katari mcp credentials` lists the stored credentials, `katari mcp forget NAME`
deletes one (forcing re-authorization on next use). See
[Secrets and credentials]({docs}/{currentVersion}/guides/secrets-and-credentials) for the whole
credential story.

## Recipe: Notion

Notion's official server (`https://mcp.notion.com/mcp`) is OAuth-only, so pull it once with an
ephemeral dev-time login and connect at runtime with the credential the runtime stores:

```sh
katari mcp pull --url https://mcp.notion.com/mcp --oauth --out src/myapp/notion.ktr
```

`--oauth` opens a browser to authorize the listing; the generated `myapp.notion` module carries no
token. At runtime, `connect` takes the **stored** credential named `notion` — opening is
listing-free, so a missing credential parks the run at the **first tool call** on the
authorization escalation above, answered once from the admin console or `katari answer`,
after which every later run resumes silently:

```katari
import myapp.notion

@"Open the Notion connection with the stored OAuth credential, then search."
agent main(query: string) -> string with io {
  use handler {
    request prelude.throw(error: mcp.server_error | mcp.auth_error | json.validation_error) -> never {
      break f"notion failed: ${json.stringify(value = error)}"
    }
  }
  use notion.connect(auth = mcp.oauth(name = "notion"))
  let results = notion.search(query = query)
  json.stringify(value = results)
}
```

## Serve your agents

`mcp.serve` is the inbound direction: the runtime mints a fresh, unguessable capability URL and
serves a record of your agents as MCP tools there — each key is the published tool name, each
agent's declared signature the advertised schema — for exactly as long as the subscriber runs:

```katari
@"The published tool: an ordinary, fully handled agent."
agent double(value: integer) -> integer {
  value * 2
}

@"Escalate the capability URL as an open question, then serve until the run is cancelled."
request announce(url: string) -> null

agent keep_serving(url: string) -> never with announce | io {
  announce(url = url)
  forever {
    time.sleep(milliseconds = 3600000)
  }
}

agent main() -> never with announce | io {
  mcp.serve(tools = { double = double }, subscriber = keep_serving)
}
```

The URL is the key: possession grants access, nothing else does. The subscriber hands it to whoever
should connect (an AI session, a teammate's MCP client) and stays alive while calls should be served;
when it returns — or the run is cancelled — the URL deactivates. A `tools/call` whose arguments
violate the published schema is rejected at the boundary as invalid params; a served tool that throws
or panics on a well-formed call proxies up and cancels the whole endpoint, so per-request resilience
is a handler around the tool's body — the same contract as
[webhooks]({docs}/{currentVersion}/guides/webhooks).

## Trust boundary

0.1's MCP integration is built for servers you control or trust — the standard you would apply to any
code you run in-process. Consuming a server decodes its tool responses onto the value plane, and the
runtime does not yet authenticate that a decoded value which looks like a callable originated inside
your program, so a crafted response could in principle forge one. Routing is unaffected either way: a
tool value carries its own `{url, auth}`, so a call cannot be redirected. The general authorization
that closes the decode surface — per-capability authz on decoded callables — is planned for v0.2.

## Where to go next

<DocCards>
  <DocCard href="{docs}/{currentVersion}/tutorial/giving-the-model-tools" />
  <DocCard href="{docs}/{currentVersion}/concepts/effects-and-handlers" />
</DocCards>

The `mcp` module's every signature and error is in the [reference](/packages).
