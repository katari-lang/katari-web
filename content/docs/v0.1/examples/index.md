---
title: Complete programs
description: Deployable residents to read and run — four focused examples in one repository, and the multi-agent system they lead up to.
---

Everything else on this site is an excerpt: a page shows the handler and not the file it lives in,
and the [tutorial]({docs}/{currentVersion}/tutorial) builds a real bot and then stops, because a
tutorial has to. These are whole projects — manifest, lockfile, compose file, secrets, sidecar —
that you clone, point at your own tokens, and leave running.

All of them are residents: programs that stay on a channel or a schedule rather than running once
and exiting. A resident is the first program whose correctness you cannot see by running it once, so
each one below ends with what a runtime restart costs it, and each README says the same at length.

## release-watch

[**A GitHub release monitor with an AI front desk.**](https://github.com/katari-lang/examples/tree/main/release-watch)
Say "keep an eye on vercel/next.js" in a Discord channel and the curator — one AI whose whole tool
set is `watch`, `unwatch` and `list_watches` — edits the watch list. Announcing is not its job: a
poll fiber on a durable timer checks each watched repository against a stored cursor and posts what
is new, with no model anywhere in that path. Read it for that split between a model that reads
intent and a deterministic path that acts, and for the store as the single desired set — the next
tick simply sees the new list, so `watch` and `unwatch` need no fork-and-cancel reconcile. A release
is announced before the cursor advances, so announcements are at-least-once on purpose.

_A restart:_ the watch list and every cursor survive; the curator's conversation does not, and the
run stops rather than standing deaf over its channel.

## standup-scribe

[**A Slack standup bot whose digest a human approves before it posts.**](https://github.com/katari-lang/examples/tree/main/standup-scribe)
A weekday cron posts the prompt, replies are collected in that message's thread, one model step
drafts the digest, and the facilitator presses _Post it_, rewrites it, or discards it. Read it for
the human in the loop: the review is one `slack.ask` whose form is prefilled with the draft, so
"approved" means approved at the submitted text, with nothing re-derived between the click and the
post. Slack's message stream and its interaction plane are subscribed separately and cannot race
each other, and the ask runs under a six-hour deadline so an unanswered review cannot hold back
tomorrow's standup.

_A restart:_ the open window and the replies already collected in it come back, because both live in
the store and the desk's `var`; an open review does not, so that day's digest goes unposted.

## concierge

[**Two AIs on one Discord bot.**](https://github.com/katari-lang/examples/tree/main/concierge)
A public face answers the community from published notes it can read and never write; a private
curator works with the owner in a control channel and publishes, rewrites and retracts those notes
in plain language. A question the notes do not cover is mailed to the curator instead of guessed at.
Read it as the smallest complete `ai.route`: two `ai.spawn` calls whose five parameters — name,
tools, persona, `deliver_to`, `sources` — are the entire difference between the two AIs, and whose
tool sets are the privacy membrane. Three middlewares wrap the route and none of them serializes, so
the two AIs' model calls overlap instead of taking turns.

_A restart:_ the published notes survive in the store; an interrupted turn ends its AI's fiber, the
control channel gets one line, and the run stops.

## inbox-butler

[**Gmail triage that proposes calendar events for one click.**](https://github.com/katari-lang/examples/tree/main/inbox-butler)
When a mail looks like it wants a meeting, the butler drafts the event and asks you on Discord with
every field prefilled and editable; a mail that is not a meeting costs nothing at all. Read it for
composition — four packages, three credentials, one program — and for OAuth you never handle: the
runtime owns the Google credential and the program only names it. Triage is one
`ai.infer_structured` call whose result is converted to a data sum at the boundary, so the desk
dispatches on `not_event | event_candidate | triage_failed` and nothing else. Each question is forked
as its own fiber, so triage continues while a human takes their time.

_A restart:_ the Gmail cursor survives, so mail that arrived while the butler was down is triaged
when it returns; a pending question does not, and that candidate is not re-asked.

## tsukasa, the capstone

[**A multi-agent resident system.**](https://github.com/yukikurage/discord-bot-example) One
`ai.route` holds an assistant that manages an operator's life and work, and every AI in it is a
fiber — one `ai.spawn` line with its own conversation, store workspace, mailbox and watchers. Core
holds everything: tasks, memory, the calendar and mailbox, a Python sandbox, image generation, and
workers it hires on demand. Herald is the one public face, and its capability set is its privacy
boundary — it learns of the operator's life only through a store cell core publishes into. Every
crossing of that seam waits on the operator through a single `discord.ask`, where the `controls`
data is the whole difference between approve-or-deny, edit-and-approve, and a free-form answer.

_A restart:_ a monitor comes back, because its spec is a store row the boot re-forks from; a hired
worker does not, because the roster is a handler `var`.

## Running one

The recipe is the same for the four examples; each README fills in its own tokens, channel ids and
settings.

```sh
git clone https://github.com/katari-lang/examples
cd examples/release-watch

cp .env.example .env
echo "KATARI_API_KEY=$(openssl rand -hex 32)"       >> .env
echo "KATARI_SECRET_KEY=$(openssl rand -base64 32)" >> .env
docker compose up -d                             # runtime + Postgres + blob store, self-hosted
export $(grep '^KATARI_API_KEY=' .env)

katari lock                                      # fetch the pinned closure into .katari/
(cd .katari/packages/discord-* && npm install)   # once: the sidecar's own dependencies

katari env set DISCORD_TOKEN --secret            # each README lists its own
katari apply
katari run release_watch.main --detach
```

Two of those lines are easy to skip and neither is optional. `katari lock` is what fetches: a fresh
clone has no `.katari/`, and `check` and `apply` only read that cache. And the `discord` and `slack`
packages each carry an [FFI sidecar]({docs}/{currentVersion}/guides/ffi-sidecars) whose own npm
dependencies the bundler needs — so run the `npm install` once inside the fetched copy, with
`slack-*` in place of `discord-*` for standup-scribe.

The entry point is `main` in every one of them, under the package name from `katari.toml` —
`release_watch`, `standup_scribe`, `concierge`, `inbox_butler`. `Ctrl-C` detaches your terminal and
the run keeps serving; `katari cancel <run-id>` stops it for real.

## Where to go next

<DocCards>
  <DocCard href="{docs}/{currentVersion}/getting-started/quickstart" />
  <DocCard href="{docs}/{currentVersion}/guides/residents" />
  <DocCard href="{docs}/{currentVersion}/guides/packages" />
  <DocCard href="{docs}/{currentVersion}/guides/ffi-sidecars" />
</DocCards>
