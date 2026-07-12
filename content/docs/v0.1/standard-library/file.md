---
title: prelude.file
description: file 値の内容・メタデータをランタイム内で読む — read_base64 / content_type / size。
---

`file` はプロジェクトの blob ストアへの薄いハンドルで、値自体は参照 (identity) だけを運ぶ — bytes と
メタデータはランタイム側に留まるので、プログラムは file をコストなしに受け渡しでき、ハンドルの
中身が古くなったり偽造されたりすることもない。ここの 3 つの primitive は、内容やメタデータを実際に
読む必要がある場面 (マルチモーダルモデルの `inline_data` 用の base64 など) の橋渡しをする。
default import 経由で `file.` qualified に呼ぶ。

## agent

### `file.read_base64`

```katari
primitive agent read_base64(value: file) -> string
```

file の bytes を base64 エンコードした文字列 — マルチモーダルモデル API の inline 形。内容全体が
1 つの文字列として実体化するので、サイズに注意する (大きなファイルはリクエストボディも大きくなる)。

### `file.content_type`

```katari
primitive agent content_type(value: file) -> string
```

プロジェクトのファイルカタログに記録された MIME タイプ (例: `"image/png"`)。アップロード時に
何も記録されていなければ `""`。

### `file.size`

```katari
primitive agent size(value: file) -> integer
```

ファイルのバイト数。プロジェクトのファイルカタログから読む (内容のダウンロードは発生しない)。

## 関連

<DocCards>
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/cli" />
  <DocCard href="{docs}/{currentVersion}/language-reference/effects" />
</DocCards>
