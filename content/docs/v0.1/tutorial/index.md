---
title: "Tutorial: an AI Discord bot"
description: Six chapters from an empty project to a deployed Discord bot that talks to a model, uses your agents as tools, and ends with a second agent beside it.
---

This tutorial builds one program, six chapters long: a Discord bot that holds a
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
- a bot **deployed** to your runtime, serving a channel until you cancel it, its
  conversation held as durable run state;
- a **second agent** beside it, reached by mail rather than by a call — the shape every
  further agent joins without re-opening the ordering question.

Every chapter picks up the previous chapter's file and evolves it, and every chapter shows
its complete code, so you can rebuild the project at any point without hunting through diffs.

## What you need

- [Installation]({docs}/{currentVersion}/getting-started/installation) done: the `katari`
  CLI on your PATH, a local runtime at `http://localhost:3000`, and `KATARI_API_KEY`
  exported in your shell.
- [Quickstart]({docs}/{currentVersion}/getting-started/quickstart) done: you have
  deployed a project and run an agent once.
- Later chapters bring their own credentials — an Anthropic API key (chapter 3), a Tavily
  API key (chapter 4), and a Discord bot token (chapter 5). The first two chapters need
  no keys at all, and neither does the sixth.

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
   a channel as a **resident**: a region fiber watches Discord, the observation server
   keeps the conversation, and the whole thing deploys as one durable run.
6. [A Second Agent]({docs}/{currentVersion}/tutorial/a-second-agent) — put a second agent
   on the resident's bus: a **desk** is one request plus one sequential handler, and
   **mail** between desks is a fiber whose whole body is one perform — so a minute-long
   search stops freezing the channel.

Every idea the bot leans on — delegation, effects, escalation, durable runs, schemas —
has a fuller treatment under
[Concepts]({docs}/{currentVersion}/concepts/agents-and-delegation); the tutorial links
out as it goes.

The path does not stop at chapter 6:
[the example programs]({docs}/{currentVersion}/examples) are four complete deployable
projects that begin where this tutorial ends — including one with no Discord in it at all,
and one with no model in it at all.

Start with [Hello, Agent]({docs}/{currentVersion}/tutorial/hello-agent).
