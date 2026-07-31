---
title: Approval gates
description: A gate is app code, not a package — one `spawn_gate` request forks the question and its whole consequence into a fiber, the answer folds into a single `granted | refused` sum, and the requesting turn never waits.
---

A **gate** is what an action looks like when a human must decide before it happens: a post that
crosses into public view, an email leaving to a third party, a worker committed to an errand.
[Asking a human]({docs}/{currentVersion}/guides/asking-a-human) is the mechanism underneath — one
`ask` that takes its controls as data and returns the answer as data. This page is the design
**around** that call: where the question runs, who waits for it, how the answer is read, and what
happens when the approved action fails.

The whole idiom fits in one sentence — **the turn does not wait; a fiber does** — and in five steps:

1. The app declares its own `spawn_gate` request — "run this in the background".
2. The one place that owns a nursery **serves** it, forking the task.
3. A gated tool builds a `decide` closure — the question _and_ its consequence — hands it to
   `spawn_gate`, and **returns at once** with a pending note the model reads and moves past.
4. Inside the fiber, `ask_operator` blocks on the human — and nothing waits with it: no desk, no
   watcher, no handler.
5. The answer folds into one sum, and the gate's body is a **single dispatch** on it.

## The gate is app code, not a package

A gate _looks_ like a reusable facility right up until you write one, and this page is really about
why it is not — the argument is worth having before you reach for a library that does not exist.

A gate is three things stuck together — **fork, ask, branch** — and only the fork is generic. Hold all
three in a package and the package inherits every difficulty of not knowing the other two:

- **The fiber's row becomes a type parameter.** A package cannot know what an approved action may do —
  post, mail, register a worker — so the effect row of the decision closure has to be threaded through
  the whole signature as an effect generic, and spelled by the caller at the use site.
- **It needs `lacks` on two rows at once.** The facility serves the very request its own closures run
  under, so both the ask closure's row and the continuation's row must be constrained to _not_ contain
  it, or the facility can serve itself.
- **It grows a second effect tail.** With one tail, a scoped provider re-emits its whole ceiling into
  the caller's residual — every gate's effects leak upward into a program that already handles them.
  Keeping the residual honest means a second tail for the outer row, and the two-tail discipline is the
  hardest thing in the signature to get right.

In app code, all three vanish. The ceiling is a **concrete type synonym you already wrote** for the
nursery, so there is no generic row to thread and no type argument at the call site. Nothing serves a
request it also performs, so no `lacks`. There is no provider between the desks and the root, so there
is no residual to keep precise — and no re-emitted `region.crashed` phantom either.

**The honest accounting.** The reference bot did not get shorter for this: its source grew by about 70
lines, because six editable drafts are six forms of prefilled fields, and because the failure guard
below is a new capability rather than a replacement. What shrank is the number of things a reader must
hold at once — one dependency fewer, three concepts fewer (a generic approve request, a `serve`
provider with its scope marker and its own second nursery, and a root-escalated confirm, all replaced
by `spawn_gate` + `ask_operator`), and one nursery instead of two. The
[escalation]({docs}/{currentVersion}/concepts/escalation) report `katari check` prints came out **39%
shorter**: fourteen tools that had each declared an approve request carrying `<the entire ceiling>` as
a type argument — a 700-character row, printed fourteen times — now declare `spawn_gate`, one name.

The law worth keeping is narrow: **a facility whose mechanism is a fork is cheaper to inline than to
abstract.** The abstraction paid for itself while the answer was a boolean. It stopped paying the
moment the answer became data.

## Two requests, and nothing else

Everything the idiom needs is two declarations the app writes itself.

```katari
@"Ask the operator one question and BLOCK until they COMPLETE one of @controls@ — the seam every
human decision goes through, so no tool has to know a channel."
request ask_operator(prompt: string, controls: array[discord.control]) -> discord.answer

// What a GATE fiber may do: ask, then act. (Type synonyms take no docs.)
type gate_ceiling =
  ask_operator | core_message | admit_worker | discord.credential | io
  | prelude.throw[discord.discord_error | env.missing_secret]

@"FORK a gate: run @task@ — one crossing's whole question-and-consequence — as a fiber, and answer the
caller AT ONCE, so the requesting turn ends without waiting."
request spawn_gate(
  @"The gate's fiber name; prefix it `gate:` so a roster line reads as a question awaiting the operator." name: string,
  @"The whole gate: ask the human, then act on what they answered." task: agent (input: null) -> null with gate_ceiling,
) -> string
```

Note what is _not_ declared: no callback pair. A split `on_grant` / `on_deny` would put a
re-derivation between the submit and the deed; here the fiber's body reads the answer and acts in
**one** place, which is what keeps "approved at these values" true.

