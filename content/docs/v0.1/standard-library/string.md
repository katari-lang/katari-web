---
title: prelude.string
description: string の操作 — length / split / join / slice / contains / replace / to_upper など。
---

`string` の、連結 (`++` / f-string) だけでは足りない操作。default import 経由で `string.` qualified
に呼ぶ。インデックスは Unicode コードポイント単位であり UTF-16 unit ではない — BMP 外の文字も
1 として数える。

## agent

### `string.length`

```katari
primitive agent length(value: string) -> integer
```

Unicode コードポイント数。

### `string.split`

```katari
primitive agent split(value: string, separator: string) -> array[string]
```

`separator` の出現の間の部分文字列。空の `separator` はコードポイントごとに分割する。

### `string.join`

```katari
primitive agent join(parts: array[string], separator: string) -> string
```

`parts` を `separator` を挟んで連結する。

### `string.slice`

```katari
primitive agent slice(value: string, start: integer, end: integer) -> string
```

`start` (含む) から `end` (含まない) までのコードポイント、0-based、範囲外はクランプされる。

### `string.contains` / `string.starts_with` / `string.ends_with`

```katari
primitive agent contains(value: string, search: string) -> boolean
primitive agent starts_with(value: string, search: string) -> boolean
primitive agent ends_with(value: string, search: string) -> boolean
```

`search` が含まれるか / 先頭にあるか / 末尾にあるか。

### `string.index_of`

```katari
primitive agent index_of(value: string, search: string) -> integer | null
```

`search` が最初に出現するコードポイントのインデックス。出現しなければ `null`。

### `string.replace`

```katari
primitive agent replace(value: string, search: string, replacement: string) -> string
```

`search` のすべての出現 (リテラルなテキスト、パターンではない) を `replacement` に置き換える。
空の `search` は無変更を返す。

### `string.trim`

```katari
primitive agent trim(value: string) -> string
```

先頭・末尾の空白を除いた文字列。

### `string.to_upper` / `string.to_lower`

```katari
primitive agent to_upper(value: string) -> string
primitive agent to_lower(value: string) -> string
```

Unicode の既定の大文字・小文字化 (ロケール無し)。

### `string.to_string`

```katari
primitive agent to_string(value: null | boolean | number | string) -> string
```

スカラー値をその文字列表現にする (整数は小数点なしで描画される)。複合値には代わりに
`json.stringify(value = json.encode(value = ...))` を使う。

### `string.to_integer` / `string.to_number`

```katari
primitive agent to_integer(value: string) -> integer | null
primitive agent to_number(value: string) -> number | null
```

文字列を base-10 整数 / 数値として読む (それぞれ整数でない・数値でない場合は `null` —
数モデルが正確に保持できない大きさの整数も含む)。パディングされた入力には `trim` と組み合わせる。
診断付きのパースには代わりに `json.parse_as[integer]` / `json.parse_as[number]` を使う。

## 関連

<DocCards>
  <DocCard href="{docs}/{currentVersion}/standard-library/array" />
  <DocCard href="{docs}/{currentVersion}/standard-library/json" />
  <DocCard href="{docs}/{currentVersion}/standard-library/math" />
</DocCards>
