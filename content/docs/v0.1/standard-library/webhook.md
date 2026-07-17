---
title: prelude.webhook
description: A dynamically generated inbound HTTP endpoint, inbound(callback, subscriber).
---

The reverse of `http.fetch`: instead of the program calling the outside world, the outside world
calls the program. Calls route to the runtime's `webhook` reactor (in-runtime, like `http.fetch` /
`mcp.*`; no FFI sidecar). Called qualified as `webhook.` via the default import. Because these are
external calls they perform `io`, adding `io` to the caller's effect row.

## Agents

### `webhook.inbound`

```katari
external agent inbound[R, effect E](
  callback: agent never -> unknown with E,
  subscriber: agent (url: string) -> R with E,
) -> R with E from "webhook"
```

Issues an unguessable public URL that lives only as long as `subscriber` is running. Every POST to
that URL is converted into a call to `callback`: the JSON body becomes the arguments (a body that
does not conform to `callback`'s input schema is rejected with 400 and `callback` never runs), and
`callback`'s result becomes the JSON response. Possessing the URL is the only credential; it is
mounted outside the bearer-authenticated API surface, and no one else can call it.

`subscriber` owns the URL's lifetime: it receives the issued URL, typically registers it with an
external service (a calendar push-notification API, a repository's webhook configuration, usually
via FFI), and stays alive for as long as deliveries should flow. When `subscriber` returns, the URL
is revoked and its result becomes `inbound`'s result. Canceling the run cancels `subscriber`
(running its FFI cleanup) and revokes the URL through the same path.

```katari title="webhook.ktr"
agent double(value: integer) -> integer {
  value * 2
}

agent self_subscriber(url: string) -> string {
  let first = deliver(url = url, value = 21)
  f"delivered: ${first}"
}

agent deliver(url: string, value: integer) -> string {
  let response = http.fetch(
    url = url,
    method = "POST",
    headers = record.empty(),
    body = json.to_text(value = { value = value }),
  )
  response.body
}

agent main() -> string {
  webhook.inbound(callback = double, subscriber = self_subscriber)
}
```

An HTTP wait that was in flight across a restart is lost (the provider's own retry redelivers it),
but the URL itself is durable: it survives restarts until `subscriber` settles.

## Related

<DocCards>
  <DocCard href="{docs}/{currentVersion}/standard-library/http" />
  <DocCard href="{docs}/{currentVersion}/standard-library/mcp" />
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/runtime" />
</DocCards>
