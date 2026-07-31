---
title: A Second Agent
description: Growing chapter 5's bot into two. A desk is a request plus a sequential handler; mail between desks is a fiber whose whole body is one perform — which is what keeps two agents from waiting on each other.
---

[Chapter 5]({docs}/{currentVersion}/tutorial/a-discord-bot) leaves you a resident: a nursery, a fiber
watching a Discord channel, and one conversation answering what it hears. The want that arrives next
is usually concrete. Someone asks the bot to research something; `tavily.search` and two page fetches
take a minute; and for that minute **the channel is dead** — every other message queues behind a turn
nobody else is waiting for.

That is not a tuning problem. It is one lane. This chapter puts a second agent beside the bot, and the
whole of it is two ideas:

> **A desk is one request plus one sequential handler** — a serialization domain, with its own state
> and its own FIFO.
>
> **Mail between desks is a fiber whose whole body is one perform** — never a direct call.

## Your bot already has a desk

`use ai.serve_observations(...)` is one. Behind it is a handler with a `var`, serving one request,
advancing one conversation per arrival — you just never had to look at it:

```katari
// What `serve_observations` is, in the shape you will write from here on.
use handler (var face: ai.desk = ai.new_desk()) {
  request ai.observation(source: string, content: string, files: array[file], author: string | null) {
    let advanced = ai.advance_desk(state = face, arrival = ai.arrival(source = source, content = content, hop = 0, files = files, author = author), tools = tools, persona = ai.no_persona, deliver_to = deliver_to)
    next null with { face = advanced.state }
  }
}
```

It serves **exactly one** conversation, and the package is blunt about the boundary:

> FOR MORE THAN ONE CONVERSATION, GO TO THE DESK API. This serves exactly one: a program that grows a
> second addressee — a public-facing character beside a private one, a table of workers — cannot
> express it here, because there is one var and one tool set.

The reason is worth understanding rather than accepting, because it is the chapter's first idea in
disguise. `ai.observation` is **one request**. Two `serve_observations` clauses would both be serving
it, the inner one shadows the outer, and the second conversation would never hear anything. Telling
two desks apart means telling their arrivals apart, and the only thing that tells arrivals apart is
**which request they arrive on**.

So the second agent starts by giving the first one a request of its own:

```katari
@"The face's inbox: everything the channel says, and everything the researcher reports back."
request face_message(source: string, content: string, files: array[file], author: string | null, hop: integer ?= 0) -> null

@"The researcher's inbox: one question, handed over by the face."
request research_request(question: string, hop: integer) -> null
```

The watcher fiber now performs `face_message` where it performed `ai.observation`, and everything else
about chapter 5's bot — the providers, the supervision, the region — stays exactly as it was.

## A desk is a request plus a sequential handler

Each request gets its own **sequential** handler: one with `var` state.

A sequential handler serves its requests at a FIFO, in arrival order, so its `var` is an actor's
state: no two turns of the same desk ever overlap, and nothing else can write it. That is the whole
serialization story, and it is **per desk, not global** — `region.watch` re-emits every fiber's
escalation concurrently and imposes no ordering of its own, so a slow turn at the researcher's desk
never stalls the face. Extra `watch` calls buy nothing; **the desks are told apart by their handlers,
not by more watches.**

The corollary is a rule to apply before writing any code: **one desk per thing that must not
interleave with itself.** A conversation, a worker, a per-user inbox. If two streams may safely run at
once, they want two desks — not one desk with a bigger record. A minute-long search and a one-line
"thanks!" are exactly two such streams, which is why the researcher is a desk and not a tool that
blocks.

`use parallel handler` is exactly the wrong tool here, and the compiler says so
([K3025]({docs}/{currentVersion}/toolchain/error-codes)): a parallel handler dispatches its bodies
concurrently, so two overlapping turns would each advance the conversation from the same value and one
write would silently vanish.

## Mail is a fiber, not a call

The researcher has to answer. The obvious spelling is a direct perform from its `deliver_to`:

```katari
// THE TRAP — this compiles.
deliver_to = agent (reply: string) -> null {
  face_message(source = "researcher", content = reply, files = [], author = null, hop = hop + 1)
},
```

