---
title: prelude.math
description: 算術演算子を超える数値操作 — abs / min / max と floor / ceil / round の丸め三兄弟。
---

算術演算子 (`+` `-` `*` `/` `%`) を超える数値操作。default import 経由で `math.` qualified に呼ぶ。
丸め三兄弟 (`floor` / `ceil` / `round`) は言語で唯一の `number -> integer` 変換であり (`/` は常に
`number` を返す)、除算した量に対する整数演算はここを通る。

## agent

### `math.abs`

```katari
primitive agent abs[T extends number](value: T) -> T
```

絶対値。integer を保つ。

### `math.min` / `math.max`

```katari
primitive agent min[T extends number](left: T, right: T) -> T
primitive agent max[T extends number](left: T, right: T) -> T
```

小さい方 / 大きい方。両オペランドが integer なら integer を保つ。

### `math.floor`

```katari
primitive agent floor(value: number) -> integer
```

value 以下で最大の整数。non-finite な値は起こり得ない (除算が non-finite を生まないため)。

### `math.ceil`

```katari
primitive agent ceil(value: number) -> integer
```

value 以上で最小の整数。

### `math.round`

```katari
primitive agent round(value: number) -> integer
```

最も近い整数 (0 から離れる方向への四捨五入 — 小学校で習う規則。銀行丸めではない)。

## 関連

<DocCards>
  <DocCard href="{docs}/{currentVersion}/standard-library/string" />
  <DocCard href="{docs}/{currentVersion}/language-reference/effects" />
</DocCards>
