# google_calendar — Google Calendar tools for Katari

A single module, `google_calendar`: two tools the model can call — `list_events` and `create_event` —
and a notification watcher, `watch` — backed by Google's OAuth refresh-token grant. Pure Katari over
`http.fetch`: the token exchange and every Calendar API call build their request and parse their reply
as `json`. No FFI sidecar.

- `google_calendar.list_events(calendar_id, time_min, time_max, max_results?)` — upcoming events in a
  window, trimmed to id / summary / start / end / link.
- `google_calendar.create_event(calendar_id, summary, start, end, description?)` — create an event.
- `google_calendar.watch(calendar_id, lead_time_milliseconds, poll_interval_milliseconds, deliver_to)` — a
  daemon that delivers each upcoming **timed** event to `deliver_to` as it enters the lead window
  (at-least-once, deduped per `(id, start)` within a single activation). Never resolves; composes under
  `parallel [ … ]`.
- `google_calendar.provider(client_id, client_secret, refresh_token)` — provides the OAuth credentials (each
  a `string of private`) and a **cached access token** for the extent of a continuation. The first tool
  call exchanges the refresh token; later calls reuse the cached access token until it nears expiry.

Failures are a two-variant sum, `google_calendar.calendar_error = google_calendar.auth_error | google_calendar.api_error`:

- `auth_error` — the token endpoint rejected the grant (a revoked/expired refresh token, or wrong
  client credentials), or a Calendar API call came back 401/403. Retrying does not help until a human
  re-authorizes.
- `api_error` — any other non-2xx Calendar API failure (a bad request, a missing calendar, a quota or
  server error). Usually transient; a plain backoff retry is the right response.

## Secrets / env

Three OAuth values, provisioned as runtime **secrets** (`--secret`) and read with `env.get_secret`:

```sh
katari env set GOOGLE_OAUTH_CLIENT_ID     --secret
katari env set GOOGLE_OAUTH_CLIENT_SECRET --secret
katari env set GOOGLE_OAUTH_REFRESH_TOKEN --secret
```

They can be secrets because Katari's request body is a private-capable sink (the body-sink rule): a
`string of private` may leave the runtime through a request's submission surfaces — a header value *and*
the body — so these credentials ride the token endpoint's `application/x-www-form-urlencoded` body
(where the refresh token, which has no header form at all, must go), revealed only at the transport
boundary for the one server the program named — never read back out as a plain string. The three secrets
stay inside the provider; only the short-lived access token it fetches leaves it (that token is public —
an HTTP response is declassified).

