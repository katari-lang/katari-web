---
title: Asking a human
description: Park a question durably as an escalation, or put it in a channel with `ask` — controls go in as data, one answer value comes back.
---

There are two places a person can answer from, chosen by what the question has to survive. A request
nobody handles becomes a durable row in the runtime's database; a `discord.ask` is a live message with
controls on it, answered where the conversation already is.

## A question with no handler

Declare a request, perform it, and handle it nowhere. The run parks at its root and waits:

```katari
@"Nothing serves this, so it parks: the run waits until someone answers."
request confirm_release(version: string) -> boolean

agent main(version: string) -> string with confirm_release {
  if (confirm_release(version = version)) { f"released ${version}" } else { "(held back)" }
}
```

The parked question is an [escalation]({docs}/{currentVersion}/concepts/escalation): it appears in the
admin console and in `katari status` carrying its arguments, with an input form derived from the return
type. Answer it there or with `katari answer`, minutes or days later — a deploy in between changes
nothing, because the waiting run is durable state rather than a held connection.

## A question in a channel

`discord.ask` posts a prompt with controls under it and blocks until someone completes one. The answer
comes back as a value:

```katari
agent admin_channel() -> string {
  string.trim(value = env.get_or(key = "ADMIN_CHANNEL", fallback = ""))
}

@"Tool: put a draft in front of the operator; answers with the draft when they approve, and empty when
they do not."
agent approved_draft(draft: string) -> string {
  match (discord.ask(
    channel = admin_channel(),
    prompt = f"Publish this to the public feed?\n\n${draft}",
    controls = [
      discord.button(id = "approve", label = "approve"),
      discord.button(id = "deny", label = "deny"),
    ],
  )) {
    case discord.clicked(id => "approve", by => _, display_name => _) -> draft
    case rest -> ""
  }
}
```

The literal `id => "approve"` is the branch. It turns on the key the program wrote rather than the label
a human reads, so relabelling or translating the button changes nothing, and `case rest` already covers
whatever a later version puts beside these two. A press arrives over the platform's interaction path,
correlated back to the prompt this call posted, so it never competes with the `watch_messages` source
already serving that channel.

## Four shapes, one call

Approval, free text, editing a draft and picking from a list are one agent with different data in
`controls`:

| shape           | controls                                                  | answer                                    |
| --------------- | --------------------------------------------------------- | ----------------------------------------- |
| approval        | two `button`s                                             | `clicked(id, by, display_name)`           |
| free-form text  | a one-field `form`                                        | `submitted(id, values, by, display_name)` |
| draft editing   | a `form` prefilled with the draft, beside a deny `button` | `submitted` / `clicked`                   |
| multiple choice | a `select` over a computed list                           | `chose(id, option, by, display_name)`     |

The prefilled form is the shape to reach for when there is a draft. What comes back is not a yes about a
proposal — it is the text the human read and submitted:

```katari
@"Send the mail the operator submitted — which may not be the mail that was proposed."
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
    case discord.submitted(id => _, values => values, by => _, display_name => _) -> send_mail(values = values)
    case rest -> "(declined)"
  }
}

@"Send what the boxes hold; a cleared body reads as the operator withdrawing the draft."
agent send_mail(values: record[string]) -> string {
  match (record.get(target = values, key = "body")) {
    case null -> "(declined)"
    case text -> if (string.trim(value = text) == "") { "(declined)" } else { f"sent: ${text}" }
  }
}
```

Nothing regenerates the text between the submit and the deed, so approved means approved at these
values. Every declared field comes back and a blank box arrives as the empty string, so what a blank
means is the program's decision — the usual rule is that a cleared body is a refusal. Reach for `select`
when the options are data the program computed; a fixed set of choices is clearer as one `button` each.

## Where the wait lives

### Inside the turn

The tool performs the ask and returns the answer, so the model continues on it. A tool call races
`tool_budget_milliseconds`, and that budget bounds machine latency; a tool that waits on a person is
named in `unbounded_tool_names`, derived from the tool's own metadata so a rename carries:

