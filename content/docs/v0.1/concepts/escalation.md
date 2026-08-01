---
title: Escalation
description: A request with no handler parks the run as a durable open question — answered by a human minutes or days later, surviving restarts.
---

A request escalates when no handler is in scope anywhere up the chain: it leaves the run, and
the runtime records it as a row addressed to a person. The performing thread parks on that
row, so a week of waiting costs a database entry rather than a process, and the answer
resumes the thread at the exact expression that asked.

## A question with no handler

```katari
@"Ask a human to approve; the run parks until this question is answered."
request approve(summary: string) -> boolean

@"Publish a draft once a human signs off."
agent publish(draft: string) -> string with approve {
  if (approve(summary = draft)) {
    "published"
  } else {
    "discarded"
  }
}
```

Run `publish` and nothing handles `approve`, so the call escalates. `katari run` shows the
question and prompts you right in the terminal; a detached run keeps the question open, and
the admin console lists it in the Escalations inbox with a form derived from the request's
answer schema (here: a boolean). From the CLI:

```bash
katari ls escalations          # every open question, newest first
katari status <run>            # one run's state and its open questions
katari answer                  # pick a question, get prompted through its schema
katari answer <id> --value true
```

While the run waits, the run page shows the delegation tree — which agents are blocked on
which question. The answer is validated against the request's answer schema, delivered to
the parked thread, and the run continues. Restart the runtime in between and nothing is
lost: the open escalation row is the state.

## Handled or escalated — the same request

```katari
@"The same request, intercepted: with a handler in scope, nothing escalates."
agent publish_preapproved(draft: string) -> string {
  use handler {
    request approve(summary: string) { next true }
  }
  publish(draft = draft)
}
```

Escalation is the default meaning of a request, not a special kind of request. Any caller
can intercept `approve` with an ordinary handler and answer in-process; wrap the same agent
differently in different deployments and the human is in or out of the loop with no change
to `publish`. This symmetry is what makes requests the right boundary for human-in-the-loop
logic — see [Effects and handlers]({docs}/{currentVersion}/concepts/effects-and-handlers).

## Pause-and-ask: OAuth authorization

```katari
@"Call GitHub as the authorized user. The first call pauses the run on an
authorization escalation; completing the browser flow resumes it right here."
agent whoami() -> string with io | prelude.throw[oauth.server_error | http.fetch_error] {
  let bearer : string of private = oauth.token(name = "github")
  let response = http.fetch(
    url = "https://api.github.com/user",
    headers = { Authorization = prelude.concat(left = "Bearer ", right = bearer) },
  )
  response.body
}
```

Some escalations are raised by the runtime itself. When `oauth.token` finds no usable
credential under the name — never authorized, or its refresh died mid-run — the run pauses on
a `prelude.oauth.authorize` escalation. The console renders it as an authorization request
with an Authorize button, and `katari answer` prints the authorization URL and opens your
browser.

Completing the flow deposits the credential in the runtime's store and answers every
escalation waiting on it; the run resumes and re-resolves the token. The token material never
rides the answer — the answer is only the resume signal. A pause the runtime cannot resolve
without a human is an escalation; a transient failure (`oauth.server_error`) is a throw. The
same contract backs MCP servers with `oauth(...)` auth — see
[Secrets and credentials]({docs}/{currentVersion}/guides/secrets-and-credentials).

## What escalates, what fails, what is rejected

Every failure channel rides the same escalation spine, and they resolve differently:

- **A user-facing request** with no handler parks the run as an answerable question, as
  above.
- **An uncaught `prelude.throw`** reaches the run root and fails the run — it was catchable
  all the way up, and nothing caught it.
- **A `panic`** is the runtime's own failure channel (division by zero, a broken FFI
  process). Katari code cannot raise one, and it fails the run unless a handler catches it
  on the way out.
- **Malformed input from outside** never reaches your agent at all. An inbound webhook
  delivery or MCP `tools/call` whose body does not fit the target's input schema is rejected
  with a 400-class response at the boundary, and the endpoint stays up; a run started with a
  non-conforming argument is refused before it launches.
- **`reflection.call_error` belongs to `reflection.call_agent` alone.** Dynamic dispatch —
  an AI-built argument record hitting a tool — validates against the target's input schema
  and throws a catchable `call_error` on mismatch, so a tool loop can let the model retry.
  Direct calls are type-checked at compile time and carry no such error; no other boundary
  reuses it.

## Where to go next

<DocCards>
  <DocCard href="{docs}/{currentVersion}/concepts/durable-execution" />
  <DocCard href="{docs}/{currentVersion}/concepts/parallelism" />
  <DocCard href="{docs}/{currentVersion}/tutorial/effects-and-escalation" />
  <DocCard href="{docs}/{currentVersion}/guides/asking-a-human" />
</DocCards>
