---
title: Runtime
description: 常駐サーバー — snapshot・durable execution・escalation の park・6 つの reactor。
---

`typescript/runtime` は IR を実行し、実行状態を永続化する常駐サーバー (Hono ベース、単一の Node
プロセス)。JSON API (`/api/v1`、CLI がここに繋ぐ) と、そこに焼き込まれた admin web console
(`/`) を同じポートで両方サーブする。

## 階層: project / snapshot / instance

- **project** — デプロイ・隔離の最上位単位 (1 project = 1 app)。明示的に削除するまで残る。
- **snapshot** — code version。中身は module 名 → module hash の manifest で、実体の IR は
  content-addressed な module store が持つ。`katari apply` は変更のあった module の IR だけを
  アップロードし (差分は転送の最適化に過ぎず、コミットされる snapshot は常に **完全な** manifest)、
  project の head を新しい snapshot へ前進させる。`katari project rollback` で head を古い
  snapshot に戻せる。
- **instance** — 走行中の 1 agent activation。`delegate` で召喚され、状態 (scope) と finalizer
  スタックを持ち、`return` / cancel で消える。

## instance は起動時の snapshot を pin する

走行中の instance は起動時の snapshot を pin し、生きている間ずっとその版の一貫した世界を見る —
依存 module を新しい snapshot にデプロイしても、既存の instance には影響しない。この保証は
特別な機構なしに成り立つ: instance 内で新しい agent を呼ぶ (`delegate`) たびに、**呼び出し元
instance 自身の snapshot がそのままスタンプされる**。head を見るのは instance が外部トリガ
(run の開始、webhook の配信など) で生まれる瞬間だけで、以降の内部 delegation は自分の snapshot を
継承し続ける。

## durable execution

runtime はターン境界 (エフェクトを伴う leaf delegation) ごとに instance の状態を永続化する。
これにより:

- **escalation は park する** — 未処理の `request` が run の外まで達すると、run はそのまま
  待機状態になり、`katari answer` や console から回答が来るまでプロセスを消費しない。
  ([Effects]({docs}/{currentVersion}/language-reference/effects) の escalation を参照。)
- **再起動から復元する** — プロセスが落ちても、次回起動時に永続化された instance グラフから
  再開する。in-flight だった外部呼び出し (FFI / http / mcp) は「完了したかどうか分からない」
  状態になり得るので、**at-most-once** で扱う: 再起動をまたいで進行中だった呼び出しは再実行せず、
  失敗として決着させる (katari 側の retry は言語レベルの選択であり、ランタイムが黙って再実行する
  ことはない)。
- `finally` で armed した finalizer は、正常完了・キャンセルの直前に必ず (逆順で) 走る — 詳細は
  [finally]({docs}/{currentVersion}/language-reference/finally)。

## reactor

`external agent` の呼び出しは、宣言の `from "reactor"` 節 (省略時は FFI) が指す reactor が
実行する。runtime にはちょうど 6 つある:

| reactor   | 役割                                                                                            |
| --------- | ----------------------------------------------------------------------------------------------- |
| `core`    | コンパイル済み agent / closure の呼び出しを実行する (`OperationDelegate` の既定先)              |
| `api`     | run の開始・cancel・escalation への回答という、外部イベントの起点                               |
| `http`    | `http.fetch` / `post_json` — in-runtime の HTTP クライアント (sidecar 不要)                     |
| `webhook` | `webhook.inbound` — 動的な公開 URL を発行し、POST を callback 呼び出しに変換する                |
| `mcp`     | `mcp.provide` / `call` / `serve` — in-runtime の MCP クライアント / サーバー                    |
| `ffi`     | `from` を省略した `external agent` — プロジェクトの TypeScript sidecar プロセスへ dispatch する |

`http` / `webhook` / `mcp` はいずれも「ランタイムに組み込まれた外部呼び出し」で、ユーザーが SDK を
install する必要がない。`ffi` だけがプロジェクト固有の sidecar プロセスを要求し (`@katari-lang/port`
で書く)、`katari apply` がそれをバンドルして runtime に配る。sidecar のハンドラは inner delegation
で katari 側の agent を呼び返せる (`context.call`)。

## デプロイ (self-hosted)

`katari init` が生成する `compose.yaml` は Postgres・S3 互換の blob ストア (SeaweedFS)・runtime
イメージ (`ghcr.io/katari-lang/katari:<version>`) の 3 サービスを立てる。runtime は
`KATARI_API_KEY` (CLI / console が Bearer で認証する) と `KATARI_SECRET_KEY` (secret の at-rest
暗号化キー) が無いと起動しない。詳細な手順は
[Installation]({docs}/{currentVersion}/getting-started/installation) を参照。

## 関連

<DocCards>
  <DocCard href="{docs}/{currentVersion}/language-reference/effects" />
  <DocCard href="{docs}/{currentVersion}/language-reference/finally" />
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/cli" />
</DocCards>