It compiles, and that is the trap. What it does is visible in one place — the escalation report at the
end of `katari check`:

```text
  bot.main
    escalates: bot.face_message, io
```

`main` used to escalate nothing but `io`. Now every reply the researcher produces travels **past** the
face desk and out of the program, where the runtime parks the run and waits for a human to answer it.
The bot did not break; it quietly grew a question.

Spell the composition root's row — `agent main(channel: string) -> string with io` — and the same
mistake is a compile error instead, with a diagnostic that names the real problem:

```text
bot:44:1 K3001: The actual effect performs `bot.face_message`, which the expected effect does not
allow. Either name that request in the expected `with` row, or serve it here with a `use handler`
clause.
  Note: `bot.face_message` is served by the handler installed at line 80, but a handler body's
  performs escalate from its own install site and reach only handlers installed ABOVE it — move that
  handler earlier, or this perform later.
  expected: io
  actual:   face_message | io
```

That is the argument for annotating a composition root, and it is worth doing on day one.

A handler body's own performs escalate from **the handler's install site** — see
[Handler geometry]({docs}/{currentVersion}/guides/handler-geometry) — so a desk can reach only desks
installed above it. Two desks that answer each other need each to be above the other, which is not a
thing. And even where the geometry happens to work, a direct perform is still wrong: the face would be
holding its own FIFO while synchronously running a turn inside the researcher's, which is the freeze
this chapter set out to remove.

The fix is to stop performing and start **posting**:

```katari
deliver_to = agent (reply: string) -> null {
  region.post(
    nursery = nursery,
    task = agent () -> null { face_message(source = "researcher", content = reply, files = [], author = null, hop = hop + 1) },
    name = "researcher->face",
  )
  null
},
```

`region.post` forks a fiber whose whole body is that one perform. Three consequences, and they are the
reason this shape exists:

- **It leaves the current turn.** The perform now happens in a fiber, so its escalation joins the
  region's mailbox and surfaces at `region.watch` — **below every desk**, which is why it can reach
  any of them regardless of install order. Mail is order-free; a direct perform is not.
- **It queues behind the current turn.** A mid-turn send cannot re-enter its own sequential desk,
  because the fiber's escalation lands in the mailbox and the desk is still busy with the turn that
  sent it. No deadlock, and FIFO ordering for free.
- **It does not widen the sender's row.** `post`'s own effect is `Scope | io`; the desk request lives
  in the _task's_ row, not the caller's. So sending mail to a desk costs the sender nothing in its
  signature — which is exactly why the geometry stops mattering.

The nursery is the message queue, and it is durable: escalations survive a restart and drain in
arrival order. There is no new machinery here at all — `region.post` is the `fork` you already used
for the watcher, specialised to a task that takes no argument.

There is **no synchronous ask between agents.** A question is a send; the answer is a later send back.
If you want a reply, mail one.

## The tool that hands work over

The face needs a way to decide to delegate, and a model decides by calling a tool. This one is minted
inside the desk's clause, because it closes over the nursery:

```katari
@"Tool: hand a question to the researcher and MOVE ON. It answers later, in the channel;
this returns the moment the question is posted, so the chat never waits on a search."
agent ask_researcher(@"The question, self-contained — the researcher shares no context with you." question: string) -> string {
  // The fiber runs LATER, so anything about "now" is read now and carried in: the
  // provenance of the turn that called this tool is not a fact the fiber could ask for.
  let asking = ai.inbound_provenance()
  region.post(
    nursery = nursery,
    task = agent () -> null { research_request(question = question, hop = asking.hop + 1) },
    name = "face->researcher",
  )
  "Handed to the researcher. Their findings will arrive as a message; say so and carry on."
}
```

Three things in it are the whole delegation pattern:

- **It returns immediately**, and what it returns is a sentence for the model, not the answer. The
  face's turn ends; the channel stays live.
- **The question is self-contained**, and the docstring says so where the model will read it. The
  researcher has its own conversation and shares no context with the face — that is what "second
  agent" means.
