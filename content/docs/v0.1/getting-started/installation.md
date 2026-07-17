---
title: Installation
description: Install the CLI with npm and start a self-hosted runtime with docker compose.
---

Katari has two parts: the **CLI**, which compiles and deploys a project, and the **runtime**,
which executes it.

## CLI

`@katari-lang/cli` is a thin Node shim. The actual work is done by a prebuilt native binary
shipped in a `@katari-lang/cli-<platform>` package, which npm/pnpm selects automatically as an
optional dependency.

```sh
npm i -g @katari-lang/cli
# or, per project
pnpm add -D @katari-lang/cli
```

Supported platforms are `linux-x64` and `darwin-arm64` (Intel Macs run it through Rosetta 2). On
other platforms, download a prebuilt tarball from [Releases](https://github.com/katari-lang/katari/releases)
or build from source with `stack build`.

```sh
katari --version
katari --help
```

## Runtime

Deploying and running a project requires a runtime. `katari init` (see the next section,
[Quickstart]({docs}/{currentVersion}/getting-started/quickstart)) generates a `compose.yaml` that
starts a self-hosted stack of three services: Postgres, an S3-compatible blob store (SeaweedFS),
and the runtime image.

```sh
cp .env.example .env
echo "KATARI_API_KEY=$(openssl rand -hex 32)"       >> .env
echo "KATARI_SECRET_KEY=$(openssl rand -base64 32)" >> .env
docker compose up -d
```

- `KATARI_API_KEY`: the key the CLI and the admin console use as a Bearer token to authenticate.
  The runtime will not start without it.
- `KATARI_SECRET_KEY`: the at-rest encryption key for secret values (base64, 32 bytes). This key
  is distinct from `KATARI_API_KEY`.

Once started, the admin console (`/`) and the JSON API (`/api/v1`) both listen on the same port
(3000 by default). The CLI reads `[runtime].url` from `katari.toml` (default
`http://localhost:3000`) and `KATARI_API_KEY` from `.env` to connect. To point the runtime at
cloud blob storage instead, remove `BLOB_S3_ENDPOINT`, set real AWS credentials, and remove the
`seaweedfs` service.

## Related

<DocCards>
  <DocCard href="{docs}/{currentVersion}/getting-started/quickstart" />
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/cli" />
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/runtime" />
</DocCards>
