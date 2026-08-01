---
title: A Second AI
description: A researcher beside the resident — one more ai.spawn, one tool that mails it the question, and the channel keeps answering while the search runs.
---

Someone asks chapter 5's bot to look something up. `tavily.search` and two page fetches take a
minute, and for that minute the resident is inside one turn: a conversation is a sequence, so
every other message in the channel waits behind an errand nobody else cares about.

A minute-long errand belongs to somebody else. This chapter hires a second AI to run it.

## Two AIs, one channel

Nothing about the route is one-of-anything. A second `ai.spawn` gives the program a second AI —
its own conversation, its own tools, its own persona — running as its own fiber under the same
nursery.

```katari
let _researcher = ai.spawn[bot_effects](
  name = "researcher",
  tools = [tavily.search, web.fetch_page],
  max_steps = 12,
  persona = researcher_persona,
  deliver_to = speak,
)
```

The researcher has no `sources`: nothing external pushes to it, and its only correspondent is
the resident. Its `deliver_to` is `speak` — the same agent the resident speaks through — so its
findings arrive in the channel directly rather than travelling back through the resident.

The resident's own tool list loses the web tools it no longer needs, and gains one that reaches
the researcher.

## The tool that hands work over

A model delegates by calling a tool, and `ai.mail` is what a tool posts with.

```katari
@"Tool: hand a question to the researcher, who answers later in this channel. Returns as soon
as the question is posted, so say that you have asked and carry on. Write the question so it
stands alone: the researcher shares none of this conversation."
agent ask_researcher(@"The question, in full." question: string) -> string with ai.mail | ai.inbound_provenance {
  // `hop` is the count the sender stamped, so the errand carries one more than the message behind it.
  let whence = ai.inbound_provenance()
  match (ai.mail(to = "researcher", source = f"mail:${whence.origin}", content = question, hop = whence.hop + 1)) {
    case ai.posted(_) -> "The researcher has it; their findings will arrive in the channel."
    case ai.no_recipient(to => missing) -> f"Nobody answers to \"${missing}\" right now, so the question went nowhere."
  }
}
```

Three things in it are the whole pattern.

**It returns immediately, and what it returns is a sentence for the model rather than the
answer.** `ai.mail` posts the report and hands back an outcome; the resident's turn ends, and
the channel is live again. There is no synchronous ask between AIs — a question is a send, and
the answer is a later send.

**The question stands alone, and the doc string says so where the model will read it.** The
researcher has its own conversation and shares none of the resident's. That is what a second AI
means.

**Provenance is read, not guessed.** `ai.inbound_provenance()` answers with the `origin` and
`hop` of the report this turn is serving, so the tool labels its mail with who it came from and
stamps `hop + 1`. A message from a person enters at `hop = 0` — the watcher writes it — and the
count grows by one at each relay, so a program that wants to damp a long exchange reads it. It
is a field rather than a parsed prefix, so a rendering change never becomes a routing change.

## When an AI ends

The route forgets an AI that ended and re-raises the event outward, so the two death handlers
sit above `use ai.route` and read truthfully about which AI is gone. This program answers by
stopping: with two AIs and one channel, either ending leaves the channel half-served, and the
run's result says which one it was.

```katari
use handler {
  request region.crashed(id: string, name: string, message: string) {
    break f"stopped: ${name} was interrupted (${message})"
  }
  request region.failed(id: string, name: string, error: unknown) {
    break f"stopped: ${name} ended on ${json.stringify(value = error)}"
  }
}
```

A program that would rather re-hire puts that handler inside the route's extent — below the
`use ai.route` line, where a `spawn` reaches the route — because a restart goes at the altitude
of what died. `crashed` names a dead fiber whose region is alive; above the route is outside the
region, and that altitude's business is the region's own death.

## The whole bot

The complete `src/bot.ktr`:

```katari
import ai
import ai.anthropic
import discord
import tavily
import web

// The row the AIs' tools and watchers run under — the one type argument the route takes.
type bot_effects =
  discord.credential | tavily.credential
  | io | prelude.throw[discord.discord_error | env.missing_secret | oauth.server_error]

// Required; empty when unset — `main` refuses a blank value.
agent channel() {
  string.trim(value = env.get_or(key = "CHANNEL", fallback = ""))
}

agent resident_persona() -> string {
  "You are a helpful resident of a Discord channel. Answer from what you know; for anything that needs the web, call ask_researcher and carry on without waiting. Reply with empty text to stay silent."
}

agent researcher_persona() -> string {
  "You research one question at a time for this channel's resident. Search, read, and reply with a short answer and the sources behind it. Nobody is waiting on you in real time, so be thorough."
}

@"Tool: count how many times a letter appears in a word. Models guess at this; this counts."
agent count_letters(word: string, letter: string) -> integer {
  array.length(target = string.split(value = word, separator = letter)) - 1
}

@"Tool: hand a question to the researcher, who answers later in this channel. Returns as soon
as the question is posted, so say that you have asked and carry on. Write the question so it
stands alone: the researcher shares none of this conversation."
agent ask_researcher(@"The question, in full." question: string) -> string with ai.mail | ai.inbound_provenance {
  // `hop` is the count the sender stamped, so the errand carries one more than the message behind it.
  let whence = ai.inbound_provenance()
  match (ai.mail(to = "researcher", source = f"mail:${whence.origin}", content = question, hop = whence.hop + 1)) {
    case ai.posted(_) -> "The researcher has it; their findings will arrive in the channel."
    case ai.no_recipient(to => missing) -> f"Nobody answers to \"${missing}\" right now, so the question went nowhere."
  }
}

// Where both AIs speak: bounded to Discord's limit, a transient failure drops one post.
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

@"Entry: two AIs on one channel — a resident that answers, and a researcher it hands errands to."
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
  // The route forgets an AI that ended and re-raises the event here. Either AI ending leaves the
  // channel half-served, so both stop the run with the reason.
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
    tools = [count_letters, ask_researcher],
    max_steps = 8,
    persona = resident_persona,
    deliver_to = speak,
    sources = [watcher],
  )
  let _researcher = ai.spawn[bot_effects](
    name = "researcher",
    tools = [tavily.search, web.fetch_page],
    max_steps = 12,
    persona = researcher_persona,
    deliver_to = speak,
  )
  region.watch(nursery = root)
}
```

```sh
katari apply
katari run bot.main
```

Ask the channel something that needs the web. The resident says it has handed the question over
and goes on answering; a minute later the researcher's findings arrive as a second message. Ask
it to count letters in between and it answers at once.

## Adding the third

Everything above was the mechanism, and the recurring cost is short: one more `ai.spawn` with
its own persona and tools, plus whatever mails it — a tool, if a model decides; a `sources`
entry, if the outside world does. Nothing else in the program changes. The AIs address each
other by name through the route, so a new one re-opens no ordering question for the existing
ones, and that is the property that makes a third and a fourth cheap.

## Where you are

Six chapters, one file, and two AIs sharing a channel. From here the same shape carries a
program of any size: `concierge` is this bot grown into a membrane, where a public face answers
a community from published notes and a private curator is the only thing that may write them.

<DocCards>
  <DocCard href="{docs}/{currentVersion}/guides/residents" />
  <DocCard href="{docs}/{currentVersion}/examples" />
</DocCards>
