# google_calendar — Google Calendar tools for Katari

A single module, `google_calendar`: two tools the model can call — `list_events` and `create_event` —
and a notification watcher, `watch` — over Google's Calendar API. Pure Katari: every API call is
`http.fetch` with the request built and the reply parsed as `json`. No FFI sidecar — and no OAuth
plumbing in the program: authentication is the runtime's credentials core, reached through the stdlib's
`oauth.token`.

- `google_calendar.list_events(calendar_id, time_min, time_max, max_results?)` — upcoming events in a
  window, trimmed to id / summary / start / end / link.
- `google_calendar.create_event(calendar_id, summary, start, end, description?)` — create an event.
- `google_calendar.watch(calendar_id, lead_time_milliseconds, poll_interval_milliseconds, deliver_to)` — a
  daemon that delivers each upcoming **timed** event to `deliver_to` as it enters the lead window
  (at-least-once, deduped per `(id, start)` within a single activation). Never resolves; composes under
  `parallel [ … ]`.
- `google_calendar.provider(name?)` — provides the capability the tools require (`get_access_token`)
  for the extent of a continuation, by resolving the **stored credential** named `name` (default
  `"google"`) through the runtime on every ask. The provider holds no secret and keeps no cache: the
  runtime owns the token material, serves the stored access token while its recorded lifetime holds,
  and refreshes it against the stored token endpoint once due. The resolved token is a
  `string of private` — it flows only to the `Authorization: Bearer` header, never to a user-facing
  boundary.

## Failure model

Three meanings, decided at three boundaries:

- **The credential needs a human** — it was never authorized, or its refresh is dead. This is **never
  an error**: `oauth.token` pauses the run on a `prelude.oauth.authorize` escalation (the admin console
  and `katari answer` render it as an authorization request), and completing the browser flow resumes
  the run right where it stopped. Nothing to catch — a pause, not a throw.
- **`oauth.server_error`** (stdlib) — the token could not be resolved for a **transient** reason: a
  network error, or the token endpoint failing (5xx) while refreshing. Thrown at the provider; retry it
  like any transport blip.
- **`google_calendar.calendar_error = google_calendar.auth_error | google_calendar.api_error`** — the
  Calendar API's own failures, classified once:
  - `auth_error` — a 401/403: Google rejected the resolved access token (revoked before its stored
    expiry, or scoped too narrowly). Retrying the *same* token does not help, but **replaying the call
    does**: the re-run resolves the token afresh, the runtime refreshes the credential once its stored
    lifetime passes, and a credential the runtime cannot refresh parks the run as a re-authorization
    prompt. No app-owned escalation is needed.
  - `api_error` — any other non-2xx (a bad request, a missing calendar, a quota or server error).
    Usually transient; a plain backoff retry is the right response.

## Setup: register the Google OAuth client, then log in

The runtime hosts the whole OAuth flow — the browser consent, the redirect callback, the token
exchange, storage and refresh. You register a Google OAuth client with the runtime once; programs then
name the credential and never see a token.

### 1. Create the OAuth client in the Google Cloud console

1. In [console.cloud.google.com](https://console.cloud.google.com), create (or select) a project and
   enable the **Google Calendar API** (APIs & Services → Library).
2. Configure the **OAuth consent screen** (APIs & Services → OAuth consent screen). While the app is in
   *Testing* status, add the Google account you will authorize as a test user — and note that Google
   expires a Testing app's refresh tokens after 7 days, so **publish the app** (or use *Internal* on a
   Workspace domain) for a daemon that must keep running.
3. Create the client: APIs & Services → Credentials → Create Credentials → **OAuth client ID**, type
   **Web application**. Add the runtime's callback as an **authorized redirect URI**:
   `<public-url>/oauth/callback`, where `<public-url>` is the runtime's public base URL
   (`KATARI_PUBLIC_URL`; the local default is the runtime's own address, e.g.
   `http://localhost:3000/oauth/callback`).
4. Note the **Client ID** and **Client secret**.

### 2. Register the client with the runtime

In the admin console, open your project's **Credentials** page and press **Register client**:

