# google_calendar — Google Calendar tools for Katari

A single module, `google_calendar`: five tools the model can call — `list_events`, `free_busy`,
`create_event`, `update_event`, `delete_event` — and a notification watcher, `watch`, over Google's Calendar
API. Pure Katari: every API call is `http.fetch` with the request built and the reply parsed as `json`. No
FFI sidecar, and no OAuth plumbing in the program — authentication is the runtime's credentials core,
reached through the stdlib's `oauth.token`.

- `google_calendar.list_events(calendar_id, time_min, time_max, max_results?)` — upcoming events in a
  window, trimmed to id / summary / start / end / link. A recurring event arrives expanded into its
  individual occurrences, each with its own id.
- `google_calendar.free_busy(calendar_id, time_min, time_max)` — the busy windows over a range, merged
  across events and carrying no titles: the openings are the gaps between them.
- `google_calendar.create_event(calendar_id, summary, start, end, description?, recurrence?, time_zone?)` —
  create an event, or a whole recurring series in one call.
- `google_calendar.update_event(calendar_id, event_id, summary?, start?, end?, description?)` — a partial
  edit. An omitted field (`null`) is left alone; a field passed as `""` is emptied.
- `google_calendar.delete_event(calendar_id, event_id)` — remove an event, or a whole series.
- `google_calendar.watch(calendar_id, lead_time_milliseconds, poll_interval_milliseconds, cursor_at, deliver_to)` —
  a daemon that delivers each upcoming timed event to `deliver_to(value = …)` as it enters the lead window.
  Never resolves; composes under `parallel [ … ]`.
- `google_calendar.provider(source, continuation)` — provides the capability the tools require
  (`credential`) for the extent of a continuation, by resolving a `credentials.source` through the runtime
  on every ask. It holds no secret and keeps no cache: the runtime owns the token material and its refresh,
  and the resolved token is a `string of private` that flows only to the `Authorization: Bearer` header.

`gmail` and `google_calendar` share one Google credential and one piece of plumbing — the `Bearer` header,
the 401/403 classification and the authenticated call — in `google_common`, their transitive dependency.

## Times and ids

`time_min` / `time_max` / `start` / `end` are RFC3339 timestamps (`"2026-07-11T15:00:00+09:00"`), and
`calendar_id` is `"primary"` for the user's own calendar or an address like `"team@example.com"`.

Both listings pin `singleEvents=true`, so Google expands a series into one entry per occurrence with its own
id and start. The id you hand to `update_event` / `delete_event` therefore decides the reach: the
series-master id (what `create_event` returned) edits or deletes every occurrence, while an occurrence's id
(what `list_events` returns) affects only that one, recorded as an exception to the series. There is no
third reach: "this and all following" is not something these tools express. The recurrence rule itself is
not patchable — to change a series' schedule, `delete_event` the master and `create_event` a new series.

## Recurring events

A recurrence is an attribute of an event: `create_event` takes an optional `recurrence` (RFC 5545 rules,
passed to Google verbatim, with Google as the validator) and an optional `time_zone`, so "every Wednesday
and Sunday until the end of August" is one call. `start` / `end` describe the first occurrence, and the rule
repeats it.

| Intent | Rule |
| --- | --- |
| every Wednesday and Sunday, through 2026-08-31 | `RRULE:FREQ=WEEKLY;BYDAY=WE,SU;UNTIL=20260831T000000Z` |
| every weekday, 10 occurrences | `RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;COUNT=10` |
| the same day of every month, no end | `RRULE:FREQ=MONTHLY` |
| every day, no end | `RRULE:FREQ=DAILY` |

`UNTIL` is a compact UTC timestamp (`YYYYMMDDTHHMMSSZ` — no dashes or colons, unlike `start` / `end`) and is
inclusive; `COUNT` is the other way to end a series. Give one or neither. Weekdays are the two-letter
`MO TU WE TH FR SA SU`.

`time_zone` is an IANA name (`"Asia/Tokyo"`, `"America/New_York"`) and is Google's requirement on a
recurring event: it is the frame the rule is expanded in, which fixes whose 10:00 "every Wednesday at 10:00"
means and keeps an occurrence at 10:00 local across a daylight-saving shift. A recurring event without it is
rejected as an `http.api_error` (a 400); a single event needs none, its RFC3339 offset having already fixed
one instant.

## Failures

Three meanings, decided at three boundaries:

- A credential that needs a human — never authorized, or its refresh is dead — pauses the run on a
  `prelude.oauth.authorize` escalation, which the admin console and `katari answer` render as an
  authorization request; completing the browser flow resumes the run where it stopped.
- `oauth.server_error` (stdlib) — the token could not be resolved for a transient reason. Thrown at the
  provider.
- `http.api_failure = http.auth_error | http.api_error` (stdlib) — the Calendar API's own failures,
  classified by `http.classify_status` where `google_common.call` reads a response, both carrying `status`,
  `context` and `message`. `http.auth_error` is a 401/403: replaying the call resolves the token afresh, the
  runtime refreshes the credential once its stored lifetime passes, and one it cannot refresh parks the run
  as a re-authorization prompt. `http.api_error` is any other non-2xx; read `status`, since 408 / 429 / 5xx
  are worth a backoff.

