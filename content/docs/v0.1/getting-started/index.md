---
title: What is Katari?
description: A language for orchestrating AI agents, with typed effects and a durable runtime.
---

Katari is a programming language for **orchestration**: the layer of a system that decides
which agent runs, with what input, what happens when one asks a human a question, and what
survives a crash. You write that layer as a typed program; a persistent runtime executes it.

> **Katari 0.1 is released, and pre-1.0.** The language, toolchain, and runtime are usable
> today, but the API surface is not frozen: a minor version may still ship breaking changes.
> Pin what you deploy — `katari.lock` and the runtime image tag exist for exactly that.

Three ideas carry the whole language:

- **Agents are functions.** An agent takes a labelled record in and returns a value out, and
  both sides carry a JSON schema. Anything can call it — another agent, an HTTP client, an AI
  model that discovered it as a tool.
- **Effects are visible.** An agent's signature tracks the requests it may perform
  (`with ask`). A request with a handler in scope is a function call; a request with no
  handler **escalates** — the run parks as an open question a human answers, minutes or days
  later.
- **Execution is durable.** The runtime persists every step. A run can wait on a webhook, a
  cron occurrence, or an OAuth authorization, survive a server restart, and resume exactly
  where it parked.

## A taste

```katari
@"Ask a human to weigh in; the run waits until this question is answered."
request ask(question: string) -> string

@"Review one source by asking a human what stands out in it."
agent review(source: string) -> string with ask {
  let note = ask(question = f"What stands out in ${source}?")
  f"${source}: ${note}"
}

@"Review every source in parallel, then join the findings into one report."
agent main(sources: array[string]) -> string with ask {
  let notes = parallel for (let source in sources) {
    next review(source = source)
  }
  string.join(parts = notes, separator = "\n")
}
```

`parallel for` fans each source out to its own thread. Nothing handles `ask`, so every
question escalates: the run parks, the console shows the blocked tree, and each answer —
from the inbox or `katari answer` — resumes its thread. The compiler checked all of it: the
effect row, the schemas, the join.

## What ships with it

- A **compiler** that lowers Katari source to an IR, and a **runtime server** that executes
  IR snapshots against PostgreSQL — runs, escalations, and schedules all persist.
- A **standard library** (`http`, `json`, `time`, `webhook`, `mcp`, `oauth`, `replay`, …) and
  a **package registry** — `ai` (model-agnostic tool-calling over Anthropic / Gemini /
  OpenAI), `discord`, `slack`, `google_calendar`, `tavily`, and more. Every API is documented
  in the [reference](/packages).
- **MCP in both directions**: consume any MCP server's tools as typed agents, or serve your
  agents as an MCP server.
- **Tooling**: a CLI, an LSP with a VSCode extension, and an admin web console with a live
  run trace.

## Where to go next

- [Why Katari]({docs}/{currentVersion}/getting-started/why-katari) — why orchestration is a
  language problem, and what a text language buys that a node graph cannot.
- [Installation]({docs}/{currentVersion}/getting-started/installation) — the CLI and a local
  runtime.
- [Quickstart]({docs}/{currentVersion}/getting-started/quickstart) — a project running in
  five minutes.
- [Tutorial]({docs}/{currentVersion}/tutorial) — build a Discord bot that talks to a model
  and uses your agents as tools.
- [Concepts]({docs}/{currentVersion}/concepts/agents-and-delegation) — the execution model,
  one idea at a time.
- [Examples]({docs}/{currentVersion}/examples) — four complete, deployable resident agents you
  can clone and run: a GitHub release monitor with no model in it, a Slack standup bot with a
  human-approved digest, a two-desk Discord concierge, and a Gmail-to-calendar butler behind an
  approval gate.
