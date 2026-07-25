---
title: Asking a human
description: A chat surface has two planes — a stream of messages, and one blocking question. `ask` takes its controls as data and returns the answer as data, so approval, free text, draft editing and choice are one call with four control lists.
---

The `discord` and `slack` packages present the same channel twice, along two independent paths:

- The **message plane** — a stream. `watch_messages(channel, deliver_to)` serves a channel forever,
  delivering each incoming post as one `message` value, and `send_message` / `try_send` post back.
- The **interaction plane** — a question and its answer. One agent, `ask`: post a prompt with
  **controls** in front of it and block until someone completes one of them.

```katari
data message(channel: string, author: string, text: string, files: array[file])
// Slack's `message` carries one extra field, `thread`; see "Twins, and where they diverge".

type control = button | select | form
type answer = clicked | chose | submitted

agent ask(
  channel: string,
  prompt: string,
  controls: array[control],
) -> answer with connection | io | prelude.throw[discord_error]
```

That split is the whole reason a question is safe to ask in the middle of some other work.

## Why an interaction is not a message

A channel's messages have exactly one consumer: whatever agent you handed to `watch_messages`, which
is already routing every post to a desk. A second reader — a tool that "waits for the next thing the
human says" — would be racing that source for the same events, and which of the two saw the reply
would be a coin flip. This is why neither package ships a "read the next message" primitive: it could
not be composed with the source that is already running.

An **interaction is not a message**. A press or a submit arrives over the platform's interaction path,
correlated back to the prompt this call posted, so it can never be swallowed by the desk and never
steals a post from it. The two planes do not contend, which is what makes "the agent stops mid-task,
asks a human, and continues on the answer" a shape you can write at all.

## One call, four shapes

Approval, free-form text, editing a draft and picking from a list are **not** four agents. They are
`ask` with different data in `controls`:

| shape           | controls                                                  | answer                      |
| --------------- | --------------------------------------------------------- | --------------------------- |
| approval        | two `button`s                                             | `clicked(id, by)`           |
| free-form text  | a one-field `form`                                        | `submitted(id, values, by)` |
| draft editing   | a `form` prefilled with the draft, beside a deny `button` | `submitted` / `clicked`     |
| multiple choice | a `select` over a computed list                           | `chose(id, option, by)`     |

Both sums are plain data:

```katari
data button(id: string, label: string)
data select(id: string, label: string, options: array[string])
data field(id: string, label: string, value: string ?= "", multiline: boolean ?= false)
data form(id: string, label: string, title: string, fields: array[field])

data clicked(id: string, by: string)
data chose(id: string, option: string, by: string)
data submitted(id: string, values: record[string], by: string)
```

Every example below spells `discord`; the Slack twin is the same program with `slack.` in its place.

### Approval

```katari
@"Publish only if the operator presses approve."
agent publish_gated(channel: string, draft: string) -> string {
  match (discord.ask(
    channel = channel,
    prompt = f"Publish this to the public feed?\n\n${draft}",
    controls = [
      discord.button(id = "approve", label = "approve"),
      discord.button(id = "deny", label = "deny"),
    ],
  )) {
    case discord.clicked(id => "approve", by => _) -> publish(text = draft)
    case rest -> "(not published)"
  }
}
```

The literal `id => "approve"` **is** the branch. It turns on the key the program wrote, not on the
label a human reads — relabel the button, translate it into another language, and the branch still
holds. `case rest` takes everything else: the deny, and any control you later add beside it.

### Free-form text

Free text is a form with nothing prefilled, not a second mechanism:

```katari
@"Ask the operator one question; null when they skipped or submitted an empty box."
agent consult(channel: string, question: string) -> string | null {
  match (discord.ask(
    channel = channel,
    prompt = f"A question for you: ${question}",
    controls = [
      discord.form(id = "reply", label = "answer", title = "your answer", fields = [
        discord.field(id = "answer", label = "answer", multiline = true),
      ]),
      discord.button(id = "skip", label = "skip"),
    ],
  )) {
    case discord.submitted(id => _, values => values, by => _) -> {
      match (record.get(target = values, key = "answer")) {
        case null -> null
        case text -> if (string.is_blank(value = text)) { null } else { text }
      }
    }
    case rest -> null
  }
}
```

