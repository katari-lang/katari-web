---
title: The runtime
description: The server that executes snapshots — architecture, the console, keys, and self-hosting.
---

The runtime is one server process. It stores every project, snapshot, run, and escalation in
PostgreSQL, keeps file bytes in an S3-compatible blob store, and serves everything on a
single port:

- `/api/v1` — the JSON API the CLI and console speak, behind a Bearer token.
- `/` — the admin console, baked into the image as static assets.
- `/inbound/<token>` — the public URLs `webhook.inbound` mints; the unguessable token is the
  capability.
- `/mcp/<token>` — the public endpoints `mcp.serve` mints, same contract.
- `/oauth/callback` — where OAuth providers redirect the browser during an authorization.

`katari init` scaffolds a `compose.yaml` running exactly this — the published
`ghcr.io/katari-lang/katari` image, `postgres`, and a SeaweedFS blob store, with state in named
volumes:

```yaml
services:
  runtime:
    image: ghcr.io/katari-lang/katari:0.1.5
    ports:
      - "${KATARI_PORT:-3000}:3000"
    environment:
      DATABASE_URL: postgres://katari:katari@postgres:5432/katari
      KATARI_API_KEY: ${KATARI_API_KEY:?set KATARI_API_KEY in .env}
      KATARI_SECRET_KEY: ${KATARI_SECRET_KEY:?set KATARI_SECRET_KEY in .env}
      BLOB_S3_BUCKET: katari-blobs
      BLOB_S3_ENDPOINT: http://seaweedfs:8333
```

That stack is the local dev setup and the self-host deployment — there is no separate "production"
runtime.

## Snapshots and runs

`katari apply` uploads a compiled program as a **snapshot**: an immutable version of the IR.
Each project has a **head** — the snapshot new runs execute by default. Deploying moves the
head; it never touches old snapshots, and a run stays pinned to the snapshot it started on
for its whole life. That is what makes deploys safe next to week-long runs, and what makes
rollback trivial: `katari project rollback <snapshot>` just moves the head back.

A **run** is one execution of an agent. The runtime persists every step it takes — each
delegation, each escalation, each timer — so a run survives a server restart and resumes
where it parked. The mechanics are in
[Durable execution]({docs}/{currentVersion}/concepts/durable-execution).

## The console

The console lives at the runtime's root URL and asks for the `KATARI_API_KEY` once. Per
project it shows:

- **Dashboard** — active runs, open escalations, recent runs, and the project README
  (`apply` uploads your `README.md`).
- **Runs** — every run; a run's page has its argument, result or error, the delegation tree,
  and the escalation history.
- **Agents** — the deployed agents with their input and output schemas, and an invoke form to
  start a run from the browser.
- **Escalations** — the inbox: every open question across the project, answerable in place.
  Answering resumes the run.
- **Snapshots** — the deploy history, with rollback.
- **Files**, **Env**, **Credentials** — uploaded blobs, configuration entries, and the
  project's OAuth clients and stored credentials.

## The two keys

- `KATARI_API_KEY` is the Bearer token every `/api/v1` caller must present — at least 32
  characters, and the runtime refuses to boot without one, so an API is never accidentally left
  open. Only `/api/v1/health` and the console's static assets skip it.
- `KATARI_SECRET_KEY` (base64, 32 bytes) encrypts secret env values and stored credentials at
  rest. It never authenticates anything, and it is the one value to keep across every redeploy:
  the ciphertext records which key version sealed it, not the key. To rotate, put the new key in
  `KATARI_SECRET_KEY` and move the old one to `KATARI_SECRET_KEY_PREVIOUS` — new writes use the
  new key while old values keep opening.

Generate them with `openssl rand -hex 32` and `openssl rand -base64 32` respectively, as the
scaffolded `.env.example` shows.

## Self-hosting

The scaffolded compose file is a complete deployment; adapting it is configuration, not
architecture:

