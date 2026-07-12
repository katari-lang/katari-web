---
title: prelude.array
description: array[T] の操作 — get / append / concat / slice / contains / flatten / range。
---

`array[T]` の、リテラルや `for` のマッピングだけでは足りない操作。default import 経由で `array.`
qualified に呼ぶ。パラメータは一貫して `target` という名前 (`prelude.record` と揃えている)。

## agent

### `array.get`

```katari
primitive agent get[T](target: array[T], index: integer) -> T | null
```

`index` (0-based) の要素。範囲外なら `null`。

### `array.length`

```katari
primitive agent length(target: array[unknown]) -> integer
```

要素数。

### `array.append`

```katari
primitive agent append[T](target: array[T], value: T) -> array[T]
```

末尾に `value` を足したコピーを返す。

### `array.concat`

```katari
primitive agent concat[T](left: array[T], right: array[T]) -> array[T]
```

`left` に続けて `right` の要素を並べた配列。

### `array.slice`

```katari
primitive agent slice[T](target: array[T], start: integer, end: integer) -> array[T]
```

`start` (含む) から `end` (含まない) までの要素、0-based、範囲外は境界にクランプされる。

### `array.contains`

```katari
primitive agent contains[T](target: array[T], value: T) -> boolean
```

`value` が要素の中にあるか (`==` と同じ構造的等価性)。

### `array.index_of`

```katari
primitive agent index_of[T](target: array[T], value: T) -> integer | null
```

`value` に構造的に等しい最初の要素のインデックス。無ければ `null`。

### `array.flatten`

```katari
primitive agent flatten[T](target: array[array[T]]) -> array[T]
```

ネストを 1 段外して要素を順に連結する。`for` のマッピングと組み合わせると filter イディオムになる:
各要素を `[x]` か `[]` に map してから flatten する。

### `array.reverse`

```katari
primitive agent reverse[T](target: array[T]) -> array[T]
```

要素を逆順にした配列。

### `array.range`

```katari
primitive agent range(start: integer, end: integer) -> array[integer]
```

`start` (含む) から `end` (含まない) までの整数 — `for` の回数指定ループの元になる。
`end <= start` なら空。

### `array.empty`

```katari
primitive agent empty() -> array[never]
```

空の配列。

## 関連

<DocCards>
  <DocCard href="{docs}/{currentVersion}/standard-library/record" />
  <DocCard href="{docs}/{currentVersion}/standard-library/string" />
  <DocCard href="{docs}/{currentVersion}/language-reference/syntax" />
</DocCards>
