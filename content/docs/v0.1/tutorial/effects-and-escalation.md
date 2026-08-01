---
title: Effects and Escalation
description: Declare a request, handle it in-program, then remove the handler and watch the run park as a question a human answers.
---

A bot is mostly asking: ask a model for a reply, ask an operator for approval, ask an API for
data. In Katari every ask is a **request** — a capability's name and signature, with no
implementation attached — and what it becomes depends on who is listening.

## Declare a request

```katari
@"Ask the human operator a question; the run waits until it is answered."
request ask(question: string) -> string
```

An agent that performs `ask` does not know who answers. That is decided by whoever calls it,
and it is the engine of the final bot.

## A handler makes it a call

Replace `src/bot.ktr`:

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

`use handler { ... }` installs an implementation of `ask` for the rest of the block. Inside the
clause, `next "Ada"` answers the request: whoever performed `ask` resumes with `"Ada"`.

```sh
katari apply
katari run bot.scripted
```

```text
"Hello, Ada!"
```

## No handler: the run parks

Now the same call with no handler in scope. Add `main`:

```katari
@"Greet whoever the operator names. Nothing here handles `ask`, so the question escalates."
agent main() -> string with ask {
  greet(name = ask(question = "Who should I greet?"))
}
```

The request **escalates**: it leaves the run entirely and becomes an open question addressed to
you, the operator.

```sh
katari apply
katari run bot.main
```

`katari run` shows the question and prompts for the answer in your terminal. The more honest
version of the same flow is the detached one, because nothing about an escalation requires you
to be watching:

```sh
katari run bot.main --detach
katari ls escalations                 # the open question, with its id and schema
katari answer <id> --value '"Grace"'  # JSON, checked against the request's schema
katari status <run-id>                # done — result "Hello, Grace!"
```

While the question is open the run burns no connection and no process: it is parked, durably.
Restart the runtime and the question is still there. Answer it in a minute or in a week, from
the CLI or from the console's escalations inbox, and the run resumes where it stopped.

## The signature tells the truth

`agent main() -> string with ask` — the `with` clause is the agent's **effect row**, the
requests it may perform. The compiler checks it: write `with io` there instead and `katari
check` names exactly what leaked.

```text
bot:7:1 K3001: The actual effect performs `bot.ask`, which the expected effect does not allow.
Either name that request in the expected `with` row, or serve it here with a `use handler` clause.
  expected: io
  actual:   ask
```

Leave the row off entirely and the compiler infers it. Spell it out on the agents you mean
others to call: it is the half of the contract schemas cannot carry — not just what goes in and
out, but what this agent may ask for along the way.

## Handlers can hold state

A handler can carry a `var`: state that lives as long as the handler does and threads through
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

`next value with { count = count + 1 }` does two things at once: answers the current request
with `value`, and carries the updated state forward to the next one.

```sh
katari apply
katari run bot.roll_call
```

```text
"Hello, guest #1! Hello, guest #2!"
```

Replace "every `ask` advances a counter" with "every incoming message extends a conversation",
and `roll_call` is the shape the final bot runs on — shipped by the `ai` package rather than
written by you. The state is a value in your program: no session store, no cache to invalidate.

## Next

A model **provider** is exactly what you just wrote — a handler, shipped by a package,
installed with one `use` line.

<DocCards>
  <DocCard href="{docs}/{currentVersion}/tutorial/talking-to-a-model" />
  <DocCard href="{docs}/{currentVersion}/concepts/effects-and-handlers" />
  <DocCard href="{docs}/{currentVersion}/concepts/escalation" />
  <DocCard href="{docs}/{currentVersion}/concepts/durable-execution" />
</DocCards>
