---
title: Effects and Escalation
description: Declare a request, handle it in-program, then remove the handler and watch the run park as a question a human answers.
---

Your bot can compute, but it cannot yet _ask_ for anything — and a bot is mostly asking:
ask a model for a reply, ask an operator for approval, ask an API for data. In Katari
every ask is a **request**, and this chapter shows both things a request can become: a
function call, when a handler is in scope; an **escalation** — an open question a human
answers — when none is.

## Declare a request

A request is an effect declaration: a capability's name and signature, with no
implementation attached.

```katari
@"Ask the human operator a question; the run waits until it is answered."
request ask(question: string) -> string
```

An agent that performs `ask` does not know — and cannot know — who answers. That is
decided by whoever calls it, which is the whole trick of this chapter and the engine of
the final bot.

## A handler makes it a call

Replace `src/bot.ktr` with:

```katari
@"Ask the human operator a question; the run waits until it is answered."
request ask(question: string) -> string

@"Greet someone by name."
agent greet(name: string) -> string {
  f"Hello, ${name}!"
}

@"The call with a handler in scope: `ask` is answered in-program, nothing escalates."
agent scripted() -> string {
  use handler {
    request ask(question: string) { next "Ada" }
  }
  greet(name = ask(question = "Who should I greet?"))
}
```

`use handler { ... }` installs an implementation of `ask` **for the rest of the block**.
Inside the clause, `next "Ada"` answers the request: whoever performed `ask` resumes with
`"Ada"`. With a handler in scope, a request is an ordinary function call:

```sh
katari apply
katari run bot.scripted
```

```text
"Hello, Ada!"
```

## No handler: the run parks

Now the same call with **no** handler. Add `main` to the file — the complete
`src/bot.ktr` is:

```katari
@"Ask the human operator a question; the run waits until it is answered."
request ask(question: string) -> string

@"Greet someone by name."
agent greet(name: string) -> string {
  f"Hello, ${name}!"
}

@"Greet whoever the operator names. Nothing here handles `ask`, so the question escalates."
agent main() -> string with ask {
  greet(name = ask(question = "Who should I greet?"))
}

@"The same call with a handler in scope: `ask` is answered in-program, nothing escalates."
agent scripted() -> string {
  use handler {
    request ask(question: string) { next "Ada" }
  }
  greet(name = ask(question = "Who should I greet?"))
}
```

`main` performs `ask` and no handler is anywhere in scope, so the request **escalates**:
it leaves the run entirely and becomes an open question addressed to you, the operator.

```sh
katari apply
katari run bot.main
```

The run starts, reaches `ask`, and parks. `katari run` shows the question and prompts you
for the answer right in the terminal — type a name and the result comes back as if
nothing unusual happened.

The more honest version of that flow is the detached one, because nothing about an
escalation requires you to be watching:

```sh
katari run bot.main --detach
katari ls escalations        # the open question, with its id and schema
katari answer <id> '"Grace"' # the answer is JSON, checked against the request's schema
katari status <run-id>       # done — result "Hello, Grace!"
```

While the question is open, the run is not burning a connection or a process — it is
**parked, durably**. Restart the runtime; the question is still there. Answer it in a
minute or in a week — from the CLI or from the console's escalations inbox — and the run
resumes exactly where it stopped. That is the runtime's core promise, and the final bot
leans on it hard: see
[Durable Execution]({docs}/{currentVersion}/concepts/durable-execution).

## The signature tells the truth

Look at `main`'s signature: `agent main() -> string with ask`. The `with` clause is the
agent's **effect row** — the requests it may perform. The compiler checks it: declare a
row that omits a performed request and `katari check` rejects the agent, naming exactly
what leaked (`Left effect performs a request not present in the right effect: bot.ask`).
Leave the row off entirely and the compiler infers it. Spell it out on the agents you
mean others to call — it is the half of the contract that schemas cannot carry: not just
what goes in and out, but _what this agent may ask for_ along the way.

## Handlers can hold state

One more step, and it is the exact shape the finished Discord bot is built on. A handler
can carry a `var` — state that lives as long as the handler does and threads through
every request it answers. The complete `src/bot.ktr`:

```katari
@"Ask the human operator a question; the run waits until it is answered."
request ask(question: string) -> string

@"Greet someone by name."
agent greet(name: string) -> string {
  f"Hello, ${name}!"
}

@"Greet whoever the operator names. Nothing here handles `ask`, so the question escalates."
agent main() -> string with ask {
  greet(name = ask(question = "Who should I greet?"))
}

@"The same call with a handler in scope: `ask` is answered in-program, nothing escalates."
agent scripted() -> string {
  use handler {
    request ask(question: string) { next "Ada" }
  }
  greet(name = ask(question = "Who should I greet?"))
}

@"A stateful handler: a `var` rides the handler, and every `ask` advances it."
agent roll_call() -> string {
  use handler (var count: integer = 1) {
    request ask(question: string) {
      next f"guest #${string.to_string(value = count)}" with { count = count + 1 }
    }
  }
  let first = greet(name = ask(question = "Who is next?"))
  let second = greet(name = ask(question = "Who is next?"))
  f"${first} ${second}"
}
```

`next value with { count = count + 1 }` does two things at once: answers the current
request with `value`, and carries the updated state forward to the next one.

```sh
katari apply
katari run bot.roll_call
```

```text
"Hello, guest #1! Hello, guest #2!"
```

Squint at `roll_call` and you can see the bot this tutorial ends with: replace "every
`ask` advances a counter" with "every incoming Discord message extends a conversation
history", and you have chapter 5's message loop. The state is just a value in your
program — no session store, no cache to invalidate.

## Where you are

Requests, handlers, escalation, and handler state — the full effect vocabulary. Next
chapter, the payoff for learning it: a model **provider** is nothing but a package-shipped
handler you `use`, and wiring one in takes a single line —
[Talking to a Model]({docs}/{currentVersion}/tutorial/talking-to-a-model).

Deeper treatments:
[Effects and Handlers]({docs}/{currentVersion}/concepts/effects-and-handlers) and
[Escalation]({docs}/{currentVersion}/concepts/escalation).
