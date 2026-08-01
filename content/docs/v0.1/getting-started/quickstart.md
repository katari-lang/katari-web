---
title: Quickstart
description: Scaffold a project, start a local runtime, run an agent, and answer its escalation.
---

You need the CLI and Docker from [Installation]({docs}/{currentVersion}/getting-started/installation).
Everything here happens in one terminal.

## Scaffold a project

```sh
katari init hello --dir hello
cd hello
```

```
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

`katari.toml` names the package and points at a runtime (`http://localhost:3000` by default).
`src/hello.ktr` defines one request and one agent:

```katari
request ask_name(prompt: string) -> string

agent main() -> string with ask_name {
  let name = ask_name(prompt = "What is your name?")
  f"Hello, ${name}!"
}
```

Nothing handles `ask_name`, so calling it **escalates**: the question leaves the run and waits
for a human. You are about to be that human.

## Start a local runtime

The scaffolded `compose.yaml` runs the runtime image, PostgreSQL, and an S3-compatible blob
store. It needs two keys in `.env`:

```sh
export KATARI_API_KEY=$(openssl rand -hex 32)
cp .env.example .env
echo "KATARI_API_KEY=$KATARI_API_KEY" >> .env
echo "KATARI_SECRET_KEY=$(openssl rand -base64 32)" >> .env
docker compose up -d
```

`KATARI_API_KEY` is the bearer token every caller authenticates with; `KATARI_SECRET_KEY`
encrypts secret values at rest. The runtime refuses to boot without either.

The CLI reads `KATARI_API_KEY` from your shell environment rather than from `.env`, which is why
the `export` comes first. In a new terminal, export it again — the value is in `.env`.

## Compile and deploy

```sh
katari check
```

```
OK — 21 module(s), no errors
Entry points (requests that escalate to the run root):
  hello.main
    escalates: hello.ask_name
```

`check` compiles locally and reports diagnostics; nothing leaves your machine. The last block is
the **escalation report** — the requests that would reach a human, per entry point. Here it names
the one you are about to answer. `apply` compiles too, then uploads the result to the runtime as an
immutable **snapshot**:

```sh
katari apply
```

```
Creating project hello
Deploying hello to http://localhost:3000
  21 changed, 0 unchanged, 0 removed
  + hello
  + prelude
  ...
Applied snapshot 980c94ce-fa15-45bb-ac6c-3f9b064ee87b to project hello
```

## Run it

```sh
katari run hello.main
```

```
Started run 3acbdecd-f74c-424f-bff9-33087242aec2 (Ctrl-C detaches; the run keeps going)
  12:11:34 delegate api→core hello.main [04fbd8f5]
  12:11:34 delegate core→core hello.ask_name [e233d5ab]
  12:11:34 escalate core→core request hello.ask_name [e233d5ab/362ed1d7]
  12:11:34 escalate core→api request hello.ask_name [04fbd8f5/42d264c0]

The run is asking hello.ask_name: {"prompt":"What is your name?"}
? answer (string) Ada
Answered; waiting on the run again...
  12:11:34 escalateAck api→core [04fbd8f5/42d264c0]
  12:11:34 escalateAck core→core [e233d5ab/362ed1d7]
  12:11:34 delegateAck core→core [e233d5ab]
  12:11:34 delegateAck core→api [04fbd8f5]
"Hello, Ada!"
```

The trace streams live: the run delegates to `hello.main`, hits `ask_name`, and escalates.
`katari run` turns the open question into a terminal prompt; your answer resumes the run,
and the result comes back.

## Answer from outside the run

That inline prompt is a convenience, not the model. The escalation is a durable row on the
runtime — the run parks on it for as long as it takes. Start a run without waiting on it:

```sh
katari run hello.main --detach
katari ls escalations
```

```
ID        RUN       REQUEST         QUESTION                         CREATED
0affdd73  f51154d2  hello.ask_name  {"prompt":"What is your name?"}  2026-07-17 12:09
```

Answer it — hours later, from another machine, id prefixes are enough:

```sh
katari answer 0affdd73 --value '"Grace"'
katari status f51154d2
```

```
Run           f51154d2-1403-45c5-bb23-0016daf6320d
Name          hello.main
Agent         hello.main
State         done
Snapshot      980c94ce-fa15-45bb-ac6c-3f9b064ee87b
Argument      {}
Result        "Hello, Grace!"
...
```

## Look at the console

Open [http://localhost:3000](http://localhost:3000) and paste your `KATARI_API_KEY` (it is in `.env`). The console
shows the project you just deployed: its runs with their delegation trees and traces, the
escalation inbox — where you could have answered `ask_name` instead — snapshots, env
entries, and files. [The runtime]({docs}/{currentVersion}/toolchain/runtime) tours the
screens.

When you are done:

```sh
docker compose down
```

State lives in named Docker volumes, so `up -d` brings everything back — including any run
still parked on a question. Add `-v` to wipe it.

## Next

<DocCards>
  <DocCard href="{docs}/{currentVersion}/tutorial" />
  <DocCard href="{docs}/{currentVersion}/concepts/escalation" />
  <DocCard href="{docs}/{currentVersion}/toolchain/cli" />
</DocCards>