The pair is the stdlib's, so one `supervise` converter covers `gmail` and every other authenticated REST
package beside this one. `watch` adds `google_calendar.watch_misconfigured` for a poll interval wider than
the lead window — a program defect, so the fix is the constants rather than a retry.

## Secrets / env

None in the program: the runtime hosts the OAuth flow — browser consent, redirect callback, token exchange,
storage and refresh — and the program names the credential.

1. In [console.cloud.google.com](https://console.cloud.google.com), create or select a project and enable
   the **Google Calendar API**. Configure the OAuth consent screen; a Testing app's refresh tokens expire
   after 7 days, so publish the app (or use Internal on a Workspace domain) for a daemon that keeps running.
2. Create an **OAuth client ID** of type Web application, with the runtime's callback as an authorized
   redirect URI: `<public-url>/oauth/callback` (`KATARI_PUBLIC_URL`; locally
   `http://localhost:3000/oauth/callback`).
3. In the admin console, open the project's **Credentials** page and press **Register client**:

| Field | Value |
| --- | --- |
| Name | `google` (whatever name the program passes to `credentials.oauth`) |
| Issuer | `https://accounts.google.com` |
| Authorization endpoint | `https://accounts.google.com/o/oauth2/v2/auth` |
| Token endpoint | `https://oauth2.googleapis.com/token` |
| Client ID / Client secret | from the console (the secret is write-only) |
| Scopes | `https://www.googleapis.com/auth/calendar` |
| Extra authorize parameters | `access_type=offline prompt=consent` |

`access_type=offline` is what makes Google issue a refresh token, and `prompt=consent` makes it re-issue one
on a later re-authorization. Press **Log in** on the client's row to store the credential, or let the first
`credential` ask of a run pause on its authorization escalation and log in from there. For several Google
accounts, register the same client under several names and pick one per scope.

## Usage

```katari
import google_calendar

agent upcoming(calendar_id: string, time_min: string, time_max: string) -> array[google_calendar.event] with io | prelude.throw[env.missing_secret | oauth.server_error | http.api_failure | http.fetch_error | json.parse_error] {
  use google_calendar.provider(source = credentials.oauth(name = "google"))
  google_calendar.list_events(calendar_id = calendar_id, time_min = time_min, time_max = time_max)
}
```

Hand the five tools to an AI loop's tool list to let the model read and schedule on its own; each carries a
model-facing `@doc`.

## The watch

`google_calendar.watch` is `poll.subscribe` — the stdlib's durable-subscription skeleton — under a Calendar
adapter, so it speaks that module's guarantees. It delivers a timed event as its start enters the lead
window; the events already inside that window when the watch starts are recorded on the first poll, so what
it reports is an event entering the window from then on, and `list_events` answers "what is coming up".
All-day events are outside its scope, having no instant to place in the window.

Delivery is at-least-once, deduped per `(event id, start time)`. The commit lands only after a delivery
returns, so a crash or a throw in between re-delivers exactly that event on the next tick; exactly-once is
built at the destination, by making the delivery idempotent on that pair. An event whose start moved is a
different pair, so it re-notifies. The memory keeps the most recent 200 keys and forgets by age.

`cursor_at` decides what a restart does, and has no default. `poll.resume(key = "…")` keeps the memory in
the store, so a runtime restart, a re-forked fiber and a `replay` re-run all come back holding the keys they
already delivered — give each watch a key of its own. `poll.fresh()` keeps it in the run alone, priming
again on the activation's first poll. Neither backfills: a seen-set subscription has no floor to list from,
so what crossed the window while the watch was down stays behind it. (`gmail.watch` has a receive clock, so
its `resume` does deliver the downtime.)

`poll_interval_milliseconds` must not exceed `lead_time_milliseconds`, since the gap `(T+lead, T+poll)`
belongs to no window; a wider interval is rejected at entry with `google_calendar.watch_misconfigured`.

```katari
import google_calendar
import discord

@"Notify a Discord channel 10 minutes before each event, checking every minute."
agent remind(calendar_id: string, channel: string) -> never with io | store.get | store.set | prelude.throw[google_calendar.watch_misconfigured | http.api_failure | discord.discord_error | env.missing_secret | oauth.server_error | http.fetch_error | json.parse_error] {
  use discord.provider(source = credentials.env(key = "DISCORD_TOKEN"))
  use google_calendar.provider(source = credentials.oauth(name = "google"))
  agent notify(value: google_calendar.event) -> null {
    let _posted = discord.send_message(channel = channel, text = f"Upcoming: ${value.summary} at ${value.start}\n${value.html_link}", files = [])
  }
  google_calendar.watch(
    calendar_id = calendar_id,
    lead_time_milliseconds = 600000,
    poll_interval_milliseconds = 60000,
    cursor_at = poll.resume(key = "calendar-reminders"),
    deliver_to = notify,
  )
}
```

`deliver_to`'s effects flow out to the app's handlers unchanged. A poll failure propagates and kills the
watch; resilience is composed around it with a `prelude.supervise` provider and a converter that replays
the transient failures and `http.auth_error` alike, and re-raises `watch_misconfigured`.

## License

MIT.
