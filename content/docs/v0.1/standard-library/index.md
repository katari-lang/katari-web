---
title: Standard Library
description: prelude の各サブモジュールのリファレンス — シグネチャ・パラメータ・挙動・エラー。
---

prelude は default import されるサブモジュール群で、qualified に呼ぶ (`json.parse`, `http.fetch`,
`mcp.provide`, `reflection.get_metadata`, `record.get`)。演算子 (`+` `==` `&&` ...) が desugar する
先や `throw[T]` そのものは prelude のトップレベルにあり、
[Language Reference › Syntax]({docs}/{currentVersion}/language-reference/syntax) と
[Effects]({docs}/{currentVersion}/language-reference/effects) で扱う。このセクションは各サブ
モジュールの agent / 型のシグネチャ、パラメータ、挙動、エラーを列挙する。

| モジュール   | 内容                                                                                |
| ------------ | ----------------------------------------------------------------------------------- |
| `json`       | `json` 直和型と、parse / stringify / encode / decode の総称的な変換                 |
| `http`       | ランタイム組み込みの HTTP クライアント (`fetch` / `post_json`)                      |
| `record`     | `record[T]` の操作 (`get` / `set` / `keys` / `entries` / `merge` ...)               |
| `array`      | `array[T]` の操作 (`get` / `append` / `slice` / `flatten` / `range` ...)            |
| `string`     | `string` の操作 (`split` / `join` / `replace` / `to_upper` ...)                     |
| `math`       | 算術演算子を超える数値操作 (`abs` / `min` / `max` / `floor` / `round`)              |
| `env`        | プロジェクトスコープの環境アクセス (`get_secret` / `get_all`)                       |
| `file`       | file 値の内容・メタデータをランタイム内で読む (`read_base64` / `content_type`)      |
| `webhook`    | 動的に生成される inbound HTTP エンドポイント (`inbound`)                            |
| `mcp`        | MCP サーバーへのスコープ付き接続 (`provide` / `call`) と公開 (`serve`)、`auth` 直和 |
| `reflection` | agent を第一級の inspectable な値として扱う (`get_metadata` / `call_agent`)         |

<DocCards>
  <DocCard href="{docs}/{currentVersion}/standard-library/json" />
  <DocCard href="{docs}/{currentVersion}/standard-library/http" />
  <DocCard href="{docs}/{currentVersion}/standard-library/record" />
  <DocCard href="{docs}/{currentVersion}/standard-library/array" />
  <DocCard href="{docs}/{currentVersion}/standard-library/string" />
  <DocCard href="{docs}/{currentVersion}/standard-library/math" />
  <DocCard href="{docs}/{currentVersion}/standard-library/env" />
  <DocCard href="{docs}/{currentVersion}/standard-library/file" />
  <DocCard href="{docs}/{currentVersion}/standard-library/webhook" />
  <DocCard href="{docs}/{currentVersion}/standard-library/mcp" />
  <DocCard href="{docs}/{currentVersion}/standard-library/reflection" />
</DocCards>
