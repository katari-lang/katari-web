---
title: prelude.string
description: Operations on string, length / split / join / slice / contains / replace / to_upper, and more.
---

Operations on `string` that concatenation (`++` / f-strings) alone does not cover. Called
qualified as `string.` via default import. Indexes are in Unicode code points, not UTF-16 units; a
character outside the BMP still counts as 1.

## Agents

### `string.length`

```katari
primitive agent length(value: string) -> integer
```

The number of Unicode code points.

### `string.split`

```katari
primitive agent split(value: string, separator: string) -> array[string]
```

The substrings between occurrences of `separator`. An empty `separator` splits by code point.

### `string.join`

```katari
primitive agent join(parts: array[string], separator: string) -> string
```

Concatenates `parts`, interspersed with `separator`.

### `string.slice`

```katari
primitive agent slice(value: string, start: integer, end: integer) -> string
```

The code points from `start` (inclusive) to `end` (exclusive), 0-based; out-of-range bounds are
clamped.

### `string.contains` / `string.starts_with` / `string.ends_with`

```katari
primitive agent contains(value: string, search: string) -> boolean
primitive agent starts_with(value: string, search: string) -> boolean
primitive agent ends_with(value: string, search: string) -> boolean
```

Whether `search` is contained, at the start, or at the end.

### `string.index_of`

```katari
primitive agent index_of(value: string, search: string) -> integer | null
```

The code-point index of the first occurrence of `search`. Returns `null` if it does not occur.

### `string.replace`

```katari
primitive agent replace(value: string, search: string, replacement: string) -> string
```

Replaces every occurrence of `search` (literal text, not a pattern) with `replacement`. An empty
`search` returns the value unchanged.

### `string.trim`

```katari
primitive agent trim(value: string) -> string
```

The string with leading and trailing whitespace removed.

### `string.to_upper` / `string.to_lower`

```katari
primitive agent to_upper(value: string) -> string
primitive agent to_lower(value: string) -> string
```

Unicode's default case conversion (locale-independent).

### `string.to_string`

```katari
primitive agent to_string(value: null | boolean | number | string) -> string
```

Renders a scalar value as its string representation (an integer renders without a decimal point).
For composite values, use `json.stringify(value = json.encode(value = ...))` instead.

### `string.to_integer` / `string.to_number`

```katari
primitive agent to_integer(value: string) -> integer | null
primitive agent to_number(value: string) -> number | null
```

Reads a string as a base-10 integer / number (returning `null` when it is not an integer or not a
number respectively, including an integer whose magnitude the numeric model cannot represent
exactly). Combine with `trim` for padded input. For parsing with diagnostics, use
`json.parse_as[integer]` / `json.parse_as[number]` instead.

## Related

<DocCards>
  <DocCard href="{docs}/{currentVersion}/standard-library/array" />
  <DocCard href="{docs}/{currentVersion}/standard-library/json" />
  <DocCard href="{docs}/{currentVersion}/standard-library/math" />
</DocCards>
