---
title: prelude.record
description: Operations on record[T], a homogeneous string-keyed map, get / set / remove / keys / entries / merge.
---

Operations on `record[T]` (the shape held by the entries of a parsed JSON object, an environment
listing, and the like). Called qualified as `record.` via default import. The parameter is
consistently named `target` (matching `prelude.array`).

## Agents

### `record.get`

```katari
primitive agent get[T](target: record[T], key: string) -> T | null
```

Reads the value under `key`. Returns `null` if `key` is absent.

### `record.set`

```katari
primitive agent set[T](target: record[T], key: string, value: T) -> record[T]
```

Returns a copy with `value` under `key` (replacing any existing entry).

### `record.remove`

```katari
primitive agent remove[T](target: record[T], key: string) -> record[T]
```

Returns a copy without `key` (unchanged if `key` is absent).

### `record.keys`

```katari
primitive agent keys(target: record[unknown]) -> array[string]
```

Returns all keys in sorted order.

### `record.has`

```katari
primitive agent has(target: record[unknown], key: string) -> boolean
```

Whether `key` exists.

### `record.size`

```katari
primitive agent size(target: record[unknown]) -> integer
```

The number of entries.

### `record.entries`

```katari
primitive agent entries[T](target: record[T]) -> array[[string, T]]
```

Returns all entries as an array of `[key, value]` pairs in sorted key order: the `for`-iterable
view of a record.

### `record.values`

```katari
agent values[T](target: record[T]) -> array[T] {
  for (let [_, value] in record.entries(target = target)) {
    next value
  }
}
```

Returns all values in sorted key order, in the form that pairs with `keys`. Because it iterates
`entries` directly with `for`, reading values is always total; there is no extra step of calling
`get` per key and handling absence.

### `record.merge`

```katari
primitive agent merge[T](left: record[T], right: record[T]) -> record[T]
```

Combines the entries of both records into one. When a key appears in both, **the value from
`right` wins** (the direction that lets a call extend layered configuration and override default
values). The header merge in `http.post_json` follows this shape.

### `record.empty`

```katari
primitive agent empty() -> record[never]
```

An empty record.

## Related

<DocCards>
  <DocCard href="{docs}/{currentVersion}/standard-library/array" />
  <DocCard href="{docs}/{currentVersion}/standard-library/json" />
  <DocCard href="{docs}/{currentVersion}/language-reference/syntax" />
</DocCards>
