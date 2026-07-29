# google_common — the Google REST plumbing `gmail` and `google_calendar` share

A single module, `google_common`: the three moves every Google REST integration makes identically — the
`Authorization: Bearer` header, the 401/403-versus-everything-else classification, and the authenticated
**call**, for every verb. Pure Katari, no sidecar, no credential of its own.

**This is a library for packages, not a tool set.** Nothing here is handed to a model, and an app does not
import it: `gmail` and `google_calendar` depend on it and it arrives as their transitive dependency. If you
are wiring a bot, you want [`gmail`](../gmail) or [`google_calendar`](../google_calendar) — this is what
they are built out of. It is here for the *next* Google package too, which should not start from a fourth
copy of the same forty lines.

- `google_common.bearer(token)` — the `{ "Authorization" = "Bearer <token>" }` header record. `token` is a
  `string of private`; concatenation propagates the taint and a header record is a private-capable
  submission sink, so the secret leaves only toward Google's server — never into a URL, a log or a trace.
- `google_common.classify_api_error(context, status, body)` — a failed response as an
  **`http.api_failure`**: a 401 or 403 is `http.auth_error`, every other non-2xx is `http.api_error`. It is
  `http.classify_status` under the name the Google packages spell, so the reading is the stdlib's and
  every authenticated REST package shares it. `context` names the call (`"list_events"`, `"send"`,
  `"watch"`) and rides on the error *beside* the status and the server's body, not folded into a sentence.
- `google_common.call(method, url, body, context, token)` — **one** authenticated call for GET, POST,
  PATCH and DELETE. `body` is a value tree sent as application/json, or `null` for a call that carries no
  document. Returns the reply parsed as a JSON value — or `null` for a 2xx with an empty body, which is
  what a 204 No Content always is. A non-2xx throws the classified failure; a 2xx body that is not JSON
  throws `json.parse_error`.
- `google_common.google_get(url, context, token)` — `call` with the method fixed to `"GET"` and no
  request document. What is left of the helper this package started as.

**Breaking in 0.2.0.** `call` is new and `google_get` is now a skin over it; `classify_api_error` keeps its
signature but delegates to `http.classify_status`, so the `http.auth_error` / `http.api_error` it produces
now carry a `status` and a `context` field and their `message` is the server's body *verbatim* rather than
a `"<context> failed (status N): <body>"` sentence. A renderer that showed `message` alone now shows the
three parts it chooses.

## Why it exists

`gmail` and `google_calendar` are two views of one account behind one OAuth credential, and they were
written independently. By the time both existed, those three agents were **byte-for-byte identical** in the
two files — comments included — which is not a coincidence but what "the same server, the same auth scheme,
the same error envelope" looks like when two packages each spell it out. The cost was drift: a fix to one
(the 403-is-auth reading, say) had no way of reaching the other.

The **403 decision** is the part worth having in one place. Google returns 403 both for a token that may not
do this and for a quota that is spent, and it is read as *auth*. The asymmetry is the argument: a quota 403
that is replayed simply fails again, costing one wasted retry, while reading a revoked token as a quota
problem costs the recovery entirely — the `replay` converter never re-resolves the credential, and the
runtime's re-authorization prompt never appears. The argument held for every authenticated REST API and not
only Google's, so it now lives one level further down still, in `http.classify_status`; what stays here is
the name the Google packages call it by.

The **six hand-written writes** are the other half, and the reason `call` exists. The first cut of this
package answered only GET, so `gmail.send`, `gmail.modify_labels`, `create_event`, `update_event`,
`delete_event` and `free_busy` each kept their own `http.fetch` → 2xx test → classify block —
`google_calendar` had even written *"`google_common` has no POST helper"* into its source as the reason.
Six copies of the founding duplication, with the verb as the only difference between them. So the verb is
an argument now, and the bodyless request and the 204's empty reply are absorbed inside `call` rather than
respelled at each site.

## What is deliberately *not* here

**The `credential` request, and therefore `provider`.** A request is a package's own **capability** — the
thing an app grants by installing that package's provider — so moving it here would fuse `gmail`'s and
`google_calendar`'s authority into one row every consumer of either would have to carry. Each package keeps
its own `credential` request and its own `provider`, and passes the **resolved token in as an argument**:

```katari
import google_common

@"The Gmail credential capability — this package's own, served by its own provider."
request credential() -> string of private

@"Issue an authenticated Gmail API call. The header, the 2xx check and the classification are
`google_common`'s; what this adds is the one thing that is Gmail's — the `credential` ask."
agent gmail_call(method: string, url: string, body: unknown | null, context: string) -> unknown with credential | io | prelude.throw[http.api_failure | http.fetch_error | json.parse_error] {
  google_common.call(method = method, url = url, body = body, context = context, token = credential())
}
```

Those few lines stay duplicated in both packages on purpose: they are the lines that say *who each package
is*. Everything downstream of the token is here.

**The error vocabulary.** `http.auth_error` / `http.api_error` / `http.api_failure` are the **stdlib's**
(`prelude.http`), not this package's. That is what lets an app composing `gmail`, `google_calendar` and any
other authenticated REST package write **one** `replay` converter for all of them:

```katari
import google_common

agent read_resiliently(url: string, token: string of private) -> unknown with io {
  use replay.forever(initial_delay_milliseconds = 100.0, factor = 2.0, max_delay_milliseconds = 60000.0)
  use handler {
    request prelude.throw(error: http.api_failure | oauth.server_error | http.fetch_error | json.parse_error) -> never {
      // A rejected token and a transient fault are both replayed: the re-run re-resolves the credential,
      // and one the runtime cannot refresh parks the run on its own authorize escalation.
      replay.interrupted(failure = error)
    }
  }
  google_common.google_get(url = url, context = "example", token = token)
}
```

**The classification itself**, since 0.2.0. `http.classify_status` draws the 401/403 line for every
authenticated REST package in the ecosystem, and it retains the status on the way out so a retry policy
reads a number rather than a sentence. `classify_api_error` stays as the name the Google packages already
spell — one call, delegating — rather than as a second place the line could move.

## Not a synonym for "an error"

`http.api_failure` is the vocabulary of a **REST call's status code**. A package whose failures are not that
— a gateway's own protocol, a websocket login — keeps its own sum, exactly as `discord` and `slack` do.

## Depending on it

```toml
[dependencies]
packages = ["google_common"]
```

Because resolution is root-authoritative, an **application** that has not yet got `google_common` from a
registry snapshot needs its own `[overrides.google_common]` — and, until overrides may name a transitive
dependency, `"google_common"` in its own `packages` list beside `gmail` / `google_calendar`.

## License

MIT.
