---
title: prelude.mcp
description: MCP サーバーへのスコープ付き接続 (provide / call)、公開 (serve)、auth 直和と typed error。
---

MCP を両方向で扱う。呼び出しは runtime の `mcp` reactor に route する (FFI sidecar なし)。default
import 経由で `mcp.` qualified に呼ぶ。手引きは [Guides › MCP]({docs}/{currentVersion}/guides/mcp)。

外部呼び出し (`provide` / `call` / `serve`) は io を行うため、呼び出し側の effect 行に `io` が加わる。

## 型

### `mcp.auth`

```katari
type auth = headers | oauth
```

`provide` / `call` がサーバーを認証する方式: 明示ヘッダ、または named OAuth credential。

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

### `mcp.scope`

```katari
effect scope[URL]
```

url をキーとする phantom なスコープ marker。ツールの effect 行に乗るが、オペレーションを持たず、
perform も handle もされず、lowering で消える。`provide` が継続の行にこれを mint し、自身の結果行からは
discharge するので、`scope[URL]` タグの付いたツールは `provide` より長生きできない。`URL` は phantom で
**covariant**: `scope["x"]` は `scope[string]` に適合するが、`scope["y"]` には決して適合しない。リテラル
url は url ごとのスコープ、dynamic な url は最も広い `scope[string]` を与える。

### `mcp.tool`

```katari
type tool[URL] = agent never -> unknown with io | scope[URL] | prelude.throw[server_error | auth_error]
```

1 つのサーバーツールを表す普通の agent 値で、`scope[URL]` で gate されている。自己完結な callable の
TOP 型でもあり、effect を handle し終えた任意の agent が `tool[string]` に coerce する (`serve` の
パラメータで利用)。

### `mcp.toolbox`

```katari
type toolbox[URL] = record[tool[URL]]
```

ツール名をキーとするツールのレコードで、`URL` はツールを gate するスコープ。キーで 1 つ呼ぶか、
`record.values(target = ...)` でツールの flat な配列を得て AI ループにまとめて渡す。

### `mcp.server_error`

```katari
data server_error(message: string)
```

サーバーがリスト / ツール呼び出しを拒否した、または transport が失敗した。catch して retry を制御する —
retry した呼び出しは再接続する。閉じたスコープの外で呼ばれたツールも、閉じたスコープ名を添えてこれで
拒否される。

### `mcp.auth_error`

```katari
data auth_error(message: string)
```

`oauth` credential が不在、または token refresh で直らない期限切れ。retry では直らない —
`katari mcp login` を人間が再実行する。`server_error` と区別するため別の型。

## agent

### `mcp.provide`

```katari
external agent provide[literal URL, R, effect E](
  url: URL,
  auth: auth,
  continuation: agent (value: toolbox[URL]) -> R with E | scope[URL],
) -> R with E
```

`url` のサーバーのツールを、`continuation` の区間だけ生きるスコープとして差し込む
[`use` provider]({docs}/{currentVersion}/language-reference/providers)。runtime がサーバーをリストし、
1 ツールにつき 1 つの runtime-minted agent (サーバー宣言の名前 / 説明 / 入力スキーマ —
`reflection.get_metadata` 用および呼び出しサイトの検証用 — と、リストした際のサーバー記述子 `url` +
`auth` を運ぶ) を `toolbox[URL]` として `continuation` に渡す。`scope[URL]` は継続の行に乗り (ツール
呼び出しが raise するもの)、`provide` 自身の行からは discharge されるので、ツールは block の外へ逃げ
られない — 継続が return するとスコープが閉じ、以降その記述子のツール呼び出しは typed `server_error` で
拒否される。リテラルな `url` は `URL` をその文字列のシングルトンに束縛し (url ごとのスコープ)、dynamic な
`url` は `URL` を `string` に格下げする (最も広いスコープ)。接続の管理は不要で、runtime が記述子ごとに
lazy に (再)接続する。

- **Throws** `server_error` (リスト拒否 / transport 失敗)、`auth_error` (`oauth` credential 不在・失効)。

### `mcp.call`

```katari
external agent call[literal URL, T](url: URL, auth: auth, tool: string, arguments: json.json)
  -> T with scope[URL] | prelude.throw[server_error | auth_error | json.decode_error]
```

サーバーのツールを 1 つ直接呼ぶ — `provide` の静的な対応物で、listing も minted agent 値もない
(`katari mcp pull` が生成するバインディングの土台)。`tool` はサーバー宣言のツール名、`arguments` は
リテラルな `json` ツリー (パラメータごとに `json.encode` で組む)。返りは runtime が **`T` に対して
デコード**する — `json.decode[T]` と同じ機構で、`structuredContent` を `T` の wire form として復元し
(`$ref` handle は本物の `file` 値に、record / array / scalar は値になる)、`T` に conform しなければ
`json.decode_error` を投げる。`T` = `json.json` にすれば応答を生の `json` ツリーのまま受ける。`T` は
結果にしか現れず推論できないので**明示 instantiate が必須** (K3016)、`URL` は引数から推論されるが明示
`[...]` の arity には数えられる (混在は書けない、K3009) ので、呼び出し側は両方書く:
`mcp.call[url_literal, T](url = url_literal, ...)`。スコープ gating は型レベル (行の `scope[URL]`) で、
生成バインディングは同じ記述子の `provide` スコープの中でだけ呼ぶ。**minted tool と違い、呼び出し前に
引数を検証しない** — 拒否は `server_error`。

- **Throws** `server_error`、`auth_error`、`json.decode_error` (返りが `T` に conform しない)。

### `mcp.serve`

```katari
external agent serve[R, effect E](
  tools: toolbox[string],
  subscriber: agent (url: string) -> R with E,
) -> R with E
```

`tools` を、`subscriber` が走る間 live な MCP サーバーとして公開する。runtime が推測不能な capability
URL を鋳造し、レコードの各キーを公開ツール名、各 agent の宣言シグネチャを advertise されるスキーマと
して serve する。URL の所持が唯一の credential。`subscriber` は URL を受け取り、呼ぶべき相手に渡し、
serve すべき間 生き続ける — return すると URL は失効し、その結果が `serve` の結果になる。run を cancel
すると `subscriber` を cancel し、同じ経路で URL を失効させる。`subscriber` の effect は呼び出し側の
handler にそのまま流れる。serve する agent は自己完結 (`tool[string]` — effect を handle 済み) で
なければならない。

## 関連

<DocCards>
  <DocCard href="{docs}/{currentVersion}/standard-library/reflection" />
  <DocCard href="{docs}/{currentVersion}/guides/mcp" />
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/cli" />
</DocCards>