| Field | Value |
| --- | --- |
| Name | `google` (the provider's default credential name) |
| Issuer | `https://accounts.google.com` |
| Authorization endpoint | `https://accounts.google.com/o/oauth2/v2/auth` |
| Token endpoint | `https://oauth2.googleapis.com/token` |
| Client ID / Client secret | from the console (the secret is write-only — it is sealed and never echoed back) |
| Scopes | `https://www.googleapis.com/auth/calendar` |
| Extra authorize parameters | `access_type=offline prompt=consent` |

The extra parameters matter for Google specifically: `access_type=offline` is what makes Google issue a
**refresh token** (without it the credential dies when the first access token expires), and
`prompt=consent` makes Google re-issue one on a later re-authorization instead of silently omitting it.

### 3. Log in

Press **Log in** on the registered client's row and complete the consent screen — the runtime stores
the credential under the client's name. Or skip this: the first `get_access_token` of a run **pauses**
it on an authorization escalation, which the admin console (and `katari answer`) render as the same
login button; authorizing resumes the run.

For several Google accounts, register the same client under several names (e.g. `google_work`) and pick
one per scope: `use google_calendar.provider(name = "google_work")`.

## Usage: the tools

```katari
import google_calendar

agent upcoming(calendar_id: string, time_min: string, time_max: string) -> array[google_calendar.event] with io | prelude.throw[oauth.server_error | google_calendar.calendar_error | http.fetch_error | json.parse_error] {
  use google_calendar.provider()
  google_calendar.list_events(calendar_id = calendar_id, time_min = time_min, time_max = time_max)
}
```

Hand `google_calendar.list_events` / `google_calendar.create_event` to an AI loop's tool list to let the model read
and schedule on its own. A failed call throws `google_calendar.calendar_error` — handle it at the app root.
If the credential is not authorized yet, the run pauses and asks instead of failing.

## Usage: the watch

`google_calendar.watch` polls a calendar and delivers each upcoming **timed** event to your `deliver_to` agent.
Delivery is **at-least-once**, deduped per `(event id, start time)` — but only *within a single watch
activation*. While the watch keeps running (including across a crash-recovery restart, which resumes the
durable dedup memory) an event whose start has not moved is delivered once, and an event whose start
*moved* is a new pair, so it re-notifies. A **replay re-run is a fresh activation** whose memory starts
empty, so a `prelude.replay` provider around the watch (below) re-delivers every event still inside the
lead window; a `deliver_to` failure likewise re-delivers the events after it in that tick on the next run.
All-day events are **not** covered — they have no instant to place in the lead window. The watch never
resolves, so it runs as a `parallel [ … ]` arm (or a standalone entry); its `deliver_to` effects flow out
to the app's handlers unchanged.

`poll_interval_milliseconds` must not exceed `lead_time_milliseconds`: a wider interval leaves the gap
`(T+lead, T+poll)` covered by no window and would silently drop events starting there. That is a program
defect, rejected at entry with `google_calendar.watch_misconfigured` (the `panic` this morally is — a Katari
program cannot raise one — surfaced as a throw).

```katari
import google_calendar
import discord

@"Notify a Discord channel 10 minutes before each event, checking every minute."
agent remind(calendar_id: string, channel_id: string) -> never {
  use discord.provider(token = env.get_secret(key = "DISCORD_TOKEN"))
  use google_calendar.provider()
  agent notify(event: google_calendar.event) -> null {
    discord.send_message(channel_id = channel_id, text = f"Upcoming: ${event.summary} at ${event.start}\n${event.html_link}", files = [])
  }
  google_calendar.watch(
    calendar_id = calendar_id,
    lead_time_milliseconds = 600000,    // look 10 minutes ahead
    poll_interval_milliseconds = 60000, // poll once a minute
    deliver_to = notify,
  )
}
```

`watch` has **no built-in retry**: a poll failure — an http error, a rejected token, a `deliver_to`
that throws — propagates and kills the watch, exactly as an uncaught failure in any callee does.
Resilience is composed *around* the watch with a `prelude.replay` provider, below.

## Composition: resilience with `prelude.replay`

`prelude.replay` splits the retry **mechanism** from the failure **policy**. A `replay` *provider*
re-runs the rest of a block, but it knows nothing about what counts as retriable: it catches exactly one
request, `replay.interrupted`, and re-runs after its delay. Deciding *which* failures become an
`interrupted` is your code — an ordinary `use handler` (a **converter**) installed between the provider
and the block that turns the throws it chooses into `replay.interrupted(failure = …)` and re-raises the
rest.

Under `oauth.token`, the policy collapses to **one converter**. The prototype needed a second, attended
recipe — an app-owned escalation that parked a revoked refresh token for a human — because re-authorization
was the app's problem. It no longer is: a credential that needs a human pauses the run on the *runtime's*
`prelude.oauth.authorize` escalation, inside `get_access_token` itself. So the converter's whole job is:

- **replay** the transient failures (`api_error`, `oauth.server_error`, `http.fetch_error`,
  `json.parse_error`) — back off and re-run;
- **replay `auth_error` too** — the re-run resolves the token afresh; once the rejected token's stored
  lifetime passes the runtime refreshes it, and if the refresh is dead the re-run *pauses for
  re-authorization* on its own. (Until that stored lifetime passes — at most about an hour — the replays
  re-see the same token and fail again, which is why a capped backoff like `replay.forever`, not
  `replay.immediate`, is the right mechanism here.)
- **re-raise** the genuine defects (`watch_misconfigured` — fix the constants, retrying is meaningless).

Two rules the converter must obey — both because a `throw` handler catches the **whole** throw union of
the block it guards, not a subset:

1. **Name every failure the block can raise.** For the block below that is `google_calendar`'s
   `auth_error | api_error | watch_misconfigured`, plus `oauth.server_error` from the provider and
   `http.fetch_error` / `json.parse_error` from the calls. (A `deliver_to` that itself throws — say a
   `discord.send_message` transport error — adds its failure type to that union too.)
2. **Reconstruct a re-raised failure** rather than re-throwing the match scrutinee: `prelude.throw(error
   = error)` would widen the residual back to the whole union, so each propagated case rebuilds its own
   value (`prelude.throw(error = google_calendar.watch_misconfigured(message = message))`).

### The daemon, resilient: one converter over `replay.forever`

```katari
import google_calendar
import discord

@"The calendar reminder daemon: replay transient failures and rejected tokens, propagate the defects.
A credential that needs a human pauses the run on the runtime's authorize escalation — not handled here."
agent remind_resiliently(calendar_id: string, channel_id: string) -> never with io | prelude.throw[google_calendar.watch_misconfigured | env.missing_secret] {
  use discord.provider(token = env.get_secret(key = "DISCORD_TOKEN"))
  agent notify(event: google_calendar.event) -> null {
    discord.send_message(channel_id = channel_id, text = f"Upcoming: ${event.summary}", files = [])
  }
  // MECHANISM: re-run the block after a backoff (100ms, doubling, capped at a minute) on every replay.
  use replay.forever(initial_delay_milliseconds = 100.0, factor = 2.0, max_delay_milliseconds = 60000.0)
  // POLICY: names every failure the block can throw, then dispatches — one defect re-raised, the rest replayed.
  use handler {
    request prelude.throw(error: google_calendar.auth_error | google_calendar.api_error | google_calendar.watch_misconfigured | oauth.server_error | http.fetch_error | json.parse_error) -> never {
      match (error) {
        case google_calendar.watch_misconfigured(message => message) -> { prelude.throw(error = google_calendar.watch_misconfigured(message = message)) } // program defect
        case _ -> { replay.interrupted(failure = error) } // transient, or a rejected token → back off + replay (the re-run re-resolves)
      }
    }
  }
  // INSIDE the replay scope, so a re-run RE-ENTERS the provider and its next `get_access_token`
  // re-resolves the credential through the runtime.
  use google_calendar.provider()
  google_calendar.watch(calendar_id = calendar_id, lead_time_milliseconds = 600000, poll_interval_milliseconds = 60000, deliver_to = notify)
}
```

### The full story: the daemon beside a bot, under one `parallel`

```katari
@"The bot's serve loop — the app's other arm, echoing each message in the channel."
agent discord_serve(channel_id: string) -> never {
  use discord.provider(token = env.get_secret(key = "DISCORD_TOKEN"))
  agent echo(channel_id: string, text: string, files: array[file]) -> null {
    discord.send_message(channel_id = channel_id, text = f"echo: ${text}", files = [])
  }
  discord.watch_messages(channel_id = channel_id, deliver_to = echo)
}

@"The whole app: the reminder daemon and the bot serve loop, side by side and independently resilient.
A `parallel` of two arms is a pair; of two `never` arms, one that is never produced."
agent main(calendar_id: string, channel_id: string) -> [never, never] {
  parallel [
    remind_resiliently(calendar_id = calendar_id, channel_id = channel_id),
    discord_serve(channel_id = channel_id),
  ]
}
```

The `auth_error` / `api_error` split is still what makes the policy precise — but now both arms replay,
for different reasons: an `api_error` replay re-runs the *same* call past a transient fault, while an
`auth_error` replay is a *token re-resolution* whose end state, when a human really is needed, is the
runtime's own re-authorization pause. The one failure the converter re-raises is the one no replay can
change: a miswired watch.
