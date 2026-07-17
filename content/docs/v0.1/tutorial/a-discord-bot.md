---
title: A Discord Bot
description: Connect the tool loop to a channel — conversation history as handler state, deployed and durable on your runtime.
---

Everything is on the table: a tool-calling loop (chapter 4), and a stateful handler that
answers a stream of requests (chapter 2's `roll_call`). This chapter connects them to a
Discord channel. The bot serves the channel until you cancel it: every incoming message
runs the loop over the conversation so far, and the reply is posted back.

## A bot token

In the [Discord Developer Portal](https://discord.com/developers/applications), create an
application, add a **Bot**, and copy its token. Two settings matter:

- On the Bot page, enable the **MESSAGE CONTENT intent**. The gateway client requests the
  `Guilds`, `GuildMessages` and `MessageContent` intents, and only the last is privileged.
- Invite the bot to your server with permission to read and send messages in the channel
  you want it to serve.

You will also need the channel's id: enable Developer Mode in your Discord client's
advanced settings, then right-click the channel and **Copy Channel ID**.

Store the token like every other credential in this tutorial:

```sh
katari env set DISCORD_TOKEN --secret
```

## Add the `discord` package

```sh
katari add discord
(cd .katari/packages/discord-* && npm install)
```

The second line is new. Unlike `ai`, `tavily` and `web` — pure Katari over the prelude's
`http` — the `discord` package carries an FFI **sidecar**: a
[discord.js](https://discord.js.org) gateway client in TypeScript, implementing the
package's `external` agents. `katari apply` bundles every dependency's sidecar into the
snapshot automatically; the `npm install`, run once inside the fetched package, gives the
bundler the sidecar's own dependencies. (How sidecars work:
[FFI Sidecars]({docs}/{currentVersion}/guides/ffi-sidecars).)

What the package exposes is small: `discord.provider(token = ...)` logs in once and
serves the connection for the rest of the block; `discord.watch_messages(channel_id,
deliver_to)` serves a channel forever, delivering each incoming message to an agent you
supply; `discord.send_message(channel_id, text, files)` posts back. Attachments arrive
and depart as first-class `file` values. ([reference](/reference/discord))

## The bridge request

`watch_messages` delivers each message to a plain agent. But the bot needs _state_ across
messages — the conversation history — and state, you know from chapter 2, lives in a
handler. So the app declares one request of its own, and the delivered agent's only job
is to raise it:

```katari
@"Raised once per incoming channel message; `serve`'s handler owns it, so the handler's
var can carry the conversation history across messages."
request on_message(channel_id: string, text: string, files: array[file]) -> null
```

Message arrives → agent raises `on_message` → the stateful handler answers it and rolls
the history forward. Chapter 2's `roll_call`, with Discord doing the asking.

## The whole bot

The complete, final `src/bot.ktr`:

```katari
import ai
import ai.types
import ai.anthropic
import discord
import tavily
import web

// Everything the app anticipates going wrong: a provider step failing, a bad dynamic
// tool dispatch, or a missing secret.
type app_error = ai.step_error | ai.loop_error | env.missing_secret

@"Tool: count how many times a letter appears in a word. Models guess at this; this counts."
agent count_letters(word: string, letter: string) -> integer {
  array.length(target = string.split(value = word, separator = letter)) - 1
}

@"Raised once per incoming channel message; `serve`'s handler owns it, so the handler's
var can carry the conversation history across messages."
request on_message(channel_id: string, text: string, files: array[file]) -> null

@"Entry: provide the model, the tools' keys and the Discord connection, then serve one
channel forever."
agent main(channel_id: string) -> string {
  use handler { request panic(msg: string) { break f"failed: ${msg}" } }
  use handler {
    request prelude.throw(error: app_error) -> never {
      break f"error: ${json.to_text(value = error)}"
    }
  }
  use anthropic.provider(
    api_key = env.get_secret(key = "ANTHROPIC_API_KEY"),
    system = "You are a helpful assistant in a Discord channel. Use the tools when they help; once you have enough to answer, stop calling tools and reply.",
  )
  use tavily.provider(api_key = env.get_secret(key = "TAVILY_API_KEY"))
  use discord.provider(token = env.get_secret(key = "DISCORD_TOKEN"))
  serve(channel_id = channel_id, tools = [count_letters, tavily.search, web.fetch_page])
}

@"Serve one channel until cancelled: each incoming message runs the tool loop over the
conversation so far (kept as handler state), and the reply is posted back."
agent serve[effect E](channel_id: string, tools: array[agent never -> unknown with E]) -> never {
  use handler (var history: array[types.message] = []) {
    request on_message(channel_id: string, text: string, files: array[file]) {
      let asked = array.append(target = history, value = types.turn(role = "user", text = text, files = files))
      let answer = ai.infer_with_tools[E](history = asked, tools = tools, max_steps = 8)
      discord.send_message(channel_id = channel_id, text = answer, files = [])
      next null with { history = array.append(target = asked, value = types.turn(role = "model", text = answer, files = [])) }
    }
  }
  // The watch's deliver_to: bridge each delivered message into the on_message request the
  // handler above owns. Nested because `serve` is its only caller.
  agent deliver(channel_id: string, text: string, files: array[file]) -> null with on_message {
    on_message(channel_id = channel_id, text = text, files = files)
  }
  discord.watch_messages(channel_id = channel_id, deliver_to = deliver)
}
```

Two agents, and you have met every idea in them:

- **`main` is the composition root, and every integration is one `use` line** — the
  model, the search key, the gateway connection. None of the packages know each other;
  they meet here, and their failures land in the two root handlers. The
  `prelude.throw` clause you know; the `panic` clause is its counterpart for failures
  no one anticipates typing — a crashed sidecar process, a division by zero. A panic
  cannot be raised from Katari, but it can be caught on the way out, and at the root of
  a long-running bot you want that: a readable string result instead of a failed run.
- **`serve` is `roll_call` grown up.** The handler's `var history` is the channel's
  memory: each `on_message` appends the user turn, runs the loop — the same
  `ai.infer_with_tools`, generic over the tools' effects `E` — posts the answer, and
  rolls the history forward with `next null with { history = ... }`. The nested
  `deliver` agent is the bridge from the previous section, and
  `discord.watch_messages` feeds it forever — its return type is `never`. One built-in
  courtesy: the bot's own posts are not delivered back to it, so replying cannot loop.

## Deploy and talk

```sh
katari apply
katari run bot.main --arg '{"channel_id": "123456789012345678"}'
```

Type in the channel. The bot answers; ask it to count letters or to look something up
and the tools fire. `Ctrl-C` detaches your terminal — the run keeps serving without you.
On the console's run page, the delegation tree grows live: the gateway watch, and under
it one `on_message` → `infer_step` → tool-dispatch chain per message.

This run is a run like any other, which is the quiet punchline of the tutorial:

- it appears in `katari ls`, and it ends when you say so — `katari cancel <run-id>`;
- its history is run state, so it survives a runtime restart: bring the runtime down and
  up mid-conversation, and the watch reattaches with the channel's memory intact;
- redeploying is `katari apply` and a fresh `katari run` — snapshots are immutable, so a
  new deploy never mutates a serving bot under your feet.

## Where you go from here

You built a project whose agents an AI model calls through their compiled schemas, wired
a model and a gateway in with one `use` line each, kept conversation state as a typed
value, and deployed the whole thing as a durable run. From here:

- widen the bot's reach with [MCP]({docs}/{currentVersion}/guides/mcp) — hand it every
  tool of any MCP server without writing code — or let it receive the outside world's
  pushes with [Webhooks]({docs}/{currentVersion}/guides/webhooks) and
  [Scheduled Jobs]({docs}/{currentVersion}/guides/scheduled-jobs);
- read the ideas you have been using at full depth, starting with
  [Agents and Delegation]({docs}/{currentVersion}/concepts/agents-and-delegation) and
  [Durable Execution]({docs}/{currentVersion}/concepts/durable-execution);
- or tour what else ships in the box: the [CLI]({docs}/{currentVersion}/toolchain/cli),
  the [runtime and console]({docs}/{currentVersion}/toolchain/runtime), and the
  [editor tooling]({docs}/{currentVersion}/toolchain/editor).
