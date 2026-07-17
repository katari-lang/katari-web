---
title: Compiler
description: Compiles .ktr into per-module IR JSON, with bundled stdlib and K-prefixed diagnostics.
---

`haskell/compiler` (`katari-compiler`) compiles `.ktr` source into the JSON IR (intermediate
representation) that the runtime executes. The pipeline processes each file as one module, in
order: parse, name resolution, type checking, lowering.

## Modules and the stdlib

**Each `.ktr` file is one module.** There is no top-level `module` declaration; the module name is
derived from the package name and the file path. `prelude` (and its `json` / `http` / `record` /
`array` / `string` / `math` / `env` / `file` / `webhook` / `mcp` / `reflection` submodules) is
embedded in the compiler binary ([`haskell/compiler/stdlib`]({docs}/{currentVersion}/standard-library)).
It requires no installation and is available as a default import from any project.

## Compilation output: per-module IR

The output is **one `IRModule` per source module**. The runtime assumes each module is uploaded
individually, so there is no whole-program link step. Each `IRModule` contains:

- A set of `BlockAgent`s, the only callable unit, each with a calling convention (input/output plus
  request effects, including JSON Schema).
- **A thread is the execution of a block.** Structural nodes such as `match` / `for` / `handle` /
  `parallel` become `OperationCall` within the same instance (starting a local child thread), while
  calls to an agent or a closure always become `OperationDelegate` (summoning a new instance). This
  distinction determines the runtime's unit of persistence (see
  [Runtime]({docs}/{currentVersion}/katari-toolchains/runtime)).
- It carries no type information. The public schema lives in the `BlockAgent`'s `schema` (JSON
  Schema). A `@"..."` doc annotation becomes this schema's `description`, and appears as-is in
  AI-facing tool definitions and in `reflection.get_metadata`.

Each `IRModule` carries a `schemaVersion`. This is a contract that only increments when the IR
gains an operation an old runtime cannot execute (v2 added early release of unused variables,
`drop`; v3 added `defer` for `finally`). An old runtime rejects IR with a `schemaVersion` it does
not understand.

## Diagnostics

Diagnostics carry a code of `K` plus four digits (`K1xxx` for parsing, `K3xxx` for type checking).
Parsing **recovers per declaration**: a broken declaration is reported as an error, replaced with a
placeholder, and parsing skips ahead to the next declaration keyword and continues, so a single
syntax mistake does not wipe out diagnostics for the rest of the file. `katari check`
(`haskell/cli`) displays these diagnostics as-is.

## katari check / katari build

`katari check` only compiles and reports diagnostics; it does not deploy. `katari build` writes out
the IR JSON (the default output path is `.katari/dist/ir.json`). `katari apply` does this and also
deploys to the runtime as a new snapshot. The upload is a per-module diff (unchanged modules are
not resent); see the snapshot section of
[Runtime]({docs}/{currentVersion}/katari-toolchains/runtime) for details.

## Related

<DocCards>
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/runtime" />
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/lsp" />
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/cli" />
</DocCards>
