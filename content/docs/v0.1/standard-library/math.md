---
title: prelude.math
description: Numeric operations beyond the arithmetic operators, abs / min / max and the rounding trio floor / ceil / round.
---

Numeric operations beyond the arithmetic operators (`+`, `-`, `*`, `/`, `%`). Called qualified as
`math.` via default import. The rounding trio (`floor` / `ceil` / `round`) are the only `number ->
integer` conversions in the language (`/` always returns `number`), so integer arithmetic on a
divided quantity passes through here.

## Agents

### `math.abs`

```katari
primitive agent abs[T extends number](value: T) -> T
```

The absolute value. Preserves `integer`.

### `math.min` / `math.max`

```katari
primitive agent min[T extends number](left: T, right: T) -> T
primitive agent max[T extends number](left: T, right: T) -> T
```

The smaller / larger of the two. Preserves `integer` if both operands are `integer`.

### `math.floor`

```katari
primitive agent floor(value: number) -> integer
```

The largest integer less than or equal to `value`. A non-finite value cannot occur, because
division never produces a non-finite result.

### `math.ceil`

```katari
primitive agent ceil(value: number) -> integer
```

The smallest integer greater than or equal to `value`.

### `math.round`

```katari
primitive agent round(value: number) -> integer
```

The nearest integer (rounding away from zero, the rule taught in grade school, not banker's
rounding).

## Related

<DocCards>
  <DocCard href="{docs}/{currentVersion}/standard-library/string" />
  <DocCard href="{docs}/{currentVersion}/language-reference/effects" />
</DocCards>
