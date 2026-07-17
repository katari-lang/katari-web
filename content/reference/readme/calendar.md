# calendar — Google Calendar tools for Katari

A single module, `calendar`: two tools the model can call — `list_events` and `create_event` — backed
by Google's OAuth refresh-token grant. Pure Katari over `http.fetch`: the token exchange and both
Calendar API calls build their request and parse their reply as `json`. No FFI sidecar.

- `calendar.list_events(calendar_id, time_min, time_max, max_results?)` — upcoming events in a
  window, trimmed to id / summary / start / end / link.
- `calendar.create_event(calendar_id, summary, start, end, description?)` — create an event.
- `calendar.provider(client_id, client_secret, refresh_token)` — provides the OAuth credentials (each
  a `string of private`) for the extent of a continuation. Each tool call exchanges the refresh token
  for a fresh access token.

## Secrets / env

Three OAuth values, provisioned as runtime **secrets** (`--secret`) and read with `env.get_secret`:

```sh
katari env set GOOGLE_OAUTH_CLIENT_ID     --secret
katari env set GOOGLE_OAUTH_CLIENT_SECRET --secret
katari env set GOOGLE_OAUTH_REFRESH_TOKEN --secret
```

They can be secrets now because Katari's request body is a private-capable sink (the body-sink rule): a
`string of private` may leave the runtime through a request's submission surfaces — a header value *and*
the body — so these credentials ride the token endpoint's `application/x-www-form-urlencoded` body
(where the refresh token, which has no header form at all, must go), revealed only at the transport
boundary for the one server the program named — never read back out as a plain string.

To get a refresh token: create an OAuth client (type "Web application" or "Desktop app") in the
Google Cloud console, enable the Google Calendar API, then use the
[OAuth 2.0 Playground](https://developers.google.com/oauthplayground) with your own credentials to
authorize the `https://www.googleapis.com/auth/calendar` scope and exchange the code — the response's
`refresh_token` is the value to store.

## Usage

```katari
import calendar

agent upcoming(calendar_id: string, time_min: string, time_max: string) -> array[calendar.event] with io | prelude.throw[env.missing_secret | calendar.calendar_error | http.fetch_error | json.parse_error] {
  use calendar.provider(
    client_id = env.get_secret(key = "GOOGLE_OAUTH_CLIENT_ID"),
    client_secret = env.get_secret(key = "GOOGLE_OAUTH_CLIENT_SECRET"),
    refresh_token = env.get_secret(key = "GOOGLE_OAUTH_REFRESH_TOKEN"),
  )
  calendar.list_events(calendar_id = calendar_id, time_min = time_min, time_max = time_max)
}
```

Hand `calendar.list_events` / `calendar.create_event` to an AI loop's tool list to let the model read
and schedule on its own. A failed call throws `calendar.calendar_error` — handle it at the app root.
