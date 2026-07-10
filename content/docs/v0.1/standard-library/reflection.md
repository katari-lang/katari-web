---
title: prelude.reflection
description: agent を第一級の inspectable な値として扱う — get_metadata / call_agent。
---

agent を第一級の inspectable な値として扱う 2 つのプリミティブ: `get_metadata` が callable の公開
シグネチャを読み、`call_agent` が callable 値を runtime-built の引数でディスパッチする。default import
経由で `reflection.` qualified に呼ぶ。runtime が鋳造するツール (`prelude.mcp` の MCP ツールなど) も、
コンパイル済み agent と同様にこの両方に参加する — ツールは agent である。

## 型

### `reflection.agent_metadata`

```katari
data agent_metadata(
  name: string,
  description: string,
  input: json.json,
  output: json.json,
  requests: json.json,
)
```

1 つの callable の公開メタデータ: qualified 名、`@"..."` の説明、input / output / requests の JSON
Schema (各スキーマは `json` 値で、AI ツールリストにそのまま埋められる)。ローカル (closure) の callable
は名前が空。

### `reflection.call_error`

```katari
data call_error(message: string)
```

動的ディスパッチが target 実行前に失敗した: target が callable でない、または `args` が入力スキーマに
適合しない (`message` が問題のパスを示す)。`call_agent` が投げる。

## agent

### `reflection.get_metadata`

```katari
primitive agent get_metadata(value: agent never -> unknown with all) -> agent_metadata
```

callable 値 (top-level agent、data constructor、request、external、ローカル closure、または MCP
サーバーのツールのような runtime-minted tool) から `agent_metadata` を導出する。`[T]` でインスタンス化
した generic callable はその instantiation に特化したスキーマを返す。runtime-minted tool は provider が
宣言した名前 / 説明 / 入力スキーマを返す。

### `reflection.call_agent`

```katari
primitive agent call_agent[R, effect E](target: agent never -> R with E, args: unknown)
  -> R with E | prelude.throw[call_error]
```

callable **値** を runtime-built の引数レコードでディスパッチする — 静的呼び出しの動的対応物で、
AI がツールリストから選んだ target を呼ぶ用途。`args` は delegation 境界で target の入力スキーマに対し
検証され、不適合はこの呼び出しサイトで `call_error` を投げる (catch してモデルに retry させる)。
target の effect はそのまま通過する。

- **Throws** `call_error` (target が callable でない、または `args` が入力スキーマに不適合)。

## 関連

<DocCards>
  <DocCard href="{docs}/{currentVersion}/standard-library/mcp" />
  <DocCard href="{docs}/{currentVersion}/guides/mcp" />
</DocCards>
