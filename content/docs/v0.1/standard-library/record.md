---
title: prelude.record
description: 同種の string キー付きマップ record[T] の操作 — get / set / remove / keys / entries / merge。
---

`record[T]` (パース済み JSON オブジェクトの entries、env の一覧などが持つ形) の操作。default import
経由で `record.` qualified に呼ぶ。パラメータは一貫して `target` という名前 (`prelude.array` と
揃えている)。

## agent

### `record.get`

```katari
primitive agent get[T](target: record[T], key: string) -> T | null
```

`key` の下の値を読む。`key` が無ければ `null`。

### `record.set`

```katari
primitive agent set[T](target: record[T], key: string, value: T) -> record[T]
```

`key` の下に `value` を持つコピーを返す (既存エントリを置き換える)。

### `record.remove`

```katari
primitive agent remove[T](target: record[T], key: string) -> record[T]
```

`key` を持たないコピーを返す (`key` が無ければ無変更)。

### `record.keys`

```katari
primitive agent keys(target: record[unknown]) -> array[string]
```

すべてのキーをソート順で返す。

### `record.has`

```katari
primitive agent has(target: record[unknown], key: string) -> boolean
```

`key` が存在するか。

### `record.size`

```katari
primitive agent size(target: record[unknown]) -> integer
```

エントリ数。

### `record.entries`

```katari
primitive agent entries[T](target: record[T]) -> array[[string, T]]
```

すべてのエントリを `[key, value]` ペアの配列として、キーのソート順で返す — record の `for`-iterable
なビュー。

### `record.values`

```katari
agent values[T](target: record[T]) -> array[T] {
  for (let [_, value] in record.entries(target = target)) {
    next value
  }
}
```

すべての値を、`keys` の対となる形でキーのソート順で返す。`entries` を直接 `for` で辿るので、
値の読みは常に total (キーごとに `get` して欠損を扱う、という一手間がない)。

### `record.merge`

```katari
primitive agent merge[T](left: record[T], right: record[T]) -> record[T]
```

両方の record のエントリを 1 つにする。キーが重複したら **right の値が勝つ** (レイヤ化した
設定を呼び出しごとに拡張する、デフォルト値の上書き方向)。`http.post_json` の header マージが
この形。

### `record.empty`

```katari
primitive agent empty() -> record[never]
```

空の record。

## 関連

<DocCards>
  <DocCard href="{docs}/{currentVersion}/standard-library/array" />
  <DocCard href="{docs}/{currentVersion}/standard-library/json" />
  <DocCard href="{docs}/{currentVersion}/language-reference/syntax" />
</DocCards>
