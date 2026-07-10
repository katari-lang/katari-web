---
title: prelude.mcp
description: MCP サーバーへの接続 (tools / call)、公開 (serve)、auth 直和と typed error。
---

MCP を両方向で扱う。呼び出しは runtime の `mcp` reactor に route する (FFI sidecar なし)。default
import 経由で `mcp.` qualified に呼ぶ。手引きは [Guides › MCP]({docs}/{currentVersion}/guides/mcp)。

外部呼び出し (`tools` / `call` / `serve`) は io を行うため、呼び出し側の effect 行に `io` が加わる。

## 型

### `mcp.auth`

```katari
type auth = headers | oauth
```

`tools` / `call` がサーバーを認証する方式: 明示ヘッダ、または named OAuth credential。

### `mcp.headers`

```katari
data headers(values: record[string of private])
```

ヘッダ方式のアクセス。`values` は毎リクエストに乗る。各値は secret (`string of private`) 可 —
bearer key など。匿名アクセスは `mcp.headers(values = record.empty())`。

### `mcp.oauth`

```katari
data oauth(name: string)
```

named OAuth credential。`katari mcp login --url <server> --name <name>` で out-of-band に確立し
サーバー側に保存したものを参照する。runtime がトークンを注入・refresh する。`name` は secret ではない。

### `mcp.tool`

```katari
type tool = agent never -> unknown with io | prelude.throw[server_error | auth_error]
```

1 つのサーバーツールを表す普通の agent 値。自己完結な callable の TOP 型でもあり、effect を
handle し終えた任意の agent がこれに coerce する (`serve` のパラメータで利用)。

### `mcp.toolbox`

```katari
type toolbox = record[tool]
```

ツール名をキーとするツールのレコード。キーで 1 つ呼ぶか、`record.values(target = ...)` で
ツールの flat な配列を得て AI ループにまとめて渡す。

### `mcp.server_error`

```katari
data server_error(message: string)
```

サーバーがリスト / ツール呼び出しを拒否した、または transport が失敗した。catch して retry を制御する —
retry した呼び出しは再接続する。

### `mcp.auth_error`

```katari
data auth_error(message: string)
```

`oauth` credential が不在、または token refresh で直らない期限切れ。retry では直らない —
`katari mcp login` を人間が再実行する。`server_error` と区別するため別の型。

## agent

### `mcp.tools`

```katari
external agent tools(url: string, auth: auth)
  -> toolbox with prelude.throw[server_error | auth_error]
```

`url` のサーバーのツールを、1 ツールにつき 1 つの runtime-minted agent として返す。各ツールは
サーバー宣言の名前 / 説明 / 入力スキーマ (`reflection.get_metadata` 用、および呼び出しサイトの検証用) と、
リストした際のサーバー記述子 (`url` + `auth` — ヘッダ値は secret 可) を運ぶ。接続の管理は不要で、
runtime が記述子ごとに lazy に (再)接続する。

- **Throws** `server_error` (接続拒否 / transport 失敗)、`auth_error` (`oauth` credential 不在・失効)。

### `mcp.call`

```katari
external agent call(url: string, auth: auth, tool: string, arguments: json.json)
  -> json.json with prelude.throw[server_error | auth_error]
```

サーバーのツールを 1 つ直接呼ぶ — `tools` の静的な対応物で、listing も minted agent 値もない。
`tool` はサーバー宣言のツール名、`arguments` はリテラルな `json` ツリー (パラメータごとに
`json.encode` で組む)。返りはサーバーの応答を `json` ツリーで受ける (`structuredContent` があれば
それ、無ければテキストを `json_string`、バイナリブロックの生成ファイルはツリー内の `$ref` handle
オブジェクト)。**minted tool と違い、呼び出し前に引数を検証しない** — 拒否は `server_error`。

- **Throws** `server_error`、`auth_error`。

### `mcp.serve`

```katari
external agent serve[R, effect E](
  tools: toolbox,
  subscriber: agent (url: string) -> R with E,
) -> R with E
```

`tools` を、`subscriber` が走る間 live な MCP サーバーとして公開する。runtime が推測不能な capability
URL を鋳造し、レコードの各キーを公開ツール名、各 agent の宣言シグネチャを advertise されるスキーマと
して serve する。URL の所持が唯一の credential。`subscriber` は URL を受け取り、呼ぶべき相手に渡し、
serve すべき間 生き続ける — return すると URL は失効し、その結果が `serve` の結果になる。run を cancel
すると `subscriber` を cancel し、同じ経路で URL を失効させる。`subscriber` の effect は呼び出し側の
handler にそのまま流れる。serve する agent は自己完結 (`tool` — effect を handle 済み) でなければ
ならない。

## 関連

<DocCards>
  <DocCard href="{docs}/{currentVersion}/standard-library/reflection" />
  <DocCard href="{docs}/{currentVersion}/guides/mcp" />
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/cli" />
</DocCards>
