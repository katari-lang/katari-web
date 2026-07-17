---
title: Katari Toolchains
description: An overview of the compiler, runtime, lsp, and cli, from .ktr to deployment, execution, and editor support.
---

The Katari toolchain consists of four components.

```
.ktr source ──[compiler]──▶ IR (JSON, per module) ──[katari apply]──▶ [runtime] ──▶ instance execution
     ▲                                                                       │
     └──[lsp]── editor (hover / completion / definition / references) ◀────┘ (diagnostics reuse the compiler)
```

| Component                                                      | Implementation       | Role                                                             |
| -------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------- |
| [Compiler]({docs}/{currentVersion}/katari-toolchains/compiler) | `haskell/compiler`   | Compiles `.ktr` into per-module IR JSON and produces diagnostics |
| [Runtime]({docs}/{currentVersion}/katari-toolchains/runtime)   | `typescript/runtime` | The long-running server that executes and persists IR            |
| [LSP]({docs}/{currentVersion}/katari-toolchains/lsp)           | `haskell/lsp`        | Hover / completion / definition / references for editors         |
| [CLI]({docs}/{currentVersion}/katari-toolchains/cli)           | `haskell/cli`        | Scaffolds, compiles, deploys, and manages runs for a project     |

The compiler and the LSP are written in Haskell and share the same diagnostics infrastructure. The
runtime is written in TypeScript, as a Hono server on Node. The CLI distributes its Haskell binary
through npm as well (see [Installation]({docs}/{currentVersion}/getting-started/installation)).

<DocCards>
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/compiler" />
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/runtime" />
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/lsp" />
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/cli" />
</DocCards>
