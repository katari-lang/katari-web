---
title: CLI
description: The list of katari commands, and the flags of the MCP subcommands (login / pull).
---

`katari` compiles a project, deploys it to the runtime, and manages runs. See
`katari <command> --help` for details of each command.

## Command list

| Command   | Description                                                                      |
| --------- | -------------------------------------------------------------------------------- |
| `init`    | Scaffolds a new Katari project                                                   |
| `check`   | Compiles the project and reports diagnostics                                     |
| `build`   | Compiles the project to IR JSON                                                  |
| `apply`   | Compiles and deploys to the runtime as a new snapshot                            |
| `add`     | Adds a dependency to `katari.toml` and updates `katari.lock`                     |
| `remove`  | Removes a dependency from `katari.toml` and updates `katari.lock`                |
| `run`     | Starts an agent and waits for the result (Ctrl-C detaches)                       |
| `status`  | Shows the state, result, and open question of one run                            |
| `cancel`  | Cancels a running run                                                            |
| `answer`  | Answers a question that a run escalated                                          |
| `ls`      | Lists runs (default) / agents / snapshots / projects / escalations / files / env |
| `env`     | Manages a project's env entries (get / set / unset)                              |
| `file`    | Uploads / downloads project files                                                |
| `mcp`     | Manages MCP server credentials and bindings (login / pull)                       |
| `project` | Manages a project on the runtime (remove, rollback)                              |

Most commands accept common global options: `-q,--quiet`, `--verbose`, `--no-input`, `--url URL`
(overrides the runtime URL), and `-C,--directory DIR` (the directory containing `katari.toml`).

## env

Manages a project-scoped key/value store, including secrets. See
[`env.get_secret` / `env.get_all`]({docs}/{currentVersion}/standard-library/env) for reading it
from program code. Listing is `katari ls env`.

```sh
katari env [--project NAME] <get|set|unset> ...
```

| Subcommand                   | Description                                                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `get KEY`                    | Prints the value of a non-secret entry (secret entries are rejected because they are write-only over the API)           |
| `set KEY [VALUE] [--secret]` | Creates or overwrites an entry. If `VALUE` is omitted, it is read from an echo-off prompt (in a terminal) or from stdin |
| `unset KEY`                  | Deletes an entry                                                                                                        |

A value passed with `--secret` is encrypted at storage time and cannot be read back from anywhere
over the API (program code can read it only through `env.get_secret`). When `VALUE` is not given
explicitly, it is read from an echo-off prompt if the terminal is interactive, or from stdin
otherwise, which is a safe input path that does not appear in shell history.

## file

Manages a project's blob storage. Listing is `katari ls files`. Bytes are streamed in both
directions, so even large blobs are not loaded into memory.

```sh
katari file <upload|download|delete> ...
```

| Subcommand                          | Description                                                          |
| ----------------------------------- | -------------------------------------------------------------------- |
| `upload PATH [--content-type TYPE]` | Uploads a local file and prints the new file id                      |
| `download FILE [-o PATH]`           | Downloads the file's bytes (default: stdout if not a terminal)       |
| `delete FILE`                       | Deletes the file (a run that still references it reads it as "gone") |

`FILE` may be a file id, or a unique prefix of one.

## mcp

The verbs for MCP integration. `login` establishes a named OAuth credential outside of program
code, and `pull` generates a typed binding module from a live server. See
[Guides › MCP]({docs}/{currentVersion}/guides/mcp) for a walkthrough.

`katari mcp [--project NAME] <login|pull> ...`. `--project` is the project the login credential
belongs to (default: the `[package].name` from the surrounding `katari.toml`).

### mcp login

```sh
katari mcp login --url <URL> --name <NAME> [--scope <SCOPE>]
```

Runs OAuth 2.1 (authorization-code + PKCE + dynamic client registration) interactively and stores
the resulting credential as the project secret `mcp.oauth.<NAME>` (encrypted at storage time,
write-only over the API). The authorization URL is printed to stderr. This requires the runtime,
since the credential is stored through the env API.

| Flag            | Required | Description                                                                                                            |
| --------------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `--url URL`     | Required | The MCP server to authenticate against (the url that program code passes to `mcp.provide`)                             |
| `--name NAME`   | Required | The credential name that program code references with `mcp.oauth(name = ...)`. Stored as the secret `mcp.oauth.<NAME>` |
| `--scope SCOPE` | Optional | The OAuth scope to request (space-separated, per the server's documentation)                                           |

A stored credential can be listed and deleted with the normal env tooling (`katari ls env` /
`katari env unset`).

### mcp pull

```sh
katari mcp pull --url <URL> --out <PATH> [--header k=v]... [--oauth [--scope <SCOPE>]]
```

Enumerates the server's tools and writes out a single self-contained `.ktr` binding module. Each
tool gets one typed wrapper agent, and a `with_tools` provider closes them into a `provide` scope
and is returned (the consumer writes `use github.with_tools(auth = ...)`). Regenerating overwrites
the file. **`pull` is local**: it needs neither a runtime connection nor an API key; it only talks
to the server and writes a file.

| Flag                 | Required | Description                                                                                                      |
| -------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `--url URL`          | Required | The MCP server whose tools are enumerated                                                                        |
| `--out PATH`         | Required | The `.ktr` file the generated module is written to (overwritten)                                                 |
| `--header KEY=VALUE` | Optional | A header sent with every request (repeatable; for example, a bearer key)                                         |
| `--oauth`            | Optional | Authenticates interactively (the same flow as login). The credential stays in memory only; **nothing is stored** |
| `--scope SCOPE`      | Optional | The OAuth scope to request (only meaningful together with `--oauth`)                                             |

- `pull` has **no** `--name` flag, because it stores nothing.
- Auth is a disjoint union: `--header` and `--oauth` are **mutually exclusive** (the server is
  reached with either explicit headers _or_ OAuth).
- `--scope` is only meaningful together with `--oauth`.

#### Type mapping

The server's JSON Schema is mapped to Katari types. The mapping is all-or-nothing per parameter and
per output. **On the parameter side**, this is because `json.encode` speaks the wire form: if
`json.json` appears anywhere inside a type, it gets filled in as a `$constructor` tree rather than
a raw fragment, so a parameter that cannot be fully mapped falls back to `json.json` and inserts
the tree as-is. **On the output side**, decoding moves to the runtime (`mcp.call[url, T]` decodes
for `T`): if `outputSchema` can be fully mapped, `T` is the `<tool>_output` synonym type; otherwise
`T` is `json.json` (the raw tree).

| JSON Schema                                                                                                             | Katari                                              |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `string` / `integer` / `number` / `boolean` / `null`                                                                    | As-is                                               |
| `array` + `items`                                                                                                       | `array[T]`                                          |
| `object` + `properties`                                                                                                 | object type (non-required fields become `?` fields) |
| `object` with only a schema-valued `additionalProperties`                                                               | `record[T]`                                         |
| `anyOf` (all members mappable)                                                                                          | union `A \| B`                                      |
| Everything else (`enum` / `const`, `allOf` / `oneOf`, tuples, empty schema, field names that are not valid identifiers) | `json.json` fallback                                |

## Related

<DocCards>
  <DocCard href="{docs}/{currentVersion}/guides/mcp" />
  <DocCard href="{docs}/{currentVersion}/standard-library/mcp" />
</DocCards>
