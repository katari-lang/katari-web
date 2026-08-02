# google_common — the Google REST plumbing `gmail` and `google_calendar` share

A single module, `google_common`, and two agents: the authenticated **call**, for every verb, and the
**drain** of a paginated listing. Pure Katari, no sidecar, no credential of its own.

This is a library for packages, not a tool set. Nothing here is handed to a model, and an app does not
import it: `gmail` and `google_calendar` depend on it and it arrives as their transitive dependency. To
wire a bot, use [`gmail`](../gmail) or [`google_calendar`](../google_calendar).

- `google_common.call(method, url, body, context, token)` — one authenticated call for GET, POST, PATCH
  and DELETE. `body` is a value tree sent as application/json, or `null` for a call that carries no
  document. Returns the reply parsed as a JSON value, or `null` for a 2xx with an empty body (a 204 No
  Content). `token` is a `string of private`; it is concatenated into the `Authorization: Bearer` header,
  and since a header record is a private-capable submission sink the secret leaves only toward Google's
  server — never into a URL, a log or a trace.
- `google_common.paged(base_url, item_key, context, token)` — drain a paginated listing: GET the first
  page, take its items from under `item_key` (`"messages"` for a `messages.list`, `"items"` for an
  `events.list`), follow `nextPageToken` to exhaustion, and answer every page's items concatenated in page
  order. `base_url` must already carry its query string (`&pageToken=` is appended). Items come back
  unparsed, as `unknown` — what one *is* is the calling package's parse.

## Failures

A non-2xx throws **`http.api_failure`**, classified by `http.classify_status`: a 401 or 403 is
`http.auth_error`, every other status is `http.api_error`. Both carry the status, the `context` and
Google's own body as `message`. A 2xx body that is not JSON throws `json.parse_error`; a request that never
completes throws `http.fetch_error`.

Google returns 403 both for a token that may not do this and for a spent quota, and both are read as auth:
a replayed quota 403 costs one wasted retry, while reading a revoked token as a quota problem loses the
credential re-resolution entirely.

The vocabulary is the stdlib's (`prelude.http`), not this package's, so an app composing `gmail`,
`google_calendar` and any other authenticated REST package writes one `supervise` converter for all of
them.

## The credential stays in each package

A request is a package's own capability — the thing an app grants by installing that package's provider —
so `credential` and `provider` live in `gmail` and `google_calendar` rather than here. Each passes the
resolved token in as an argument:

```katari
import google_common

@"The Gmail credential capability — this package's own, served by its own provider."
request credential() -> string of private

@"Issue an authenticated Gmail API call: `google_common.call` with this package's `credential` ask added."
agent gmail_call(method: string, url: string, body: unknown | null, context: string) -> unknown with credential | io | prelude.throw[http.api_failure | http.fetch_error | json.parse_error] {
  google_common.call(method = method, url = url, body = body, context = context, token = credential())
}
```

## Secrets / env

None. The token is the caller's.

## Depending on it

```toml
[dependencies]
packages = ["google_common"]
```

Because resolution is root-authoritative, an application that has not yet got `google_common` from a
registry snapshot needs its own `[overrides.google_common]` — and, until overrides may name a transitive
dependency, `"google_common"` in its own `packages` list beside `gmail` / `google_calendar`.

## License

MIT.
