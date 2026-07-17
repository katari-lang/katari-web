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
non-secrets). A secret is encrypted at rest and **write-only over the API**: `katari env get`
refuses it, and only a running program can read it back. Non-secret entries set without
`--secret` are readable in bulk from a program via `env.get_all`.

## Read it in a program

```katari
@"Call a bearer-protected API with a key from the project's env store."
agent main() -> string with io | prelude.throw[env.missing_secret | http.fetch_error] {
  let key = env.get_secret(key = "EXAMPLE_API_KEY")
  let response = http.fetch(
    url = "https://api.example.com/profile",
    method = "GET",
    headers = record.set(target = record.empty(), key = "Authorization", value = "Bearer " ++ key),
    body = "",
  )
  response.body
}
```

`env.get_secret` returns a `string of private` — a **tainted** string. Concatenating onto it
(`"Bearer " ++ key`) stays private; the taint follows the value wherever it flows. A private
value may leave the runtime only toward a deliberate **submission sink**, and it is redacted at
every user-facing boundary: a run result, the trace, an escalation. You cannot accidentally
return a secret to a caller.

## What the type system stops

`http.fetch` encodes the flow policy in its signature: header **values** and the **body** are
`string of private` — a secret may be submitted as an auth header or inside a form body, revealed
only to the one server the program named — while `url` and `method` are public `string`, because
a URL leaks into logs, caches, proxies, and `Referer` headers. Interpolating a secret into a URL
is a compile error:

```text
let response = http.fetch(
  url = "https://api.example.com/lookup?key=" ++ key,   // a secret in a public position
  ...

profile:3:18 K3001: Private attribute cannot be a subtype of public attribute
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
  let key = {
    use handler {
      request prelude.throw(error: env.missing_secret) -> never { break null }
    }
    env.get_secret(key = "NOTIFY_API_KEY")
  }
  match (key) {
    case null -> "(notifications disabled)"
    case value -> {
      let response = http.fetch(
        url = "https://api.example.com/notify",
        method = "POST",
        headers = record.set(target = record.empty(), key = "Authorization", value = "Bearer " ++ value),
        body = json.to_text(value = { text = message }),
      )
      response.body
    }
  }
}
```

## Let the runtime own OAuth tokens

For an OAuth-protected API, don't store tokens in the env at all. `oauth.token` names a stored
**credential**; the runtime holds the token material, refreshes it on demand, and hands your
program a short-lived bearer as a private string:

```katari
@"Call the GitHub API as the stored \"github\" credential. If the credential is missing or dead,
the run parks on an authorization escalation and resumes once someone completes the browser flow."
agent main() -> string with io | prelude.throw[oauth.server_error | http.fetch_error] {
  let bearer = oauth.token(name = "github")
  let response = http.fetch(
    url = "https://api.github.com/user",
    method = "GET",
    headers = record.set(target = record.empty(), key = "Authorization", value = "Bearer " ++ bearer),
    body = "",
  )
  response.body
}
```

The contract is **pause-and-ask, never fail**: when the named credential has no usable token —
never authorized, or its refresh died, even mid-run — `token` does not throw. The run parks on a
`prelude.oauth.authorize` [escalation]({docs}/{currentVersion}/concepts/escalation); the admin
console renders it as an authorization card with an "Authorize" button, `katari answer` drives
the same browser flow from the terminal, and completing it resumes the run right where it
stopped. Only a _transient_ resolution failure (the token endpoint down mid-refresh) throws the
catchable `oauth.server_error`. Token material never crosses the escalation answer or the audit
log — the flow deposits it server-side and the answer is just the resume signal.

## Register a credential

A credential comes from one of two acquisition profiles, and everything after acquisition —
storage, refresh, the authorize escalation — is shared:

- **configured** — you register an OAuth client in the admin console's Credentials page (issuer,
  authorize / token endpoints, client id, an optional write-only client secret, scopes). Then
  either press **Log in** to establish the credential proactively before any run, or just run the
  workflow — the first `oauth.token(name = ...)` parks on the authorize escalation and the same
  flow completes it.
- **mcp** — `mcp.oauth(name = ...)` on an [MCP connection]({docs}/{currentVersion}/guides/mcp)
  derives the client automatically from the server's metadata (discovery plus dynamic client
  registration); there is nothing to register first.

The Credentials page also lists every stored credential and lets you **Forget** one — forcing a
fresh authorization on next use, for example to switch accounts.

## Where to go next

- [Escalation]({docs}/{currentVersion}/concepts/escalation) — the park-and-resume machinery
  authorization rides on.
- [Packages]({docs}/{currentVersion}/guides/packages) — registry packages take their keys via
  `env.get_secret` provider arguments.
- The `env`, `oauth`, and `http` modules in the [reference](/reference).
