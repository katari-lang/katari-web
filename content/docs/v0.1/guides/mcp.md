---
title: MCP
description: Consume any MCP server's tools as typed agents — dynamically or through generated bindings — and serve your own agents as an MCP server.
---

Katari speaks MCP in both directions, with no sidecar and nothing to install: `mcp.provide` plugs
a server's tools into a program as ordinary agent values, `katari mcp pull` freezes a server's
tools into a typed binding module at dev time, and `mcp.serve` publishes your own agents as a
live MCP server.

## Connect to a server

One line lists the server and hands you its tools for the extent of the block:

```katari
agent main(url: string) -> string {
  use handler {
    request prelude.throw(error: mcp.server_error | mcp.auth_error | reflection.call_error) -> never {
      break f"mcp failed: ${json.to_text(value = error)}"
    }
  }
  let tools : mcp.toolbox[string] = use mcp.provide(url = url, auth = mcp.headers(values = record.empty()))
  match (record.get(target = tools, key = "add")) {
    case null -> "(no add tool)"
    case tool -> json.to_text(value = reflection.call_agent(target = tool, args = { x = 19, y = 23 }))
  }
}
```

Each entry in the toolbox **is an agent**, minted by the runtime with the server-declared name,
description, and input schema: `reflection.get_metadata` reads them, and a call is validated
against the schema before the server is ever contacted. There is no connection to manage — the
runtime connects lazily, reuses the connection across calls, and reconnects transparently after a
failure or a restart.

The tools are **scoped**: a tool's effect row carries `mcp.scope[URL]`, which only `provide`'s
block discharges, so a tool cannot outlive its connection — returning one out of the block is a
type error. A literal `url` scopes tools per-URL; a dynamic one (as above) widens the scope to
any URL, which is why the toolbox above is typed `mcp.toolbox[string]`.

## Hand the tools to a model

`record.values` flattens the toolbox into the array shape the `ai` package's loop takes — the
model sees each tool's server-declared schema and calls them like any other agent:

```katari
import ai
import ai.types
import ai.gemini

@"Hand every tool an MCP server publishes to the model loop, for one task."
agent main(url: string, task: string) -> string with io {
  use handler {
    request prelude.throw(error: ai.step_error | ai.loop_error | env.missing_secret | mcp.server_error | mcp.auth_error) -> never {
      break f"failed: ${json.to_text(value = error)}"
    }
  }
  use gemini.provider(
    model = "gemini-3.5-flash",
    api_key = env.get_secret(key = "GEMINI_API_KEY"),
  )
  let tools : mcp.toolbox[string] = use mcp.provide(url = url, auth = mcp.headers(values = record.empty()))
  ai.infer_with_tools(
    history = [types.turn(role = "user", text = task, files = [])],
    tools = record.values(target = tools),
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

The module contains one `connect` provider plus one agent per tool. You open the connection as a
bare `use` statement and call the tools directly:

```katari
import myapp.github

@"Open the connection once, then call the pulled tools like ordinary agents."
agent main() -> string with io {
  use handler {
    request prelude.throw(error: mcp.server_error | mcp.auth_error | json.decode_error) -> never {
      break f"mcp failed: ${json.to_text(value = error)}"
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
back to a raw `json.json` tree. A tool with a fully mapped `outputSchema` gets a typed result
(decoded in the runtime, `json.decode_error` on a mismatch); otherwise the result is the raw
reply as `json.json`. Two generated modules compose in one block — their scopes and `credentials`
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
      break f"failed: ${json.to_text(value = error)}"
    }
  }
  let key = env.get_secret(key = "MCP_BEARER_KEY")
  let tools : mcp.toolbox[string] = use mcp.provide(
    url = url,
    auth = mcp.headers(values = record.set(target = record.empty(), key = "Authorization", value = "Bearer " ++ key)),
  )
  f"connected: ${string.to_string(value = array.length(target = record.values(target = tools)))} tools"
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
      break f"mcp failed: ${json.to_text(value = error)}"
    }
  }
  let tools : mcp.toolbox["https://mcp.notion.com/mcp"] =
    use mcp.provide(url = "https://mcp.notion.com/mcp", auth = mcp.oauth(name = "notion"))
  f"the server publishes ${string.to_string(value = array.length(target = record.values(target = tools)))} tools"
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

The URL **is** the key: possession grants access, nothing else does. The subscriber hands it to
whoever should connect (an AI session, a teammate's MCP client) and stays alive while calls
should be served; when it returns — or the run is cancelled — the URL deactivates. A `tools/call`
whose arguments violate the published schema is rejected at the boundary as invalid params; a
served tool that throws or panics on a well-formed call proxies up and cancels the whole
endpoint, so for per-request resilience wrap the tool's body in a handler — the same contract as
[webhooks]({docs}/{currentVersion}/guides/webhooks).

## Where to go next

- [Giving the model tools]({docs}/{currentVersion}/tutorial/giving-the-model-tools) — the
  tutorial chapter this guide generalizes.
- [Effects and handlers]({docs}/{currentVersion}/concepts/effects-and-handlers) — why a scope can
  live in an effect row at all.
- The `mcp` module in the [reference](/reference) — every signature and error, in detail.
