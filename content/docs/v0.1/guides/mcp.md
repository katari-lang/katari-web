---
title: MCP Integration
description: MCP サーバーのツールを呼び出し、自分の agent を MCP サーバーとして公開する。
---

[Model Context Protocol](https://modelcontextprotocol.io) の統合は、外部ツールを AI フローに
合成する標準的な経路である。Katari の MCP はランタイム組み込み — `http.fetch` と同じく、runtime の
`mcp` reactor が MCP クライアント / サーバーを兼ね、ユーザーが SDK を install する必要はない。
両方向を扱える: outbound は `mcp.tools` でサーバーのツールをプログラムに差し込み、inbound は
`mcp.serve` で自分の agent を MCP サーバーとして公開する。

各 agent の正確なシグネチャは [Standard Library › mcp]({docs}/{currentVersion}/standard-library/mcp)、
CLI サブコマンドは [CLI › mcp]({docs}/{currentVersion}/katari-toolchains/cli#mcp) を参照。

## サーバーに接続する

`mcp.tools(url, auth)` はサーバーのツールを **toolbox** (ツール名をキーとする agent のレコード) として
返す。ツールは runtime が鋳造した agent 値で、サーバーが宣言した名前 / 説明 / 入力スキーマを運ぶ —
**ツールは agent である**。接続の管理は不要で、各ツールが自分の記述子 (`url` + `auth`) を持ち、
runtime が記述子ごとに lazy に (再)接続する。

`auth` は直和で、サーバーの認証方式を選ぶ。

```katari title="connect.ktr"
// 匿名アクセス — 空のヘッダ。
let tools = mcp.tools(url = url, auth = mcp.headers(values = record.empty()))

// bearer key — secret をヘッダ値に (secret は tool 値の中まで private のまま生きる)。
let headers = record.set(target = record.empty(), key = "Authorization", value = "Bearer " ++ key)
let tools = mcp.tools(url = url, auth = mcp.headers(values = headers))

// OAuth — `katari mcp login` で out-of-band に確立した named credential を参照するだけ。
let tools = mcp.tools(url = url, auth = mcp.oauth(name = "github"))
```

`mcp.headers` はヘッダ値に secret (`string of private`) を許す。secret は tool 値の中で private の
まま (保存時は封印、ユーザー可視の境界では redact) 保たれ、サーバーにのみ reveal される。
`mcp.oauth` が参照するトークン素材はプログラムに一切現れない — 名前だけを渡す。

## ツールを動的に呼ぶ

ツールは agent なので、`prelude.reflection` の 2 つのプリミティブでそのまま扱える:
`get_metadata` が公開シグネチャ (名前 / 説明 / スキーマ) を読み、`call_agent` が runtime-built の
引数でディスパッチする。引数はサーバーに届く前に入力スキーマで検証され、不適合は
`reflection.call_error` を投げる。これは AI ツールループがコンパイル済み agent に対して使うのと
同じ機構で、MCP ツールも見分けがつかない形で流れる。

```katari title="mcp_demo.ktr"
@"サーバーをリストし、ツール名を報告し、`add` ツールを動的ディスパッチで呼ぶ。"
agent main(url: string) -> string {
  use handler {
    request prelude.throw(error: mcp.server_error | mcp.auth_error | reflection.call_error) -> never {
      break f"mcp failed: ${json.to_text(value = error)}"
    }
  }
  let tools = mcp.tools(url = url, auth = mcp.headers(values = record.empty()))
  let names = for (let tool in record.values(target = tools)) {
    next reflection.get_metadata(value = tool).name
  }
  let added = match (record.get(target = tools, key = "add")) {
    case null -> "(no add tool)"
    case tool -> json.to_text(value = reflection.call_agent(target = tool, args = { x = 19, y = 23 }))
  }
  f"tools=${string.join(parts = names, separator = ",")}; add=${added}"
}
```

`record.values(target = tools)` は toolbox のツールを flat な配列で返す — AI ループにまとめて渡す形。

## ツールを直接呼ぶ

listing も鋳造も要らない静的な呼び出しには `mcp.call` を使う。これは
[`katari mcp pull`](#型付きバインディングを生成する) が生成するバインディングの土台でもある。
`arguments` はリテラルな `json` ツリーで、返りはサーバーの応答を `json` ツリーで受ける。呼び出し前に
引数を検証しない (鋳造されたツールと違う) ので、拒否は `server_error` になる。

```katari title="direct.ktr"
agent add(url: string, x: integer, y: integer) -> json.json with io | prelude.throw[mcp.server_error | mcp.auth_error] {
  let arguments = json.json_object(entries = {
    x = json.encode(value = x),
    y = json.encode(value = y),
  })
  mcp.call(url = url, auth = mcp.headers(values = record.empty()), tool = "add", arguments = arguments)
}
```

## エージェントを公開する

`mcp.serve` は `webhook.inbound` の MCP 版で、渡した agent 群を MCP サーバーとして公開する。runtime が
推測不能な capability URL を鋳造し、`subscriber` が生きている間そこでツールを serve する。レコードの
キーが公開ツール名、agent の宣言シグネチャが advertise されるスキーマになる。URL の所持が唯一の
credential — bearer 認証の API 面の外に mount され、subscriber が return する (または run が cancel
される) と URL は失効する。

```katari title="serve.ktr"
agent double(value: integer) -> integer {
  value * 2
}

@"URL を受け取り、呼び出すべき相手 (AI セッション、チームメイトの MCP クライアント) に渡し、
serve すべき間 生き続ける。return するとその結果が `serve` の結果になる。"
agent publisher(url: string) -> string {
  f"serving at ${url}"
}

agent main() -> string {
  mcp.serve(tools = { double = double }, subscriber = publisher)
}
```

`toolbox` はパラメータ型として `tool` (自己完結な callable の TOP 型) を要求するので、
**effect を handle し終えた任意の agent がそのまま coerce する** — ユーザー側に儀式は要らない。
公開する agent の effect 行は「自己完結」に制限される: 外へ escalate する request を持つ agent を
公開したいなら、まず handle してからレコードに入れる。

## 型付きバインディングを生成する

実行時の動的な鋳造ではなく、**コンパイル時に** 型付きの Katari モジュールとしてツールを固定したい場合は
`katari mcp pull` を使う。生成物は自己完結の `.ktr` モジュール 1 個 — サーバーのツール 1 つにつき
型付きラッパー agent が 1 つ、それらを接続 (`url` + `auth`) にクローズした `connect` agent が返る。
再生成はファイルを上書きする (生成物は成果物であり、手編集しない)。

```sh
katari mcp pull --url https://server/mcp --out src/github.ktr --oauth
```

```katari title="src/main.ktr"
import github   // `--out src/github.ktr` で生成したモジュール

agent main() -> string with io | prelude.throw[mcp.server_error | mcp.auth_error | json.decode_error] {
  let tools = github.connect(auth = mcp.oauth(name = "github"))
  let issue = tools.get_issue(owner = "katari-lang", repo = "katari", number = 1)
  issue.title
}
```

サーバーの JSON Schema が完全にマップできるパラメータ / 出力は型付きになり、マップできない部分を含む
ものは `json.json` に fallback する。フラグとマッピング規則は
[CLI › mcp pull]({docs}/{currentVersion}/katari-toolchains/cli#mcp-pull) を参照。

## エラー

MCP の外部呼び出しは 2 つの typed throw に統一される。両者は質的に異なる。

| エラー | 契約 |
| --- | --- |
| `mcp.server_error` | リスト / ツール呼び出しの拒否、または transport 失敗。**retry すれば再接続する** (接続断・restart 中断を含む)。 |
| `mcp.auth_error` | `oauth` credential の不在、または refresh で直らない期限切れ。**retry では直らない** — `katari mcp login` を再実行する。 |

```katari
use handler {
  request prelude.throw(error: mcp.server_error) -> never { break retry() }
  request prelude.throw(error: mcp.auth_error) -> never { break f"re-run katari mcp login" }
}
```

## 関連

<DocCards>
  <DocCard href="{docs}/{currentVersion}/standard-library/mcp" />
  <DocCard href="{docs}/{currentVersion}/standard-library/reflection" />
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/cli" />
</DocCards>
