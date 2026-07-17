---
title: LSP
description: Hover, completion, definition, and references for editors, plus debounced diagnostics.
---

`haskell/lsp` (`katari-lsp`) is a Language Server Protocol implementation that shares its
diagnostics infrastructure with the compiler. The VSCode extension (`typescript/vscode`) launches
it and connects to it. The extension itself provides syntax highlighting as well as command palette
entries such as `katari.check` and `katari.build`.

## Features provided

| Feature     | Description                                                                                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hover       | Shows the source fragment and type of the expression at the cursor on one line, adding the qualified name if it is a top-level reference                                                                           |
| Completion  | Three modes: right after `ident.`, the member list of the module or object; inside an open `(`, the list of parameter labels of the callee (excluding labels already used); otherwise, everything visible in scope |
| Definition  | Jumps to the definition of the symbol at the cursor (cross-module resolution, including dependency packages)                                                                                                       |
| References  | All occurrences of the symbol across the whole workspace (the definition itself counts as one occurrence)                                                                                                          |
| Diagnostics | Updates the buffer on every edit and publishes diagnostics from a recompile debounced by 150ms                                                                                                                     |

Filtering of completion candidates (such as prefix matching) is done by the editor. The server
returns the entire candidate set for each mode.

## How recompilation works

`didOpen` / `didChange` / `didClose` first update the buffer overlay, then schedule a workspace
recompile debounced by 150ms. Because the recompile rereads the project from disk (with buffer
overlays applied on top), file creation, deletion, and dependency changes are picked up naturally
without needing to worry about invalidating a cache. File changes on disk
(`workspace/didChangeWatchedFiles`) trigger the same recompile.

## Related

<DocCards>
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/compiler" />
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/cli" />
</DocCards>
