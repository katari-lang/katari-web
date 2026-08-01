---
title: Giving the Model Tools
description: Reflection turns your agents into tool definitions; the model searches the web, fetches pages, and calls your code.
---

A tool, to an AI model, is a name, a description, and an input schema. You have been building
exactly those since chapter 1 — every agent carries them, derived from its signature and doc
string. So an agent _is_ a tool, and there is no tool-definition step at all.

## A tool of your own

Models famously miscount letters in words; your bot will not. Replace `src/bot.ktr`:

```katari
@"Tool: count how many times a letter appears in a word. Models guess at this; this counts."
agent count_letters(word: string, letter: string) -> integer {
  array.length(target = string.split(value = word, separator = letter)) - 1
}
```

That is the entire tool. The doc string matters more than usual here: it is what the model
reads when deciding whether — and how — to call the agent.

## What the model will see

Don't take that on faith; look. The prelude's `reflection` module exposes the same derived
metadata the AI loop uses.

```katari
@"See a tool the way the model will: the name, description and input schema that reflection
derives from its signature."
agent inspect() -> unknown {
  let meta = reflection.get_metadata(value = count_letters)
  {
    name = meta.name,
    description = meta.description,
    input_schema = meta.input,
  }
}
```

```sh
katari apply
katari run bot.inspect
```

```json
{
  "name": "bot.count_letters",
  "description": "Tool: count how many times a letter appears in a word. Models guess at this; this counts.",
  "input_schema": {
    "type": "object",
    "properties": {
      "letter": { "type": "string" },
      "word": { "type": "string" }
    },
    "required": ["letter", "word"],
    "additionalProperties": true
  }
}
```

That is, byte for byte, the shape a tool-calling API expects. Tools go by their qualified
`module.name`, so the model calls `bot.count_letters`.

## Two tools from the registry

```sh
katari add tavily web
katari env set TAVILY_API_KEY --secret
```

- `tavily.search` — web search over the Tavily API, returning the top hits as structured results
  (title, URL, content snippet) a program can route and a model can read. It needs a key from
  [tavily.com](https://tavily.com), provided the way the model key was:
  `use tavily.provider(...)`. ([reference](/packages/tavily))
- `web.fetch_page` — HTTP GET as a tool, body bounded to roughly a page so a fetch cannot blow
  the context window. Public pages only; no key, no provider. ([reference](/packages/web))

Both are short, pure-Katari modules — worth reading as examples of tools done well.

## The loop

The complete `src/bot.ktr`:

```katari
import ai
import ai.types
import ai.anthropic
import tavily
import web

// Everything the app anticipates going wrong: a provider step failing, a missing secret,
// a dead stored credential — plus the loop's own throw, two tools sharing a name.
type app_error = ai.step_error | ai.duplicate_tool | env.missing_secret | oauth.server_error

@"Tool: count how many times a letter appears in a word. Models guess at this; this counts."
agent count_letters(word: string, letter: string) -> integer {
  array.length(target = string.split(value = word, separator = letter)) - 1
}

@"See a tool the way the model will: the name, description and input schema that reflection
derives from its signature."
agent inspect() -> unknown {
  let meta = reflection.get_metadata(value = count_letters)
  {
    name = meta.name,
    description = meta.description,
    input_schema = meta.input,
  }
}

@"Run the tool-calling loop: the model may search the web, fetch a page, or count letters
before it commits to an answer."
agent solve(task: string) -> string with io {
  use handler {
    request prelude.throw(error: app_error) -> never {
      break f"error: ${json.stringify(value = error)}"
    }
  }
  use anthropic.provider(
    source = credentials.env(key = "ANTHROPIC_API_KEY"),
    system = "You are a concise assistant. Use the tools when they help; once you have enough to answer, stop calling tools and reply.",
  )
  use tavily.provider(source = credentials.env(key = "TAVILY_API_KEY"))
  ai.infer_with_tools(
    history = [types.turn(role = types.user_role(), text = task)],
    tools = [count_letters, tavily.search, web.fetch_page],
    max_steps = 8,
  )
}
```

`tools` is an array of agents — yours and the packages' side by side, nothing marking them as
special. Per step, `ai.infer_with_tools`:

1. shows the model the conversation plus every tool's derived metadata — the `inspect` output,
   mechanically;
2. if the model answers, returns the answer; if it calls tools, dispatches the whole batch
   concurrently with `parallel for`;
3. validates each call's model-built arguments against that tool's input schema at the
   delegation boundary — the same boundary that rejected `{"name": 42}` in chapter 1;
4. feeds the results back as new turns and goes again, up to `max_steps`.

A model is an unreliable caller, and the loop treats it as one. A hallucinated tool name,
arguments that fail the schema, a tool that crashes, and a tool's own typed `throw` all come
back to the model as results it can read and correct from, so none of them reach `app_error` —
only `ai.duplicate_tool` does, two tools sharing a name being your bug rather than the model's.
When the step budget runs out the loop plays one final tool-less step, so the model answers from
what it gathered instead of researching forever.

## Run it

```sh
katari apply
katari run bot.solve --arg '{"task": "Count the letter r in strawberry."}'
katari run bot.solve --arg '{"task": "What is the latest major version of discord.js? Check the web."}'
```

Watch the second one on the console's run page while it executes: under `solve`, an `infer_step`
per round, and the tool calls fanning out as parallel delegations beneath — the model's
reasoning, rendered as a call tree.

## Three rungs

`ai` exposes the same loop at three heights. Each rung adds one capability, and the tutorial
climbs them in order.

**`ai.infer(history)`** — one model step, no tools, the reply as a string. Chapter 3's rung: a
question in, an answer out.

**`ai.take_turn[E](conversation, tools, max_steps)`** — one whole _turn_ as a value. It runs the
loop you just used and hands back the reply, the advanced conversation, the step's token
measurement, and one event per tool call. A provider failure comes back as a `failed_turn` value
rather than unwinding, so a program that must survive a bad step matches on it and carries on.
`ai.infer_with_tools` is this call keeping only the reply, and re-raising a `failed_turn`'s error as
a throw — which is why chapter 4's `app_error` had to include `ai.step_error`.

**`ai.route[E]()`** — the turn loop with a life of its own. `ai.spawn[E]` hires an AI under a
name, giving it its own conversation, tool set, persona, background watchers and a `deliver_to`
agent where its replies go; `ai.mail` posts a report to one by name; `ai.dismiss` retires one.
Each AI runs as a fiber under the route's nursery, advancing its conversation as reports arrive,
with nobody blocked on a reply. `route[E]` and `spawn[E]` take the effect row your own agents
run under as an explicit type argument — nothing in their arguments determines it.

Chapter 5 is the third rung: one `use ai.route`, one `ai.spawn`, and a Discord channel.

## Next

<DocCards>
  <DocCard href="{docs}/{currentVersion}/tutorial/a-discord-bot" />
  <DocCard href="{docs}/{currentVersion}/guides/mcp" />
</DocCards>

Tools need not be compiled from your source: `mcp.provide` mints agents from any MCP server's
tools at runtime, schemas included, and they flow through this same loop untouched.