To get a refresh token: create an OAuth client (type "Web application" or "Desktop app") in the
Google Cloud console, enable the Google Calendar API, then use the
[OAuth 2.0 Playground](https://developers.google.com/oauthplayground) with your own credentials to
authorize the `https://www.googleapis.com/auth/calendar` scope and exchange the code — the response's
`refresh_token` is the value to store.

## Usage: the tools

```katari
import google_calendar

agent upcoming(calendar_id: string, time_min: string, time_max: string) -> array[google_calendar.event] with io | prelude.throw[env.missing_secret | google_calendar.calendar_error | http.fetch_error | json.parse_error] {
  use google_calendar.provider(
    client_id = env.get_secret(key = "GOOGLE_OAUTH_CLIENT_ID"),
    client_secret = env.get_secret(key = "GOOGLE_OAUTH_CLIENT_SECRET"),
    refresh_token = env.get_secret(key = "GOOGLE_OAUTH_REFRESH_TOKEN"),
  )
  google_calendar.list_events(calendar_id = calendar_id, time_min = time_min, time_max = time_max)
}
```

Hand `google_calendar.list_events` / `google_calendar.create_event` to an AI loop's tool list to let the model read
and schedule on its own. A failed call throws `google_calendar.calendar_error` — handle it at the app root.

## Usage: the watch

`google_calendar.watch` polls a calendar and delivers each upcoming **timed** event to your `deliver_to` agent.
Delivery is **at-least-once**, deduped per `(event id, start time)` — but only *within a single watch
activation*. While the watch keeps running (including across a crash-recovery restart, which resumes the
durable dedup memory) an event whose start has not moved is delivered once, and an event whose start
*moved* is a new pair, so it re-notifies. A **replay re-run is a fresh activation** whose memory starts
empty, so a `prelude.replay` provider around the watch (below) re-delivers every event still inside the
lead window; a `deliver_to` failure likewise re-delivers the events after it in that tick on the next run.
All-day
events are **not** covered — they have no instant to place in the lead window. The watch never resolves,
so it runs as a `parallel [ … ]` arm (or a standalone entry); its `deliver_to` effects flow out to the
app's handlers unchanged.

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
  use google_calendar.provider(
    client_id = env.get_secret(key = "GOOGLE_OAUTH_CLIENT_ID"),
    client_secret = env.get_secret(key = "GOOGLE_OAUTH_CLIENT_SECRET"),
    refresh_token = env.get_secret(key = "GOOGLE_OAUTH_REFRESH_TOKEN"),
  )
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

`watch` has **no built-in retry**: a poll failure — an http error, a revoked token, a `deliver_to`
that throws — propagates and kills the watch, exactly as an uncaught failure in any callee does.
Resilience is composed *around* the watch with a `prelude.replay` provider, below.

## Composition: resilience with `prelude.replay`

`prelude.replay` splits the retry **mechanism** from the failure **policy**. A `replay` *provider*
re-runs the rest of a block, but it knows nothing about what counts as retriable: it catches exactly one
request, `replay.interrupted`, and re-runs after its delay. Deciding *which* failures become an
`interrupted` is your code — an ordinary `use handler` (a **converter**) installed between the provider
and the block that turns the throws it chooses into `replay.interrupted(failure = …)` and re-raises the
rest. This is exactly what `google_calendar`'s `auth_error | api_error` split is for: **retry** a transient
`api_error` / network / parse error, **escalate** a revoked-token `auth_error` no retry can fix.

The providers (the `use`-site shape is unchanged from the old `retry.*`):

- `use replay.exponential(initial_delay_milliseconds = …, factor = …, max_attempts = …)` — bounded; on
  exhaustion re-raises the last failure as a typed `throw`.
- `use replay.forever(initial_delay_milliseconds = …, factor = …, max_delay_milliseconds = …)` —
  unbounded, capped backoff. For daemons.
- `use replay.immediate()` — unbounded, no artificial delay; the cadence is whatever the converter does
  *before* it signals (e.g. an escalation that parks for a human).

Two rules the converter must obey — both because a `throw` handler catches the **whole** throw union of
the block it guards, not a subset:

1. **Name every failure the block can raise.** For the block below that is `google_calendar`'s
   `auth_error | api_error | watch_misconfigured`, plus `http.fetch_error` / `json.parse_error` from the
   calls and `env.missing_secret` from reading the secrets. (A `deliver_to` that itself throws — say a
   `discord.send_message` transport error — adds its failure type to that union too.)
2. **Reconstruct a re-raised failure** rather than re-throwing the match scrutinee: `prelude.throw(error
   = error)` would widen the residual back to the whole union, so each propagated case rebuilds its own
   value (`prelude.throw(error = google_calendar.auth_error(message = message))`).

### (a) `replay.forever` — survive transient failures, escalate the rest

Retry the transient failures with a capped backoff; let a revoked-token `auth_error` (and the genuine
defects) propagate out rather than spin. This selective policy is the redesign's whole point — the old
`retry.forever` caught *everything*, so it spun forever on a revoked token exactly as on a 5xx.

```katari
import google_calendar
import discord

// A revoked token propagates OUT of this daemon (retrying cannot fix it); guard it with recipe (b),
// or merge both policies into one converter as in the full story below.
agent remind_resiliently(calendar_id: string, channel_id: string) -> never
    with io | prelude.throw[google_calendar.auth_error | google_calendar.watch_misconfigured | env.missing_secret] {
  use discord.provider(token = env.get_secret(key = "DISCORD_TOKEN"))
  agent notify(event: google_calendar.event) -> null {
    discord.send_message(channel_id = channel_id, text = f"Upcoming: ${event.summary}", files = [])
  }
  // MECHANISM: re-run the block after a backoff (100ms, doubling, capped at a minute) on every replay.
  use replay.forever(initial_delay_milliseconds = 100.0, factor = 2.0, max_delay_milliseconds = 60000.0)
  // POLICY: names every failure the block can throw, then dispatches — transient → replay, fatal → re-raise.
  use handler {
    request prelude.throw(error: google_calendar.auth_error | google_calendar.api_error | google_calendar.watch_misconfigured | http.fetch_error | json.parse_error | env.missing_secret) -> never {
      match (error) {
        case google_calendar.auth_error(message => message) -> { prelude.throw(error = google_calendar.auth_error(message = message)) }               // revoked token → recipe (b)
        case google_calendar.watch_misconfigured(message => message) -> { prelude.throw(error = google_calendar.watch_misconfigured(message = message)) } // program defect
        case env.missing_secret(key => key, message => message) -> { prelude.throw(error = env.missing_secret(key = key, message = message)) } // config
        case _ -> { replay.interrupted(failure = error) }                                                                              // transient → back off + replay
      }
    }
  }
  use google_calendar.provider(
    client_id = env.get_secret(key = "GOOGLE_OAUTH_CLIENT_ID"),
    client_secret = env.get_secret(key = "GOOGLE_OAUTH_CLIENT_SECRET"),
    refresh_token = env.get_secret(key = "GOOGLE_OAUTH_REFRESH_TOKEN"),
  )
  google_calendar.watch(calendar_id = calendar_id, lead_time_milliseconds = 600000, poll_interval_milliseconds = 60000, deliver_to = notify)
}
```

### (b) `replay.immediate` + your own escalation — park a revoked token for re-authorization

When the refresh token is *revoked*, the exchange fails with `auth_error` and no amount of retrying will
fix it — a human must re-authorize. There is **no more `retry.attended` / `replay.attention`**: the app
owns the escalation. Declare your own request, perform it in the converter (unhandled, it escalates to a
**durable open question** that parks the run until someone answers with `katari answer`), then signal
`replay.interrupted` so the block re-runs on the answer. `replay.immediate` adds no delay — the human is
the delay.

```katari
import google_calendar
import discord

// The app's OWN re-auth escalation — declared here, NOT by replay. Unhandled, it parks as an open question.
request needs_reauth(detail: google_calendar.auth_error) -> null

agent remind_attended(calendar_id: string, channel_id: string) -> never
    with io | needs_reauth | prelude.throw[google_calendar.api_error | google_calendar.watch_misconfigured | http.fetch_error | json.parse_error | env.missing_secret] {
  use discord.provider(token = env.get_secret(key = "DISCORD_TOKEN"))
  agent notify(event: google_calendar.event) -> null {
    discord.send_message(channel_id = channel_id, text = f"Upcoming: ${event.summary}", files = [])
  }
  // MECHANISM: re-run at once on replay; the escalation below sets the (human) pace.
  use replay.immediate()
  // POLICY: escalate a revoked token, then replay after the human answers; everything else propagates.
  use handler {
    request prelude.throw(error: google_calendar.auth_error | google_calendar.api_error | google_calendar.watch_misconfigured | http.fetch_error | json.parse_error | env.missing_secret) -> never {
      match (error) {
        case google_calendar.auth_error(message => message) -> {
          needs_reauth(detail = google_calendar.auth_error(message = message))   // parks as a durable open question
          replay.interrupted(failure = google_calendar.auth_error(message = message)) // re-runs when it is answered
        }
        case google_calendar.api_error(message => message) -> { prelude.throw(error = google_calendar.api_error(message = message)) }
        case google_calendar.watch_misconfigured(message => message) -> { prelude.throw(error = google_calendar.watch_misconfigured(message = message)) }
        case http.fetch_error(message => message) -> { prelude.throw(error = http.fetch_error(message = message)) }
        case json.parse_error(message => message) -> { prelude.throw(error = json.parse_error(message = message)) }
        case env.missing_secret(key => key, message => message) -> { prelude.throw(error = env.missing_secret(key = key, message = message)) }
      }
    }
  }
  // INSIDE the replay + converter scope, so a re-run RE-ENTERS the provider: its `var cache` starts at
  // `absent()` and the next call re-exchanges the (re-authorized) refresh token it re-reads here. A
  // provider *outside* the replay scope would keep reusing the old, revoked token.
  use google_calendar.provider(
    client_id = env.get_secret(key = "GOOGLE_OAUTH_CLIENT_ID"),
    client_secret = env.get_secret(key = "GOOGLE_OAUTH_CLIENT_SECRET"),
    refresh_token = env.get_secret(key = "GOOGLE_OAUTH_REFRESH_TOKEN"),
  )
  google_calendar.watch(calendar_id = calendar_id, lead_time_milliseconds = 600000, poll_interval_milliseconds = 60000, deliver_to = notify)
}
```

Because escalation is an ordinary request, an app can also *handle* `needs_reauth` itself (post to a
channel and wait there) instead of letting it park as an open question — the policy is entirely yours.

### The full story: one converter for both, beside a bot, under one `parallel`

A production daemon wants both policies in one converter: transient failures back off and replay, a
revoked token escalates and replays, and the genuine defects propagate. That is just the two `match`
arms above, merged, over `replay.forever`:

```katari
import google_calendar
import discord

request needs_reauth(detail: google_calendar.auth_error) -> null

@"The calendar reminder daemon: retry transient failures, escalate a revoked token, run forever."
agent remind(calendar_id: string, channel_id: string) -> never
    with io | needs_reauth | prelude.throw[google_calendar.watch_misconfigured | env.missing_secret] {
  use discord.provider(token = env.get_secret(key = "DISCORD_TOKEN"))
  agent notify(event: google_calendar.event) -> null {
    discord.send_message(channel_id = channel_id, text = f"Upcoming: ${event.summary}", files = [])
  }
  use replay.forever(initial_delay_milliseconds = 100.0, factor = 2.0, max_delay_milliseconds = 60000.0)
  use handler {
    request prelude.throw(error: google_calendar.auth_error | google_calendar.api_error | google_calendar.watch_misconfigured | http.fetch_error | json.parse_error | env.missing_secret) -> never {
      match (error) {
        case google_calendar.auth_error(message => message) -> {
          needs_reauth(detail = google_calendar.auth_error(message = message))
          replay.interrupted(failure = google_calendar.auth_error(message = message))
        }
        case google_calendar.watch_misconfigured(message => message) -> { prelude.throw(error = google_calendar.watch_misconfigured(message = message)) }
        case env.missing_secret(key => key, message => message) -> { prelude.throw(error = env.missing_secret(key = key, message = message)) }
        case _ -> { replay.interrupted(failure = error) }
      }
    }
  }
  use google_calendar.provider(
    client_id = env.get_secret(key = "GOOGLE_OAUTH_CLIENT_ID"),
    client_secret = env.get_secret(key = "GOOGLE_OAUTH_CLIENT_SECRET"),
    refresh_token = env.get_secret(key = "GOOGLE_OAUTH_REFRESH_TOKEN"),
  )
  google_calendar.watch(calendar_id = calendar_id, lead_time_milliseconds = 600000, poll_interval_milliseconds = 60000, deliver_to = notify)
}

@"The bot's serve loop — the app's other arm, echoing each message in the channel."
agent discord_serve(channel_id: string) -> never {
  use discord.provider(token = env.get_secret(key = "DISCORD_TOKEN"))
  agent echo(channel_id: string, text: string, files: array[file]) -> null {
    discord.send_message(channel_id = channel_id, text = f"echo: ${text}", files = [])
  }
  discord.watch_messages(channel_id = channel_id, deliver_to = echo)
}

@"The whole app: the reminder daemon and the bot serve loop, side by side and independently resilient."
agent main(calendar_id: string, channel_id: string) -> never {
  parallel [
    remind(calendar_id = calendar_id, channel_id = channel_id),
    discord_serve(channel_id = channel_id),
  ]
}
```

The `auth_error` / `api_error` split is what makes this precise: the converter *retries* an `api_error`
(and the network / parse blips) without ever bothering a human, and *escalates* an `auth_error` — the
one genuinely human problem — as a re-authorization prompt, all in one ordinary `match`.
