---
title: prelude.array
description: Operations on array[T], get / append / concat / slice / contains / flatten / range.
---

Operations on `array[T]` that literals and `for` mapping alone do not cover. Called qualified as
`array.` via default import. The parameter is consistently named `target` (matching
`prelude.record`).

## Agents

### `array.get`

```katari
primitive agent get[T](target: array[T], index: integer) -> T | null
```

The element at `index` (0-based). Returns `null` if out of range.

### `array.length`

```katari
primitive agent length(target: array[unknown]) -> integer
```

The number of elements.

### `array.append`

```katari
primitive agent append[T](target: array[T], value: T) -> array[T]
```

Returns a copy with `value` appended at the end.

### `array.concat`

```katari
primitive agent concat[T](left: array[T], right: array[T]) -> array[T]
```

An array with `right`'s elements placed after `left`'s.

### `array.slice`

```katari
primitive agent slice[T](target: array[T], start: integer, end: integer) -> array[T]
```

The elements from `start` (inclusive) to `end` (exclusive), 0-based; out-of-range bounds are
clamped.

### `array.contains`

```katari
primitive agent contains[T](target: array[T], value: T) -> boolean
```

Whether `value` is among the elements (the same structural equality as `==`).

### `array.index_of`

```katari
primitive agent index_of[T](target: array[T], value: T) -> integer | null
```

The index of the first element structurally equal to `value`. Returns `null` if none.

### `array.flatten`

```katari
primitive agent flatten[T](target: array[array[T]]) -> array[T]
```

Removes one level of nesting, concatenating the elements in order. Combined with `for` mapping, it
forms the filter idiom: map each element to `[x]` or `[]`, then flatten.

### `array.reverse`

```katari
primitive agent reverse[T](target: array[T]) -> array[T]
```

An array with the elements in reverse order.

### `array.range`

```katari
primitive agent range(start: integer, end: integer) -> array[integer]
```

The integers from `start` (inclusive) to `end` (exclusive); the basis for a `for` loop with a
fixed count. Empty if `end <= start`.

### `array.empty`

```katari
primitive agent empty() -> array[never]
```

An empty array.

## Related

<DocCards>
  <DocCard href="{docs}/{currentVersion}/standard-library/record" />
  <DocCard href="{docs}/{currentVersion}/standard-library/string" />
  <DocCard href="{docs}/{currentVersion}/language-reference/syntax" />
</DocCards>
