---
title: prelude.json
description: The json sum type and the parse / stringify / encode / decode conversions, generic conversion between values and json.
---

`json` is a tagged representation of a JSON document: a sum type with one `data` constructor per
JSON shape. It lets a document whose shape is not fixed, such as an AI response, be traversed with
`match`. It is called qualified as `json.` via default import.

There are six conversions, and they operate by a uniform rule that does not treat `json` as a
special case.

| Conversion    | Type             | Meaning                                                        |
| ------------- | ---------------- | -------------------------------------------------------------- |
| `parse`       | `string -> json` | Turns text into a tree (traversed with `match`)                |
| `stringify`   | `json -> string` | Turns a tree back into document text (the inverse of `parse`)  |
| `encode[T]`   | `T -> json`      | Embeds an arbitrary value into a tree in its wire form         |
| `decode[T]`   | `json -> T`      | Reads a tree as `T`, validating it against T's schema          |
| `parse_as[T]` | `string -> T`    | `parse` followed by `decode[T]`, without an intermediate tree  |
| `to_text[T]`  | `T -> string`    | `encode` followed by `stringify`, without an intermediate tree |

Law: `stringify(parse(t)) == t`, and for any T, `decode[T](encode(x)) == x`. The conversion
between a value and `json` is a generic, total bijection that never refers to a schema, so this
law holds even when T is `json` itself or contains agents or closures. The typed readers
(`decode[T]` / `parse_as[T]`) apply a separate validation pass afterward, checking the decoded
value against T's schema.

`encode` embeds values in their wire form: a plain record becomes a `json_object`; a `data` value
nests its fields under `value` (`{ $constructor: name, value: {...} }`; keys starting with `$` are
doubled to escape them, so there is no collision); an array becomes a `json_array`; a `file`
becomes a `$ref` handle object; and an agent or closure becomes a `$agent` / `$closure` reference
object. A secret value taints the entire result, so it cannot cross a user-facing boundary (the
ordinary information-flow rule).

## Types

### `json.json`

```katari
type json = json_null | json_boolean | json_integer | json_number | json_string | json_array | json_object
```

Exactly one of the seven JSON shapes. Each shape carries its content in a single field, named
`entries`, `items`, or `value` depending on the shape (for example `json_object(entries:
record[json])`, `json_array(items: array[json])`). A number with no fractional part becomes
`json_integer` under `parse`.

### `json.parse_error`

```katari
data parse_error(message: string)
```

The text is not valid JSON. Thrown by `parse` / `parse_as`.

### `json.decode_error`

```katari
data decode_error(message: string)
```

The parsed document does not conform to the requested type's schema. Thrown by `decode` /
`parse_as`. `message` indicates the path of the problem.

## Agents

### `json.parse`

```katari
primitive agent parse(text: string) -> json with prelude.throw[parse_error]
```

Parses a `json` tree from text (traversed with `match`). An invalid document throws `parse_error`.

### `json.parse_as`

```katari
primitive agent parse_as[T](text: string) -> T with prelude.throw[parse_error | decode_error]
```

Parses text directly as `T`: a typed text boundary that does not go through an intermediate `json`
tree. Because `T` appears only in the result, it cannot be inferred, so explicit instantiation is
required (`json.parse_as[my_type](text = ...)`). An invalid document throws `parse_error`; a
schema mismatch throws `decode_error`.

### `json.stringify`

```katari
primitive agent stringify(value: json) -> string
```

Turns a `json` tree into (compact) document text (the inverse of `parse`). For an arbitrary value,
combine it as `stringify(value = encode(value = x))`.

### `json.encode`

```katari
primitive agent encode[T](value: T) -> json
```

Embeds an arbitrary value into `json` in its wire form. `decode[T]` inverts this for any T.

### `json.to_text`

```katari
primitive agent to_text[T](value: T) -> string
```

Renders an arbitrary value as (compact) wire-form JSON text: `stringify(value = encode(value =
x))`. The inverse of `parse_as[T]`.

### `json.decode`

```katari
primitive agent decode[T](value: json) -> T with prelude.throw[decode_error]
```

Reads a `json` tree as `T` (the generic inverse of `encode`: `$constructor` objects become `data`
values, and `$agent` / `$closure` / `$ref` objects become callables / files). It then applies a
separate, strict validation pass against T's schema. Because `T` appears only in the result,
explicit instantiation is required (`json.decode[unknown]` reads regardless of shape). A schema
mismatch throws `decode_error`.

### `json.or_null` / `json.field` / `json.element` / `json.text`

Plain Katari agents for probing a document whose shape is unfixed or unknown (an AI response, a
third-party API response) without writing a `match` each time. Each reader is **total**: a missing
key, an out-of-range index, or a shape mismatch becomes `json_null()` / `""` rather than an error,
so lookups can be chained:

```katari
agent first_content(parsed: json.json) -> string {
  json.text(target = json.field(target = json.element(target = parsed, index = 0), key = "content"))
}
```

For a document whose shape is known, prefer the typed boundaries that fail by default (`parse_as[T]`
/ `decode[T]`).

## Related

<DocCards>
  <DocCard href="{docs}/{currentVersion}/standard-library/http" />
  <DocCard href="{docs}/{currentVersion}/standard-library/record" />
  <DocCard href="{docs}/{currentVersion}/standard-library/reflection" />
</DocCards>