- **`ai.inbound_provenance()` is read before the post, not inside it.** The fiber runs later, so a
  fact about the current turn has to be carried in. Try it inside the task and the checker stops you:
  the fiber's ceiling has no `inbound_provenance` in it.

## The whole bot

Chapter 5's `src/bot.ktr`, with a second agent on it. `katari check` accepts it as written:

```katari
import ai
import ai.anthropic
import discord
import tavily
import web

@"The channel watcher raised a typed failure — a revoked token, a channel the bot was
removed from. Nothing a fresh watcher would fix, so it stops the bot instead of looping."
data watcher_failed(name: string, detail: string)

type app_error = ai.step_error | ai.duplicate_tool | discord.discord_error | env.missing_secret | oauth.server_error | watcher_failed

@"The region's scope marker: a nullary phantom, one per nursery."
effect bot_scope

@"The face's inbox: everything the channel says, and everything the researcher reports back."
request face_message(source: string, content: string, files: array[file], author: string | null, hop: integer ?= 0) -> null

@"The researcher's inbox: one question, handed over by the face."
request research_request(question: string, hop: integer) -> null

// What a fiber may RAISE — now BOTH desks, because a fiber may address either.
type bot_ceiling = face_message | research_request | discord.credential | io

@"Tool: count how many times a letter appears in a word. Models guess at this; this counts."
agent count_letters(word: string, letter: string) -> integer {
  array.length(target = string.split(value = word, separator = letter)) - 1
}

@"The channel watcher, run as a fiber — and it SUPERVISES ITSELF."
agent channel_source(input: string) -> never with bot_ceiling | prelude.throw[discord.discord_error | env.missing_secret | oauth.server_error] {
  use supervise.forever(initial_delay_milliseconds = 1000.0, factor = 2.0, max_delay_milliseconds = 900000.0)
  use supervise.signal_panics[never]()
  discord.watch_messages(channel = input, deliver_to = agent (value: discord.message) -> null {
    face_message(
      source = f"discord:${value.channel}",
      content = value.text,
      files = value.files,
      author = discord.author_tag(source = credentials.env(key = "DISCORD_TOKEN"), author = value.author),
    )
  })
}

@"Entry: the chapter-5 bot with a second agent beside it."
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
  let nursery: region.nursery[bot_scope, bot_ceiling] = use region.provide[bot_scope, bot_ceiling]

  // DESK TWO — THE RESEARCHER. Its own conversation, its own lane: a search that takes a
  // minute happens HERE, and the face keeps answering the channel while it does.
  use handler (var scholar: ai.desk = ai.new_desk()) {
    request research_request(question: string, hop: integer) {
      let advanced = ai.advance_desk(
        state = scholar,
        arrival = ai.arrival(source = "face", content = question, hop = hop),
        tools = [tavily.search, web.fetch_page],
        persona = ai.no_persona,
        // The findings LEAVE as mail — the face is a different lane, not a return value.
        deliver_to = agent (reply: string) -> null {
          region.post(
            nursery = nursery,
            task = agent () -> null { face_message(source = "researcher", content = reply, files = [], author = null, hop = hop + 1) },
            name = "researcher->face",
          )
          null
        },
      )
      next null with { scholar = advanced.state }
    }
  }

  // DESK ONE — THE FACE. This is `ai.serve_observations` with the packaging taken off:
  // one request of your own, one var, one `advance_desk` per arrival.
  use handler (var face: ai.desk = ai.new_desk()) {
    request face_message(source: string, content: string, files: array[file], author: string | null, hop: integer) {
      @"Tool: hand a question to the researcher and MOVE ON. It answers later, in the channel;
this returns the moment the question is posted, so the chat never waits on a search."
      agent ask_researcher(@"The question, self-contained — the researcher shares no context with you." question: string) -> string {
        // The fiber runs LATER, so anything about "now" is read now and carried in: the
        // provenance of the turn that called this tool is not a fact the fiber could ask for.
        let asking = ai.inbound_provenance()
        region.post(
          nursery = nursery,
          task = agent () -> null { research_request(question = question, hop = asking.hop + 1) },
          name = "face->researcher",
        )
        "Handed to the researcher. Their findings will arrive as a message; say so and carry on."
      }
      let advanced = ai.advance_desk(
        state = face,
        arrival = ai.arrival(source = source, content = content, hop = hop, files = files, author = author),
        tools = [count_letters, ask_researcher],
        persona = ai.no_persona,
        deliver_to = agent (reply: string) -> null {
          let _outcome = discord.try_send(channel = channel, text = reply)
          null
        },
      )
      next null with { face = advanced.state }
    }
  }

  use handler {
    request region.crashed(id: string, name: string, message: string) { next null }
    request region.failed(id: string, name: string, error: unknown) {
      prelude.throw(error = watcher_failed(name = name, detail = json.stringify(value = error)))
    }
  }
  let _watcher = region.fork(nursery = nursery, task = channel_source, argument = channel, name = "channel-watcher")
  region.watch(nursery = nursery)
}
```

