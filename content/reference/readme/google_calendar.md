# google_calendar — Google Calendar tools for Katari

A single module, `google_calendar`: two tools the model can call — `list_events` and `create_event` —
and a notification watcher, `watch` — over Google's Calendar API. Pure Katari: every API call is
`http.fetch` with the request built and the reply parsed as `json`. No FFI sidecar — and no OAuth
plumbing in the program: authentication is the runtime's credentials core, reached through the stdlib's
`oauth.token`.

- `google_calendar.list_events(calendar_id, time_min, time_max, max_results?)` — upcoming events in a
  window, trimmed to id / summary / start / end / link. A recurring event arrives **expanded** into its
  individual occurrences, each with its own id.
- `google_calendar.create_event(calendar_id, summary, start, end, description?, recurrence?, time_zone?)` —
  create an event, or a whole **recurring series** in one call (see [Recurring events](#recurring-events)).
- `google_calendar.update_event(calendar_id, event_id, summary?, start?, end?, description?)` — a partial
  edit. An omitted field (`null`) is **left alone**; a field passed as `""` is **emptied** (see
  [Reading them back, and editing them](#reading-them-back-and-editing-them)).
- `google_calendar.delete_event(calendar_id, event_id)` — remove an event, or a whole series.
- `google_calendar.free_busy(calendar_id, time_min, time_max)` — the **busy** windows over a range,
  merged across events and carrying no titles: the openings are the gaps between them.
- `google_calendar.watch(calendar_id, lead_time_milliseconds, poll_interval_milliseconds, cursor_at, deliver_to)` —
  a daemon that delivers each upcoming **timed** event to `deliver_to(value = …)` as it enters the lead
  window. It is `poll.subscribe` (stdlib) under a Calendar adapter: **at-least-once**, deduped per
  `(id, start)`, with `cursor_at` deciding whether the dedup memory survives a restart (see
  [Usage: the watch](#usage-the-watch)). The events already inside the window when it starts are
  recorded, not delivered — a watch reports an *entry*, not the current state. Never resolves; composes
  under `parallel [ … ]`.
- `google_calendar.provider(source, continuation)` — provides the capability the tools require
  (`credential`) for the extent of a continuation, by resolving a `credentials.source` through the
  runtime on every ask: `use google_calendar.provider(source = credentials.oauth(name = "google"))`.
  The provider holds no secret and keeps no cache: the runtime owns the token material, serves the
  stored access token while its recorded lifetime holds, and refreshes it against the stored token
  endpoint once due. The resolved token is a `string of private` — it flows only to the
  `Authorization: Bearer` header, never to a user-facing boundary.

`gmail` and `google_calendar` share one Google credential and one piece of plumbing: the `Bearer`
header, the 401/403 classification and the authenticated **call** — one agent for GET, POST, PATCH and
DELETE alike — live in the **`google_common`** package, which both depend on. You never import it: it
arrives as their transitive dependency.

**Breaking in 0.5.0.** Every optional string argument that used to default to `""` now defaults to
`null`: `create_event`'s `description` / `time_zone`, and all four fields of `update_event`. For
`update_event` that is not a spelling change but a new capability — `null` leaves a field alone and `""`
now **empties** it, which was impossible while `""` was the sentinel for "not given". `http.auth_error` /
`http.api_error` also carry a `status` and a `context` now (the stdlib's error vocabulary v2), so a
handler that reconstructs one has two more fields to fill — matching on the variant is unchanged.

## Failure model

Three meanings, decided at three boundaries:

- **The credential needs a human** — it was never authorized, or its refresh is dead. This is **never
  an error**: `oauth.token` pauses the run on a `prelude.oauth.authorize` escalation (the admin console
  and `katari answer` render it as an authorization request), and completing the browser flow resumes
  the run right where it stopped. Nothing to catch — a pause, not a throw.
- **`oauth.server_error`** (stdlib) — the token could not be resolved for a **transient** reason: a
  network error, or the token endpoint failing (5xx) while refreshing. Thrown at the provider; retry it
  like any transport blip.
- **`http.api_failure = http.auth_error | http.api_error`** (stdlib) — the Calendar API's own failures,
  classified once by `http.classify_status` (which `google_common.classify_api_error` is the Google
  packages' name for). Both variants carry `status`, `context` and `message`:
  - `http.auth_error` — a 401/403: Google rejected the resolved access token (revoked before its stored
    expiry, or scoped too narrowly). Retrying the *same* token does not help, but **replaying the call
    does**: the re-run resolves the token afresh, the runtime refreshes the credential once its stored
    lifetime passes, and a credential the runtime cannot refresh parks the run as a re-authorization
    prompt. No app-owned escalation is needed.
  - `http.api_error` — any other non-2xx (a bad request, a missing calendar, a quota or server error).
    Read `status` to decide: 408 / 429 / 5xx are worth a backoff, anything else will fail identically
    until the argument changes.

  The pair is the **stdlib's**, not this package's: `gmail` and every other authenticated REST package
  classify into the same two variants, so one `replay` converter covers all of them at once. (This
  package used to declare its own `calendar_error = auth_error | api_error` — identical, down to the
  paragraph, to `gmail`'s. Before 0.5.0 the shared pair carried only a `message`, with the status folded
  into its prose; the number rides as a field now so a retry policy compares it.)

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
the credential under the client's name. Or skip this: the first `credential` ask of a run **pauses**
it on an authorization escalation, which the admin console (and `katari answer`) render as the same
login button; authorizing resumes the run.

For several Google accounts, register the same client under several names (e.g. `google_work`) and pick
one per scope: `use google_calendar.provider(source = credentials.oauth(name = "google_work"))`.

## Usage: the tools

```katari
import google_calendar

agent upcoming(calendar_id: string, time_min: string, time_max: string) -> array[google_calendar.event] with io | prelude.throw[env.missing_secret | oauth.server_error | http.api_failure | http.fetch_error | json.parse_error] {
  use google_calendar.provider(source = credentials.oauth(name = "google"))
  google_calendar.list_events(calendar_id = calendar_id, time_min = time_min, time_max = time_max)
}
```

Hand `google_calendar.list_events` / `google_calendar.create_event` to an AI loop's tool list to let the model read
and schedule on its own. A failed call throws `http.api_failure` — handle it at the app root.
If the credential is not authorized yet, the run pauses and asks instead of failing.

## Recurring events

A recurrence is an **attribute of an event**, not a second kind of thing to create: `create_event` takes an
optional `recurrence` (RFC 5545 rules) and an optional `time_zone`, so "every Wednesday and Sunday until the
end of August" is **one call** — not an event per occurrence, and not a `create_recurring_event` twin.

```katari
import google_calendar

agent book_the_weekly() -> google_calendar.event with google_calendar.credential | io | prelude.throw[http.api_failure | http.fetch_error | json.parse_error] {
  google_calendar.create_event(
    calendar_id = "primary",
    summary = "Progress meeting",
    start = "2026-07-29T10:00:00+09:00",   // the FIRST occurrence
    end = "2026-07-29T11:00:00+09:00",
    recurrence = ["RRULE:FREQ=WEEKLY;BYDAY=WE,SU;UNTIL=20260831T000000Z"],
    time_zone = "Asia/Tokyo",              // REQUIRED whenever recurrence is given
  )
}
```

`start` / `end` describe the **first occurrence**; the rule repeats it. The rules go to Google **verbatim** —
Google is the RFC 5545 validator, so no rule parsing is invented here and a malformed rule comes back as a
plain `http.api_error`. Rules worth knowing:

| Intent | Rule |
| --- | --- |
| every Wednesday and Sunday, through 2026-08-31 | `RRULE:FREQ=WEEKLY;BYDAY=WE,SU;UNTIL=20260831T000000Z` |
| every weekday, 10 occurrences | `RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;COUNT=10` |
| the same day of every month, no end | `RRULE:FREQ=MONTHLY` |
| every day, no end | `RRULE:FREQ=DAILY` |

`UNTIL` is a **compact UTC** timestamp (`YYYYMMDDTHHMMSSZ` — no dashes or colons, unlike `start` / `end`)
and is inclusive; `COUNT` is the other way to end a series. Give one or neither, never both. Weekdays are
the two-letter `MO TU WE TH FR SA SU`.

**`time_zone` is required for a recurring event** — Google's rule, not this package's. It is the frame the
rule is *expanded* in: "every Wednesday at 10:00" has no meaning until something says whose 10:00, and it is
what keeps an occurrence at 10:00 local across a daylight-saving shift. Pass an IANA name (`"Asia/Tokyo"`,
`"America/New_York"`); a recurring event without it is rejected as an `http.api_error` (a 400). A **single**
event needs none — its RFC3339 offset already fixes one instant — and when it is omitted no `timeZone` key
is sent at all, so a single event's request is byte-for-byte the pre-recurrence one.

### Reading them back, and editing them

Nothing on the read side needed changing, and that is worth stating so it stays true: both listings pin
`singleEvents=true`, which makes Google **expand** a series into one entry per occurrence, each with its own
id and its own start. So `list_events` reports six upcoming meetings rather than one rule to interpret, and
`watch` delivers a weekly meeting once a week with its `(id, start)` dedup landing per occurrence. **Do not
drop that flag**: without it Google sends the series *master* — a single entry whose start is the first
occurrence's — and `watch` would notify a series exactly once, ever, deduping every later occurrence away
under the master's one key.

Which id you hand to `update_event` / `delete_event` therefore decides the **reach**, and Google draws that
line:

- the **series-master** id (what `create_event` returned) — edits or deletes **every** occurrence;
- an **occurrence's** id (what `list_events` returns) — affects only that one, recorded as an exception to
  the series.

There is no "this and all following" mode here, and the recurrence **rule** is not patchable through
`update_event`: to change a series' schedule or its end date, `delete_event` the master and `create_event` a
new series.

`update_event` is a **partial** edit, and since 0.5.0 it can say all three things a partial edit has to
say. Each of `summary` / `start` / `end` / `description` defaults to `null`:

| you pass | the event's field |
| --- | --- |
| nothing (`null`) | is left exactly as it is — the key is not sent |
| a value | is set to it |
| `""` | is **emptied** (`summary` / `description` only — an event must keep a `start` and an `end`) |

The third row is the one that did not exist before: while `""` meant "not given", clearing a description
or a title back to nothing could not be expressed through this tool at all.

## Usage: the watch

`google_calendar.watch` polls a calendar and delivers each upcoming **timed** event to your `deliver_to`
agent as its start enters the lead window. **The events already inside that window when the watch starts
are not delivered**: the first poll only records them, so a watch started twenty minutes before a meeting
(with a thirty-minute lead) says nothing about that meeting — what a watch reports is an event *entering*
the window, and `list_events` is what answers "what is coming up".

Under the hood it is **`poll.subscribe`** — the stdlib's durable-subscription skeleton — with a Calendar
adapter, so it speaks that module's guarantees rather than its own.

**Delivery is at-least-once**, deduped per `(event id, start time)`. An event reaches `deliver_to` one or
more times, never zero: the commit lands only after a delivery returns, so a crash or a throw in between
re-delivers exactly that event on the next tick. **Exactly-once is built at the destination**, by making
the delivery idempotent on that pair — never by expecting the loop to be stronger than a calendar allows.
An event whose start has not moved is delivered once; an event whose start *moved* is a different pair, so
it re-notifies. The memory keeps the most recent **200** keys — bounded, and it forgets by age alone, never
because one listing omitted an event (which is what used to re-notify events that left the window and came
back).

**`cursor_at` decides what a restart does**, and there is no default:

- `poll.resume(key = "…")` keeps the memory in the store, so a runtime restart, a re-forked fiber and a
  `replay` re-run all come back holding the keys they already delivered — no re-notification storm. Give
  each watch a key of its own; two watches sharing one overwrite each other.
- `poll.fresh()` keeps it in the run alone: every fresh activation primes again on its first poll, silent
  about the window it lands in and reporting the entries after it.

**Neither backfills.** A seen-set subscription has no floor to list from, so whatever crossed the window
while the watch was down is gone either way — `resume` buys quiet, not recovery. (`gmail.watch` is the
other case: it *does* have a receive clock, so its `resume` delivers the downtime.)

All-day events are **not** covered — they have no instant to place in the lead window. Recurring events, on
the other hand, need nothing special: the listing expands them per occurrence, so each is delivered on its
own schedule. The watch never resolves, so it runs as a `parallel [ … ]` arm (or a standalone entry); its
`deliver_to` effects flow out to the app's handlers unchanged.

`poll_interval_milliseconds` must not exceed `lead_time_milliseconds`: a wider interval leaves the gap
`(T+lead, T+poll)` covered by no window and would silently drop events starting there. That is a program
defect, rejected at entry with `google_calendar.watch_misconfigured` (the `panic` this morally is — a Katari
program cannot raise one — surfaced as a throw).

```katari
import google_calendar
import discord

@"Notify a Discord channel 10 minutes before each event, checking every minute."
agent remind(calendar_id: string, channel: string) -> never with io | store.get | store.set | prelude.throw[google_calendar.watch_misconfigured | http.api_failure | discord.discord_error | env.missing_secret | oauth.server_error | http.fetch_error | json.parse_error] {
  use discord.provider(source = credentials.env(key = "DISCORD_TOKEN"))
  use google_calendar.provider(source = credentials.oauth(name = "google"))
  // `deliver_to`'s parameter is named `value` — the prelude's primary-argument rule, which
  // `poll.subscribe` fixes for every watch built on it.
  agent notify(value: google_calendar.event) -> null {
    // `send_message` answers with the posted message's id; a reminder has no use for it.
    let _posted = discord.send_message(channel = channel, text = f"Upcoming: ${value.summary} at ${value.start}\n${value.html_link}", files = [])
  }
  google_calendar.watch(
    calendar_id = calendar_id,
    lead_time_milliseconds = 600000,    // look 10 minutes ahead
    poll_interval_milliseconds = 60000, // poll once a minute
    cursor_at = poll.resume(key = "calendar-reminders"),
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
`prelude.oauth.authorize` escalation, inside the `credential` ask itself. So the converter's whole job is:

- **replay** the transient failures (`http.api_error`, `oauth.server_error`, `http.fetch_error`,
  `json.parse_error`) — back off and re-run;
- **replay `http.auth_error` too** — the re-run resolves the token afresh; once the rejected token's stored
  lifetime passes the runtime refreshes it, and if the refresh is dead the re-run *pauses for
  re-authorization* on its own. (Until that stored lifetime passes — at most about an hour — the replays
  re-see the same token and fail again, which is why a capped backoff like `replay.forever`, not
  `replay.immediate`, is the right mechanism here.)
- **re-raise** the genuine defects (`watch_misconfigured` — fix the constants, retrying is meaningless).

Two rules the converter must obey — both because a `throw` handler catches the **whole** throw union of
the block it guards, not a subset:

1. **Name every failure the block can raise.** For the block below that is `http.api_failure`
   (`http.auth_error | http.api_error`) plus `google_calendar.watch_misconfigured`, plus
   `oauth.server_error` from the provider and `http.fetch_error` / `json.parse_error` from the calls —
   `env.missing_secret` from both providers, *and* whatever `deliver_to` itself throws, which here is
   `discord.discord_error`. Miss one and the handler does not apply at all; it is not a partial catch.
2. **Reconstruct a re-raised failure** rather than re-throwing the match scrutinee: `prelude.throw(error
   = error)` would widen the residual back to the whole union, so each propagated case rebuilds its own
   value (`prelude.throw(error = google_calendar.watch_misconfigured(message = message))`).

### The daemon, resilient: one converter over `replay.forever`

```katari
import google_calendar
import discord

@"The calendar reminder daemon: replay transient failures and rejected tokens, propagate the defects.
A credential that needs a human pauses the run on the runtime's authorize escalation — not handled here."
agent remind_resiliently(calendar_id: string, channel: string) -> never with io | store.get | store.set | prelude.throw[google_calendar.watch_misconfigured | env.missing_secret] {
  agent notify(value: google_calendar.event) -> null {
    let _posted = discord.send_message(channel = channel, text = f"Upcoming: ${value.summary}", files = [])
  }
  // MECHANISM: re-run the block after a backoff (100ms, doubling, capped at a minute) on every replay.
  use replay.forever(initial_delay_milliseconds = 100.0, factor = 2.0, max_delay_milliseconds = 60000.0)
  // POLICY: names every failure the block can throw, then dispatches — one defect re-raised, the rest replayed.
  use handler {
    request prelude.throw(error: http.api_failure | google_calendar.watch_misconfigured | discord.discord_error | env.missing_secret | oauth.server_error | http.fetch_error | json.parse_error) -> never {
      match (error) {
        case google_calendar.watch_misconfigured(message => message) -> { prelude.throw(error = google_calendar.watch_misconfigured(message = message)) } // program defect
        case env.missing_secret(key => key, message => message) -> { prelude.throw(error = env.missing_secret(key = key, message = message)) } // wiring defect: no backoff fixes it
        case _ -> { replay.interrupted(failure = error) } // transient, or a rejected token → back off + replay (the re-run re-resolves)
      }
    }
  }
  // BOTH providers sit INSIDE the replay scope, so a re-run RE-ENTERS them and the next `credential` ask
  // re-resolves through the runtime (and a dropped gateway connection is re-made). `poll.resume` is what
  // makes the backoff free: the dedup memory outlives the failed activation, so the re-run does not
  // re-announce what it already had.
  use discord.provider(source = credentials.env(key = "DISCORD_TOKEN"))
  use google_calendar.provider(source = credentials.oauth(name = "google"))
  google_calendar.watch(calendar_id = calendar_id, lead_time_milliseconds = 600000, poll_interval_milliseconds = 60000, cursor_at = poll.resume(key = "calendar-reminders"), deliver_to = notify)
}
```

### The full story: the daemon beside a bot, under one `parallel`

```katari continues
@"The bot's serve loop — the app's other arm, echoing each message in the channel."
agent discord_serve(channel: string) -> never with io | prelude.throw[discord.discord_error | env.missing_secret | oauth.server_error] {
  use discord.provider(source = credentials.env(key = "DISCORD_TOKEN"))
  // `deliver_to`'s parameter is named `value` — the prelude's primary-argument rule (discord 0.6.0).
  agent echo(value: discord.message) -> null {
    let _posted = discord.send_message(channel = value.channel, text = f"echo: ${value.text}", files = [])
  }
  discord.watch_messages(channel = channel, deliver_to = echo)
}

@"The whole app: the reminder daemon and the bot serve loop, side by side and independently resilient.
A `parallel` of two arms is a pair; of two `never` arms, one that is never produced."
agent main(calendar_id: string, channel: string) -> [never, never] with io | store.get | store.set | prelude.throw[google_calendar.watch_misconfigured | discord.discord_error | env.missing_secret | oauth.server_error] {
  // (`discord_serve` is not wrapped in a replay here — the point of the pair is the daemon beside it.)
  parallel [
    remind_resiliently(calendar_id = calendar_id, channel = channel),
    discord_serve(channel = channel),
  ]
}
```

The `http.auth_error` / `http.api_error` split is still what makes the policy precise — but now both arms
replay, for different reasons: an `http.api_error` replay re-runs the *same* call past a transient fault,
while an `http.auth_error` replay is a *token re-resolution* whose end state, when a human really is
needed, is the runtime's own re-authorization pause. The one failure the converter re-raises is the one no
replay can change: a miswired watch. And because that split is the **stdlib's** vocabulary, the same
converter covers a `gmail` arm added beside these two without naming a second package's error sum.
