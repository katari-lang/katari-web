---
title: The CLI
description: Every katari command, in the order a working day reaches for them.
---

One binary, `katari`, carries the compiler and the runtime client. Commands that talk to the
runtime resolve the URL as `--url`, then `KATARI_API_URL`, then `[runtime].url` from
`katari.toml` — and authenticate with the `KATARI_API_KEY` environment variable as a Bearer
token. `katari <command> --help` documents every flag.

## All commands

| Command                              | What it does                                                                                                |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `katari init [NAME]`                 | Scaffold a new project: `katari.toml`, `src/main.ktr`, and a compose file for a local runtime.              |
| `katari check`                       | Compile the project and report diagnostics. Local only — nothing reaches the runtime.                       |
| `katari build`                       | Compile to IR JSON on disk (`.katari/dist/ir.json`), for inspection or CI artifacts.                        |
| `katari docs`                        | Emit the package's library API reference as JSON; `--stdlib` documents the prelude instead.                 |
| `katari add PKG...`                  | Add dependencies from the pinned registry snapshot and refresh `katari.lock`.                               |
| `katari remove PKG...`               | Remove dependencies and refresh `katari.lock`.                                                              |
| `katari apply`                       | Compile and deploy to the runtime as a new immutable snapshot; the project head moves to it.                |
| `katari run [AGENT]`                 | Start an agent and wait for its result, streaming the trace and prompting on escalations. Ctrl-C detaches.  |
| `katari ls [TARGET]`                 | List runs (default), `agents`, `snapshots`, `projects`, `escalations`, `files`, or `env`.                   |
| `katari status [RUN]`                | One run's state, argument, result, open questions, and full trace.                                          |
| `katari answer [ESCALATION]`         | Answer a question a run escalated; the run resumes.                                                         |
| `katari cancel [RUN]`                | Cancel a running run, optionally recording a `--reason`.                                                    |
| `katari env get/set/unset`           | Manage the project's env entries on the runtime; `--secret` makes a value write-only and encrypted at rest. |
| `katari file upload/download/delete` | Move file bytes between your disk and the runtime's blob store.                                             |
| `katari mcp pull`                    | Generate a typed `.ktr` binding module from an MCP server's tool listing.                                   |
| `katari mcp credentials/forget`      | List or delete the project's stored MCP OAuth credentials.                                                  |
| `katari project remove/rollback`     | Delete a project on the runtime, or move its head back to an earlier snapshot.                              |

## The edit loop

`check` is the tight loop — it compiles everything (dependencies included) and prints
diagnostics. `build` writes the IR JSON when you want to see what the runtime will execute.
`add` and `remove` edit `katari.toml` and re-pin `katari.lock`; which packages exist and how
versions pin is covered in [Packages]({docs}/{currentVersion}/guides/packages).

## Deploying and running

`apply` is the only deploy verb: every invocation compiles, uploads a snapshot, and moves the
project head. Old snapshots stay — `katari ls snapshots` lists them and
`katari project rollback <id>` makes one the head again. Runs pin the snapshot they started
on, so a deploy never changes a program mid-run.

```sh
katari run main.main --arg '{}' --detach
```

`run` without an agent opens an interactive picker; without `--arg` it prompts per parameter.
`--arg` takes the whole argument record as JSON. `--detach` prints the run id and returns
immediately; detaching never stops the run.

## Observing and answering

```sh
katari ls escalations
katari answer 0affdd73 --value '"Grace"'
katari status f51154d2
```

Everywhere an id is expected, a unique prefix is enough. `status` takes `--search TEXT` and
`--kind KIND` to filter the trace, and `--json` for the raw payload — as does `ls`.
Escalations are the human-in-the-loop surface; the model behind them is
[Escalation]({docs}/{currentVersion}/concepts/escalation).

## Project state on the runtime

`env` entries are key-value configuration your programs read at run time; `--secret` values
can be written but never read back over the API. `file` moves blobs your programs reference.
`mcp pull` writes a `.ktr` module of typed agents from a live MCP server — see
[MCP]({docs}/{currentVersion}/guides/mcp).

## Global flags

Every command accepts `--quiet`, `--verbose` (traces runtime HTTP on stderr), `--url`, and
`--no-input`. Commands that compile take `-C DIR` to point at the project directory; commands
that talk to the runtime take `--project NAME` instead. Both default to walking up from the
current directory to the nearest `katari.toml`.

**Note:** anything interactive — pickers, per-parameter prompts, confirmation — is disabled
by `--no-input`, which turns missing input into an error. Use it in CI and scripts.

## Next

- [The runtime]({docs}/{currentVersion}/toolchain/runtime) — what `apply` deploys to.
- [The editor]({docs}/{currentVersion}/toolchain/editor) — the same commands from VSCode.
- [Quickstart]({docs}/{currentVersion}/getting-started/quickstart) — the daily flow end to
  end.
