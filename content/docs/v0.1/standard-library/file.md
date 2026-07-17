---
title: prelude.file
description: Read the content and metadata of a file value inside the runtime, read_base64, content_type, and size.
---

`file` is a thin handle onto the project's blob store. The value itself carries only a reference
(identity); the bytes and metadata stay on the runtime side, so a program can pass a file around
at no cost, and a handle can never go stale or be forged. The three primitives here bridge to the
cases that need to actually read the content or metadata, such as producing base64 for a
multimodal model's `inline_data`. They are called qualified as `file.` via the default import.

## Agents

### `file.read_base64`

```katari
primitive agent read_base64(value: file) -> string
```

The file's bytes as a base64-encoded string, the inline form used by multimodal model APIs. The
entire content is materialized as a single string, so size matters: a large file produces a large
request body.

### `file.content_type`

```katari
primitive agent content_type(value: file) -> string
```

The MIME type recorded in the project's file catalog (for example `"image/png"`). `""` if nothing
was recorded at upload time.

### `file.size`

```katari
primitive agent size(value: file) -> integer
```

The file's size in bytes. Read from the project's file catalog; no content download occurs.

## Related

<DocCards>
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/cli" />
  <DocCard href="{docs}/{currentVersion}/language-reference/effects" />
</DocCards>
