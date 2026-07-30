---
title: Packages
description: Add registry packages to a project, pin an immutable snapshot, and override a dependency with a local path or a git fork.
---

A Katari project declares its dependencies in `katari.toml`. Each name in
`[dependencies].packages` resolves through a pinned **registry snapshot** — a curated set of
`(package, version)` pins that are guaranteed to compile together — or through a local
`[overrides]` entry. The CLI fetches each pinned tarball, verifies its content hash, and records
the exact resolution in `katari.lock`.

## Add a package

```sh
katari add tavily
```

`katari add` checks that the name is resolvable (present in the pinned snapshot, or covered by a
root `[overrides]` entry), rewrites the `packages` array in `katari.toml`, fetches and verifies
the pin, and refreshes `katari.lock`. `katari remove` is the same edit in the other direction.

After adding, import the package by its name and call its agents qualified:

```katari
import tavily

@"Search the web; failures degrade to a readable line instead of failing the run."
agent main(question: string) -> string with io {
  use handler {
    request prelude.throw(error: env.missing_secret | oauth.server_error | http.api_failure | http.fetch_error | json.parse_error) -> never {
      break f"search failed: ${json.stringify(value = error)}"
    }
  }
  use tavily.provider(source = credentials.env(key = "TAVILY_API_KEY"))
  json.stringify(value = tavily.search(query = question))
}
```

The `credentials.env(key = ...)` argument names where the API key lives in the project's
env store; the provider resolves the current value at each use — see
[Secrets and credentials]({docs}/{currentVersion}/guides/secrets-and-credentials).

## Pin a snapshot

The `[dependencies]` section names the registry and the snapshot every package resolves against:

```toml
[dependencies]
registry = "https://raw.githubusercontent.com/katari-lang/katari-registry/main"
snapshot = "snapshot-2026-07-30-f55993f8"
packages = ["tavily"]
```

- A **snapshot** is a consistent set: every package in it compiles against every other, with the
  `katari_compiler` version the snapshot declares. Once cut, a snapshot file is immutable — pin
  one and your resolution never shifts under you. This is the recommended setting.
- `snapshot = "staging"` points at the registry's mutable candidate set — the packages that will
  become the next snapshot. Use it for early access to a just-merged package, and switch back to
  the next immutable cut.

There are no per-package version constraints to solve: the snapshot already fixed every version,
so `packages` is a flat list of names.

## Move to a newer snapshot

```sh
katari update                                  # the registry's newest cut
katari update snapshot-2026-07-30-f55993f8     # or a named one — including staging, and going back
```

`update` re-pins `[dependencies].snapshot` and re-locks in one step. Then `katari check` compiles
against the new set, and its diagnostics are the upgrade's real cost — a package whose signature
moved shows up here, before anything is deployed.

**Editing the pin by hand is not enough**, and the CLI will say so rather than let it slide: with a
`snapshot` line the lock has not been resolved against, `check`, `build` and `apply` refuse and tell
you to run `katari lock`. That refusal exists because the alternative is quiet and wrong — a check
that resolves from a stale lock reports green about the packages you just stopped asking for.

Note that a snapshot's name does not tell you its age: the trailing hex is a content hash with no
order, so two cuts from the same day sort arbitrarily. `update` reads the registry's index instead
of guessing from names.

`snapshot = "staging"` is a mutable set, but pinning it does **not** make your builds move: the lock
freezes the exact resolution at lock time, and it changes only when you run `lock` or `update`
again.

## Commit the lockfile

`katari lock` writes `katari.lock` next to `katari.toml`, and `katari add` / `katari remove` /
`katari update` call it for you after editing the manifest. Nothing else writes it — in particular
`apply` does not, so a deploy can never resolve something your build never saw:

```toml
[lock]
version = 1
snapshot = "snapshot-2026-07-30-f55993f8"
katari_compiler = "0.1.1"

[packages.tavily]
source = "git"
url = "https://github.com/katari-lang/katari-package-tavily"
rev = "76e97c8d62e2fa1fb4dd320d3a3dcb7b5a6df186"
sha256 = "6162b74fed8462af0ec3a3ac9789d9ad601de38e79b2512e792aa3c7c69668d4"
```