Read the install order as one rule — _if handler A's body performs request R, then R's handler must be
above A_ — and it explains every line of it:

| Position (outermost first)                  | Why there                                                                                       |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| The two root handlers                       | Where an anticipated throw and an unanticipated panic end the run.                              |
| The providers                               | A desk's turn performs `ai.infer_step`; a fiber performs `discord.credential`. Both must enclose everything below. |
| `use region.provide[…]`                     | Everything below it may hold the nursery handle — including the desks, which is what lets them post. |
| **The desks**, in either order              | They reach each other only as mail, so nothing orders them relative to each other.              |
| `region.crashed` / `region.failed`          | Below the desks, so its body may address them directly.                                         |
| `region.fork(…)`, then `region.watch(…)`    | The source, and the one pump that re-emits every fiber's escalation.                            |

"**The desks, in either order**" is the payoff. In a program where agents call each other directly,
every new agent re-opens the ordering question for every existing one. Here mail absorbs it, and that
is the property that makes a third and a fourth agent cheap.

## Hops, and not talking to yourself

Two agents that can mail each other can mail each other **forever**. Nothing in the mechanism stops a
polite exchange from becoming an infinite one, and when the desks are model turns, each round trip
costs real money.

The damping is one field, carried on the bus and defaulted at the edge:

```katari
request face_message(source: string, content: string, files: array[file], author: string | null, hop: integer ?= 0) -> null
```

A message from the channel arrives at `hop = 0` — the default does that, so the watcher never thinks
about it. Every desk that mails onward stamps `hop + 1`, and a desk that wants a ceiling refuses to
mail onward past it.

Three properties are worth having on purpose. **The hop is a field, not a parsed prefix** — the moment
a display string becomes load-bearing, a rendering change becomes a routing bug. **The ceiling is per
desk**, so the desk that answers may still answer while the desk that initiates stops initiating.
And **exceeding the ceiling is not an error** — the message still lands, it just does not bounce
again; a conversation that runs out of hops should go quiet, not throw.

## Reading the escalation report

`katari check` ends with a report that is the fastest way to see what a new desk actually did to your
program:

```text
OK — 30 module(s), no errors
Entry points (requests that escalate to the run root):
  bot.channel_source
    escalates: bot.face_message, bot.research_request, discord.credential, prelude.throw[…], io
  bot.main
    escalates: (nothing but io)
```

Read it as **"what would reach a human"**. Two lines, two different questions:

- **`bot.main` — `(nothing but io)`.** The bot is closed. Every desk request raised anywhere inside it
  is served inside it, so nothing escalates and no human is ever asked about the bus. This is the line
  to check after adding a desk — it is what caught the direct perform above.
- **`bot.channel_source` — both desk requests.** That is the fiber's **ceiling**: the set of things
  this source is permitted to put on the bus. A fiber is not an entry point you run, but the report
  lists it as one, and reading it as a capability is the right instinct — this watcher may address
  either desk, because the ceiling is declared once for the whole nursery.

## Adding the third agent

Everything above was the mechanism. The recurring cost, once it is in place, is short:

1. Add its request, and add that request to `bot_ceiling`.
2. Add its `use handler (var …)` clause, anywhere among the desks.
3. Give whoever mails it a `region.post` — a tool, if a model decides; a line in another desk's body,
   if the program does.
