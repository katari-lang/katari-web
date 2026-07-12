---
title: Types
description: 基本型・record/union・effect row・never・private/public 属性・subtyping の実際。
---

## 基本型

`null` / `boolean` / `integer` / `number` / `string` / `file` がスカラー。`integer` は `number` の
部分型で、算術演算子は両オペランドが `integer` なら `integer` を保つ (`prelude.add[T extends
number]` のような generic bound がこれを表す)。`file` はプロジェクトの blob ストアへの薄い参照 —
[`prelude.file`]({docs}/{currentVersion}/standard-library/file) で内容を読む。

## コンテナ

- `array[T]` — 配列。リテラルは `[e1, e2, ...]`、操作は
  [`prelude.array`]({docs}/{currentVersion}/standard-library/array)。
- `record[T]` — 同種の string キー付きマップ。リテラルではなく
  [`prelude.record`]({docs}/{currentVersion}/standard-library/record) の操作で作る (JSON object の
  entries や env の一覧がこの形)。
- `[T1, T2, ...]` — タプル型。値は `[e1, e2]`、パターンも `[p1, p2]`。空 `[]` や単一要素 `[T]` も
  タプルであり、`()` は単なるグルーピングでタプルを作らない。

## object 型

```katari
type point = { x: number, y: number, label?: string }
```

`{ label: T, ... }` は幅・深さ subtyping を持つ構造的な型で、`label?: T` は optional フィールド
(欠けていてもよい)。agent のパラメータリストはこの糖衣: `agent (label: T, ...) -> R` は
パラメータレコード 1 個の object 型に desugar する (空の `()` は空 object)。

## data と直和型

`data name(label: T, ...)` は 1 つの constructor を宣言し、値の生成 (`name(label = ...)`) と
パターン (`name(label => p)`) の両方に使える。複数の `data` を `type` synonym で束ねると直和型に
なる。

```katari
data circle(radius: number)
data rect(width: number, height: number)
type shape = circle | rect
```

`type union = a | b | c` は union 型一般 (直和型に限らず、任意の型の union)。

## agent 型

```katari
type transform = agent (value: number) -> number
type handler_of[T] = agent (value: T) -> T with io
```

`agent Param -> Return [with Effect]` — `Param` は上の object 型糖衣を含む型表現。effect 節は
[Effects]({docs}/{currentVersion}/language-reference/effects) を参照。callable 値は 3 種 (コンパイル
済み agent への named 参照、closure、runtime-minted な reactor-backed tool) あるが、この型はどれも
一様に受ける。

## never / unknown / all / io / pure

- `never` — 値が存在しない型。`throw` / `panic` の返り型、そして
  [`forever { ... }`]({docs}/{currentVersion}/language-reference/syntax#forever) 式や
  `time.watch` のような「決して戻らない」呼び出しの型で、そこに到達する式は他の枝と join しても
  寄与しない。
- `unknown` — 何でも受け入れる top 型 (値を使う前に絞り込みが要る)。
- `all` — effect row の top (「あらゆる request を許す」)。`reflection.get_metadata` の引数型
  `agent never -> unknown with all` がその例 (どんな入出力・どんな effect の callable も受ける)。
- `io` — 副作用がある (`external agent` の呼び出しが持ち込む) が、discharge できないマーカー
  effect。`with io | ...` の形で行に乗る。
- `pure` — effect を一切持たない (行が空)。

## 文字列リテラル型と `literal` generics

`"fast"` は型位置では **その文字列ちょうどのシングルトン型** (`"fast" <: string`)。
`[literal name extends string]` はジェネリック関数の呼び出し引数がリテラルなら、その
シングルトン型に束縛する (TypeScript の `const` 型パラメータの類似物):

```katari
agent remember[literal name extends string](value: name) -> name { value }

agent main() -> string {
  let mode: "fast" | "slow" = remember(value = "fast")   // シングルトン "fast" を返す
  let widened: string = mode                              // リテラル型は string に広がる (subtyping)
  widened
}
```

動的な (非リテラルな) 引数は素の `string` に束縛される。[`prelude.mcp`]({docs}/{currentVersion}/standard-library/mcp)
の `provide[literal URL, ...]` はこれを使って、リテラル `url` にサーバーごとのスコープを与える。

## private / public 属性と情報流

`T of private` / `T of public` は値に貼る **attribute** で、`public <: private` (public な値は
private が要求される場所にそのまま渡せるが、逆はできない)。private は「secret として汚染されている」
ことを表し、一度 private になった値を含む複合値は全体が private になる。private な値がランタイムを
出られるのは、宛先サーバーへの意図的な提出面 (`http.fetch` の header 値 / `body`) を通るときだけ —
`url` / `method` のような漏出しうる sink は public のまま、という規則になっている。

```katari
agent fetch_with_key() -> string with io | prelude.throw[env.missing_secret | http.fetch_error] {
  let key = env.get_secret(key = "API_KEY")   // string of private
  let response = http.fetch(
    url = "https://api.example.com",           // url は public のまま (型エラーにならない)
    method = "GET",
    headers = record.set(target = record.empty(), key = "Authorization", value = "Bearer " ++ key),
    body = "",
  )
  response.body
}
```

`env.get_secret` / `mcp.headers` の値 / http の header・body が代表的な private-capable な位置。
詳細は [`prelude.env`]({docs}/{currentVersion}/standard-library/env) と
[`prelude.http`]({docs}/{currentVersion}/standard-library/http) を参照。`[attribute T]` という
第 3 の generic 種は、型ではなく属性そのものを量化したい稀なケース向けにある。

## effect row (概要)

`with req1 | req2` は「この agent が行いうる request の集合」。行はリクエスト名でキーされたマップで、
同じ名前への複数の instantiation は union で 1 エントリに合流する (`throw[a]` と `throw[b]` が
混ざると `throw[a | b]` になる、1 エントリのまま)。`{...E, request[args]}` の形は union で join
するのではなく、その 1 エントリを丸ごと上書きする override — 詳しくは
[Effects]({docs}/{currentVersion}/language-reference/effects) と
[Providers]({docs}/{currentVersion}/language-reference/providers) を参照。

## 推論のいま

呼び出しの generic instantiation は引数から推論されるが、**結果の型にしか現れない generic は
推論できない** (`json.decode[T]` / `json.parse_as[T]` / `reflection` の一部など) — 呼び出し側が
明示的に `foo[T](...)` と書く必要があり、書かなければ K3016 で拒否される。`use provider(...)` の
束縛 (`let x = use provider(...)`) も同様の理由で型注釈が必須 (K3013) — provider の結果型は継続の
型から決まるので、束縛側から与えないと双方向に依存が回ってしまう。

## 関連

<DocCards>
  <DocCard href="{docs}/{currentVersion}/language-reference/effects" />
  <DocCard href="{docs}/{currentVersion}/language-reference/providers" />
  <DocCard href="{docs}/{currentVersion}/standard-library/json" />
</DocCards>
