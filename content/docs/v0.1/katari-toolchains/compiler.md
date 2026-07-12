---
title: Compiler
description: .ktr を module 単位の IR JSON へ — stdlib 同梱、K プレフィックスの diagnostics。
---

`haskell/compiler` (`katari-compiler`) は `.ktr` ソースを、ランタイムが実行する IR (中間表現) の
JSON へコンパイルする。パイプラインは 1 ファイル = 1 モジュールを、パース → 名前解決 → 型検査 →
lowering の順で通す。

## モジュールと stdlib

**`.ktr` ファイル 1 つが 1 モジュール**。トップレベルの `module` 宣言は無く、モジュール名はパッケージ
名とファイルパスから決まる。`prelude` (と `json` / `http` / `record` / `array` / `string` / `math` /
`env` / `file` / `webhook` / `mcp` / `reflection` の各サブモジュール) はコンパイラのバイナリに
埋め込まれている ([`haskell/compiler/stdlib`]({docs}/{currentVersion}/standard-library)) — インストール
不要で、どのプロジェクトからも default import で使える。

## コンパイルの出力: module 単位の IR

出力は **1 source module につき 1 `IRModule`** — ランタイムは module ごとに個別にアップロードされる
ことを前提にしているので、whole-program のリンクステップは無い。各 `IRModule` は:

- `BlockAgent` の集合 — 呼び出し可能な唯一の単位で、呼び出し規約 (JSON Schema 込みの入出力・
  request 効果) を持つ。
- **thread = block の実行**。`match` / `for` / `handle` / `parallel` のような構造ノードは同じ
  instance 内で `OperationCall` (ローカルな子 thread の起動) になり、agent や closure の呼び出しは
  常に `OperationDelegate` (新しい instance を召喚) になる — この違いがランタイムの永続化単位
  ([Runtime]({docs}/{currentVersion}/katari-toolchains/runtime) 参照) を決める。
- 型情報は持たない — 公開スキーマは `BlockAgent` の `schema` (JSON Schema) に載る。`@"..."` の
  doc annotation はこのスキーマの `description` になり、AI 向けの tool 定義や
  `reflection.get_metadata` にそのまま現れる。

各 `IRModule` には `schemaVersion` が付く — ランタイムが実行できない operation を IR が得た
タイミングでのみ上がる契約 (v2 で不要な変数の早期解放 `drop`、v3 で `finally` の `defer` を追加)。
古いランタイムは、理解できない `schemaVersion` の IR を拒否する。

## diagnostics

diagnostics は `K` + 4 桁のコードを持つ (`K1xxx` = パース、`K3xxx` = 型検査)。パースは
**宣言単位で recovery** する: 壊れた宣言はエラーを報告した上でプレースホルダに置き換え、次の
宣言キーワードまで読み飛ばして続行するので、1 つの構文ミスがファイル全体の診断を潰さない。
`katari check` (`haskell/cli`) がこの diagnostics をそのまま表示する。

## katari check / katari build

`katari check` はコンパイルして diagnostics を報告するだけ (デプロイしない)。`katari build` は
IR JSON を書き出す (既定の出力先は `.katari/dist/ir.json`)。`katari apply` はこれに加えて
runtime へ新しい snapshot としてデプロイする — アップロードは module 単位の差分 (変更の無い
module は再送しない) で、詳細は [Runtime]({docs}/{currentVersion}/katari-toolchains/runtime) の
snapshot の節を参照。

## 関連

<DocCards>
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/runtime" />
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/lsp" />
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/cli" />
</DocCards>
