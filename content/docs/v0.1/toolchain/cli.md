---
title: The CLI
description: Every katari command, in the order a working day reaches for them.
---

One binary, `katari`, carries the compiler and the runtime client. Commands that talk to the
runtime resolve the URL as `--url`, then `KATARI_API_URL`, then `[runtime].url` from
`katari.toml` — and authenticate with the `KATARI_API_KEY` environment variable as a Bearer
token. `katari <command> --help` documents every flag.

## All commands

| Command                              | What it does                                                                                                                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `katari init [NAME]`                 | Scaffold a new project: `katari.toml`, `src/<name>.ktr` (the starter module under the package namespace), and a compose file for a local runtime. `NAME` defaults to the target directory's name.                              |
| `katari check`                       | Compile the project and report diagnostics. Local only — nothing reaches the runtime.                                                                                                                                          |
| `katari build`                       | Compile to IR JSON on disk (`.katari/dist/ir.json`, or `--out`), for inspection or CI artifacts.                                                                                                                               |
| `katari docs`                        | Emit **this** package's library API reference as JSON; `--stdlib` documents the prelude instead. It does not read a dependency — for a package you depend on, the [reference](/packages) or the docs MCP server is the source. |
| `katari add PKG...`                  | Add dependencies from the pinned registry snapshot and refresh `katari.lock`.                                                                                                                                                  |
| `katari remove PKG...`               | Remove dependencies and refresh `katari.lock`.                                                                                                                                                                                 |
| `katari lock`                        | Resolve the closure `katari.toml` declares and write `katari.lock`. No compile, no deploy.                                                                                                                                     |
| `katari update [SNAPSHOT]`           | Re-pin `[dependencies].snapshot` — to the registry's newest cut, to the one you name, or to `staging` for the mutable candidate set — and re-lock.                                                                             |
| `katari apply`                       | Compile the **locked** closure and deploy it as a new immutable snapshot; the project head moves to it. `-m` labels the snapshot.                                                                                              |
| `katari run [AGENT]`                 | Start an agent and wait for its result, streaming the trace and prompting on escalations. Ctrl-C detaches.                                                                                                                     |
| `katari ls [TARGET]`                 | List runs (default), `agents`, `snapshots`, `projects`, `escalations`, `files`, `env`, or `packages`.                                                                                                                          |
| `katari status [RUN]`                | One run's state, argument, result, open questions, and full trace.                                                                                                                                                             |
| `katari answer [ESCALATION]`         | Answer a question a run escalated; the run resumes.                                                                                                                                                                            |
| `katari cancel [RUN]`                | Cancel a running run, optionally recording a `--reason`.                                                                                                                                                                       |
| `katari env get/set/unset`           | Manage the project's env entries on the runtime; `--secret` makes a value write-only and encrypted at rest.                                                                                                                    |
| `katari file upload/download/delete` | Move file bytes between your disk and the runtime's blob store.                                                                                                                                                                |
| `katari mcp pull`                    | Generate a typed `.ktr` binding module from an MCP server's tool listing.                                                                                                                                                      |
| `katari mcp credentials/forget`      | List or delete the project's stored MCP OAuth credentials.                                                                                                                                                                     |
| `katari project remove/rollback`     | Delete a project on the runtime, or move its head back to an earlier snapshot.                                                                                                                                                 |

## Starting a project

```sh
katari init hello --dir hello
```

```text
  + README.md
  + compose.yaml
  + .env.example
  + .gitignore
  + katari.toml
  + src/hello.ktr
Initialized hello
hint: docker compose up -d && katari apply && katari run hello.main
hint: Katari is pre-1.0: a minor version may still break you, so pin what you deploy — katari.lock and the runtime image tag are both in this project.
```

## The edit loop

`check` is the tight loop — it compiles everything (dependencies included) and prints
diagnostics. `build` writes the IR JSON when you want to see what the runtime will execute:

```text
Wrote 21 module(s) to /home/you/hello/.katari/dist/ir.json
```

`add`, `remove` and `update` edit `katari.toml` and re-lock in the same step; `lock` re-locks
without editing anything. Which packages exist and how versions pin is covered in
[Packages]({docs}/{currentVersion}/guides/packages).

`katari ls packages` answers "what is there to add": the pinned snapshot's whole set, with the ones
this project already has marked. It reads `katari.toml` and `katari.lock` and never touches the
runtime, so it works before anything is deployed.

```text
PACKAGE          VERSION  STATUS
ai               0.4.0    added
google_common    0.2.1    in closure
web              0.2.0
```

