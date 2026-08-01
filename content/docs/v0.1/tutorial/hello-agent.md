---
title: Hello, Agent
description: Create a project, write your first agent, and meet the schema that everything calling it goes through.
---

An agent is Katari's function: a labelled record in, a value out. Three commands move one —
`check` compiles locally, `apply` deploys, `run` executes — and every chapter after this one
repeats them.

## A fresh project

```sh
katari init bot --dir bot
cd bot
```

`katari init` scaffolds a complete project:

- `katari.toml` — the package name, the runtime URL (`http://localhost:3000`), and a
  `[dependencies]` section pinned to a registry snapshot. It is empty for now; chapter 3 fills
  it.
- `src/bot.ktr` — a starter program. Every module lives under the package's namespace, so a
  `bot` package's starter is `src/bot.ktr`, the module `bot`.
- `compose.yaml` and `.env.example` — a self-contained local runtime stack. You already have a
  runtime from the quickstart, and one runtime serves any number of projects, so leave these
  alone.

## Your first agent

Replace the contents of `src/bot.ktr`:

```katari
@"Greet someone by name."
agent greet(name: string) -> string {
  f"Hello, ${name}!"
}
```

Three things to notice:

- The `@"..."` line is the agent's documentation, and it travels with the agent — into the API
  reference, and, in chapter 4, into the tool description an AI model reads when deciding
  whether to call it. Write it for a caller who cannot see the body.
- Parameters are labelled. Every call site names its arguments (`greet(name = "Ada")`), so a
  signature reads the same everywhere: definition, call, schema.
- `f"..."` is an f-string; `${...}` splices a value in.

Compile it:

```sh
katari check
```

`check` is local and fast — no runtime involved. It is also strict: change the return type to
`integer` and it answers with exactly where and why.

```text
bot:1:1 K3001: The actual type can be a string, which the expected type does not admit
  expected: integer
  actual:   string
```

Every diagnostic carries a position and a `K` code, and every code is listed — with what it
usually means and what to do about it — in
[Error codes]({docs}/{currentVersion}/toolchain/error-codes). K3001, the one above, is the
mismatch you will meet most. Put the return type back to `string` before moving on.

## Apply, then run

The runtime executes **snapshots**: immutable, deployed versions of your project. `katari apply`
compiles and deploys one; `katari run` starts an agent from the latest.

```sh
katari apply
katari run bot.greet --arg '{"name": "Ada"}'
```

```text
"Hello, Ada!"
```

Agents are addressed as `module.name` — the file `src/bot.ktr` is the module `bot`, so your
agent is `bot.greet`. Run `katari run` with no argument to pick from a list, and `katari ls` to
see recent runs. `run` executes what you last applied, so run `katari apply` again after every
change in this tutorial.

## The schema is the contract

That `--arg` was not parsed loosely. From `greet`'s signature the compiler derived an input and
an output schema:

```json
{
  "input": {
    "type": "object",
    "properties": { "name": { "type": "string" } },
    "required": ["name"],
    "additionalProperties": true
  },
  "output": { "type": "string" }
}
```

Every way into the agent goes through it: the CLI's `--arg`, another agent's call, an HTTP
request, and — chapter 4 — an AI model calling the agent as a tool. Input that does not fit is
rejected at the boundary before your code runs, so `katari run bot.greet --arg '{"name": 42}'`
fails without starting the body. `katari docs` emits every derived schema as JSON.

This is the quiet backbone of the whole tutorial: you never write a tool definition by hand,
because the signature you already wrote is one.

## Agents call agents

One more agent closes the chapter. The complete `src/bot.ktr`:

```katari
@"Greet someone by name."
agent greet(name: string) -> string {
  f"Hello, ${name}!"
}

@"Greet a whole crew — agents call agents like functions."
agent greet_all(names: array[string]) -> string {
  let greetings = for (let name in names) {
    next greet(name = name)
  }
  string.join(parts = greetings, separator = " ")
}
```

`for` maps over the array, `next` yields each element's result, and calling another agent is
just calling it. In the runtime that call is a **delegation**: each run records a tree of who
called whom, which the console's run page draws live. Swap `for` for `parallel for` and each
greeting becomes its own thread.

```sh
katari apply
katari run bot.greet_all --arg '{"names": ["Ada", "Grace"]}'
```

```text
"Hello, Ada! Hello, Grace!"
```

## Next

Chapter 2 is the part of Katari with no analog in most languages: an agent asks for something
it cannot compute, and its signature says so.

<DocCards>
  <DocCard href="{docs}/{currentVersion}/tutorial/effects-and-escalation" />
  <DocCard href="{docs}/{currentVersion}/concepts/agents-and-delegation" />
  <DocCard href="{docs}/{currentVersion}/concepts/types-and-schemas" />
  <DocCard href="{docs}/{currentVersion}/concepts/language-reference" />
</DocCards>

The language reference is every legal form on one page. Keep it open: this language is in
nobody's training data, yours or your assistant's.