```katari
@"One turn in which the model may stop and ask a person."
agent answer_with_help(question: string) -> string {
  ai.infer_with_tools[io | discord.credential](
    history = [types.turn(role = types.user_role(), text = question, files = [])],
    tools = [approved_draft],
    max_steps = 8,
    tool_budget_milliseconds = 60000.0,
    unbounded_tool_names = [reflection.get_metadata(value = approved_draft).name],
  )
}
```

What waits is this conversation and nothing else: `region.watch` re-emits every fiber's escalation
concurrently, so other work keeps running while one operator reads a dialog.

### In a fiber

When the turn should end at once and the answer only decides an action, fork the question and its
consequence together. The forking code carries on immediately; the fiber reads the answer and does the
deed in one place, which is what keeps "approved at these values" true.

```katari
effect gate_scope

// What a gate fiber may do: ask, then act.
type gate_ceiling = discord.credential | io

@"One gate: put the question to the operator, then post what they approved — question and consequence
in one place."
agent post_gate(channel: string, draft: string) -> null with gate_ceiling | prelude.throw[discord.discord_error] {
  let _outcome = discord.try_send(channel = channel, text = approved_draft(draft = draft))
  null
}

@"Fork the gate and carry on: the question waits in a fiber, and nothing else waits with it."
agent gated_main(channel: string, draft: string) -> never with io | region.crashed | region.failed | prelude.throw[env.missing_secret | oauth.server_error] {
  use discord.provider(source = credentials.env(key = "DISCORD_TOKEN"))
  let nursery = use region.provide[gate_scope, gate_ceiling]
  let _gate = region.fork(nursery = nursery, task = post_gate, argument = { channel = channel, draft = draft }, name = "gate:post")
  region.watch(nursery = nursery)
}
```

A gate a model asks for is the same fork made from a tool, and an AI hired through `ai.route` already
has a nursery to fork into — that variant is in [Residents]({docs}/{currentVersion}/guides/residents).

## The contract

- **Ids are the correlation key.** Each control's `id` is distinct within one ask and comes back
  verbatim. Branch on the id, never on display text.
- **`values` is total over the declared fields**, so a reader handles blanks rather than absences.
- **`ask` carries no deadline, no withdrawal and no persistence.** A deadline is `time.with_deadline`
  around it; a withdrawal is `region.cancel_by_id` on the fiber holding it; a question that must survive
  a deploy is the escalation at the top of this page.
- **The wait is at most once.** It rides one external call, so a restart interrupts it as a catchable
  panic and the posted controls go stale. Ask again: a fresh ask opens its own connection.
- **`by` is a raw platform id**, enumerable and so not safe to digest plainly — pass it through
  `crypto.pseudonym` before it leaves the program.
- **Presentation is clamped, load-bearing values are fatal.** An over-long `id`, option or prefill fails
  the ask as `api_error`; `discord.check_controls` answers that purely, where the controls are built.

## The Slack twin

The `slack` package carries the same types with the same field and argument names, so a program ports
by swapping the import. Slack's `message` carries `thread` and no `display_name`, its provider takes
two tokens where Discord takes one, and its dialogs are acknowledged the instant they arrive — which
is what closes them — so a submission is validated in the program and asked again rather than
rejected per field. Presses arrive once the app's Interactivity toggle is on, over the same
WebSocket; the authoritative divergence table is in the slack package's README.

A program that should run on either declares its own request — `ask_operator(prompt, controls)` — and
binds it to a vendor with one adapter at the root. Swapping platforms is then one clause, and so is
moving the same question to an escalation.

## Where to go next

<DocCards>
  <DocCard href="{docs}/{currentVersion}/guides/residents" />
  <DocCard href="{docs}/{currentVersion}/guides/handler-geometry" />
  <DocCard href="{docs}/{currentVersion}/concepts/escalation" />
</DocCards>