`added` means the package is in `[dependencies].packages`; `in closure` means it arrived as
something else's dependency and is importable without being declared.

### What `check` prints

Diagnostics first, then a one-line verdict, then the **escalation report** — the entry points whose
requests would reach a human. Two flags change what you get:

- `--dependency-warnings` — also report warnings raised inside dependency packages. By default they
  are withheld and counted, since a warning in someone else's package is not yours to fix. Errors
  are never withheld.
- `--all-entry-points` — list every entry point, including those that escalate nothing. The default
  omits them and prints one line in their place —
  `(not shown: N entry point(s) that escalate nothing; --all-entry-points lists them)`. Use the flag
  when you are diffing the report across a change to prove no new capability was granted; it
  reproduces the report byte for byte.

A bot with two entry points, both of which escalate, so nothing is withheld and no count line
appears:

```text
OK — 21 module(s), no errors
Entry points (requests that escalate to the run root):
  office.world
    escalates: office.back_message, office.front_message, io
  office.office
    escalates: (nothing but io)
```

`(nothing but io)` is never folded away: `io` is a capability, and a composition root that reads
`(nothing but io)` is the line a reviewer checks. An agent that performs nothing at all reads
`(nothing)`.

`katari.lock` decides what compiles, and nothing writes it behind your back. `check`, `build` and
`apply` all resolve from the lock, offline, and they refuse — they do not warn — when the lock no
longer matches `katari.toml`: a moved snapshot pin, a dependency added or removed by hand, an
override that no longer agrees with what was locked. The message names the fix, which is always
`katari lock`. The alternative would be worse than a stopped build: a `check` that reads a stale
lock reports green about packages you are no longer asking for.

## Deploying and running

`apply` is the only deploy verb: every invocation compiles the locked closure, uploads a snapshot,
and moves the project head. It does not re-resolve dependencies — shipping is the worst moment to
change what you are shipping — so what `apply` deploys is exactly what your last `check` compiled.

```text
Creating project hello
Deploying hello to http://localhost:3000
  21 changed, 0 unchanged, 0 removed
  + hello
  + prelude
  ...
Applied snapshot 980c94ce-fa15-45bb-ac6c-3f9b064ee87b to project hello
```

Old snapshots stay — `katari ls snapshots` lists them and `katari project rollback <id>` makes one
the head again. Runs pin the snapshot they started on, so a deploy never changes a program mid-run.

```sh
katari run hello.main --arg '{}' --detach
```

`run` without an agent opens an interactive picker; without `--arg` it prompts per parameter.
`--arg` takes the whole argument record as JSON. `--detach` prints the run id and returns
immediately; detaching never stops the run. `--name` labels the run record, and `--snapshot` pins
the run to a snapshot other than the head.

## Observing and answering

```sh
katari ls runs --state running --limit 5
katari ls escalations
katari answer 0affdd73 --value '"Grace"'
katari status f51154d2 --kind escalate
```

Everywhere an id is expected, a unique prefix is enough. `status` takes `--search TEXT` and `--kind
KIND` (`delegate`, `delegateAck`, `escalate`, `escalateAck`, `terminate`, `terminateAck`) to filter
the trace, and `--json` for the raw payload — as does `ls`. `answer --value` carries the JSON answer
for a form escalation; an OAuth authorization is answered by visiting its URL instead, so the flag
is ignored there. The model behind all of this is
[Escalation]({docs}/{currentVersion}/concepts/escalation).

## Project state on the runtime

`env` entries are key-value configuration your programs read at run time; `--secret` values can be
written but never read back over the API, and `env get` prints a non-secret value raw, for piping.
`file` moves blobs your programs reference. `mcp pull` writes a `.ktr` module of typed agents from a
live MCP server — see [MCP]({docs}/{currentVersion}/guides/mcp).

## Global flags

Every command accepts `--quiet`, `--verbose` (traces runtime HTTP on stderr), `--url`, and
`--no-input`. Commands that compile take `-C DIR` to point at the project directory; commands that
talk to the runtime take `--project NAME` instead. Both default to walking up from the current
directory to the nearest `katari.toml`.

`--no-input` disables everything interactive — pickers, per-parameter prompts, confirmation — and
turns missing input into an error. It is what you want in CI and scripts.

## Next

<DocCards>
  <DocCard href="{docs}/{currentVersion}/toolchain/runtime" />
  <DocCard href="{docs}/{currentVersion}/toolchain/editor" />
  <DocCard href="{docs}/{currentVersion}/toolchain/error-codes" />
  <DocCard href="{docs}/{currentVersion}/getting-started/quickstart" />
</DocCards>
