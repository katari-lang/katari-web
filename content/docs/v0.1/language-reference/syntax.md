---
title: Syntax
description: モジュール宣言、let / match / for / parallel / use / finally、部分適用の _、予約語。
---

Katari は brace 区切りで、概ね自由形式だが、改行が文の区切りとして働く (Go 風の
"virtual semicolon")。ブロックの文は改行または `;` で区切り、演算子で終わる行は次行へ続く。

## モジュール

**`module` キーワードは無い** — 1 ファイルが 1 モジュールで、モジュール名はパッケージ名 +
ファイルパスから決まる (`ffi.ktr` は `ffi` モジュールで、そこにある `greet` は `ffi.greet`)。
import は他モジュールの名前を持ち込む。

```katari
import { area, type shape } from basics   // 個別の名前 (値 / 型) を持ち込む
import basics                              // モジュール全体を持ち込み、basics.area のように参照
import basics as shapes                    // エイリアス
```

`import module.path` はドット区切りのパスを取れる。名前解決は default import される `prelude`
(とそのサブモジュール `json` / `http` / `record` / ...) を除き、明示 import が必要。

## トップレベル宣言

| 宣言                                                             | 意味                                    |
| ---------------------------------------------------------------- | --------------------------------------- |
| `agent name[generics](params) -> T [with E] { body }`            | 呼び出し可能な agent (関数)             |
| `private agent ...`                                              | モジュール外からは呼べない agent        |
| `request name[generics](params) -> T`                            | request (effect の宣言のみ、本体は無い) |
| `effect name[generics]`                                          | marker effect (後述)                    |
| `external agent name[generics](params) -> T [with E] [from "R"]` | 宛先が reactor / FFI sidecar の agent   |
| `primitive agent name[generics](params) -> T [with E]`           | コンパイラ組み込みの agent (stdlib 用)  |
| `data name[generics](params)`                                    | 直和型の 1 constructor                  |
| `type name[generics] = T`                                        | 型シノニム                              |
| `import ...`                                                     | 他モジュールの名前を持ち込む            |

`agent` / `request` / `external agent` / `primitive agent` / `data` の直前には
`@"..."` doc annotation を付けられる — 生成される JSON Schema の説明文になり、AI に見せる
tool 定義や `reflection.get_metadata` の `description` に載る。

```katari
@"1 つの円を、半径で表す。"
data circle(radius: number)

@"円の面積。"
agent area(value: circle) -> number {
  3.14159 * value.radius * value.radius
}
```

`external agent` の `from "reactor"` 節は呼び出し先の reactor を名指す (`"http"` / `"webhook"` /
`"mcp"`)。省略すると FFI sidecar 宛て — [`ffi.ktr`]({docs}/{currentVersion}/katari-toolchains/runtime)
のような同名 `.ts` モジュールが実装を持つ。

## ブロックと文

ブロック `{ ... }` は文の並びと、末尾の値になる式からなる。文には `let` / `var` (for / handler の
状態) / ローカル `agent` 宣言 / `return` / `next` / `break` / `finally` / `use` があり、それ以外は
式文になる。

```katari
agent example() -> integer {
  let a = 1        // let: 不変束縛
  let b = a + 1
  b                // 末尾の式がブロックの値
}
```

## match

`match (subject) { case pattern -> body ... }` は constructor でディスパッチする。パターンは:

| パターン                       | 意味                                                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `_` / `_: T`                   | ワイルドカード (型で絞り込み可)                                                                                               |
| `42` / `"s"` / `true` / `null` | リテラル                                                                                                                      |
| `n` / `n: T`                   | 変数束縛                                                                                                                      |
| `[p1, p2, ...]`                | タプルパターン                                                                                                                |
| `{ x, y => p }`                | record パターン (`x` は `x => x` の糖衣)                                                                                      |
| `point(x => px, y => py)`      | constructor パターン (フィールド分解)                                                                                         |
| `point()`                      | フィールド無しの constructor パターン                                                                                         |
| `integer(n)`                   | 型フィルタ (primitive tag のみ: `null` / `boolean` / `integer` / `number` / `string` / `file` / `array` / `record` / `agent`) |

```katari
data circle(radius: number)
data rect(width: number, height: number)
type shape = circle | rect

agent area(value: shape) -> number {
  match (value) {
    case circle(radius => r) -> 3.14159 * r * r
    case rect(width => w, height => h) -> w * h
  }
}
```

## for / parallel

