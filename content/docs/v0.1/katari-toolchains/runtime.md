---
title: Runtime
description: The long-running server, snapshots, durable execution, escalation park, and the seven reactors.
---

`typescript/runtime` is the long-running server that executes IR and persists execution state
(Hono-based, a single Node process). It serves both the JSON API (`/api/v1`, which the CLI
connects to) and the admin web console baked into it (`/`) on the same port.

## Hierarchy: project / snapshot / instance

- **project**: the top-level unit of deployment and isolation (one project equals one app). It
  persists until explicitly deleted.
- **snapshot**: a code version. Its content is a manifest mapping module name to module hash; the
  actual IR is held by a content-addressed module store. `katari apply` uploads only the IR for
  modules that changed (the diff is purely a transfer optimization; the snapshot that gets
  committed always has a **complete** manifest), and advances the project's head to the new
  snapshot. `katari project rollback` moves the head back to an older snapshot.
- **instance**: one running agent activation. It is summoned by `delegate`, holds state (a scope)
  and a finalizer stack, and disappears on `return` or cancel.

## An instance pins the snapshot it started with

A running instance pins the snapshot it started with and sees a consistent view of that version
for as long as it lives. Deploying a dependency module in a new snapshot does not affect an
existing instance. This guarantee holds without any special mechanism: each time an instance calls
a new agent (`delegate`), **the calling instance's own snapshot is stamped onto it directly**. The
head is consulted only at the moment an instance is born from an external trigger (the start of a
run, a webhook delivery, and so on); every internal delegation after that inherits its own
snapshot.

## Durable execution

The runtime persists instance state at each turn boundary (a leaf delegation that performs an
effect). This gives:

- **Escalations park.** When an unhandled `request` reaches all the way out of a run, the run
  enters a waiting state and consumes no process resources until an answer arrives from
  `katari answer` or the console. (See escalation in
  [Effects]({docs}/{currentVersion}/language-reference/effects).)
- **It restores from a restart.** If the process goes down, it resumes from the persisted instance
  graph on next startup. An external call that was in flight (FFI / http / mcp) can end up in a
  state where it is unknown whether it completed, so it is treated as **at-most-once**: a call that
  was in progress across a restart is not re-executed and is settled as a failure instead
  (retrying is a language-level choice made by katari code, not something the runtime does
  silently). `time` and `webhook` have no external process to reconcile against, so they survive a
  restart completely: a timer re-arms from its persisted deadline, and an endpoint is
  re-registered.
- A finalizer armed with `finally` always runs, in reverse order, immediately before normal
  completion or cancellation. See [finally]({docs}/{currentVersion}/language-reference/finally) for
  details.

## Reactor

A call to an `external agent` is executed by the reactor named in the declaration's
`from "reactor"` clause (FFI if omitted). The runtime has exactly seven:

| reactor   | Role                                                                                                                       |
| --------- | -------------------------------------------------------------------------------------------------------------------------- |
| `core`    | Executes calls to compiled agents / closures (the default target of `OperationDelegate`)                                   |
| `api`     | The entry point for external events: starting a run, cancel, and answering escalations                                     |
| `http`    | `http.fetch` / `post_json`, an in-runtime HTTP client (no sidecar needed)                                                  |
| `webhook` | `webhook.inbound`, issues a dynamic public URL and turns a POST into a callback call                                       |
| `mcp`     | `mcp.provide` / `call` / `serve`, an in-runtime MCP client / server                                                        |
| `time`    | `time.now` / `sleep` / `sleep_until` / `watch`, a durable clock and timers (deadlines are persisted and re-arm on restart) |
| `ffi`     | An `external agent` with `from` omitted, dispatches to the project's TypeScript sidecar process                            |

`http`, `webhook`, `mcp`, and `time` are all external calls built into the runtime; the user does
not need to install an SDK. Only `ffi` requires a project-specific sidecar process (written with
`@katari-lang/port`), which `katari apply` bundles and delivers to the runtime. A sidecar handler
can call back into a katari-side agent through an inner delegation (`context.call`).

## Deployment (self-hosted)

The `compose.yaml` generated by `katari init` starts three services: Postgres, an S3-compatible
blob store (SeaweedFS), and the runtime image (`ghcr.io/katari-lang/katari:<version>`). The runtime
will not start without `KATARI_API_KEY` (which the CLI and console authenticate with as a Bearer
token) and `KATARI_SECRET_KEY` (the at-rest encryption key for secrets). See
[Installation]({docs}/{currentVersion}/getting-started/installation) for detailed steps.

## Related

<DocCards>
  <DocCard href="{docs}/{currentVersion}/language-reference/effects" />
  <DocCard href="{docs}/{currentVersion}/language-reference/finally" />
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/cli" />
</DocCards>