`ask_operator` is answered by one adapter at the root — the only code in the program that knows a
question becomes a Discord message. That handler is **`parallel`, and load-bearing**: several gates
wait on their own questions at the same time, and a sequential clause would queue them, so one dialog
nobody has opened yet would freeze every other gate in the program.

```katari
use parallel handler {
  request ask_operator(prompt: string, controls: array[discord.control]) {
    next discord.ask(channel = admin_channel, prompt = prompt, controls = controls)
  }
}
```

The full session skeleton — where this sits relative to the nursery and the desks — is in
[Asking a human]({docs}/{currentVersion}/guides/asking-a-human#fork-a-fiber); the positional rules
behind it are [Handler geometry]({docs}/{currentVersion}/guides/handler-geometry).

## One nursery is not one capability set

A [nursery]({docs}/{currentVersion}/concepts/parallelism)'s ceiling has to be the **union** of every
kind of fiber it holds, and it is tempting to read that as "any fiber of this region may do anything in
the union". It does not follow, as long as every fork goes through a **named request whose task row
states what that kind may do**:

```katari
// What a MONITOR fiber may do: watch, and report. (Type synonyms take no docs.)
type monitor_ceiling = core_message | io

// The NURSERY's ceiling is the union of every fiber kind. (Type synonyms take no docs.)
type bus_ceiling = gate_ceiling | worker_message
```

`spawn_gate` takes `gate_ceiling`; a `launch_watch` beside it takes the narrower `monitor_ceiling`.
The union bounds the **region**; each fork is bounded by the **request it went through**. A monitor
still cannot post to Discord and a gate still cannot mail a worker desk, though they share one
nursery, one `region.watch` and one `crashed` interpretation. Two nurseries are never the answer to a
ceiling question.

## The answer folds into one sum

`discord.answer` is three constructors and a form's `values` is a record of strings, so a gate could
easily grow a branch per shape. It should not. Read the answer **once**, into the app's own two-case
sum, and every gate body becomes a single dispatch:

```katari
@"The operator's decision, READ: the action RUNS, at @values@ — the draft exactly as they submitted it,
which is not necessarily what the model proposed."
data granted(@"Every declared field's text as submitted; empty for a plain yes/no question." values: record[string])

@"The operator's decision, READ: the action does NOT run. @reason@ is the one clause the requester is told."
data refused(@"Why it did not run, in one clause." reason: string)

// One gate's outcome, read from the answer ONCE. (Type synonyms take no docs.)
type decision = granted | refused

@"Read a YES/NO gate's answer into the decision sum: the `approve` button is `granted`, anything else
`refused`. The id is matched as a LITERAL, so the branch turns on the id the PROGRAM wrote and a
relabelled button changes nothing."
agent read_click(answer: discord.answer) -> decision {
  match (answer) {
    case discord.clicked(id => "approve", by => _) -> granted(values = record.empty())
    case rest -> refused(reason = "the operator declined")
  }
}

@"Read a FORM gate's answer into the SAME sum: a submit whose @body_key@ box still holds text is
`granted` at the submitted values; everything else is `refused`."
agent read_form(answer: discord.answer, body_key: string) -> decision {
  match (answer) {
    case discord.submitted(id => _, values => values, by => _) -> {
      if (string.is_blank(value = kept_text(values = values, key = body_key, fallback = ""))) {
        refused(reason = "the operator cleared the text — a deleted draft reads as 'do not send this'")
      } else {
        granted(values = values)
      }
    }
    case rest -> refused(reason = "the operator declined")
  }
}
```

Two readers, one sum. A new gate adds no branch anywhere, and neither does a new control: `case rest`
already covers everything a later version puts beside the ones this question asked.

## A gate, twice

Here is a gate whose question is an **editable draft**. The tool builds the form, performs
`spawn_gate`, and returns a note; everything after that happens in the fiber.

```katari
@"Tool: post to the public channel. This crosses into public view, so it is GATED — the operator gets
your draft in an EDITABLE box and you IMMEDIATELY carry on. What they submit is what gets posted; a
cleared box or a deny posts nothing. Do NOT wait or re-request."
agent post_public(text: string) -> string {
  let what = "POST to the public channel"
  @"The gate: hand the operator the draft to read and edit, then post exactly what came back — or report the refusal."
  agent decide(input: null) -> null with gate_ceiling {
    let answer = ask_operator(
      prompt = f"${what} — open 'edit & post' to read the message in full and change it before it goes out.",
      controls = edit_or_deny(form = discord.form(id = "post", label = "edit & post", title = "public post", fields = [
        discord.field(id = "text", label = "the message, as it will appear", value = text, multiline = true),
      ])),
    )
    match (read_form(answer = answer, body_key = "text")) {
      case granted(values => values) -> {
        // `try_send` answers with its OUTCOME, and this gate reports on its own send — so it folds
        // the outcome rather than claiming "posted" for a post the channel never received.
        match (discord.try_send(channel = public_channel(), text = kept_text(values = values, key = "text", fallback = text))) {
          case discord.delivered(_) -> core_message(source = "gate", content = "(approved — posted, in the wording the operator submitted; it may differ from your draft.)")
          case discord.dropped(reason => reason) -> core_message(source = "gate", content = f"(approved, but nothing was posted: ${reason}.)")
        }
      }
      case refused(reason => reason) -> refusal_note(what = what, reason = reason)
    }
  }
  spawn_gate(name = "gate:post_public", task = decide)
}
```

And here is a gate whose question is a **plain yes/no**. Same skeleton, different `controls` data and
a different reader:

```katari
@"Tool: LAUNCH a worker — a fresh agent with its own brief. Gated: you ask and IMMEDIATELY carry on."
agent launch_worker(name: string, brief: string) -> string {
  // A YES/NO gate: the operator is deciding whether this errand runs at all, and a brief they silently
  // edited would leave the model coaching a worker against a mandate it never wrote.
  let what = f"LAUNCH worker ${name} (brief: ${brief})"
  @"The gate: on approve, register the worker and mail the roster's verdict; on refusal, mail a short note."
  agent decide(input: null) -> null with gate_ceiling {
    match (read_click(answer = ask_operator(prompt = what, controls = approve_deny()))) {
      case granted(values => _) -> {
        let outcome = admit_worker(name = name, brief = brief)
        core_message(source = "gate", content = f"(approved — LAUNCH worker ${name}: ${outcome})")
      }
      case refused(reason => reason) -> refusal_note(what = what, reason = reason)
    }
  }
  spawn_gate(name = f"gate:launch_worker:${name}", task = decide)
}
```

The difference between the two is data — the `controls`, the reader, the granted action — and nothing
else. `approve_deny()`, `edit_or_deny(form)` and `refusal_note(what, reason)` are each three lines
spelled once, so fourteen gates carry no copy of the wording and none of them can quietly disagree
about what a deny reads like.

Both tools return **immediately**, which is why neither needs an exemption from
`ai.take_turn`'s tool deadline: the human wait lives in the fiber, and no deadline races a fiber. Only
a tool that genuinely blocks on a person needs `unbounded_tool_names`.

## Form or button

The choice is not a matter of taste, and it has one rule.

**Use a form when there is a draft worth editing** — because then the **submitted values _are_ the
thing that runs.** No model step sits between the click and the deed, so "approved" cannot mean
"approved at wording nobody kept". Ship the proposal as the form's prefill and act on what comes back.

**Use buttons when there is no draft a human could improve**, or when an edit would make the request
lie. Of the reference bot's fourteen gates, **six are forms and eight are buttons**, and the eight are
worth reading as a list of reasons rather than a default:

- **`update_calendar_event` takes buttons because its patch semantics already claim "blank".** Each
  field of the patch defaults to empty and empty means _leave this field of the event alone_. Put that
  in a form and a blank box could mean either "keep what was proposed" or "do not touch the event's
  value" — and a gate that cannot say what a cleared box means has no business showing one. The whole
  patch rides the prompt instead; an operator who wants a different time denies and says so.
- **`notify_core` takes buttons because editing would break the marking.** It relays text from a public
  channel to a privileged agent, and that agent must receive **what the public actually said**. An
  operator tidying the quote in a box would hand it a cleaned-up version still labelled untrusted, and
  the label would start lying. There is no draft here, only a decision.
- The rest are actions with no text to fix: starting a monitor, deleting an event, launching a worker
  against a brief the model wrote and the operator should not silently rewrite.

One thing the form buys that a summary never can: **there is no preview to truncate.** A form's dialog
holds 4000 characters per box, so the operator reads the whole draft. A gate that squeezes a
description into an ask line is a window somebody can approve through without reading.

## A blank box means what you decide it means

Every declared field comes back, and a box left blank comes back as the **empty string** — so
`submitted.values` is total over the form's fields and a gate never crashes on a missing key. What
"empty" _means_ is not in the type, and it is not the same for every box. Decide it **per box, once**:

- The **body** box — the message, the digest, the mail body, the layer — is the action's substance, so
  clearing it is a **refusal**. A human who deletes the text they were shown is not asking to send the
  empty string. That rule lives in `read_form` and nowhere else.
- An **auxiliary** box — a subject, a title, a description — falls back to **what was proposed**,
  because clearing a label is not a decision to act without one:

```katari
@"One submitted box's text, falling back to @fallback@ when the human left it BLANK — the rule for an
AUXILIARY box. Every declared field is present in @values@ (a blank box arrives as the empty string),
so the missing-key case is unreachable and folds into the same fallback."
agent kept_text(values: record[string], key: string, fallback: string) -> string {
  match (record.get(target = values, key = key)) {
    case null -> fallback
    case text -> if (string.is_blank(value = text)) { fallback } else { text }
  }
}
```

The failure mode here is silent, which is why it is worth the two helpers: a gate that forwarded
`values` raw would send an empty email the first time somebody cleared the body, and nothing would
have complained.

## Contain a gate's own failure

The action a gate runs **after** the operator approved is a real-world call, and it can fail on input
the _operator themselves_ typed — a malformed timestamp in an edited event, a Gmail 400 on a hand-fixed
draft. Neither region event saves you here. `region.crashed` reports a fiber's **panic**; an uncaught
`throw` never crosses the region as a throw at all — the `watch` boundary **traps** it and delivers it
as the typed `region.failed` event, carrying the fiber's name and the thrown value as `unknown`. So
nothing unwinds the supervisor, but nothing useful reaches it either: it learns that a gate died, not
which conversation was waiting on the answer, and not whether this particular failure means stop or
carry on. One clause, one policy, every gate.

The containment is app-side, and it belongs in the **spawn handler**, where one guard covers every
gate:

```katari
request spawn_gate(name: string, task: agent (input: null) -> null with gate_ceiling) {
  // A GATE IS A FORK — the same move `launch_watch` makes, with the gate's own ceiling on the task.
  // AND ITS FAILURE IS CONTAINED HERE, once, for every gate.
  agent guarded(input: null) -> null with gate_ceiling {
    use handler {
      request prelude.throw(error: unknown) -> never {
        match (classify_crash(error = error)) {
          case must_stop(error => fatal) -> { prelude.throw(error = fatal) }
          case restartable(error => rest) -> {
            core_message(source = "gate", content = f"(${name} failed: ${describe_crash(error = rest)}. The action did not complete — check before assuming either that it happened or that it did not.)")
            break null
          }
        }
      }
    }
    task(input = null)
  }
  let _gate = region.fork(nursery = nursery, task = guarded, argument = null, name = name)
  next f"(asked the operator — ${name}. Carry on: you cannot wait for this, and what lands may differ from the draft you proposed.)"
}
```

The classifier is the **session's own** — the same `classify_crash` the supervisor uses — so a dead
token or a missing secret still stops the run loudly, everything else is reported as a plain failure,
and the two can never drift apart on what "fatal" means. The pending note is spelled here too, once,
because "a question was asked, carry on" is a property of the mechanism rather than of any one action.

## Withdrawal, deadlines and restarts

None of these belong inside a gate, and all three compose from outside it.

**Withdrawing a pending question is a cancel.** A gate is a fiber like any other, so the same
`region.cancel_by_id` that stops a monitor withdraws a question — the ask is interrupted, its controls
go dead, and nothing is done. In the reference bot the model-facing `stop_watch` tool reaches gates for
exactly this reason, and its roster lists them under their `gate:` names.

```katari
request halt_fiber(id: string) {
  match (region.cancel_by_id(nursery = nursery, id = id)) {
    case region.cancelled(id => stopped) -> { next f"(withdrawn: ${stopped})" }
    case region.unknown_fiber(id => missing) -> { next f"(nothing to withdraw: ${missing})" }
  }
}
```

**An expiry is `time.with_deadline` around the ask**, placed by whoever knows what waiting costs — a
gate's fiber can wait all day and usually should, while a question asked _inside_ a turn holds a desk
and wants a bound. `ask` carries no timeout of its own precisely so the two can differ.

**A restart loses the pending question, and only that.** The wait rides one external call, so a
runtime restart while a gate is open interrupts it under the at-most-once rule: the posted controls go
stale, the fiber's death is reported like any other fiber's, and the conversation that asked is
untouched. Nothing invents an answer for an interaction that never landed. If the answer still
matters, ask again — whoever wanted it wants it still.

## Where to go next

- [Asking a human]({docs}/{currentVersion}/guides/asking-a-human) — the `ask` this idiom is built on,
  its four control shapes, and the contract that surprises people.
- [Handler geometry]({docs}/{currentVersion}/guides/handler-geometry) — why the ask adapter sits above
  the desks and the spawn handler below the nursery.
- [Parallelism]({docs}/{currentVersion}/concepts/parallelism) — nurseries, forks, `region.watch` and
  the `crashed` events a gate's fiber reports through.
- [Escalation]({docs}/{currentVersion}/concepts/escalation) — the durable question, for a decision that
  must survive a deploy rather than a click.
- The `discord` and `slack` packages in the [reference](/packages) — `ask`, its controls and its
  answers.
