---
title: A Discord Bot
description: One AI living on a Discord channel — a watcher mails it every message, its replies go back to the channel, and the whole thing is one durable run.
---

Chapter 4's loop answers one question and returns. An AI that lives somewhere does not return:
it hears what is said, and decides for itself whether to speak. `ai.route` is what gives an AI
that life, and this chapter opens a route with a single AI under it.

## A bot token

In the [Discord Developer Portal](https://discord.com/developers/applications), create an
application, add a **Bot**, and copy its token. On the Bot page, enable the **MESSAGE CONTENT
intent** — the gateway client requests `Guilds`, `GuildMessages` and `MessageContent`, and only
the last is privileged. Then invite the bot to your server with permission to read and send
messages in the channel it will serve. For the channel's id, turn on Developer Mode in your
Discord client's advanced settings and **Copy Channel ID** from its context menu.

```sh
katari env set DISCORD_TOKEN --secret
katari env set CHANNEL <channel id>
```

## Add the `discord` package

```sh
katari add discord
(cd .katari/packages/discord-* && npm install)
```

The second line is new. Unlike `ai`, `tavily` and `web`, the `discord` package carries an FFI
**sidecar**: a [discord.js](https://discord.js.org) gateway client in TypeScript implementing
the package's `external` agents. `katari apply` bundles every dependency's sidecar into the
snapshot automatically; the `npm install`, run once inside the fetched package, gives the
bundler the sidecar's own dependencies
([FFI Sidecars]({docs}/{currentVersion}/guides/ffi-sidecars)).

Four calls carry this chapter ([reference](/packages/discord)):

- `discord.provider(source = ...)` serves the bot token for the rest of the block. It connects
  to nothing; each call below resolves the token it acts with.
- `discord.watch_messages(channel, deliver_to)` serves a channel forever, handing each incoming
  message to your agent as one `discord.message`. The bot's own posts are never delivered, so
  replying cannot loop.
- `discord.try_send(channel, text)` posts back: a blank text posts nothing, a transient failure
  drops just that post, and either ending comes back as an outcome value.
- `discord.limits()` gives Discord's own numbers as data.

## What the AI listens to

A `sources` entry is a background watcher belonging to one AI. The route forks it once that AI
is addressable, passing `self` — the AI's name — so the watcher can mail it what it sees.

```katari
agent watcher(self: string) -> null {
  use supervise.forever()
  use supervise.signal_panics[never]()
  discord.watch_messages(channel = channel(), deliver_to = agent (value: discord.message) {
    let _posted = ai.mail(
      to = self,
      source = "channel",
      content = f"[from \"${value.display_name}\"] ${value.text}",
      hop = 0,
      files = value.files,
    )
    null
  })
}
```

Each message becomes one `ai.mail`, and therefore one turn of that AI's conversation. `hop = 0`
says a person caused it; the count exists so a report relayed between AIs can be damped, and
chapter 6 stamps one.

The two `supervise` lines are the watcher's own restart; the last section of this chapter takes
them apart. `forever` rather than `exponential`, because `exponential`'s budget is a lifetime
count that never resets, and a watch meant to outlive every deploy would die on its fifth
restart.

## The whole bot

`use ai.route[E]()` opens the nursery the AIs live in and serves `ai.spawn` / `ai.mail` /
`ai.dismiss` for the rest of the block; `region.watch(nursery = root)` is the program's tail,
running until the run is cancelled. Each AI and each of its sources is a fiber running under
that watch. One `ai.spawn` says everything about one AI: who it is
(`persona`, an agent, so the note is recomputed at every step rather than persisted into the
conversation), what it can do (`tools`), what it listens to (`sources`), where it speaks
(`deliver_to`). `E` is the row your own agents run under, spelled explicitly because nothing in
the arguments determines it. The complete `src/bot.ktr`:

```katari
import ai
import ai.anthropic
import discord
import tavily
import web

// The row the resident's tools and watcher run under — the one type argument the route takes.
type bot_effects =
  discord.credential | tavily.credential
  | io | prelude.throw[discord.discord_error | env.missing_secret | oauth.server_error]

// Required; empty when unset — `main` refuses a blank value.
agent channel() {
  string.trim(value = env.get_or(key = "CHANNEL", fallback = ""))
}

agent persona() -> string {
  "You are a helpful resident of a Discord channel. Reply when a message needs you; reply with empty text to stay silent."
}

@"Tool: count how many times a letter appears in a word. Models guess at this; this counts."
agent count_letters(word: string, letter: string) -> integer {
  array.length(target = string.split(value = word, separator = letter)) - 1
}

// Where the resident speaks: bounded to Discord's limit, a transient failure drops one post.
agent speak(reply: string) {
  let bounded = string.fit(value = reply, cap = discord.limits().message_text, marker = " …(cut)")
  let _outcome = discord.try_send(channel = channel(), text = bounded)
  null
}

// The resident's watcher: the route forks it once the AI is addressable, and it supervises itself —
// a runtime restart interrupts the watch, and a fresh one opens on the token alone.
agent watcher(self: string) -> null {
  use supervise.forever()
  use supervise.signal_panics[never]()
  discord.watch_messages(channel = channel(), deliver_to = agent (value: discord.message) {
    let _posted = ai.mail(
      to = self,
      source = "channel",
      content = f"[from \"${value.display_name}\"] ${value.text}",
      hop = 0,
      files = value.files,
    )
    null
  })
}

@"Entry: one AI resident on one channel, served until cancelled."
agent main() -> string {
  let id = channel()
  if (id == "") {
    return "refused to start: CHANNEL is not set — `katari env set CHANNEL <channel id>`."
  } else {
    null
  }
  use handler {
    request prelude.throw(error: ai.duplicate_tool | discord.discord_error | env.missing_secret | oauth.server_error) -> never {
      break f"stopped: ${json.stringify(value = error)}"
    }
  }
  use handler { request panic(msg: string) { break f"stopped on an interrupted call or a defect: ${msg}" } }
  use discord.provider(source = credentials.env(key = "DISCORD_TOKEN"))
  use tavily.provider(source = credentials.env(key = "TAVILY_API_KEY"))
  use anthropic.provider(source = credentials.env(key = "ANTHROPIC_API_KEY"))
  // One AI: either ending means the bot cannot speak, so both stop the run with the reason.
  use handler {
    request region.crashed(id: string, name: string, message: string) {
      break f"stopped: ${name} was interrupted (${message})"
    }
    request region.failed(id: string, name: string, error: unknown) {
      break f"stopped: ${name} ended on ${json.stringify(value = error)}"
    }
  }
  let root = use ai.route[bot_effects]()
  let _resident = ai.spawn[bot_effects](
    name = "resident",
    tools = [count_letters, tavily.search, web.fetch_page],
    max_steps = 8,
    persona = persona,
    deliver_to = speak,
    sources = [watcher],
  )
  region.watch(nursery = root)
}
```

`main` is the composition root, and every integration in it is one `use` line. The order is not
taste: a handler serves what is performed inside its extent, so the providers enclose the route
whose AIs call them, and the death handlers stand above the route that re-raises those events.
That rule is the subject of
[Handler geometry]({docs}/{currentVersion}/guides/handler-geometry).

## Deploy and talk

```sh
katari apply
katari run bot.main
```

Type in the channel. The bot answers; ask it to count letters or look something up and the tools
fire; say something that needs no answer and it stays quiet — an empty reply is silence, neither
delivered nor asked again, so a message that needs nothing costs one model step. `Ctrl-C`
detaches your terminal and the run keeps serving. On the console's run page the tree grows live:
the route's nursery, the `resident` fiber beside its `resident/source/0` watcher, and one
mail → `infer_step` → tool-dispatch chain per message.

This is a run like any other. It appears in `katari ls` and ends when you say so
(`katari cancel <run-id>`), and redeploying is `katari apply` plus a fresh `katari run` — where
snapshots being immutable means a new deploy never mutates a serving bot under your feet.

## What a restart means

The conversation is durable run state. It lives in the resident fiber the runtime reloads, so a
restart of the runtime itself picks the thread up mid-sentence.

The gateway connection is not durable, and it does not need to be, because nothing in the
program points at it. `discord.provider` serves the bot token, which is a value;
`watch_messages` hands that token to the sidecar, which opens a socket for that one call. A
restart interrupts the call; `signal_panics` turns that into a supervision signal and `forever`
opens a fresh watch, which resolves the token again and connects again. The rule behind it — a
durable program holds durable values, so an FFI call takes the remote name and the credential —
is in [FFI Sidecars]({docs}/{currentVersion}/guides/ffi-sidecars).

What that costs is the messages posted while nothing was listening; Discord backfills nothing
onto a fresh session. A bot that must miss none reads them back with `discord.list_messages`,
keeping the `id` of the last message it handled as the cursor. And a fresh `katari run` is a new
run, so the resident starts with an empty conversation: an AI whose memory must outlive its own
run keeps notes in the [store]({docs}/{currentVersion}/guides/store) and reads them through
tools.

## Next

One AI answers one thing at a time. Chapter 6 puts a second one beside it, so a minute-long
errand no longer holds the channel.

<DocCards>
  <DocCard href="{docs}/{currentVersion}/tutorial/a-second-agent" />
  <DocCard href="{docs}/{currentVersion}/guides/residents" />
  <DocCard href="{docs}/{currentVersion}/guides/handler-geometry" />
  <DocCard href="{docs}/{currentVersion}/concepts/parallelism" />
</DocCards>
