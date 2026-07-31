---
title: Installation
description: Install the CLI, get a runtime, and set up your editor.
---

Katari is three installable pieces: a **CLI** (compiler included) from npm, a **runtime
server** you start with Docker Compose, and an optional **VSCode extension**.

## Prerequisites

- **Node.js 18+** with npm or pnpm — the CLI ships as an npm package.
- **Docker** with the Compose plugin — the local runtime runs as a compose stack.

## The CLI

```sh
npm install -g @katari-lang/cli
```

This puts `katari` on your PATH. It carries the whole toolchain: the compiler, project and
dependency management, and every runtime client command. Verify it:

```sh
katari --version
```

```
katari 0.1.4
```

**Note:** the package installs a prebuilt binary for linux-x64 and darwin-arm64. On another
platform, download a tarball from the
[GitHub releases](https://github.com/katari-lang/katari/releases) or build from source with
stack.

## The runtime

There is nothing separate to install. `katari init` scaffolds a `compose.yaml` that runs the
published runtime image next to PostgreSQL and a blob store; `docker compose up -d` in your
project directory is the whole setup. The [Quickstart]({docs}/{currentVersion}/getting-started/quickstart)
walks through it, and [The runtime]({docs}/{currentVersion}/toolchain/runtime) covers what is
inside the stack and how to self-host it for real.

## The editor extension

Install the **Katari** extension from the VSCode Marketplace, or from the command line:

```sh
code --install-extension katari-lang.katari-vscode
```

It gives you `.ktr` syntax highlighting, diagnostics as you type, hover types, go-to-definition,
and completion — the language server is bundled, so there is nothing else to install. Details in
[The editor]({docs}/{currentVersion}/toolchain/editor).

## Next

- [Quickstart]({docs}/{currentVersion}/getting-started/quickstart) — a project running in five
  minutes.
- [Docs for AI agents]({docs}/{currentVersion}/getting-started/docs-for-ai-agents) — one command
  points your AI assistant at these docs over MCP, so it writes real Katari.
- [The CLI]({docs}/{currentVersion}/toolchain/cli) — every command, in the order you reach for
  them.
- [Tutorial]({docs}/{currentVersion}/tutorial) — build up to a Discord bot with model-driven
  tools.
