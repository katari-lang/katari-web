---
title: Secrets and credentials
description: Store secrets in the project env, keep them out of results and traces by type, and let the runtime own your OAuth tokens.
---

Katari splits configuration into three tiers: plain env entries (public strings), **secrets**
(values the type system confines to submission sinks), and **OAuth credentials** (tokens the
runtime owns outright — they never enter your program at all).

## Store a secret

```sh
katari env set TAVILY_API_KEY --secret
```

With no value argument the CLI prompts with echo off, so the secret lands in neither shell
history nor scrollback; you can also pipe it on stdin, or pass it as a plain argument (fine for
non-secrets). A secret is encrypted at rest and write-only over the API: `katari env get` refuses
it, and only a running program can read it back.

An entry set without `--secret` is an ordinary knob, and a program reads one with `env.get_or`,
which is total — the fallback is what an unset knob means, so there is nothing to catch and nothing
to branch on:

```katari
@"A non-secret knob with the value an unset one means; total, so there is nothing to catch."
agent page_size() -> integer {
  match (string.to_integer(value = env.get_or(key = "PAGE_SIZE", fallback = "50"))) {
    case null -> 50
    case size -> size
  }
}
```

## Read it in a program

```katari
@"Call a bearer-protected API with a key from the project's env store."
agent main() -> string with io | prelude.throw[env.missing_secret | http.fetch_error] {
  let key = env.get_secret(key = "EXAMPLE_API_KEY")
  let response = http.fetch(
    url = "https://api.example.com/profile",
    headers = { "Authorization" = "Bearer " ++ key },
  )
  response.body
}
```

`env.get_secret` returns a `string of private` — a tainted string. Concatenating onto it
(`"Bearer " ++ key`) stays private; the taint follows the value wherever it flows. A private value
may leave the runtime only toward a deliberate submission sink, and it is redacted at every
user-facing boundary: a run result, the trace, an escalation. You cannot accidentally return a
secret to a caller.

## What the type system stops

`http.fetch` encodes the flow policy in its signature. Header values are `string of private` and the
body is a four-way sum (`http.text` / `http.binary` / `http.multipart` / `http.json`) whose text and
JSON slots are private-capable, so a secret may be submitted as an auth header or inside a body,
revealed only to the one server the program named. `url` and `method` are public `string`, because a
URL leaks into logs, caches, proxies and `Referer` headers. Interpolating a secret into a URL is a
compile error:

```text
let response = http.fetch(
  url = "https://api.example.com/lookup?key=" ++ key,   // a secret in a public position
  ...

profile:3:18 K3001: The actual value is private (a secret), but this position accepts only a
public value — a secret may not flow out of the private context that observes it. Mark the
position `of private` too, or keep the secret out of it.
  expected: public
  actual:   private
```

The response is public — it is the server's reply, not a function of the secret — so ordinary
code consumes it freely. The FFI boundary is a sink too: a package like `e2b` passes
`api_key: string of private` straight through to its sidecar. See
[Types and schemas]({docs}/{currentVersion}/concepts/types-and-schemas) for how `of private`
fits the type system.

## Fall back when a secret is missing

A missing secret is an anticipated configuration failure, so `get_secret` throws a typed
`env.missing_secret` you can catch — an optional integration degrades instead of failing the run:

```katari
@"An optional integration: a missing key disables the feature instead of failing the run."
agent notify(message: string) -> string with io | prelude.throw[http.fetch_error] {
  use handler {
    request prelude.throw(error: env.missing_secret | http.fetch_error) -> never {
      match (error) {
        case env.missing_secret(_) -> { break "(notifications disabled)" }
        // The residual is exactly `http.fetch_error` — rethrown as bound, and it stays on the row.
        case rest -> { prelude.throw(error = rest) }
      }
    }
  }
  let response = http.fetch(
    url = "https://api.example.com/notify",
    method = "POST",
    headers = { "Authorization" = "Bearer " ++ env.get_secret(key = "NOTIFY_API_KEY") },
    body = http.json(value = { text = message }),
  )
  response.body
}
```

