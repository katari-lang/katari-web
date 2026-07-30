---
title: Four complete programs
description: The example repository as a reading list — four deployable residents, what each one teaches, the order to read them in, and the recipe that runs any of them.
---

Everything else on this site is an excerpt. A page shows you the handler and not the file it lives
in; the [tutorial]({docs}/{currentVersion}/tutorial) builds a real bot and then stops, because a
tutorial has to. The [examples repository](https://github.com/katari-lang/examples) is the rest: four
**complete projects** — manifest, lockfile, compose file, secrets, sidecar — that you clone, point
at your own tokens, and leave running.

All four are **residents**: programs that stay on a channel or a schedule rather than running once
and exiting. That is why they are worth reading rather than skimming. A resident is the first
program whose correctness you cannot see by running it once, and each README says plainly what a
runtime restart costs that program — what comes through (store rows, a desk's conversation, an open
window) and what does not (the messages nobody was listening for, a question left standing in a
channel). Nothing here can show you that, because it only shows up in a program that has been left
running.

Each pins a published registry snapshot in its `katari.toml` and compiles in CI against the
published CLI, so what you clone is what runs.

## release-watch

[**A GitHub release monitor you manage from Discord.**](https://github.com/katari-lang/examples/tree/main/release-watch)
Type `watch vercel/next.js` in a channel; on a durable schedule it polls the public releases API and
announces what is new, in that channel.

Read it for the resident skeleton with nothing else in it. There is no model anywhere in the program
— the packages are `web`, `discord` and `fleet` — so what is left on the page is the durable
machinery: one `time.watch` interval loop over the whole desired set (not one fiber per repository,
so `watch` and `unwatch` need no fork-and-cancel reconcile — the next tick simply sees the new set),
a per-repository [store]({docs}/{currentVersion}/guides/store) cursor written as a sum so "never
checked" and "checked, nothing there" cannot blur, and every HTTP failure folded into a value that
`list` shows rather than a throw that kills the loop. It is also the shortest place to watch a
program admit its own delivery guarantee: a release is announced **before** the cursor advances, so
announcements are at-least-once on purpose.

## standup-scribe

[**A Slack standup bot whose digest a human approves before it posts.**](https://github.com/katari-lang/examples/tree/main/standup-scribe)
A weekday cron opens the window, replies are collected in the prompt's thread, one model step drafts
the digest, and the facilitator presses _Post it_, rewrites it, or discards it.

Read it for the human in the loop. The review is one `slack.ask` whose form is **prefilled with the
draft**, so "approved" means approved at the submitted text, with no re-derivation between the click
and the post — the [approval gate]({docs}/{currentVersion}/guides/approval-gates) idiom, at its
smallest. Slack's message stream and its interaction plane are subscribed separately and cannot race
each other ([Asking a human]({docs}/{currentVersion}/guides/asking-a-human)), and the ask runs under
a six-hour deadline so a review nobody answers cannot hold back tomorrow's standup. The window
itself lives in the store rather than in the fiber that opened it, which is what turns three
different situations — a redelivered tick, a restart mid-window, a day that already closed — into
one mechanism.

## concierge

[**A two-desk Discord community concierge.**](https://github.com/katari-lang/examples/tree/main/concierge)
A public _face_ answers the community from published notes only; its owner curates those notes from
a private channel with three commands, and a question the notes do not cover is mailed to that
channel instead of guessed at.

Read it as [chapter 6]({docs}/{currentVersion}/tutorial/a-second-agent)'s office with real packages
on the bus: the same two desks and the same mail bridge, with `ai.advance_desk` where the
arithmetic was. The face's **tool set is its privacy boundary** —
`[memory.recall, memory.search, memory.list_memories, flag_unknown]`, three reads and a flag, no
writes — so nothing it says can come from anywhere but what the owner published. Its conversation is
a handler `var`, which is to say run state, so it survives a runtime restart intact: the clearest
demonstration on this list of what
[durable execution]({docs}/{currentVersion}/concepts/durable-execution) is actually for.

## inbox-butler

[**Gmail triage that proposes calendar events for one-click approval.**](https://github.com/katari-lang/examples/tree/main/inbox-butler)
When a mail looks like it wants a meeting, the butler drafts the event and asks you on Discord with
every field prefilled and editable. A mail that is not a meeting costs you nothing at all.

Read it for composition — four packages, four providers, one program — and for OAuth you never
handle. The runtime owns the Google credential (consent, exchange, refresh); the program only names
it, and one `credentials.preflight` call at boot names every unset secret at once instead of failing
at 3am, mid-errand
([Secrets and credentials]({docs}/{currentVersion}/guides/secrets-and-credentials)). Triage is one
`ai.infer_structured[T]` call whose object type _is_ the contract, converted to a data sum at the
boundary so the desk dispatches on a sum and nothing else. Each question is forked as its own fiber,
so the desk keeps triaging while a human takes their time, and a store marker keyed on the message
id makes an at-least-once watch exactly-once where it counts: at most one model call and one
question per mail.

## A reading order

Read **release-watch** first, even if you never want one. It is the only program here with no model
in it, so region, fibers, desk, store and crash policy are legible without an AI loop sitting on top
of them.

Then take one of the middle two, for one model surface each: **concierge** if you arrived from the
tutorial, since its mail bridge is the piece that carries you straight in from chapter 6;
**standup-scribe** if what you need next is a human's approval before an irreversible step.

Read **inbox-butler** last. It installs four providers over three credentials, and it is a much
shorter read once the other three have each shown you one of its pieces.

## Running one

The recipe is the same for all four; each README fills in its own tokens, channel ids and settings.

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

Two of those lines are easy to skip and neither is optional. **`katari lock` is what fetches**: a
fresh clone has no `.katari/`, and `check` and `apply` only read that cache. And the `discord` and
`slack` packages each carry an [FFI sidecar]({docs}/{currentVersion}/guides/ffi-sidecars) whose own
npm dependencies the bundler needs — so run the `npm install` once inside the fetched copy, with
`slack-*` in place of `discord-*` for standup-scribe.

The entry point is `main` in every one of them, under the package name from `katari.toml` —
`release_watch`, `standup_scribe`, `concierge`, `inbox_butler`. `Ctrl-C` detaches your terminal and
the run keeps serving; `katari cancel <run-id>` stops it for real. The CLI is the published one,
`npm install -g @katari-lang/cli`.

## Where to go next

- [Quickstart]({docs}/{currentVersion}/getting-started/quickstart) — if you have not deployed
  anything yet. Every example assumes a `katari` on your PATH and a runtime to point it at.
- [Packages]({docs}/{currentVersion}/guides/packages) — what these four import, and how to add one
  to a project of your own.
- [FFI sidecars]({docs}/{currentVersion}/guides/ffi-sidecars) — the rule all four obey: a call
  carries the credential it acts with, never a handle into a sidecar's memory, which is why every
  crash policy here is one clause.
- [Durable execution]({docs}/{currentVersion}/concepts/durable-execution) — the mechanism under
  "what survives a restart".