A `form` is two platform steps — a button in the channel that opens a dialog — because text input
exists only inside a dialog, and a dialog only opens in reply to a click. **Opening a dialog and
closing it again answers nothing**: the question stays open, and any control (this form again, or a
sibling) can still answer it, so a curious press cannot consume the ask.

### Editing a draft

This is the shape worth reaching for, and the one that changes how a gated action is written. Ship
the proposal as the form's **prefill**, and what comes back is not a yes about a draft — it is the
draft, as the human sent it:

```katari
@"Send the mail the operator submits — which may not be the mail that was proposed."
agent send_gated(channel: string, subject: string, body: string) -> string {
  match (discord.ask(
    channel = channel,
    prompt = "Send this mail? Edit it here and submit, or deny.",
    controls = [
      discord.form(id = "send", label = "edit & send", title = "mail draft", fields = [
        discord.field(id = "subject", label = "subject", value = subject),
        discord.field(id = "body", label = "body", value = body, multiline = true),
      ]),
      discord.button(id = "deny", label = "deny"),
    ],
  )) {
    case discord.submitted(id => _, values => values, by => _) -> send(values = values)
    case rest -> "(declined)"
  }
}
```

`send` acts on `values` — the exact text the human read and submitted. Nothing regenerates it in
between: the model that proposed the draft is not consulted again between the click and the deed, so
the two cannot drift apart. "Approved" means **approved at these values**, and the values are in hand.

Worth stating negatively, because the alternative is what a gate does by default: show a summary, take
a yes, then rebuild the payload. Every rebuild between the yes and the act is a chance for the
acted-on text to differ from the read-on text. A prefilled form removes the chance instead of
narrowing it.

### Multiple choice

```katari
match (discord.ask(
  channel = channel,
  prompt = "Which ticket should I pick up?",
  controls = [discord.select(id = "pick", label = "choose one", options = open_tickets)],
)) {
  case discord.chose(id => _, option => option, by => _) -> assign(ticket = option)
  case rest -> "(nothing chosen)"
}
```

Reach for `select` when the options are **data the program computed** — the open tickets, the matching
files. A _fixed_ set of choices is clearer as one `button` each, because then every branch has an id
the program named rather than a string it has to compare.

## What `ask` deliberately leaves out

`ask` carries no time limit, no retry and no persistence of its own. Each is a composition, and that
is the point: an expiry baked in would make every caller handle a timeout it never asked for.

**A deadline is `time.with_deadline` around it.** The loser's arm is cancelled, the controls come off
the message, and `(expired)` is left in their place:

```katari
agent ask_in_time(value: null) -> discord.answer {
  discord.ask(channel = channel, prompt = question, controls = controls)
}

match (time.with_deadline(milliseconds = 1800000, task = ask_in_time)) {
  case time.completed(value => answer) -> read(answer = answer)
  case time.deadline_passed() ->
    "(no answer within 30 minutes; the question was withdrawn and its buttons are dead)"
}
```

**A withdrawal is `region.cancel_by_id`** on the fiber holding the ask — the shape a model-facing
"cancel that request" tool takes, since fiber ids are data a model can carry and a stale one comes
back as `region.unknown_fiber` rather than a panic.

**A question that must outlive the runtime is not an `ask` at all.** `ask` rides one external call, so
a restart while it is open interrupts it and the posted controls go stale. When the question must
survive that, leave a request of your own **unserved** and let it park at the run root: an
[escalation]({docs}/{currentVersion}/concepts/escalation) is a durable database row, answerable from
the admin console or `katari answer` minutes or days later. You trade the channel's controls for a
schema-derived form in the console, and gain a question that survives a deploy.

## Two ways to wait

### Block inside the turn

The tool performs the ask and returns the answer, so the model continues on it. Reach for this when
the turn genuinely cannot proceed without a decision only a human can make.

**The tool deadline is the trap.** `ai.take_turn` races every tool call against
`tool_budget_milliseconds`, and a human is far slower than any budget worth setting for a machine
call. A blocking ask must be named in `unbounded_tool_names`, or it is cancelled long before anyone
reads it:

```katari
// `consult_operator` BLOCKS on a human by design, so it is exempt from the 60s tool deadline. The
// name is DERIVED from the tool's own metadata, so a rename cannot silently un-exempt it.
let unbounded_tools = [reflection.get_metadata(value = consult_operator).name]
ai.take_turn[E](
  conversation = conversation,
  tools = tools,
  max_steps = 16,
  tool_budget_milliseconds = 60000,
  unbounded_tool_names = unbounded_tools,
)
```

