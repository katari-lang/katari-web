---
title: Hello, Agent
description: Create a project, write your first agent, and meet the schema that everything calling it goes through.
---

An agent is Katari's function: a labelled record in, a value out, both sides carrying a
JSON schema. This chapter creates the tutorial project, writes one agent, and runs it on
your runtime — the same three commands (`check`, `apply`, `run`) you will repeat in every
chapter after this one.

## A fresh project

```sh
katari init bot --dir bot
cd bot
```

`katari init` scaffolds a complete project:

- `katari.toml` — the package name, the runtime URL (`http://localhost:3000`), and a
  `[dependencies]` section pinned to a registry snapshot (empty for now; chapter 3 fills
  it).
- `src/bot.ktr` — a starter program, the one the
  [Quickstart]({docs}/{currentVersion}/getting-started/quickstart) walks through. Every
  module lives under the package's namespace, so a `bot` package's starter is `src/bot.ktr`
  (the module `bot`).
- `compose.yaml` and `.env.example` — a self-contained local runtime stack. You already
  have a runtime running from the quickstart, so leave these alone; one runtime serves
  any number of projects.

## Your first agent

`katari init` already scaffolded `src/bot.ktr` — its module name follows the package name
(`bot`), so it is ready to use. Replace its contents with your first agent:

```katari
@"Greet someone by name."
agent greet(name: string) -> string {
  f"Hello, ${name}!"
}
```

Three things to notice:

- **The `@"..."` line is not decoration.** It is the agent's documentation, and it
  travels with the agent — into the API reference, and (in chapter 4) into the tool
  description an AI model reads to decide when to call it. Write it for a caller who
  cannot see the body.
- **Parameters are labelled.** Every call site names its arguments
  (`greet(name = "Ada")`), so a signature reads the same everywhere: definition, call,
  schema.
- `f"..."` is an f-string; `${...}` splices a value in.

Compile it:

```sh
katari check
```

`check` is local and fast — no runtime involved. It is also strict: change the return
type to `integer` and it answers with exactly where and why:

```text
bot:1:1 K3001: The actual type can be a string, which the expected type does not admit
  expected: integer
  actual:   string
```

Every diagnostic carries a position and a `K` code, and every code is listed — with what it
usually means and what to do about it — in
[Error codes]({docs}/{currentVersion}/toolchain/error-codes). Keep it open in a tab; K3001, the
one above, is the mismatch you will meet most.

Put the return type back to `string` before moving on.

## Apply, then run

The runtime executes **snapshots** — immutable, deployed versions of your project.
`katari apply` compiles and deploys one; `katari run` starts an agent from the latest.

```sh
katari apply
katari run bot.greet --arg '{"name": "Ada"}'
```

The run executes on the runtime and the CLI prints its result as JSON:

```text
"Hello, Ada!"
```

Agents are addressed as `module.name` — the file `src/bot.ktr` is the module `bot`, so
your agent is `bot.greet`. (Run `katari run` with no argument to pick from a list, and
`katari ls` to see recent runs.) One habit to build now: **`run` executes what you last
applied.** After every code change in this tutorial, `katari apply` again before running.

## The schema is the contract

That `--arg` was not parsed loosely. From `greet`'s signature, the compiler derived an
input and output schema:

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

Every way into the agent goes through it — the CLI's `--arg`, another agent's call, an
HTTP request, and — chapter 4 — an AI model calling an agent as a tool. Input
that does not fit is rejected at the boundary before your code runs. Try it:
`katari run bot.greet --arg '{"name": 42}'` fails without starting the body. You can see
every derived schema with `katari docs`, which emits the project's API reference as JSON.

This is the quiet backbone of the whole tutorial: **you never write a tool definition by
hand.** The signature you already wrote is one.

## Agents call agents

One more agent closes the chapter. Here is the complete `src/bot.ktr`:

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

`for` maps over the array, `next` yields each element's result, and calling another agent
is just… calling it. In the runtime this call is a **delegation** — each run records a
tree of who called whom, which you can watch live on the console's run page. (Swap `for`
for `parallel for` and each greeting becomes its own thread; see
[Parallelism]({docs}/{currentVersion}/concepts/parallelism).)

```sh
katari apply
katari run bot.greet_all --arg '{"names": ["Ada", "Grace"]}'
```

```text
"Hello, Ada! Hello, Grace!"
```

## Where you are

A project, an agent, and a schema-checked boundary around it. Next, the part of Katari
that has no analog in most languages: an agent asks for something it cannot compute, and
the signature says so —
[Effects and Escalation]({docs}/{currentVersion}/tutorial/effects-and-escalation).

For the fuller story of this chapter:
[Agents and Delegation]({docs}/{currentVersion}/concepts/agents-and-delegation) and
[Types and Schemas]({docs}/{currentVersion}/concepts/types-and-schemas). And when you catch
yourself guessing at syntax — this language is in nobody's training data, yours or your
assistant's — the [Language reference]({docs}/{currentVersion}/concepts/language-reference) is
every legal form on one page, including a closing list of the things Katari deliberately does
not have.
