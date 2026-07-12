---
title: Katari Toolchains
description: compiler / runtime / lsp / cli の全体像 — .ktr からデプロイ・実行・編集支援まで。
---

Katari のツールチェインは 4 つのコンポーネントからなる。

```
.ktr ソース ──[compiler]──▶ IR (JSON, module 単位) ──[katari apply]──▶ [runtime] ──▶ instance の実行
     ▲                                                                       │
     └──[lsp]── エディタ (hover / completion / definition / references) ◀────┘ (診断は compiler を再利用)
```

| コンポーネント                                                 | 実体                 | 役割                                                               |
| -------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------ |
| [Compiler]({docs}/{currentVersion}/katari-toolchains/compiler) | `haskell/compiler`   | `.ktr` を module 単位の IR JSON にコンパイルし、diagnostics を出す |
| [Runtime]({docs}/{currentVersion}/katari-toolchains/runtime)   | `typescript/runtime` | IR を実行・永続化する常駐サーバー                                  |
| [LSP]({docs}/{currentVersion}/katari-toolchains/lsp)           | `haskell/lsp`        | エディタ向けの hover / completion / definition / references        |
| [CLI]({docs}/{currentVersion}/katari-toolchains/cli)           | `haskell/cli`        | プロジェクトの scaffold・コンパイル・デプロイ・run の管理          |

コンパイラと LSP は Haskell (同じ diagnostics 基盤を共有する)、ランタイムは TypeScript
(Node 上の Hono サーバー)。CLI は Haskell 本体を npm 経由でも配布する
([Installation]({docs}/{currentVersion}/getting-started/installation) 参照)。

<DocCards>
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/compiler" />
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/runtime" />
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/lsp" />
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/cli" />
</DocCards>