The doctrine behind the exemption: a deadline bounds **machine** latency. A pending question is posted
where people can see it and the waiting run is visible in the admin console, so it is not a hang — it
is a wait somebody can answer or cancel.

What blocks is the desk that ran the turn, and only that desk.
[`region.watch`]({docs}/{currentVersion}/concepts/parallelism) re-emits every fiber's escalation
concurrently, so the only serialization point is the receiving handler: other desks keep serving while
one operator reads a dialog. Even so, a blocking ask holds a conversation — which is exactly why the
deadline belongs to the caller, who knows what waiting costs it, and not to `ask`.

### Fork a fiber

When the turn should end at once and the answer only decides an action, put the whole
question-and-consequence in a **fiber**. The tool performs a spawn request and returns a "carry on"
note; the ask happens later, and the fiber's body reads the answer and does the deed.

The app declares its own two requests, and the one place that owns a nursery serves them:

```katari
@"Ask the operator one question and BLOCK until they complete one of @controls@ — the seam every
human decision goes through, so no tool has to know a channel."
request ask_operator(prompt: string, controls: array[discord.control]) -> discord.answer

// What a gate fiber may do: ask, then act. (Type synonyms take no docs.)
type gate_ceiling = ask_operator | io | prelude.throw[discord.discord_error]

@"FORK a gate: run @task@ — one crossing's whole question-and-consequence — as a fiber, and answer
the caller AT ONCE, so the requesting turn ends without waiting."
request spawn_gate(name: string, task: agent (input: null) -> null with gate_ceiling) -> string

@"The session region's scope marker — one nullary phantom per nursery, per `region`'s rule."
effect session_scope

agent session(channel: string) -> never with region.crashed | io | prelude.throw[discord.discord_error | env.missing_secret | oauth.server_error] {
  use discord.provider(source = credentials.env(key = "DISCORD_TOKEN"))
  // THE ASK ADAPTER: the one place a human question becomes Discord. PARALLEL, and load-bearing —
  // several gates wait on their own questions at once, and a sequential clause would queue them, so
  // one unread dialog would freeze every other gate.
  use parallel handler {
    request ask_operator(prompt: string, controls: array[discord.control]) {
      next discord.ask(channel = channel, prompt = prompt, controls = controls)
    }
  }
  let nursery = use region.provide[session_scope, gate_ceiling]
  use handler {
    request spawn_gate(name: string, task: agent (input: null) -> null with gate_ceiling) {
      let handle = region.fork(nursery = nursery, task = task, argument = null, name = name)
      next f"(asked the operator — ${region.fiber_id(handle = handle)}. Carry on; you cannot wait for this.)"
    }
  }
  // The desks, and a `region.crashed` interpretation, are installed here — above the watch so their
  // escalations reach the handlers above, below the ask adapter so a desk tool can reach it.
  region.watch(nursery = nursery)
}
```

Note what is _not_ here: no facility, no callback pair. `ask_operator` means "put this question in
front of the human"; `spawn_gate` means "run this in the background". The fiber's body reads the
answer and acts in **one** place, which is what keeps "approved at these values" true — a split
`on_grant` / `on_deny` pair would put a re-derivation between the submit and the send.

Assembling gates on this — the description, the branch, containing a gate's own failure so one bad
action does not take the session down — is [Approval
gates]({docs}/{currentVersion}/guides/approval-gates).

## The contract, and what surprises people

- **Ids are the correlation key.** Each control's `id` must be distinct within one ask; the platform
  carries it back verbatim, and a duplicate makes two controls indistinguishable (Slack rejects it
  outright). Branch on the id, never on display text.
- **Every field is optional, and `values` is total.** A `field` has no required-ness knob. A box left
  blank comes back as the empty string, and `submitted.values` carries **every declared field** — a
  missing key would mean the field was never declared, not that it went unanswered. So _what a blank
  box means is the application's decision_, and it is worth deciding once, explicitly: a cleared
  **body** usually reads as a refusal (the human deleted the text they were shown), while a cleared
  **subject** usually means "keep what was proposed". Spell those two rules in one reader rather than
  in every gate.