Two things about that guard are forced rather than chosen. It wraps the call instead of branching on
the value it reads, because observing a private value taints what you compute from it: a `match` on
the secret would make the answer private too, and a public `string` result would stop compiling.
Reading the secret straight into the header sink keeps the taint on the one path allowed to carry it,
and `break` supplies the public fallback from outside that path.

The clause also names `env.missing_secret | http.fetch_error`, the whole union the block can throw,
because a `prelude.throw` clause cannot catch a subset: it takes everything and re-raises what it is
not answering. That rule and its geometry are in
[Handler geometry]({docs}/{currentVersion}/guides/handler-geometry).

## Hand a credential to a package

A package's provider does not take the secret's value. It takes a `credentials.source` — a name for
where the credential lives — and resolves the current value itself at each use:

```katari
@"Search with the key the provider resolves per use."
agent search(question: string) -> string with io | prelude.throw[env.missing_secret | oauth.server_error | http.api_failure | http.fetch_error | json.parse_error] {
  use tavily.provider(source = credentials.env(key = "TAVILY_API_KEY"))
  json.stringify(value = tavily.search(query = question))
}
```

`credentials.env(key = ...)` names an entry in the env store (resolved with `env.get_secret`,
throwing `env.missing_secret` when unset); `credentials.oauth(name = ...)` names a stored OAuth
credential (resolved with `oauth.token`, below). The app picks the variant and the package never
knows which — and because resolution happens per use, a rotated secret or a refreshed token lands
without a restart. That is why a provider's throw row carries both `env.missing_secret` and
`oauth.server_error`: which one can fire depends on the source you pass, and the type covers the sum.

## Let the runtime own OAuth tokens

For an OAuth-protected API, don't store tokens in the env at all. `oauth.token` names a stored
credential; the runtime holds the token material, refreshes it on demand, and hands your program a
short-lived bearer as a private string:

```katari
@"Call the GitHub API as the stored \"github\" credential. If the credential is missing or dead,
the run parks on an authorization escalation and resumes once someone completes the browser flow."
agent main() -> string with io | prelude.throw[oauth.server_error | http.fetch_error] {
  let bearer = oauth.token(name = "github")
  let response = http.fetch(
    url = "https://api.github.com/user",
    headers = { "Authorization" = "Bearer " ++ bearer },
  )
  response.body
}
```

The contract is pause-and-ask, never fail: when the named credential has no usable token — never
authorized, or its refresh died, even mid-run — `token` does not throw. The run parks on a
`prelude.oauth.authorize` [escalation]({docs}/{currentVersion}/concepts/escalation); the admin
console renders it as an authorization card, `katari answer` drives the same browser flow from the
terminal, and completing it resumes the run where it stopped. Only a transient resolution failure
(the token endpoint down mid-refresh) throws the catchable `oauth.server_error`. Token material never
crosses the escalation answer or the audit log — the flow deposits it server-side, and the answer is
just the resume signal.

## Register a credential

A credential comes from one of two acquisition profiles, and everything after acquisition —
storage, refresh, the authorize escalation — is shared:

- **configured** — you register an OAuth client in the admin console's Credentials page (issuer,
  authorize / token endpoints, client id, an optional write-only client secret, scopes). Then either
  press Log in to establish the credential before any run, or just run the workflow: the first
  `oauth.token(name = ...)` parks on the authorize escalation and the same flow completes it.
- **mcp** — `mcp.oauth(name = ...)` on an [MCP connection]({docs}/{currentVersion}/guides/mcp)
  derives the client automatically from the server's metadata (discovery plus dynamic client
  registration); there is nothing to register first.

The Credentials page also lists every stored credential and lets you forget one, forcing a fresh
authorization on next use — for example to switch accounts.

## Where to go next

<DocCards>
  <DocCard href="{docs}/{currentVersion}/concepts/escalation" />
  <DocCard href="{docs}/{currentVersion}/guides/packages" />
</DocCards>

The `env`, `oauth` and `http` modules' own signatures are in the [reference](/packages).
