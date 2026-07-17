---
title: "Tutorial: an AI Discord bot"
description: Five chapters from an empty project to a deployed Discord bot that talks to a model and uses your agents as tools.
---

This tutorial builds one program, five chapters long: a Discord bot that holds a
conversation with an AI model — and hands that model **tools**: web search, page fetch,
and an agent you wrote yourself.

```text
you › how many e's are in "effervescence"?
bot › 4 — I counted with the count_letters tool.
you › what's the latest major version of discord.js?
bot › (searches the web, fetches a page) It's 14 — here's the short version: …
```

By the end you have:

- agents whose **JSON schemas** — derived from their signatures by the compiler — double
  as the tool definitions an AI model calls them through;
- a model wired in with **one `use` line**, swappable for another provider in one line;
- the conversation history kept as **handler state**: a typed value in your program, not
  a bolted-on database;
- a bot **deployed** to your runtime, serving a channel until you cancel it — and
  surviving a runtime restart mid-conversation.

Each chapter picks up the previous chapter's file and evolves it, and each shows the
complete code, so you can rebuild the project at any point without hunting through diffs.

## What you need

- [Installation]({docs}/{currentVersion}/getting-started/installation) done: the `katari`
  CLI on your PATH, a local runtime at `http://localhost:3000`, and `KATARI_API_KEY`
  exported in your shell.
- [Quickstart]({docs}/{currentVersion}/getting-started/quickstart) done: you have
  deployed a project and run an agent once.
- Later chapters bring their own credentials — an Anthropic API key (chapter 3), a Tavily
  API key (chapter 4), and a Discord bot token (chapter 5). The first two chapters need
  no keys at all.

## The route

1. [Hello, Agent]({docs}/{currentVersion}/tutorial/hello-agent) — a fresh project, a
   first agent, `check` / `apply` / `run`, and the schema every caller goes through.
2. [Effects and Escalation]({docs}/{currentVersion}/tutorial/effects-and-escalation) —
   declare a request, handle it in-program, then remove the handler and watch the run
   park as a question a human answers. Plus a first stateful handler.
3. [Talking to a Model]({docs}/{currentVersion}/tutorial/talking-to-a-model) — add the
   `ai` package, provide Anthropic with one `use` line, and hold a conversation over a
   typed history.
4. [Giving the Model Tools]({docs}/{currentVersion}/tutorial/giving-the-model-tools) —
   reflection turns your agents into tool definitions; the model searches, fetches, and
   calls your code.
5. [A Discord Bot]({docs}/{currentVersion}/tutorial/a-discord-bot) — connect the loop to
   a channel with the `discord` package, keep history across messages in a handler `var`,
   and deploy.

Every idea the bot leans on — delegation, effects, escalation, durable runs, schemas —
has a fuller treatment under
[Concepts]({docs}/{currentVersion}/concepts/agents-and-delegation); the tutorial links
out as it goes. Start with
[Hello, Agent]({docs}/{currentVersion}/tutorial/hello-agent).