- **Nothing validates a submission for you, and on Slack nothing could.** The socket acknowledges an
  interaction the instant it arrives, which is exactly what closes the dialog, so per-field errors can
  never be returned. Validate in the program and `ask` again.
- **`form.title` is capped at 24 characters** — the twin contract's bound rather than either
  platform's (Discord allows 45), so a form written for one renders on the other. Every other cap is
  each platform's own (a button label of 80 characters on Discord, 75 on Slack; 25 dropdown options)
  and is **not** checked here: an over-cap control is a payload the platform rejects, surfacing as
  `api_error`. A form's own caps show when its **dialog opens**, not when the question posts.
- **A finished question stops looking answerable.** On an answer the controls are stripped off the
  message and the outcome is left in their place. A question that ends _without_ an answer is stripped
  the same way — `(expired)` for a deadline, a cancel or a teardown, `(failed)` for a platform failure
  — so no dead ask leaves live controls behind. Both strips are best effort: if the edit itself fails
  the stale controls stay, and pressing one gets the platform's own "interaction failed" notice.
- **`by` is a raw platform id** — a Discord snowflake, a Slack `U…`. Both are enumerable, so a plain
  digest of one is dictionary-reversible: tag it with `crypto.hmac_sha256` under a secret key before it
  leaves the program (an AI provider's abuse-attribution tag, a log line, an outbound body). Echoing it
  back into the channel it was pressed in discloses nothing new — that channel's membership is who
  could answer in the first place.
- **At most once, and that is the honest contract.** The wait rides one external call, so a runtime
  restart while a question is open interrupts it as a catchable `panic` and the posted controls go
  stale. That is the designed outcome, not a defect to absorb: let the panic reach your supervisor and
  ask again — whoever wanted the answer wants it still. Inventing an answer for an interaction that
  never landed is the one thing that must not happen.

## Twins, and where they diverge

The two packages carry the same data types with the same fields, so a bot ports between them by
swapping the import. Everything that differs:

- **`message.thread`** — Slack's one extra field: the thread a message was posted in, or `null` at top
  level. Slack addresses a thread by its parent's `ts`, which is also a message's identity, so
  `send_message` returns a `ts` and takes `thread_ts`. Discord has no such value.
- **Error classification** — both raise the same two constructors, `auth_error` and `api_error`, but
  Discord classifies them by HTTP status and Slack by its own error strings (`invalid_auth`,
  `missing_scope`, …). The unions are `discord.discord_error` and `slack.slack_error`.
- **Slack cannot validate a dialog server-side**, as above. Unvalidated inputs are not a divergence —
  both sides make every box optional and return `values` total over the declared fields — but only one
  of them is unable to do otherwise.

If a program should run on **either**, do not scatter `discord.` and `slack.` through it. Declare the
app's own request — `ask_operator` above is exactly that — and bind it to a vendor with **one adapter
at the root**. It is the same layering `ai.infer_step` uses for model providers: the app names the
capability it needs, and one outermost handler says who provides it. Swapping Discord for Slack is
then one clause, and moving the same question to a run-root escalation is that clause too.

## If a Slack press never arrives

Slack delivers presses and dialog submissions only when the app's **Interactivity** is switched on:
Features → Interactivity & Shortcuts → toggle it on. Socket Mode carries them over the same WebSocket,
so no Request URL is needed — but without the toggle nothing arrives at all, and the symptom is not an
error. `ask` posts its controls and blocks forever; pressing a button does nothing visible. If a
question in Slack looks like a hang, check that switch first.

The two planes are also subscribed separately: the `message.channels` / `message.groups` /
`message.im` bot events under Event Subscriptions feed `watch_messages`, and Interactivity feeds
`ask`. Two planes, two switches.

## Where to go next

- [Approval gates]({docs}/{currentVersion}/guides/approval-gates) — assembling gates on top of a
  forked ask, and where each gate's difference lives.
- [Handler geometry]({docs}/{currentVersion}/guides/handler-geometry) — why the ask adapter sits above
  the desks and the spawn handler below the nursery.
- [Escalation]({docs}/{currentVersion}/concepts/escalation) — the durable, restart-proof question, for
  when a channel's controls are not enough.
- [A Discord bot]({docs}/{currentVersion}/tutorial/a-discord-bot) — the message plane end to end, as a
  resident.
- The `discord` and `slack` packages in the [reference](/packages).
