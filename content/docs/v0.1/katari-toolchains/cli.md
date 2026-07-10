---
title: CLI
description: katari コマンドの一覧と、MCP サブコマンド (login / pull) のフラグ。
---

`katari` はプロジェクトのコンパイル、runtime へのデプロイ、run の管理を行う。各コマンドの詳細は
`katari <command> --help`。

## コマンド一覧

| コマンド | 説明 |
| --- | --- |
| `init` | 新しい Katari プロジェクトを scaffold する |
| `check` | プロジェクトをコンパイルし diagnostics を報告する |
| `build` | プロジェクトを IR JSON にコンパイルする |
| `apply` | コンパイルして runtime に新しい snapshot としてデプロイする |
| `add` | `katari.toml` に依存を追加し `katari.lock` を更新する |
| `remove` | `katari.toml` から依存を削除し `katari.lock` を更新する |
| `run` | agent を開始し結果を待つ (Ctrl-C で detach) |
| `status` | 1 つの run の状態・結果・open question を表示する |
| `cancel` | 走っている run を cancel する |
| `answer` | run が escalate した question に回答する |
| `ls` | run (既定) / agents / snapshots / projects / escalations / files / env を一覧する |
| `env` | プロジェクトの env entry を管理する (get / set / unset) |
| `file` | プロジェクトのファイルを upload / download する |
| `mcp` | MCP サーバーの credential とバインディングを管理する (login / pull) |
| `project` | runtime 上のプロジェクトを管理する (remove, rollback) |

多くのコマンドが共通のグローバルオプションを取る: `-q,--quiet`、`--verbose`、`--no-input`、
`--url URL` (runtime URL の上書き)、`-C,--directory DIR` (`katari.toml` のあるディレクトリ)。

## mcp

MCP 統合の verb。`login` はプログラムの外で named OAuth credential を確立し、`pull` は live サーバーから
型付きバインディングモジュールを生成する。手引きは [Guides › MCP]({docs}/{currentVersion}/guides/mcp)。

`katari mcp [--project NAME] <login|pull> ...` — `--project` は login の credential が属するプロジェクト
(既定: 周囲の `katari.toml` の `[package].name`)。

### mcp login

```sh
katari mcp login --url <URL> --name <NAME> [--scope <SCOPE>]
```

OAuth 2.1 (authorization-code + PKCE + dynamic client registration) を対話的に実行し、得た credential を
プロジェクト secret `mcp.oauth.<NAME>` として保存する (保存時に暗号化、API 上は write-only)。
authorization URL は stderr に印字される。runtime を要する (credential を env API 経由で保存するため)。

| フラグ | 必須 | 説明 |
| --- | --- | --- |
| `--url URL` | 必須 | 認証対象の MCP サーバー (プログラムが `mcp.tools` に渡す url) |
| `--name NAME` | 必須 | プログラムが `mcp.oauth(name = ...)` で参照する credential 名。secret `mcp.oauth.<NAME>` として保存される |
| `--scope SCOPE` | 任意 | 要求する OAuth scope (space 区切り、サーバーのドキュメントに従う) |

保存された credential は通常の env ツーリング (`katari ls env` / `katari env unset`) で一覧・削除できる。

### mcp pull

```sh
katari mcp pull --url <URL> --out <PATH> [--header k=v]... [--oauth [--scope <SCOPE>]]
```

サーバーのツールを列挙し、自己完結の `.ktr` バインディングモジュール 1 個を書き出す — ツール 1 つにつき
型付きラッパー agent が 1 つ、それらを接続にクローズした `connect` agent が返る。再生成はファイルを
上書きする。**pull はローカル**: runtime 接続も API key も要らない (サーバーと通信してファイルを書くだけ)。

| フラグ | 必須 | 説明 |
| --- | --- | --- |
| `--url URL` | 必須 | ツールを列挙する MCP サーバー |
| `--out PATH` | 必須 | 生成モジュールを書き出す (上書きする) `.ktr` ファイル |
| `--header KEY=VALUE` | 任意 | 毎リクエストに送るヘッダ (繰り返し可。例: bearer key) |
| `--oauth` | 任意 | 対話的に認証する (login と同じフロー)。credential は in-memory のみで **何も保存しない** |
| `--scope SCOPE` | 任意 | 要求する OAuth scope (`--oauth` と併用時のみ) |

- `pull` に `--name` フラグは **無い** (何も保存しないため)。
- auth は直和: `--header` と `--oauth` は **相互排他** (サーバーには明示ヘッダ *または* OAuth で到達する)。
- `--scope` は `--oauth` と併用したときだけ有効。

#### 型マッピング

サーバーの JSON Schema を Katari の型に写す。マッピングはパラメータ単位・出力単位で all-or-nothing —
`json.encode` / `json.decode` は wire form を話すため、型の中に `json.json` が 1 箇所でもあると生の
フラグメントにならないからである。完全にマップできないパラメータ / 出力は `json.json` に fallback する。

| JSON Schema | Katari |
| --- | --- |
| `string` / `integer` / `number` / `boolean` / `null` | そのまま |
| `array` + `items` | `array[T]` |
| `object` + `properties` | object 型 (non-required は `?` フィールド) |
| `object` + schema 値の `additionalProperties` のみ | `record[T]` |
| `anyOf` (全メンバーがマップ可) | union `A \| B` |
| それ以外 (`enum` / `const`、`allOf` / `oneOf`、tuple、空スキーマ、識別子にならないフィールド名) | `json.json` fallback |

## 関連

<DocCards>
  <DocCard href="{docs}/{currentVersion}/guides/mcp" />
  <DocCard href="{docs}/{currentVersion}/standard-library/mcp" />
</DocCards>
