---
title: The editor
description: The VSCode extension — language features from katari-lsp, CLI commands from the palette.
---

The **Katari** extension gives VSCode two things: language intelligence for `.ktr` files,
served by the `katari-lsp` language server, and command-palette entries that drive the
`katari` CLI. Install it from the Marketplace:

```sh
code --install-extension katari-lang.katari-vscode
```

Editors that use [Open VSX](https://open-vsx.org/extension/katari-lang/katari-vscode) instead of
the Marketplace — VSCodium, Cursor, Windsurf — find it under the same name in their own extension
view.

## Language features

- **Syntax highlighting** for `.ktr`.
- **Diagnostics** as you type — the same errors `katari check` reports, as squiggles.
- **Hover** — types and doc annotations for the symbol under the cursor.
- **Go to definition** (F12) and **find references** (Shift+F12).
- **Completion** (Ctrl+Space) — locals and top-level callables.

All of it comes from `katari-lsp`, which the extension bundles — a Marketplace install needs
no separate server setup.

## Commands

All entries are under **Katari:** in the command palette. The CLI-backed ones run in one
shared **Katari** integrated terminal, so interactive flows like `apply` prompts work, and
they target the nearest project: the extension walks up from the active file to the closest
`katari.toml`.

| Command                                | Runs                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Katari: Check project**              | `katari check`                                                                                         |
| **Katari: Build project**              | `katari build`                                                                                         |
| **Katari: Apply (deploy) project**     | `katari apply`                                                                                         |
| **Katari: Generate MCP tool bindings** | `katari mcp pull` — prompts for the server URL and a `.ktr` output path, then opens the generated file |
| **Katari: Restart language server**    | Restarts `katari-lsp` with the current settings                                                        |

**Note:** there is no login command for MCP servers that use OAuth. Authorization is an
escalation the runtime raises when a program first needs the credential — you answer it from
the console or `katari answer`, like any other question. See
[MCP]({docs}/{currentVersion}/guides/mcp).

## How binaries are resolved

The language server resolves in three tiers, first match wins:

1. an explicit `katari.server.path` setting — your own build overrides everything;
2. the `katari-lsp` bundled in the extension — what a Marketplace install uses;
3. a `katari-lsp` on PATH — a from-source checkout.

The CLI resolves the same way minus the bundled tier: `katari.cli.path` if set, else `katari`
on PATH — the extension bundles no CLI, so install it as in
[Installation]({docs}/{currentVersion}/getting-started/installation). A third setting,
`katari.server.args`, passes extra flags to the server (useful for verbose logging while
developing the LSP itself).

## Next

- [The CLI]({docs}/{currentVersion}/toolchain/cli) — what those palette commands run.
- [Quickstart]({docs}/{currentVersion}/getting-started/quickstart) — a project to open the
  editor on.
- [Types and schemas]({docs}/{currentVersion}/concepts/types-and-schemas) — what the hovers
  are showing you.