`for (pattern in source [, var name [: T] = init]...) { body } [then [(pattern)] { ... }]` は
逐次イテレーション。body 内の `next value [with { name = expr, ... }]` が次要素へ進み (accumulator
の `var` を更新する)、`break value` はループを打ち切る。`then` 節は最終結果を受け取る。

```katari
agent sum(values: array[integer]) -> integer {
  for (let value in values, var total: integer = 0) {
    next with { total = total + value }
  } then (_elements) { total }
}
```

`parallel for (...) { ... }` は同じ構文で、各要素を独立したスレッドで並列評価する。
`parallel [e1, e2, ...]` は式のタプルを並列評価する (`for` ではなく固定要素数)。

```katari
agent squares(count: integer) -> array[integer] {
  parallel for (let n in array.range(start = 1, end = count + 1)) {
    next n * n
  }
}
```

## use / handler

`use provider` は provider を、続く残りの block を継続として一回適用する — 詳細は
[Providers]({docs}/{currentVersion}/language-reference/providers) 参照。もっとも基本的な provider
は handler リテラルそのもの:

```katari
request tick() -> integer

agent count_three() -> array[integer] with tick {
  use handler (var counter = 0) {
    request tick() { next counter with { counter = counter + 1 } }
  }
  [tick(), tick(), tick()]
}
```

`handler [generics](var state = init, ...) { request handler... } [then ...]` はハンドラを式として
組み立てる (状態変数、複数の request 節、`then` で最終状態を受け取れる)。`parallel handler` は
並列に走るハンドラを作る。request 節の中では、囲みが `for` ならその `next` / `break` 、囲みが
handler ならハンドラの `next` (resume) / `break` (discharge) が使える — どちらの意味になるかは
直近の `for` / handler の位置で決まる。

## finally

`finally { <block> }` は文で、値を返さない。評価すると block を現在の instance の finalizer
スタックに積む (arming) — 詳細は [finally]({docs}/{currentVersion}/language-reference/finally) 参照。

## 部分適用: `_`

呼び出しの名前付き引数のうち、値を書いたものは今固定され、`_` を書いたものは穴になり、残りの
オプショナル引数は省略され defaulted のまま — 詳細は
[Partial Application]({docs}/{currentVersion}/language-reference/partial-application) 参照。

```katari
agent scale(factor: number, value: number) -> number { factor * value }

agent doubles(values: array[number]) -> array[number] {
  let double = scale(factor = 2.0, value = _)   // agent (value: number) -> number
  for (let value in values) { next double(value = value) }
}
```

## f-string

`f"...${expression}..."` はテンプレート文字列 — リテラルな断片と `${...}` の式が交互に並ぶ。

```katari
agent greeting(name: string, count: integer) -> string {
  f"Hello, ${name}! (${string.to_string(value = count)})"
}
```

## リテラルと式

- 数値リテラルは小数部や指数部があれば `number`、無ければ `integer`。
- 文字列リテラルは `"..."` (エスケープ: `\n` `\t` `\r` `\"` `\\` `\$` `\/`)。
- 真偽値 `true` / `false`、`null`。
- タプル `[e1, e2, ...]` (空 `[]` や単一要素 `[e]` も可)。
- record リテラル `{ label = expr, ... }` (キーは識別子、または `"Content-Type"` のような引用文字列)。
- 演算子は通常の優先順位: `!` / 単項 `-` (積み重ね可) > `* / %` > `++ + -` > 比較 (`<= >= < >`) >
  `== !=` > `&&` > `||`。

## generics

`[A, effect E, attribute T, literal L extends Bound]` の形で、種類は 4 つ: 無印 (型)、`effect`
(effect row 変数)、`attribute` (`public` / `private` のような attribute 変数)、`literal` (呼び出し側の
文字列リテラル引数をそのシングルトン型に束縛する — TypeScript の `const` 型パラメータに相当)。
`extends` で上界を書ける (`[T extends number]`)。

## 予約語

```
agent request external primitive data type import from as use handler
for parallel if else match case return next break var let finally then in with of
true false null
```

型だけの語 (`integer` `array` `record` `never` `unknown` `all` `io` `pure` ...) は予約語では
ない — 型パーサが位置的に認識するので、式の識別子やモジュール名としても使える
(`array.get` の `array` はモジュール名)。

## 関連

<DocCards>
  <DocCard href="{docs}/{currentVersion}/language-reference/types" />
  <DocCard href="{docs}/{currentVersion}/language-reference/effects" />
  <DocCard href="{docs}/{currentVersion}/language-reference/partial-application" />
  <DocCard href="{docs}/{currentVersion}/language-reference/providers" />
</DocCards>
