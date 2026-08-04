---
title: Residents
description: A resident is an AI nothing is waiting on — the route gives it a name, a mailbox, and the fibers that feed it.
---

`ai.route` opens one nursery and one address table; `ai.spawn` puts one AI into it. Each AI runs as
a fiber with its own conversation, and the program's tail is `region.watch(nursery = root)`, where
every AI's escalations arrive. The [concierge](https://github.com/katari-lang/examples/tree/main/concierge)
example is that shape at two AIs: a public face that answers from published notes, and a private
curator that is the only thing allowed to write them.

```katari
// The row this program's agents run under, and the type argument the route adds its own requests to.
type concierge_effects =
  discord.credential
  | store.get | store.set | store.delete | store.list | store.exclusive
  | io | prelude.throw[discord.discord_error | env.missing_secret | oauth.server_error]

agent serve() -> string {
  use handler {
    request prelude.throw(error: app_error) -> never { break f"stopped: ${json.stringify(value = error)}" }
  }
  use handler { request panic(msg: string) { break f"stopped on a defect: ${msg}" } }
  use discord.provider(source = credentials.env(key = "DISCORD_TOKEN"))
  use store.workspace(path = "concierge")
  use anthropic.provider(source = credentials.env(key = "ANTHROPIC_API_KEY"))
  use ai.with_context(inject = memory.index_note)
  use ai.with_breaker(on_transition = announce_outage)
  use handler {
    request region.crashed(id: string, name: string, message: string) { lost_ai(which = name, cause = message) }
    request region.failed(id: string, name: string, error: unknown) { lost_ai(which = name, cause = json.stringify(value = error)) }
  }
  let root = use ai.route[concierge_effects]()
  let _face = ai.spawn[concierge_effects](
    name = "face", max_steps = 16, persona = face_persona,
    tools = [memory.recall, memory.search, memory.list_memories, flag_unknown],
    deliver_to = face_reply, sources = [public_watcher],
  )
  let _curator = ai.spawn[concierge_effects](
    name = "curator", max_steps = 16, persona = curator_persona,
    tools = [memory.recall, memory.search, memory.remember, memory.forget],
    deliver_to = operator_note, sources = [control_watcher],
  )
  region.watch(nursery = root)
}
```

## What the route owns

The nursery the AIs live in; the table of who is addressable; one delivery fiber per `ai.mail`; one
cancellation per `ai.dismiss`; and the eviction of an AI the moment it dies. Under it runs one
`ai.resident` fiber per AI — its own conversation, its own mailbox, optionally its own store
workspace.

The route is a provider and does not watch for you, because what an AI's escalations mean is the
program's business. `ai.route[E]()` and `ai.spawn[E](...)` take that row as an explicit type
argument: nothing infers `E` from the arguments, so it is always written out.

An AI becomes addressable when its `register` handshake is served, and escalations are held durably
until a watch is up, so the first report to an AI comes from something running after
`region.watch(nursery = root)`: a source, a tool, or one of your own handlers.

## One line per AI

Everything handed to a `spawn` travels into a fiber the caller does not own, so `tools`, `persona`,
`deliver_to` and `sources` are named top-level agents over plain data. A named agent captures
nothing; a closure would carry the calling fiber's environment with it.

A persona is an agent rather than a string because it is re-derived at every model step, so nothing
is persisted into the conversation for compaction to eat, and a note that depends on the hour or on
a cell another AI just wrote can perform whatever it needs:

```katari
agent face_persona() -> string {
  "You are the concierge of this community's public Discord channel. Everything you know lives in the published notes: recall(key) reads one, search(pattern) finds one. Answer only from the notes; when they do not cover the question, say so plainly and call flag_unknown. Reply with empty text to stay silent."
}
```

A tool set is data — an array of agents — so the difference between the two AIs above is which array
each one got. `deliver_to` is where a turn's non-empty reply goes; `null` is an AI that speaks only
through its tools. An empty reply is not delivered and nothing asks again, so a quiet watcher tick
costs one model step.

## Sources

Each `sources` entry is forked at the register handshake with `self` set to the AI's name, under the
fiber name `<ai>/source/<n>` in the order listed — so a `crashed` says which watcher died. One entry
is one fiber and one death; subscriptions that must share a fate go inside one entry with `parallel`.

```katari
// The face's own watcher: `ai.spawn` forks it with `self` = "face" once that AI is addressable.
// No supervision here — the watch replays a restart's interruption itself, so what can end this
// fiber is a typed `discord_error` no reconnect heals.
agent public_watcher(self: string) -> null {
  discord.watch_messages(channel = public_channel(), deliver_to = agent (value: discord.message) {
    let _posted = ai.mail(
      to = self,
      source = "public-channel",
      content = f"[from \"${value.display_name}\"] ${value.text}",
      hop = 0,
      files = value.files,
    )
    null
  })
}
```

## Mail and hop

`ai.mail` looks the addressee up and forks a delivery fiber into its mailbox, where the report
becomes one more turn of that conversation. It answers `posted()` or `no_recipient(to)` — a name is
data, so a stale addressee is anticipated input rather than a failure.

