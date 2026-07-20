---
title: Giving the Model Tools
description: Reflection turns your agents into tool definitions; the model searches the web, fetches pages, and calls your code.
---

A tool, to an AI model, is a name, a description, and an input schema. You have been
building exactly those since chapter 1 — every agent carries them, derived from its
signature and doc string. So in Katari there is no tool-definition step at all: **an
agent is a tool**, and this chapter hands the model three of them — one you write, two
from packages.

## A tool of your own

Models famously miscount letters in words; your bot will not. Replace `src/bot.ktr`:

```katari
@"Tool: count how many times a letter appears in a word. Models guess at this; this counts."
agent count_letters(word: string, letter: string) -> integer {
  array.length(target = string.split(value = word, separator = letter)) - 1
}
```

That is the entire tool. The doc string matters more than usual: it is what the model
reads when deciding whether — and how — to call the agent.

## What the model will see

Don't take that on faith; look. The prelude's `reflection` module exposes the same
derived metadata the AI loop uses. The complete `src/bot.ktr` so far:

```katari
@"Tool: count how many times a letter appears in a word. Models guess at this; this counts."
agent count_letters(word: string, letter: string) -> integer {
  array.length(target = string.split(value = word, separator = letter)) - 1
}

@"See a tool the way the model will: the name, description and input schema that
reflection derives from its signature."
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

The result, formatted:

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

This is, byte for byte, the shape a tool-calling API expects. Note the name: tools go by
their qualified `module.name`, so the model calls `bot.count_letters`.

## Two tools from the registry

```sh
katari add tavily web
```

- `tavily.search` — web search over the Tavily API, returning the top hits as a compact
  digest (title, URL, snippet) sized to feed straight back to a model. It needs an API
  key from [tavily.com](https://tavily.com), provided the way the model key was:
  `use tavily.provider(...)`. ([reference](/packages/tavily))
- `web.fetch_page` — HTTP GET as a tool, body truncated to roughly a page so a fetch
  cannot blow the context window. Public pages only; no key, no provider.
  ([reference](/packages/web))

Both are short, pure-Katari modules — worth reading as examples of tools done well.

```sh
katari env set TAVILY_API_KEY --secret
```

## The loop

Now wire all three into `ai.infer_with_tools`. The complete `src/bot.ktr`:

```katari
import ai
import ai.types
import ai.anthropic
import tavily
import web

// Everything the app anticipates going wrong: a provider step failing, a bad dynamic
// tool dispatch, or a missing secret.
type app_error = ai.step_error | ai.loop_error | env.missing_secret

@"Tool: count how many times a letter appears in a word. Models guess at this; this counts."
agent count_letters(word: string, letter: string) -> integer {
  array.length(target = string.split(value = word, separator = letter)) - 1
}

@"See a tool the way the model will: the name, description and input schema that
reflection derives from its signature."
agent inspect() -> unknown {
  let meta = reflection.get_metadata(value = count_letters)
  {
    name = meta.name,
    description = meta.description,
    input_schema = meta.input,
  }
}

@"Run the tool-calling loop: the model may search the web, fetch a page, or count
letters before it commits to an answer."
agent solve(task: string) -> string with io {
  use handler {
    request prelude.throw(error: app_error) -> never {
      break f"error: ${json.stringify(value = error)}"
    }
  }
  use anthropic.provider(
    api_key = env.get_secret(key = "ANTHROPIC_API_KEY"),
    system = "You are a concise assistant. Use the tools when they help; once you have enough to answer, stop calling tools and reply.",
  )
  use tavily.provider(api_key = env.get_secret(key = "TAVILY_API_KEY"))
  ai.infer_with_tools(
    history = [types.turn(role = "user", text = task, files = [])],
    tools = [count_letters, tavily.search, web.fetch_page],
    max_steps = 8,
  )
}
```

The `tools` argument is just an array of agents — yours and the packages' side by side,
nothing marking them as special. Per step, `ai.infer_with_tools`:

1. shows the model the conversation plus every tool's derived metadata — the `inspect`
   output, mechanically;
2. if the model answers, returns the answer; if it calls tools, dispatches the whole
   batch **concurrently** with `parallel for`;
3. validates each call's model-built arguments against that tool's input schema at the
   delegation boundary — the same boundary that rejected `{"name": 42}` in chapter 1;
4. feeds the results back as new turns and goes again, up to `max_steps`.

A model is an unreliable caller, and the loop treats it as one: a hallucinated tool name,
arguments that fail the schema, or a tool that crashes all come back to the model as
error results it can read and correct on its next step — none of them can kill the
conversation. And when the step budget runs out, the loop forces one final tool-less
step, so the model must answer from what it has gathered instead of researching forever.
The new `ai.loop_error` in `app_error` covers the loop's own dynamic-dispatch failures.

## Run it

```sh
katari apply
katari run bot.solve --arg '{"task": "Count the letter r in strawberry."}'
katari run bot.solve --arg '{"task": "What is the latest major version of discord.js? Check the web."}'
```

Watch the second one on the console's run page while it executes: under `solve`, an
`infer_step` per round, and the tool calls fanning out as parallel delegations beneath —
the model's reasoning, rendered as a call tree.

## Where you are

The model now reaches for your code when it needs facts. Everything about the loop is
provider-agnostic and tool-agnostic — which is why the last chapter is short: Discord
becomes one more `use` line, and this loop becomes the body of a message handler —
[A Discord Bot]({docs}/{currentVersion}/tutorial/a-discord-bot).

One pointer before you go: tools need not be compiled from your source. `mcp.provide`
mints agents from any MCP server's tools at runtime, schemas included, and they flow
through this same loop untouched — see [MCP]({docs}/{currentVersion}/guides/mcp).
