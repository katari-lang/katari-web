---
title: Webhooks
description: Mint a public inbound URL from inside a program, turn every POST into a typed callback call, and own the endpoint's lifetime.
---

`webhook.inbound` inverts `http.fetch`: instead of the program calling the outside world, the
outside world calls the program. The runtime mints a fresh, unguessable public URL and, for as
long as a **subscriber** agent runs, converts every POST to that URL into a call of a
**callback** agent — the JSON request body is the argument, the callback's result is the JSON
response.

## Mint an endpoint

The smallest complete loop is self-contained — the subscriber POSTs to its own minted URL:

```katari
@"Called once per POST: the JSON body is the argument, the result is the JSON response."
agent on_delivery(value: integer) -> integer {
  value * 2
}

@"POST one delivery to the minted URL, then return — which deactivates the endpoint."
agent try_once(url: string) -> string {
  let response = http.fetch(
    url = url,
    method = "POST",
    headers = record.empty(),
    body = json.to_text(value = { value = 21 }),
  )
  response.body
}

agent main() -> string {
  webhook.inbound(callback = on_delivery, subscriber = try_once)
}
```

`main` returns `"42"`: the POST body was validated against `on_delivery`'s input schema, the
callback ran, and its result came back as the response body. When `try_once` returns, the URL
deactivates and its result becomes `inbound`'s result.

The URL is a **capability**: whoever holds it can invoke the callback, nobody else can. The route
lives outside the runtime's bearer-authenticated API surface, and the token is generated fresh
per call.

## Register the URL and stay subscribed

The subscriber owns the URL's lifetime. A real one registers the URL wherever deliveries should
come from — a push-notification API, a repository's webhook settings — and stays alive while they
flow. A registration only a human can perform is one
[escalation]({docs}/{currentVersion}/concepts/escalation) away:

```katari
@"One payment notification. A POST whose body does not match this signature is rejected 400."
agent on_payment(amount: integer, reference: string) -> string {
  f"recorded ${reference}: ${string.to_string(value = amount)}"
}

@"Nothing handles this, so the minted URL escalates as an open question: the run parks until
someone pastes the URL into the provider's dashboard and answers."
request register_url(url: string) -> null

@"Own the URL's lifetime: register it, then keep the endpoint serving until the run is cancelled."
agent keep_serving(url: string) -> never with register_url | io {
  register_url(url = url)
  forever {
    time.sleep(milliseconds = 3600000)
  }
}

agent main() -> never with register_url | io {
  webhook.inbound(callback = on_payment, subscriber = keep_serving)
}
```

The escalation shows up in the admin console and `katari status` with the URL in its argument;
answering it (from the console or `katari answer`) resumes the subscriber, which then holds the
endpoint open. A registration that must be renewed periodically renews in a loop instead — the
subscriber is an ordinary agent, so the renewal cadence is just code. An API-driven registration
typically calls an FFI external a library ships.

## The delivery contract

The HTTP caller waits for the callback and receives:

- **200** — the callback's result, raw as the response body. The program controls the exact
  reply, so a provider's URL-verification handshake is just a callback that echoes the right
  field.
- **400** — the body is not JSON, or it does not conform to the callback's declared input schema.
  This is pre-validated at the boundary: the callback never runs, and the endpoint keeps serving.
  An empty body is delivered as a `null` argument (some providers POST bare notifications).
- **404 / 410** — no endpoint serves this token / the endpoint is winding down.
- **5xx** — the callback failed while running. An execution failure on a well-formed delivery is
  different from a malformed one: the throw or panic **proxies up** like any escalation and
  cancels the whole endpoint — the run fails unless a handler above the subscriber catches it.

One bad delivery can therefore drop the endpoint. That is the honest default — a callback failure
is a real failure — but when deliveries should fail independently, catch inside the callback and
answer with a value:

```katari
data ingest_failed(message: string)

@"The fragile part of a delivery: throws `ingest_failed` when the downstream store is unavailable."
agent ingest(payload: string) -> string with prelude.throw[ingest_failed] {
  prelude.throw(error = ingest_failed(message = f"could not store ${payload}"))
}

@"Per-request resilience: catch the failure inside the callback and turn it into a response value,
so one bad delivery answers with an error body instead of cancelling the endpoint."
agent on_event(payload: string) -> string {
  use handler {
    request prelude.throw(error: ingest_failed) -> never { break "deferred; retry later" }
  }
  ingest(payload = payload)
}
```

## The URL is durable

The endpoint is part of the run's durable state, so it follows the rules of
[durable execution]({docs}/{currentVersion}/concepts/durable-execution):

- The URL **survives runtime restarts** — it stays registered until the subscriber settles, so an
  external service keeps a working address across deploys and crashes.
- A delivery in flight across a restart is lost — its HTTP waiter died with the process — and the
  webhook provider's retry redelivers it. The callback runs per delivery, so design it for
  redelivery (most providers retry on non-200 anyway).
- Cancelling the run cancels the subscriber (its cleanup runs — for example deleting an external
  registration via FFI) and deactivates the URL the same way as a normal return.

## Where to go next

- [Scheduled jobs]({docs}/{currentVersion}/guides/scheduled-jobs) — the polling twin of a
  webhook, and the retry patterns both compose with.
- [MCP]({docs}/{currentVersion}/guides/mcp) — `mcp.serve` mints capability URLs with the same
  lifetime contract.
- The `webhook` module in the [reference](/reference).