```katari
@"Tool: flag a question the published notes cannot answer. The flag is mailed to the curator, who may
publish a note so you can answer next time."
agent flag_unknown(@"The question you could not answer, in the asker's words." question: string) -> string with ai.mail | ai.inbound_provenance {
  let whence = ai.inbound_provenance()
  match (ai.mail(
    to = "curator",
    source = f"mail:${whence.origin}",
    content = f"A member asked something the notes do not cover: \"${question}\"",
    hop = whence.hop + 1,
  )) {
    case ai.posted(_) -> "The curator has it. Tell the asker plainly that you do not know."
    case ai.no_recipient(to => missing) -> f"Nobody answers to \"${missing}\" right now."
  }
}
```

`hop` counts the agent-to-agent relays a report has already made: `0` for a person or a clock,
`ai.inbound_provenance().hop + 1` in a tool that relays what it was told. It has no default, being a
fact about the message rather than about the sender, and a program that damps replies reads it. The
same call names the sender, so a tool reads provenance as values instead of parsing the turn.

## Middlewares wrap the route

An AI is a fiber, and a fiber runs under the region's
[`watch`]({docs}/{currentVersion}/concepts/parallelism) — so what covers every AI is what wraps that
watch. In the listing above the provider, `ai.with_context` and `ai.with_breaker` are all installed
before `use ai.route`, and every AI's model step therefore passes through all three: the breaker
decides whether to call, the context injection derives the notes index fresh, the provider calls.

Nothing at that seam serializes across AIs — each of those middlewares is a parallel handler. What
is ordered is one AI's own turns, a conversation being a sequence, and the route's own clauses,
which share one table.

## A restart goes at the altitude of what died

A `crashed` names a dead fiber whose region is alive, so a re-hire stands inside the route's extent:
below the `use` line, where `root` is in scope and a `spawn` still reaches the route. Above that line
is outside the region, and that altitude's business is the region's own death — the notice, the
stop, the `supervise` replay around the whole session.

```katari
agent serve() -> string {
  use anthropic.provider(source = credentials.env(key = "ANTHROPIC_API_KEY"))
  // Above the route: the region's own death is this altitude's business.
  use handler {
    request region.crashed(id: string, name: string, message: string) {
      notify(line = f"(fiber ${name} was interrupted: ${message})")
      next null
    }
    request region.failed(id: string, name: string, error: unknown) {
      break f"stopped: ${name} ended on ${json.stringify(value = error)}"
    }
  }
  let root = use ai.route[app_effects]()
  // Inside the route's extent: `root` is in scope and a `spawn` still reaches the route.
  use handler {
    request region.crashed(id: string, name: string, message: string) {
      // Outward first, so the route forgets the dead AI and the notice above happens.
      region.crashed(id = id, name = name, message = message)
      if (name == "core") {
        let _rehired = ai.spawn[app_effects](name = "core", tools = [consult_owner], max_steps = 8, persona = helper_persona, deliver_to = say)
        next null
      } else {
        next null
      }
    }
    request open_gate(question: string, answer_to: string) {
      let _fiber = region.fork(nursery = root, task = gate, argument = { question = question, answer_to = answer_to }, name = "gate")
      next null
    }
  }
  let _core = ai.spawn[app_effects](name = "core", max_steps = 8, tools = [consult_owner], persona = helper_persona, deliver_to = say)
  region.watch(nursery = root)
}
```

A fresh hire is a fresh conversation: a resident's history lives in its fiber, so nothing of the
last hour comes back with it. The concierge draws the line the other way and stops the run, because
losing its face also loses the channel watcher that belonged to it.

## Gates

The second clause above is a gate: a tool that wants a person's answer forks a fiber and returns at
once, so the turn ends and the AI stays free. The fiber asks, waits as long as it takes, and mails
the answer back as one more report.

```katari
@"Open a gate: fork a fiber that asks the owner and mails the answer back."
request open_gate(question: string, answer_to: string) -> null

@"Tool: put a question to the owner. It answers at once — the owner's reply arrives later as a message."
agent consult_owner(@"The question, in the owner's language." question: string) -> string with open_gate {
  open_gate(question = question, answer_to = "core")
  "asked — the answer will arrive as a message"
}

// A named top-level agent over plain data, so the fork carries no environment with it.
agent gate(question: string, answer_to: string) -> null with ask_owner | ai.mail {
  let verdict = ask_owner(question = question)
  let _posted = ai.mail(to = answer_to, source = "gate", content = f"You asked: ${question} — the owner said: ${verdict}", hop = 1)
  null
}
```

`ask_owner` is whatever way this program reaches a person — an unhandled request that escalates to
the run root, or `discord.ask` on a control channel. [Asking a
human]({docs}/{currentVersion}/guides/asking-a-human) covers the choice and the shapes an answer can
take.

## Where to go next

<DocCards>
  <DocCard href="{docs}/{currentVersion}/concepts/parallelism" />
  <DocCard href="{docs}/{currentVersion}/guides/handler-geometry" />
  <DocCard href="{docs}/{currentVersion}/guides/asking-a-human" />
  <DocCard href="{docs}/{currentVersion}/guides/store" />
</DocCards>
