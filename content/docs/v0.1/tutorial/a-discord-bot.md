---
title: A Discord Bot
description: A resident on a channel — a region fiber watches Discord, an observation server advances one conversation, deployed and durable on your runtime.
---

Everything is on the table: a tool-calling loop (chapter 4), and a stateful handler that
answers a stream of requests (chapter 2's `roll_call`). This chapter connects them to a
Discord channel — not as request-and-reply, but as a **resident**: an agent that lives on
the channel, hears events, and decides for itself when to speak. Two pieces are new, and
each is one idea: a **region**, which runs the channel watcher as a detached fiber, and
`ai.serve_observations`, the package-shipped handler that turns the fiber's reports into
model turns.

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

What the package exposes is small: `discord.provider(source = ...)` serves the **bot token**
for the rest of the block — it connects nothing, and each call below resolves the token it
acts with; `discord.watch_messages(channel, deliver_to)` serves a channel forever,
delivering each incoming message to an agent you supply as one `discord.message` value;
`discord.send_message(channel, text, files)` posts
back, returning the posted message's id, and `discord.try_send` is its resilient sibling —
a blank text posts nothing, a transient failure drops just that post, and either ending
comes back as a `send_outcome` value (`delivered` or `dropped`) rather than a silence.
Attachments arrive and depart as first-class `file` values.
([reference](/packages/discord))

## The watcher is a fiber

`watch_messages` never returns — it serves the channel forever. In the old request-reply
shape that was the whole program; in a resident it is one **source** among potentially
many (a second channel, a cron, an RSS poll), so it runs as a detached **fiber** inside a
[region]({docs}/{currentVersion}/concepts/parallelism#regions-fork-without-join). A fiber
carries no result: its task is `-> null`, and everything it produces leaves through its
escalations. This one's whole job is to raise the `ai` package's event request,
`ai.observation`, once per incoming message:

```katari
@"The channel watcher, run as a fiber: serve the channel forever, reporting each
incoming message as an observation. `fork` applies it to the channel id — the
parameter is named `input` because parameter names are part of an agent's type,
and `fork` declares its task as `agent (input: A) -> null`."
agent channel_source(input: string) -> never {
  agent deliver(value: discord.message) -> null {
    ai.observation(
      source = f"discord:${value.channel}",
      content = value.text,
      files = value.files,
      author = discord.author_tag(source = credentials.env(key = "DISCORD_TOKEN"), author = value.author),
    )
  }
  discord.watch_messages(channel = input, deliver_to = deliver)
}
```

The message arrives as one `discord.message` value — the callback's parameter is `value`,
the prelude's primary-argument convention, so the same agent fits any watch — and the
author that leaves the program is not the raw Discord id: `discord.author_tag` folds it
through a keyed HMAC (the bot's own token as the key), so the provider sees a stable
pseudonym, never an account id.

Message arrives → fiber raises `ai.observation` → a stateful handler somewhere above
answers it. Chapter 2's shape exactly — and this time the handler ships with the `ai`
package.

## The observation server

`ai.serve_observations` is `roll_call` grown up: a handler whose `var` carries the
conversation, one `ai.take_turn` per observation, the reply routed through a `deliver_to`
agent you supply. It brings the **resident protocol** with it: a blank reply is silence —
not delivered, so the bot can read a message and honestly say nothing — and a failed model
step is absorbed as an annotation instead of tearing the loop down. The conversation
starts empty on purpose: standing instructions ride the provider's `system` parameter,
which the automatic compaction never touches.

## The whole bot

The complete, final `src/bot.ktr`:

```katari
import ai
import ai.types
import ai.anthropic
import discord
import tavily
import web

@"The channel watcher raised a typed failure — a revoked token, a channel the bot was
removed from. Nothing a fresh watcher would fix, so it stops the bot instead of looping."
data watcher_failed(name: string, detail: string)

// Everything the app anticipates going wrong: a provider step failing, a missing
// secret, a dead stored credential, a Discord failure — plus the app's own two
// throws, two tools sharing a name and a watcher no reconnect can save. A tool that
// fails never reaches here.
type app_error = ai.step_error | ai.duplicate_tool | discord.discord_error | env.missing_secret | oauth.server_error | watcher_failed

@"The region's scope marker: a nullary phantom, one per nursery."
effect bot_scope

// The nursery's fiber ceiling — everything a fiber may RAISE: the observation it
// reports, the bot token it listens with, and io. Throws are excluded on purpose: a
// fiber's uncaught throw never crosses the region as a throw — it is trapped at the
// boundary and delivered as the `failed` event below.
type bot_ceiling = ai.observation | discord.credential | io

@"Tool: count how many times a letter appears in a word. Models guess at this; this counts."
agent count_letters(word: string, letter: string) -> integer {
  array.length(target = string.split(value = word, separator = letter)) - 1
}

@"The channel watcher, run as a fiber: serve the channel forever, reporting each
incoming message as an observation. `fork` applies it to the channel id — the
parameter is named `input` because parameter names are part of an agent's type,
and `fork` declares its task as `agent (input: A) -> null`."
agent channel_source(input: string) -> never {
  agent deliver(value: discord.message) -> null {
    ai.observation(
      source = f"discord:${value.channel}",
      content = value.text,
      files = value.files,
      author = discord.author_tag(source = credentials.env(key = "DISCORD_TOKEN"), author = value.author),
    )
  }
  discord.watch_messages(channel = input, deliver_to = deliver)
}

@"Entry: provide the model, the search key and the bot token; then serve one channel
as a resident until cancelled."
agent main(channel: string) -> string {
  use handler { request panic(msg: string) { break f"failed: ${msg}" } }
  use handler {
    request prelude.throw(error: app_error) -> never {
      break f"error: ${json.stringify(value = error)}"
    }
  }
  use anthropic.provider(
    source = credentials.env(key = "ANTHROPIC_API_KEY"),
    system = "You are a helpful resident of a Discord channel. Reply when a message needs you; reply with empty text to stay silent.",
  )
  use tavily.provider(source = credentials.env(key = "TAVILY_API_KEY"))
  use discord.provider(source = credentials.env(key = "DISCORD_TOKEN"))
  agent deliver_reply(reply: string) -> null {
    // `try_send` answers with its outcome. The server this feeds has nowhere to put one, so
    // the answer is dropped DELIBERATELY — a bot that reports "posted" reads it instead.
    let _outcome = discord.try_send(channel = channel, text = reply)
    null
  }
  agent resident(value: null) -> never with ai.observation | discord.credential | io | prelude.throw[watcher_failed] {
    let nursery: region.nursery[bot_scope, bot_ceiling] = use region.provide[bot_scope, bot_ceiling]
    use handler {
      request region.crashed(id: string, name: string, message: string) {
        // A panic means the watcher's call was interrupted — the runtime restarted under
        // it. A fresh watch opens its own connection, so forking one is the whole recovery.
        let _replacement = region.fork(nursery = nursery, task = channel_source, argument = channel, name = name)
        next null
      }
      request region.failed(id: string, name: string, error: unknown) {
        // An uncaught throw is a failure the program anticipated — a revoked token, a
        // channel the bot was removed from. Re-forking would loop on it: stop loudly.
        prelude.throw(error = watcher_failed(name = name, detail = json.stringify(value = error)))
      }
    }
    let _watcher = region.fork(nursery = nursery, task = channel_source, argument = channel, name = "channel-watcher")
    region.watch(nursery = nursery)
  }
  ai.serve_observations(
    tools = [count_letters, tavily.search, web.fetch_page],
    max_steps = 8,
    deliver_to = deliver_reply,
    continuation = resident,
  )
}
```

Three agents, and you have met every idea in them:

- **`main` is the composition root, and every integration is one `use` line** — the model,
  the search key, the bot token. None of the packages know each other; they meet
  here, and every anticipated failure lands in the two root handlers: the `prelude.throw`
  clause you know, and the `panic` clause for failures no one anticipates typing. The
  serving order matters and says what it means: providers first, `serve_observations`
  inside them (its turns need the model), and the region innermost (its fibers' reports
  need the server).
- **`resident` owns the region.** `use region.provide[bot_scope, bot_ceiling]` opens the
  nursery for the rest of the block; `fork` starts the watcher — named, so the runtime can
  tell you about it — and `region.watch` re-emits the fibers' escalations forever: each
  `ai.observation` wells up here and is answered by the server installed just outside.
  The `region.crashed` and `region.failed` clauses are the region's crash policy as
  ordinary code: the runtime reports a dead fiber as typed data — a panic as `crashed`, an
  uncaught throw as `failed` — and the two get **different** answers. `crashed` forks a
  fresh watcher, because a panic means the watch's call was interrupted and a new call
  simply connects again. `failed` stops the bot, because an uncaught throw is a failure the
  program anticipated typing — a revoked token, a channel the bot was removed from — and no
  number of fresh watchers fixes one. Handling both is not optional politeness: they ride
  `watch`'s row, so `katari check` holds you to it. Note also what is _not_ on
  `bot_ceiling` — the watcher's own `discord_error`. A fiber's uncaught throw never crosses
  the region as a throw; it arrives as `failed`'s `error`, which is why `watcher_failed` is
  this bot's throw and the package's is not.
- **`serve_observations` is the memory and the mouth.** Its handler `var` is the channel's
  conversation — durable run state, like `roll_call`'s counter — advanced one `take_turn`
  per observation, compacted automatically when it outgrows its budget. Non-blank replies
  leave through `deliver_reply`, which posts with `discord.try_send`: a transient send
  failure drops that one post and the resident keeps serving, while a bad token still stops
  it loudly. `try_send` hands back a `send_outcome` — `delivered` or `dropped(reason)` —
  rather than a silence, so a caller that reports on its own send cannot claim "posted" for a
  post the channel never received. This one has nobody to report to, so it drops the outcome
  deliberately, in the one line that says so.

## Deploy and talk

```sh
katari apply
katari run bot.main --arg '{"channel": "123456789012345678"}'
```

Type in the channel. The bot answers; ask it to count letters or to look something up and
the tools fire; say something that needs no answer and — silence, one model step, nothing
posted. `Ctrl-C` detaches your terminal; the run keeps serving without you. On the
console's run page, the delegation tree grows live: the region holding its
`channel-watcher` fiber, and one observation → `infer_step` → tool-dispatch chain per
message.

This run is a run like any other, which is the quiet punchline of the tutorial:

- it appears in `katari ls`, and it ends when you say so — `katari cancel <run-id>`;
- redeploying is `katari apply` and a fresh `katari run` — snapshots are immutable, so a
  new deploy never mutates a serving bot under your feet;
- and it comes back from a **restart of the runtime itself**, mid-thread, with the watcher
  listening again — which is worth taking apart, because its two halves come back by
  different means.

The conversation is the easy half: it lives in `serve_observations`' handler `var`, which is
durable, so the runtime reloads it and the bot picks up mid-thread. The gateway connection is
the interesting half, because it lives in the sidecar's process and is not durable at all — and
it does not have to be, because **nothing in the program points at it**. `discord.provider`
serves the bot token, which is a value; `watch_messages` hands that token to the sidecar, and
the sidecar opens a socket for that one call. FFI execution is at-most-once, so a restart
interrupts the call as a **panic** — and the `region.crashed` clause you already wrote forks a
fresh watch, which resolves the token again and connects again. One clause, no supervision
machinery, nothing to rebuild.

What a restart does cost is real but small: the messages posted while nothing was listening.
Discord backfills nothing onto a fresh session, so a bot that must miss nothing reads the
channel's own history rather than trusting the stream — which `watch_messages` says in its own
docs. That is the whole gap. There is no session to re-establish, no handle to discard and
nothing that has to be forgotten to come back: **the connection is not run state, and this bot
never asked it to be.** The rule that makes it so — a durable program holds only durable
values, so an FFI call takes the remote name and the credential — is in
[FFI Sidecars]({docs}/{currentVersion}/guides/ffi-sidecars#what-may-cross-the-boundary), with
`e2b` as its worked example.

The redeploy above is the genuinely different case, and worth being honest about: a fresh
`katari run` is a new run, and a new run's `var` starts empty. A resident whose memory must
outlive its own run holds the conversation in the
[store]({docs}/{currentVersion}/guides/store) rather than in a handler `var` — a real design
step from here, not a line you can add to the listing above.

## The closing act: from one resident to many

Nothing in this architecture is one-of-anything by necessity. Fork a second source and the
bot hears two channels; fork a `time.watch` fiber and it hears the clock (`ai.watch_prompt`
packages that); `region.roster` lists what is running and `region.cancel_by_id` stops one
by id — which is all a "stop that watch" _tool_ needs, so the model can manage the bot's
own fibers. And once several **agents** share the bus, the observation server generalizes
to a dispatcher: one sequential handler holding a `record` of conversations keyed by
addressee, every event carrying whose turn it is, agent-to-agent mail as a micro-fiber
whose whole body is one perform — queued behind the current turn by the region itself.

That system exists, and the next thing to read is the small version of it:
[**concierge**](https://github.com/katari-lang/examples/tree/main/concierge) — two agents on
one bus, where a public _face_ answers the community while its owner curates what it may know
from a private channel, and the face's **tool set is its privacy boundary** (no tool it holds
can write a note, so nothing it says can come from anywhere but what was published). One
region, two desks, mail as a micro-fiber: every idea in it is one you now know. Read it as the
sixth chapter, alongside its
[three siblings](https://github.com/katari-lang/examples) — a release monitor with no model at
all, a Slack standup bot whose digest a human approves, and a Gmail-to-calendar butler that
writes nothing without a click.

From here:

- widen the bot's reach with [MCP]({docs}/{currentVersion}/guides/mcp) — hand it every
  tool of any MCP server without writing code — or let it receive the outside world's
  pushes with [Webhooks]({docs}/{currentVersion}/guides/webhooks) and
  [Scheduled Jobs]({docs}/{currentVersion}/guides/scheduled-jobs);
- read the ideas you have been using at full depth, starting with
  [Parallelism]({docs}/{currentVersion}/concepts/parallelism) — the region's full story —
  and [Durable Execution]({docs}/{currentVersion}/concepts/durable-execution);
- or tour what else ships in the box: the [CLI]({docs}/{currentVersion}/toolchain/cli),
  the [runtime and console]({docs}/{currentVersion}/toolchain/runtime), and the
  [editor tooling]({docs}/{currentVersion}/toolchain/editor).
