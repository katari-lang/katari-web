---
title: "Tutorial: an AI Discord bot"
description: Six chapters from an empty project to a deployed Discord bot that answers a channel, uses your agents as tools, and hands its long errands to a second AI.
---

The whole tutorial grows one file, `src/bot.ktr`. Every chapter picks up the previous
chapter's version and shows its complete code, so you can rebuild the project at any point
without reading a diff.

```text
you › how many e's are in "effervescence"?
bot › 4 — I counted with the count_letters tool.
you › what's the latest major version of discord.js?
bot › I've handed that to the researcher; they'll post here.
researcher › discord.js is on v14. The short version: …
```

What that costs in code is the point of the six chapters: one `use` line per integration, one
`ai.spawn` per AI, and not one tool definition written by hand — an agent's signature already
is one.

## What you need

- [Installation]({docs}/{currentVersion}/getting-started/installation) done: the `katari` CLI on
  your PATH, a runtime at `http://localhost:3000`, `KATARI_API_KEY` exported.
- [Quickstart]({docs}/{currentVersion}/getting-started/quickstart) done: one project deployed,
  one agent run.
- Keys as you go — Anthropic in chapter 3, Tavily in chapter 4, a Discord bot token in chapter 5. The first two chapters need none.

## The chapters

<DocCards>
  <DocCard href="{docs}/{currentVersion}/tutorial/hello-agent" />
  <DocCard href="{docs}/{currentVersion}/tutorial/effects-and-escalation" />
  <DocCard href="{docs}/{currentVersion}/tutorial/talking-to-a-model" />
  <DocCard href="{docs}/{currentVersion}/tutorial/giving-the-model-tools" />
  <DocCard href="{docs}/{currentVersion}/tutorial/a-discord-bot" />
  <DocCard href="{docs}/{currentVersion}/tutorial/a-second-agent" />
</DocCards>

Every idea the bot leans on — delegation, effects, escalation, durable runs, schemas — has a
fuller treatment under
[Concepts]({docs}/{currentVersion}/concepts/agents-and-delegation), and each chapter links out
as it goes.

## After chapter 6

<DocCards>
  <DocCard href="{docs}/{currentVersion}/examples" />
  <DocCard href="{docs}/{currentVersion}/guides/residents" />
</DocCards>