Commit it: every non-path dependency is pinned to a git rev plus a verified tarball hash, so
every consumer of the repository gets the same byte-for-byte resolution. A `path` override is
recorded without a hash — a local path is mutable on purpose.

## Override a dependency

An `[overrides.<name>]` table replaces where one declared dependency comes from, without touching
the snapshot pin for everything else:

```toml
[dependencies]
registry = "https://raw.githubusercontent.com/katari-lang/katari-registry/main"
snapshot = "snapshot-2026-07-30-f55993f8"
packages = ["tavily", "discord"]

# Develop a package against the app that uses it:
[overrides.tavily]
path = "../katari-package-tavily"

# Or pin a fork; the rev must be a full 40-character commit SHA:
[overrides.discord]
git = "https://github.com/you/katari-package-discord"
rev = "b93423583ba35d85aca3f0de80823b24cb77f9f9"
```

Adding, changing or deleting an override changes the closure, so run `katari lock` afterwards —
`check` refuses until the lock agrees with the overrides, which is what stops a deleted `path` from
quietly continuing to compile out of your working copy.

Each override sets `path` **or** `git` (with `git` requiring `rev`), and must name a dependency
declared in `packages` — a typo'd override is an error rather than a silently ignored table. A
git override's `rev` is deliberately a commit SHA, not a branch or tag: with no separate content
hash, the rev is the only thing pinning reproducibility.

## What is in the registry

The pinned snapshot (`snapshot-2026-07-30-f55993f8`) carries thirteen packages. Every exported agent,
request, and type is documented in the [reference](/packages).

- **ai** — a provider-agnostic AI tool-calling loop: one `infer_step` seam with interchangeable
  Anthropic, Gemini, and OpenAI providers.
- **discord** — a discord.js gateway client: a bot-token provider, watch / send / ask agents, and
  file attachments in both directions (ships an FFI sidecar).
- **e2b** — run Python in a persistent e2b sandbox as a tool (ships an FFI sidecar).
- **fleet** — the durable **desired set** behind a fiber fleet, and its difference against the live
  nursery roster; performs only store operations, so there is nothing to configure.
- **gmail** — mail tools (`list_recent` / `read_body` / `fetch_attachment` / `send`), label editing
  and a watcher over Gmail's REST API — pure Katari, no sidecar.
- **google_calendar** — calendar tools (list / create / watch) over the OAuth refresh-token
  grant — pure Katari, no sidecar.
- **google_common** — the Google REST plumbing `gmail` and `google_calendar` share; a library for
  packages, not a tool set, and it arrives as their transitive dependency.
- **imagegen** — edit images with the Gemini image model as a tool (ships an FFI sidecar).
- **memory** — persistent memory for resident agents: five model-callable tools over the durable
  store, split into a per-turn summary layer and full notes read back on request.
- **persona** — a character as an ordered set of layers: assemble one role's per-turn injection note,
  and rewrite one layer under a hard cap.
- **slack** — a Slack bot capability over Socket Mode: a two-token provider, watch channel messages,
  post replies, ask with Block Kit controls (ships an FFI sidecar).
- **tavily** — web search as a tool over the Tavily API — pure Katari, no sidecar.
- **web** — fetch a web page as a tool over `http.fetch` — pure Katari, no key.

## Where to go next

- [The tutorial's Discord bot]({docs}/{currentVersion}/tutorial/a-discord-bot) composes four of
  these packages into one app.
- [The examples repository](https://github.com/katari-lang/examples) — four deployable projects
  that put eight of them to work, each pinning a snapshot and compiling in CI: `web` + `discord` +
  `fleet` in release-watch, `slack` + `ai` in standup-scribe, `discord` + `ai` + `memory` in
  concierge, `gmail` + `google_calendar` + `ai` + `discord` in inbox-butler.
- [FFI sidecars]({docs}/{currentVersion}/guides/ffi-sidecars) — how a package like `e2b` or
  `discord` ships TypeScript alongside its Katari source.
- [CLI]({docs}/{currentVersion}/toolchain/cli) — `katari add`, `katari remove`, and the rest of
  the toolchain.
