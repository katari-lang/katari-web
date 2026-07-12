---
title: prelude.json
description: json 直和型と、parse / stringify / encode / decode の変換 — 総称的な value ↔ json 変換。
---

`json` は JSON ドキュメントの tagged な写しで、JSON の形ごとに 1 つの `data` コンストラクタを持つ
直和型である。AI の応答のような形が不定なドキュメントを `match` で辿れる。default import 経由で
`json.` qualified に呼ぶ。

変換は 6 つあり、`json` を特別扱いしない一様な規則で動く。

| 変換          | 型               | 意味                                          |
| ------------- | ---------------- | --------------------------------------------- |
| `parse`       | `string -> json` | テキストを木にする (`match` で辿る)           |
| `stringify`   | `json -> string` | 木をドキュメントテキストに戻す (`parse` の逆) |
| `encode[T]`   | `T -> json`      | 任意の値を wire form で木に埋め込む           |
| `decode[T]`   | `json -> T`      | 木を T として読み、T のスキーマで検証する     |
| `parse_as[T]` | `string -> T`    | `decode[T]` した `parse` (中間木なし)         |
| `to_text[T]`  | `T -> string`    | `stringify` した `encode` (中間木なし)        |

法則: `stringify(parse(t)) == t`、任意の T について `decode[T](encode(x)) == x`。value ↔ `json` の
変換は **総称的で totalな bijection** — スキーマを一切参照しない — なので、この法則は `json` 自身や
agent / closure を含む T にも成り立つ。型付き reader (`decode[T]` / `parse_as[T]`) はこれとは別の
検証パスで、デコード後の値を T のスキーマと突き合わせる。

`encode` は wire form で埋め込む: 素のレコードは `json_object` になり、`data` 値はフィールドを
`value` の下にネストする (`{ $constructor: name, value: {...} }` — `$` で始まるキーは倍化 escape
されるので衝突しない)、配列は `json_array`、`file` は `$ref` handle オブジェクト、agent / closure は
`$agent` / `$closure` 参照オブジェクトになる。secret な値は結果全体を汚染し、user-facing な境界を
越えられなくなる (通常の情報流規則)。

## 型

### `json.json`

```katari
type json = json_null | json_boolean | json_integer | json_number | json_string | json_array | json_object
```

7 つの JSON 形のうち正確に 1 つ。フィールドを持たない構造は `entries` / `items` / `value` の名前で
その形の中身を運ぶ (`json_object(entries: record[json])`, `json_array(items: array[json])` など)。
小数部を持たない数値は `parse` で `json_integer` になる。

### `json.parse_error`

```katari
data parse_error(message: string)
```

テキストが JSON として不正。`parse` / `parse_as` が投げる。

### `json.decode_error`

```katari
data decode_error(message: string)
```

パース済みドキュメントが要求された型のスキーマに適合しない。`decode` / `parse_as` が投げる。
`message` が問題のパスを示す。

## agent

### `json.parse`

```katari
primitive agent parse(text: string) -> json with prelude.throw[parse_error]
```

テキストから `json` 木をパースする (`match` で辿る)。不正なドキュメントは `parse_error` を投げる。

### `json.parse_as`

```katari
primitive agent parse_as[T](text: string) -> T with prelude.throw[parse_error | decode_error]
```

テキストを直接 T としてパースする — 中間の `json` 木を経ない、型付きのテキスト境界。`T` は結果にしか
現れず推論できないので明示 instantiate が必須 (`json.parse_as[my_type](text = ...)`)。不正な
ドキュメントは `parse_error`、スキーマ不適合は `decode_error` を投げる。

### `json.stringify`

```katari
primitive agent stringify(value: json) -> string
```

`json` 木を (compact な) ドキュメントテキストにする (`parse` の逆)。任意の値には
`stringify(value = encode(value = x))` のように組み合わせる。

### `json.encode`

```katari
primitive agent encode[T](value: T) -> json
```

任意の値をその wire form で `json` に埋め込む。`decode[T]` が任意の T についてこれを逆にする。

### `json.to_text`

```katari
primitive agent to_text[T](value: T) -> string
```

任意の値を (compact な) wire form の JSON テキストとして描画する —
`stringify(value = encode(value = x))`。`parse_as[T]` の逆。

### `json.decode`

```katari
primitive agent decode[T](value: json) -> T with prelude.throw[decode_error]
```

`json` 木を T として読む (`encode` の総称的な逆 — `$constructor` オブジェクトが `data` 値に、
`$agent` / `$closure` / `$ref` オブジェクトが callable / file に戻る)。その後 T のスキーマに対して
別枠の厳格な検証を行う。`T` は結果にしか現れないので明示 instantiate が必須
(`json.decode[unknown]` は形を問わずに読む)。スキーマ不適合は `decode_error` を投げる。

### `json.or_null` / `json.field` / `json.element` / `json.text`

形が不定・不明なドキュメント (AI の応答、サードパーティ API のレスポンス) を、そのたびに `match` を
書かずに探るための素の Katari agent。各 reader は **total** — キー不在・範囲外・形違いは
`json_null()` / `""` になり、エラーにならない — ので探索を連鎖できる:

```katari
agent first_content(parsed: json.json) -> string {
  json.text(target = json.field(target = json.element(target = parsed, index = 0), key = "content"))
}
```

形が既知のドキュメントには、default で失敗する型付き境界 (`parse_as[T]` / `decode[T]`) を使う方が
よい。

## 関連

<DocCards>
  <DocCard href="{docs}/{currentVersion}/standard-library/http" />
  <DocCard href="{docs}/{currentVersion}/standard-library/record" />
  <DocCard href="{docs}/{currentVersion}/standard-library/reflection" />
</DocCards>