| Variable                                                         | What it sets                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`, `HOST`                                                   | Where the server listens (defaults `3000`, `0.0.0.0`).                                                                                                                                                                                                                   |
| `DATABASE_URL`                                                   | The PostgreSQL connection string. Migrations run on boot.                                                                                                                                                                                                                |
| `DATABASE_SSL`                                                   | `disable` / `require` / `verify-full`. Unset, the runtime picks `disable` for a loopback host and `verify-full` for anything else.                                                                                                                                       |
| `KATARI_INSTANCE_LOCK`                                           | `on` by default: the boot-time single-instance advisory lock. `off` only where you are certain nothing else runs against this database.                                                                                                                                  |
| `KATARI_INSTANCE_LOCK_TIMEOUT_MS`                                | How long a booting process waits for the previous one to release the lock before refusing to boot (default `60000`). Raise it for a slow-draining rolling deploy.                                                                                                        |
| `KATARI_API_KEY`, `KATARI_SECRET_KEY`                            | The API Bearer token and the at-rest encryption key. Both required.                                                                                                                                                                                                      |
| `KATARI_SECRET_KEY_PREVIOUS`                                     | Keys still accepted for decryption, comma-separated, newest first — the other half of a rotation.                                                                                                                                                                        |
| `BLOB_S3_BUCKET`, `BLOB_S3_ENDPOINT`, `BLOB_S3_FORCE_PATH_STYLE` | The blob store. Point at a real bucket by dropping the endpoint and setting AWS credentials; unset, blobs live in memory (dev only).                                                                                                                                     |
| `KATARI_PUBLIC_URL`                                              | The base URL the outside world reaches you at — what `/inbound` and `/mcp` URLs are minted under. Required under `NODE_ENV=production`.                                                                                                                                  |
| `KATARI_EGRESS_ALLOW_PRIVATE`                                    | Off by default: a program's outbound requests cannot reach loopback, private or link-local addresses, so a model-chosen URL cannot reach your internal network or the cloud metadata service. The scaffolded compose file turns it on because everything is one machine. |
| `KATARI_EGRESS_ALLOWED_HOSTS`                                    | The narrow form of that escape hatch: named hosts a deployment's programs may reach, comma-separated.                                                                                                                                                                    |
| `KATARI_RATE_LIMIT_PER_MINUTE`                                   | Requests a minute per client address on the surfaces carrying no bearer token — `/inbound`, `/mcp`, the OAuth callback — and on failed authentication (default `120`).                                                                                                   |
| `CORS_ORIGIN`                                                    | Allowed origins for a separately-hosted console (default `*` — pin it in shared deployments).                                                                                                                                                                            |
| `LOG_LEVEL`                                                      | `debug` / `info` / `warn` / `error`.                                                                                                                                                                                                                                     |

Webhooks and served MCP endpoints are only as reachable as your runtime: behind a proxy,
`KATARI_PUBLIC_URL` must be the outside address, or the minted URLs point at a host external
services cannot reach.

`/api/v1/health` answers without authentication and without touching the database — use it for
container health checks and uptime probes:

```sh
curl -s http://localhost:3000/api/v1/health
```

```json
{ "ok": true, "data": { "status": "ok", "uptimeSeconds": 42, "version": "0.1.5" } }
```

## Operational constraints

Two properties of the 0.1 runtime shape how you deploy it.

**One runtime process per database.** A project's threads, its in-flight external calls, and its
at-most-once bookkeeping are warm state in the process that executes them, and every boot revives an
actor for every project with a live run. The scope is therefore the database, not the project: one
process owns all of it. The runtime enforces that with a PostgreSQL session advisory lock taken at
boot and held for the life of the process. A second process waits for the lock and refuses to boot
if it does not get it within `KATARI_INSTANCE_LOCK_TIMEOUT_MS` (default 60 s); the wait is what makes
a rolling deploy work, since the new process idles until the old one drains and releases. Several
projects share one runtime and one database, which is what the scaffolded compose file runs.

**MCP servers are trusted code.** Both `mcp.provide` and a `katari mcp pull` binding decode a tool
response onto the value plane, and the runtime does not yet authenticate that a decoded value which
looks like a callable originated inside your program. Connect only to servers you control or trust.
The general authorization that closes this lands in v0.2; the full note is in
[MCP → Trust boundary]({docs}/{currentVersion}/guides/mcp#trust-boundary).

## Next

<DocCards>
  <DocCard href="{docs}/{currentVersion}/concepts/durable-execution" />
  <DocCard href="{docs}/{currentVersion}/guides/webhooks" />
  <DocCard href="{docs}/{currentVersion}/guides/secrets-and-credentials" />
  <DocCard href="{docs}/{currentVersion}/toolchain/cli" />
</DocCards>
