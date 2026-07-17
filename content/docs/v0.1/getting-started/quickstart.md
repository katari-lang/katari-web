---
title: Quickstart
description: From katari init to katari run, including answering one escalation from the terminal.
---

This page assumes [Installation]({docs}/{currentVersion}/getting-started/installation) is done.
It scaffolds a project, deploys it, and runs it.

## 1. Scaffold a project

```sh
katari init my-project
cd my-project
```

This generates `katari.toml` (project configuration), `compose.yaml` and `.env.example` (for the
self-hosted runtime), and `src/main.ktr`:

```katari title="src/main.ktr"
// Your first Katari program. `main` asks its operator a question: the `ask_name` request
// escalates out of the run, and `katari run` prompts you for the answer right in the
// terminal (or answer later with `katari answer`). Delete the request once you have real
// inputs; it is here to show the human-in-the-loop flow end to end.

request ask_name(prompt: string) -> string

agent main() -> string with ask_name {
  let name = ask_name(prompt = "What is your name?")
  f"Hello, ${name}!"
}
```

Nothing handles `ask_name`, so it stays on `main`'s effect row: calling it produces an escalation.

## 2. Start the runtime

```sh
cp .env.example .env
echo "KATARI_API_KEY=$(openssl rand -hex 32)"       >> .env
echo "KATARI_SECRET_KEY=$(openssl rand -base64 32)" >> .env
docker compose up -d
```

The admin console starts at [http://localhost:3000](http://localhost:3000) and asks for
`KATARI_API_KEY` on first access. The CLI reads the key from `.env`.

## 3. Deploy and run

```sh
katari apply
katari run
```

`katari apply` compiles the project and deploys it to the runtime as a new snapshot. `katari run`
lets you pick an agent interactively (this project has only `main.main`). Selecting it turns the
`ask_name` escalation into a terminal prompt:

```
? What is your name? Katari
```

After you answer, the run completes and prints the result:

```
Hello, Katari!
```

Pressing `Ctrl-C` detaches from the run without stopping it; it keeps running on the runtime. To
answer later, or from a different process, use `katari status <run>` to see the open question and
`katari answer <escalation>` to answer it.

## Next steps

- Edit the `request` and `use handler` in `src/main.ktr` to build an agent that takes real input.
  See [Syntax]({docs}/{currentVersion}/language-reference/syntax) for the language grammar and
  [Effects]({docs}/{currentVersion}/language-reference/effects) for the effect model.
- Use `katari add` to add a registry package to `[dependencies]` in `katari.toml`.
- See [CLI]({docs}/{currentVersion}/katari-toolchains/cli) for the full list of day-to-day
  commands.

<DocCards>
  <DocCard href="{docs}/{currentVersion}/language-reference/syntax" />
  <DocCard href="{docs}/{currentVersion}/language-reference/effects" />
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/cli" />
</DocCards>
