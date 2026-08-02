# e2b — a Python sandbox, as Katari tools

A single module, `e2b`, plus its FFI sidecar `src/e2b.ts`: run Python in an
[e2b](https://e2b.dev) sandbox, and move a file across that sandbox's boundary in either direction.
The sandbox is **owned by the provider** and shared by every call in its scope — a stateful kernel, so
variables, imports, and files persist across the model's steps.

- `e2b.provider(source = ...)` — serves the **environment**: a `session` (a sandbox id + the api key),
  opening ONE sandbox lazily on first use and sharing it for the extent of the continuation, so the
  model's steps build on each other's state.
- `e2b.run_python(code)` — run Python in that sandbox and return its stdout / value / traceback text.
- `e2b.put_file(content, path)` — write a `file` INTO the sandbox, so code can open it; returns the
  path e2b actually wrote to.
- `e2b.get_file(path, content_type ?= "")` — read `path` back OUT as a `file`, to hand onward.

Bytes in at a path and bytes out from a path is the whole file surface: naming the file, choosing the
format, and deciding when to move it are the caller's (or the model's) judgement.

## Failures

The `session` seam answers with a **value** — `session_ready(environment)` or
`session_unavailable(message)` — because the provider's deep handler runs at its own install site, above
any tool loop, and so cannot throw back *into* the tool that performed `session`. The **tools** throw a
typed error:

| agent | success | throws |
| --- | --- | --- |
| `run_python` | `string` — stdout / value / your code's own traceback | `sandbox_unavailable`, `run_failed` |
| `put_file` | `string` — the path e2b actually wrote to | `sandbox_unavailable`, `put_failed` |
| `get_file` | `file` — the handle itself, unwrapped | `sandbox_unavailable`, `get_failed` |

Every variant carries `message` — the field an AI loop renders for the model when it absorbs a tool's
throw, and the sentence a human reads in a log. `e2b.sandbox_failure` is the union of all four, for an
app that wants one converter. A **Python error in the code is not a failure of the tool**: the traceback
is ordinary output and comes back as `run_python`'s result.

An AI loop absorbs a tool's throw, feeds the model the message to work around, and reports
`ai.tool_failed` to the app. A caller outside such a loop catches — that is the
`prelude.throw[e2b.sandbox_failure]` in the example below.

`get_file`'s success is the `file` itself, unwrapped, so it passes straight on to anything taking a
file, and an AI loop's result-file collection finds it and inlines a chart for the model to see.

## Model-facing

All three tools are documented `@"Tool:` and are meant to be handed to a model's tool list — the
capability goes in as a named tool and the judgement about when to use it stays with the model. A model
names a file the way it names one anywhere else in Katari: by replaying the handle object it can see in
its conversation, a bare `{"$katari_ref": "<id>"}` (the same contract as `ai.view_image`).

A `path` argument reaches the **sandbox** filesystem and nothing else. The sandbox is the trust
boundary, and it grants no authority `run_python` does not already grant — Python can already open and
write any path in there. The runtime, the host and other projects' files are not reachable through
either agent.

## Secrets / env

`E2B_API_KEY` — your e2b API key. Store it in the runtime with `katari env set E2B_API_KEY --secret`,
and name it with `credentials.env(key = "E2B_API_KEY")`. It is a `string of private`, passed straight to
the sidecar and never surfaced elsewhere. The credential resolves per `session` request, so a rotation
lands on the next tool call without a restart.

## Usage

```katari
import e2b

agent analyse(attachment: file) -> string with io | prelude.throw[e2b.sandbox_failure | env.missing_secret | oauth.server_error] {
  use e2b.provider(source = credentials.env(key = "E2B_API_KEY"))
  let path = e2b.put_file(content = attachment, path = "/home/user/input.csv")
  e2b.run_python(code = f"import pandas; print(pandas.read_csv(\"${path}\").describe())")
}
```

Or hand `[e2b.run_python, e2b.put_file, e2b.get_file]` to an AI loop's tool list and let the model drive
the whole loop itself.

## The sidecar

The externals (`e2b_open`, `e2b_run_in`, `e2b_put_file`, `e2b_get_file`) live in `src/e2b.ts`, which
keeps the live sandboxes in a module-level map keyed by session handle. One rule governs that entry
across every handler: a cache miss reconnects (or recreates under the same handle), and a failed
operation drops it so the next call re-heals. Each handler returns a result value (`{ ok, ... }`) rather
than throwing — a throw would cross back as a panic and tear the run down.

File bytes never travel on the sidecar's stdio reply channel: a Katari `file` crosses the FFI boundary
as a slim handle, so `put_file` downloads it and `get_file` uploads what it read, both over the
runtime's HTTP blob side channel. A file the sidecar produces is owned by its call and ascends to the
calling agent on return. `content_type` is asked for rather than sniffed because a sandbox filesystem
stores bytes at a path and nothing about their type; `""` records none, so absence travels as absence.

`src/e2b.ts` imports `@e2b/code-interpreter` and `@katari-lang/port`, declared in `package.json`. Run
`pnpm install` (or `npm install`) in this package so `katari apply` can bundle the sidecar;
`pnpm run typecheck` type-checks it. A pure-Katari consumer that never applies this package does not
need them.
