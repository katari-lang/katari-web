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

`katari init` scaffolds a `compose.yaml` running exactly this: the published
`ghcr.io/katari-lang/katari` image, `postgres`, and a SeaweedFS blob store, with state in
named volumes. That stack is the local dev setup and the self-host deployment — there is no
separate "production" runtime.

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

- `KATARI_API_KEY` is the Bearer token every `/api/v1` caller must present — the runtime
  refuses to boot without one, so an API is never accidentally left open. Only
  `/api/v1/health` and the console's static assets skip it.
- `KATARI_SECRET_KEY` (base64, 32 bytes) encrypts secret env values and stored credentials at
  rest. It never authenticates anything.

Generate them with `openssl rand -hex 32` and `openssl rand -base64 32` respectively, as the
scaffolded `.env.example` shows.

## Self-hosting

The scaffolded compose file is a complete deployment; adapting it is configuration, not
architecture:

| Variable                                                         | What it sets                                                                                                                               |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`, `HOST`                                                   | Where the server listens (defaults `3000`, `0.0.0.0`).                                                                                     |
| `DATABASE_URL`                                                   | The PostgreSQL connection string. Migrations run on boot.                                                                                  |
| `KATARI_API_KEY`                                                 | The API Bearer token. Required.                                                                                                            |
| `KATARI_SECRET_KEY`                                              | The at-rest encryption key. Required.                                                                                                      |
| `BLOB_S3_BUCKET`, `BLOB_S3_ENDPOINT`, `BLOB_S3_FORCE_PATH_STYLE` | The blob store. Point at a real bucket by dropping the endpoint and setting AWS credentials; unset, blobs live in memory (dev only).       |
| `KATARI_PUBLIC_URL`                                              | The base URL the outside world reaches you at — what `/inbound` and `/mcp` URLs are minted under. Set it behind a reverse proxy or tunnel. |
| `CORS_ORIGIN`                                                    | Allowed origins for a separately-hosted console (default `*` — lock it down in shared deployments).                                        |
| `LOG_LEVEL`                                                      | `debug` / `info` / `warn` / `error`.                                                                                                       |

**Note:** webhooks and served MCP endpoints are only as reachable as your runtime. If it sits
behind a proxy, `KATARI_PUBLIC_URL` must be the outside address, or the minted URLs point at
a host external services cannot reach.

`/api/v1/health` answers without authentication — use it for container health checks and
uptime probes.

## Operational constraints

Two limits of the v0.1.0 runtime are worth stating plainly before you deploy.

**One runtime process per project.** A project's runs, its durable state, and its in-flight
timers and reactors are owned by the process that executes them; the runtime has **no lease** that
prevents a second process from warming the same project against the same database. Running two
processes over one project is therefore unsupported — they would both drive the same runs and
corrupt each other's progress. Deploy **one runtime process per project**. Scaling out (a lease so
several processes can safely share a project) is planned for a later release; until then, a single
process is the supported topology, and it is what the scaffolded compose file runs.

**Connect only to MCP servers you trust.** v0.1.0's MCP integration — both `mcp.provide` and a
`katari mcp pull` binding — assumes the servers you reach are **trusted**. A tool response is decoded
onto the value plane, and the runtime does not yet authenticate that a decoded value which looks like
a callable actually originated inside your program, so a malicious server could in principle return a
crafted response. The general authorization that closes this lands in v0.2; for now, treat an MCP
server as trusted code and connect only to servers you control or trust. The full note is in
[MCP → Trust boundary]({docs}/{currentVersion}/guides/mcp#trust-boundary).

## Next

- [Durable execution]({docs}/{currentVersion}/concepts/durable-execution) — what "persists
  every step" actually means.
- [Webhooks]({docs}/{currentVersion}/guides/webhooks) — the `/inbound` surface from the
  program side.
- [Secrets and credentials]({docs}/{currentVersion}/guides/secrets-and-credentials) — what
  `KATARI_SECRET_KEY` protects.