4. **Check that `bot.main` still escalates nothing but `io`.** If it grew, you added a desk and forgot
   its desk.

There is deliberately no registry of desks, no dispatcher and no addressee enum in that list. A desk's
request _is_ its address, and `check` already knows every one of them.

## When the desks come and go

`ai` also has **`ai.desk_table`** — `record[ai.desk]` behind `ai.advance_in_table`, which looks a key
up, runs that key's desk, and writes it back. It is worth knowing exactly when it replaces the shape
above, because the answer is not "when you have more than one desk".

**A table is storage, not concurrency.** `advance_in_table` takes a table value and returns a new one;
where it runs is decided by its call site, and its call site is one handler holding one `var`. So a
table is **N conversations on one lane** — a slow turn for one key delays every other key. It is worth
saying plainly, because "a table of desks" sounds like the opposite.

That is not an oversight in the package. What serializes in Katari is a sequential handler, and a
handler is lexical, so **the number of lanes is the number of handlers you wrote**. The face and the
researcher are two lanes because two `use handler` clauses are on the page. Keys minted at run time
cannot mint handlers, so they share one. The concurrency in this chapter is entirely in the fibers,
and desks are deliberately the part that is not concurrent.

**So a face and a researcher are two `var`s, not a two-row table.** They are two names the program was
written around, and folding them into a keyed collection would trade away the thing this chapter is
about — two lanes that do not wait on each other.

The table earns its keep where keys are **minted while the program runs**: one desk per worker
admitted by name, one per customer conversation. There the arithmetic decides it — a desk costs a
request, a handler and a ceiling entry, and you cannot write three declarations per worker when the
workers arrive at run time. One request carrying a key, one handler, and a table makes adding an agent
**a row instead of an edit**.

That form comes with one rule you would otherwise write yourself. A name is reusable — dismiss
`scribe`, admit `scribe` again for a different errand — and the second scribe must inherit neither the
first one's conversation nor its still-in-flight mail. So the roster mints a higher **generation** at
each admit, every arrival carries the one it was dispatched under, and an arrival older than the
table's is dropped as `stale`. See the [`ai` reference](/packages/ai) for `advance_in_table` and
`forget_desk`.

A program that has both is normal: fixed desks as their own `var`s, and one table beside them for the
population that changes. The lane a table shares is usually fine for the reason a real one gives — a
worker computes only when it is mailed, so two keys wanting the same instant is rare. When it is not
fine, nothing new is needed either: the dispatch clause `region.post`s the turn as a fiber and takes
the finished desk back on one more request, keeping a per-key busy flag in its `var` so one key still
never runs twice at once. That is a per-key scheduler out of the pieces this chapter already used, and
the reason it is not the default is that every fiber that can crash mid-turn is a flag somebody has to
clear.

## Where you are

That is the tutorial: six chapters, one bot, and a rule for putting a second agent beside it. Every
agent after this one is another desk and another `post`, not another ordering problem.

- [**The example programs**]({docs}/{currentVersion}/examples) — four complete residents you can
  clone and run, and the one this chapter points at is
  [**concierge**](https://github.com/katari-lang/examples/tree/main/concierge): two desks that are
  two Discord channels, where this bot has two roles. It also shows the wrapper a production desk
  adds and this chapter left out — a turn must not re-run (`deliver_to` may already have posted), so
  the `advance_desk` call goes inside `supervise.once` with `supervise.signal_panics[never]`, and an
  interrupted turn costs that one message instead of the whole conversation.
- [Handler geometry]({docs}/{currentVersion}/guides/handler-geometry) — the install-site rule this
  page leans on, and how to read a stack of handlers.
- [Parallelism]({docs}/{currentVersion}/concepts/parallelism#regions-fork-without-join) — regions,
  fibers, and why `watch` is transparent.
- [Asking a human]({docs}/{currentVersion}/guides/asking-a-human) — the other thing a desk must never
  block on. A question is a fiber too.
- [Error codes]({docs}/{currentVersion}/toolchain/error-codes) — K3001's geometry note, K3025, and
  the rest of what a misplaced handler looks like.
