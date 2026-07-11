---
title: MCP Integration
description: MCP サーバーのツールをスコープ付きで呼び出し、自分の agent を MCP サーバーとして公開する。
---

[Model Context Protocol](https://modelcontextprotocol.io) の統合は、外部ツールを AI フローに
合成する標準的な経路である。Katari の MCP はランタイム組み込み — `http.fetch` と同じく、runtime の
`mcp` reactor が MCP クライアント / サーバーを兼ね、ユーザーが SDK を install する必要はない。
両方向を扱える: outbound は `mcp.provide` でサーバーのツールをプログラムに差し込み、inbound は
`mcp.serve` で自分の agent を MCP サーバーとして公開する。

各 agent の正確なシグネチャは [Standard Library › mcp]({docs}/{currentVersion}/standard-library/mcp)、
CLI サブコマンドは [CLI › mcp]({docs}/{currentVersion}/katari-toolchains/cli#mcp) を参照。

## サーバーに接続する

ツールは**値ではなく生きた能力**であり、接続より長生きしてはならない — `provide` が走っている間だけ
存在する。だから `mcp.provide(url, auth)` は [`use` provider]({docs}/{currentVersion}/language-reference/providers)
であって、単なる関数ではない: サーバーをリストし、続く block に **toolbox** (ツール名をキーとする
agent のレコード) をスコープとして渡し、block を抜けるとスコープを閉じる。ツールを block の外へ返そう
とすると、ツールが運ぶスコープを discharge する場所が無くなり**型エラー**になる。

```katari title="connect.ktr"
// 匿名アクセス — 空のヘッダ。
let tools : mcp.toolbox[string] = use mcp.provide(url = url, auth = mcp.headers(values = record.empty()))

// bearer key — secret をヘッダ値に (secret は tool 値の中まで private のまま生きる)。
let headers = record.set(target = record.empty(), key = "Authorization", value = "Bearer " ++ key)
let tools : mcp.toolbox[string] = use mcp.provide(url = url, auth = mcp.headers(values = headers))

// OAuth — `katari mcp login` で out-of-band に確立した named credential を参照するだけ。
let tools : mcp.toolbox[string] = use mcp.provide(url = url, auth = mcp.oauth(name = "github"))
```

`use` の binder (`tools`) には**明示の型注釈が必須** — 無いと **K3013** になる (`use` の一般規則)。
`auth` は直和で認証方式を選ぶ: `mcp.headers` はヘッダ値に secret (`string of private`) を許し、匿名も
bearer key もこの 1 コンストラクタで表す。secret は tool 値の中で private のまま (保存時は封印、ユーザー
可視の境界では redact) 保たれ、サーバーにのみ reveal される。`mcp.oauth` が参照するトークン素材は
プログラムに一切現れない — 名前だけを渡す。

型 `mcp.toolbox[URL]` の `URL` は**スコープ**を表す。リテラルな url は url ごとのスコープ
(`mcp.scope["https://..."]`) を与え、dynamic な (非リテラルの) url は最も広いスコープ
`mcp.scope[string]` に格下げする。上の例は `url` 変数なので `mcp.toolbox[string]` になっている。
url ごとのスコープは、複数のサーバーを衝突なく合成するための鍵である (後述)。

## ツールを動的に呼ぶ

ツールは runtime が鋳造した agent 値で、サーバーが宣言した名前 / 説明 / 入力スキーマを運ぶ —
**ツールは agent である**。だから `prelude.reflection` の 2 つのプリミティブでそのまま扱える:
`get_metadata` が公開シグネチャを読み、`call_agent` が runtime-built の引数でディスパッチする。引数は
サーバーに届く前に入力スキーマで検証され、不適合は `reflection.call_error` を投げる。これは AI ツール
ループがコンパイル済み agent に対して使うのと同じ機構で、MCP ツールも見分けがつかない形で流れる。

```katari title="mcp_demo.ktr"
@"サーバーをリストし、ツール名を報告し、`add` ツールを動的ディスパッチで呼ぶ — すべて `provide`
スコープの中で。"
agent main(url: string) -> string {
  use handler {
    request prelude.throw(error: mcp.server_error | mcp.auth_error | reflection.call_error) -> never {
      break f"mcp failed: ${json.to_text(value = error)}"
    }
  }
  let tools : mcp.toolbox[string] = use mcp.provide(url = url, auth = mcp.oauth(name = "github"))
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
呼び出しはすべて `provide` の block の中にある: ツールの呼び出しは `mcp.scope` を raise し、`provide`
が return するときにそれが discharge されるので、ツールは block の外へ逃げられない。

## 複数のサーバーを合成する

`provide` をネストすると、内側と外側のスコープが **union でマージ**する — 両方のサーバーのツールが
同じ block で生き、各ツールは自分のサーバーに対して走る。これが url ごとのスコープの狙いである:
リテラル url がそれぞれ別のスコープを持つので、2 つの `provide` が衝突しない。

```katari title="two_servers.ktr"
@"2 つの MCP サーバーを 1 つのスコープに合成する: `provide` のネストがスコープを union でマージし、
どちらのサーバーのツールも走る。リテラル url が各サーバーに url ごとのスコープを与える。"
agent main() -> string {
  use handler {
    request prelude.throw(error: mcp.server_error | mcp.auth_error | reflection.call_error) -> never {
      break f"mcp failed: ${json.to_text(value = error)}"
    }
  }
  let github : mcp.toolbox["https://github.example.com/mcp"] =
    use mcp.provide(url = "https://github.example.com/mcp", auth = mcp.oauth(name = "github"))
  let linear : mcp.toolbox["https://linear.example.com/mcp"] =
    use mcp.provide(url = "https://linear.example.com/mcp", auth = mcp.oauth(name = "linear"))
  let title = match (record.get(target = github, key = "get_issue")) {
    case null -> "(no get_issue)"
    case tool -> json.to_text(value = reflection.call_agent(target = tool, args = { owner = "katari-lang", repo = "katari", number = 1 }))
  }
  let ticket = match (record.get(target = linear, key = "create_ticket")) {
    case null -> "(no create_ticket)"
    case tool -> json.to_text(value = reflection.call_agent(target = tool, args = { title = title }))
  }
  f"github=${title}; linear=${ticket}"
}
```

## ツールを直接呼ぶ

listing も鋳造も要らない静的な呼び出しには `mcp.call` を使う。これは
[`katari mcp pull`](#型付きバインディングを生成する) が生成するバインディングの土台でもある。
`mcp.call[literal URL, T]` は 2 つの generic を取る: リテラルな `URL` (スコープを url ごとに束縛する) と、
返りの**デコード先** `T`。`arguments` はリテラルな `json` ツリー (パラメータごとに `json.encode` で組む)
で、返りはサーバーの応答を **`T` に対してデコード**する — `json.decode[T]` と同じく、`structuredContent`
を `T` の wire form として読み (ファイルは本物の `file` handle に復元)、不適合は `json.decode_error` を
投げる。`T` は結果にしか現れず推論できないので**明示 instantiate が必須**、`URL` は引数から推論されるが
明示 `[...]` の arity には数えられる (all-or-nothing) ので、呼び出し側は両方書く。スコープはこの agent
自身の行に乗る — 呼び出し側が同じ記述子の `provide` スコープの中で走らせる。

```katari title="direct.ktr"
type get_issue_output = { title: string, number: integer, state: string }

agent get_issue(number: integer) -> get_issue_output with io | mcp.scope["https://github.example.com/mcp"] | prelude.throw[mcp.server_error | mcp.auth_error | json.decode_error] {
  let arguments = json.json_object(entries = { number = json.encode(value = number) })
  mcp.call["https://github.example.com/mcp", get_issue_output](
    url = "https://github.example.com/mcp",
    auth = mcp.oauth(name = "github"),
    tool = "get_issue",
    arguments = arguments,
  )
}
```

`T` を `json.json` にインスタンス化すれば、応答を生の `json` ツリーとして受けられる (codegen が
`outputSchema` をマップできないときの選択)。呼び出し前に引数を検証しない (鋳造されたツールと違う)
ので、拒否は `server_error` になる。

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

`serve` は `toolbox[string]` を要求する。エントリ型 `tool[string]` は**自己完結な callable の TOP 型**
なので、**effect を handle し終えた任意の agent がそのまま coerce する** — ユーザー側に儀式は要らない。
外へ escalate する request を持つ agent を公開したいなら、まず handle してからレコードに入れる。

## 型付きバインディングを生成する

実行時の動的な鋳造ではなく、**コンパイル時に** 型付きの Katari モジュールとしてツールを固定したい場合は
`katari mcp pull` を使う。生成物は自己完結の `.ktr` モジュール 1 個 — サーバーのツール 1 つにつき型付き
ラッパー agent が 1 つ、それらを `provide` スコープにクローズした `with_tools` provider が返る。再生成は
ファイルを上書きする (生成物は成果物であり、手編集しない)。

```sh
katari mcp pull --url https://github.example.com/mcp --out src/github.ktr --oauth
```

`with_tools` も `use` provider なので、消費側は `mcp.provide` と同じ形になる: binder に型注釈を付け、
以降の block で型付きの `tools` を使う。ラッパーは各々 `mcp.call` を静的経路で呼ぶので、スコープは
`with_tools` の中で開いて閉じ、`tools.get_issue(...)` は普通の dot アクセスとして型が付く。

```katari title="src/main.ktr"
import github   // `--out src/github.ktr` で生成したモジュール

agent main() -> string {
  let tools : {
    get_issue: agent(owner: string, repo: string, number: integer) -> github.get_issue_output with io | mcp.scope["https://github.example.com/mcp"] | prelude.throw[mcp.server_error | mcp.auth_error | json.decode_error],
  } = use github.with_tools(auth = mcp.oauth(name = "github"))
  let issue = tools.get_issue(owner = "katari-lang", repo = "katari", number = 1)
  issue.title
}
```

サーバーの JSON Schema が完全にマップできるパラメータ / 出力は型付きになり (上の `get_issue_output`)、
マップできない部分を含むものは `json.json` に fallback する。フラグとマッピング規則は
[CLI › mcp pull]({docs}/{currentVersion}/katari-toolchains/cli#mcp-pull) を参照。

## エラー

MCP の外部呼び出しは 2 つの typed throw に統一される (typed `mcp.call` は加えて `json.decode_error`)。
`server_error` と `auth_error` は質的に異なる。

| エラー             | 契約                                                                                                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mcp.server_error` | リスト / ツール呼び出しの拒否、または transport 失敗。**retry すれば再接続する** (接続断・restart 中断を含む)。閉じたスコープの外で呼んだツールも、閉じたスコープ名を添えてこれで拒否される。 |
| `mcp.auth_error`   | `oauth` credential の不在、または refresh で直らない期限切れ。**retry では直らない** — `katari mcp login` を再実行する。                                                                      |

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
  <DocCard href="{docs}/{currentVersion}/language-reference/providers" />
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/cli" />
</DocCards>
