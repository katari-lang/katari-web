---
title: Standard Library
description: prelude の各サブモジュールのリファレンス。
---

prelude は default import されるサブモジュール群で、qualified に呼ぶ (`mcp.tools`,
`reflection.get_metadata`, `record.get`)。このセクションは各サブモジュールの agent / 型のシグネチャ、
パラメータ、挙動、エラーを列挙する。

| モジュール | 内容 |
| --- | --- |
| `mcp` | MCP サーバーへの接続 (`tools` / `call`) と公開 (`serve`)、`auth` 直和 |
| `reflection` | agent を第一級の inspectable な値として扱う (`get_metadata` / `call_agent`) |

<DocCards>
  <DocCard href="{docs}/{currentVersion}/standard-library/mcp" />
  <DocCard href="{docs}/{currentVersion}/standard-library/reflection" />
</DocCards>

> 他の prelude サブモジュール (`json` / `http` / `record` / `array` / `string` / `math` / `env` /
> `file` / `webhook`) のリファレンスは未整備。
