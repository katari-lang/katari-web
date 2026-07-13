---
title: Standard Library
description: Reference for each prelude submodule's signatures, parameters, behavior, and errors.
---

The prelude is a set of submodules that are default-imported and called qualified (`json.parse`,
`http.fetch`, `mcp.provide`, `reflection.get_metadata`, `record.get`). The targets that operators
(`+`, `==`, `&&`, ...) desugar to, and `throw[T]` itself, live at the top level of the prelude and
are covered in [Language Reference › Syntax]({docs}/{currentVersion}/language-reference/syntax)
and [Effects]({docs}/{currentVersion}/language-reference/effects). This section enumerates the
agent and type signatures, parameters, behavior, and errors of each submodule.

| Module       | Contents                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| `json`       | The `json` sum type and the generic parse / stringify / encode / decode conversions                        |
| `http`       | The runtime's built-in HTTP client (`fetch` / `post_json`)                                                 |
| `record`     | Operations on `record[T]` (`get` / `set` / `keys` / `entries` / `merge`, ...)                              |
| `array`      | Operations on `array[T]` (`get` / `append` / `slice` / `flatten` / `range`, ...)                           |
| `string`     | Operations on `string` (`split` / `join` / `replace` / `to_upper`, ...)                                    |
| `math`       | Numeric operations beyond the arithmetic operators (`abs` / `min` / `max` / `floor` / `round`)             |
| `env`        | Project-scoped environment access (`get_secret` / `get_all`)                                               |
| `file`       | Reads the content and metadata of `file` values within the runtime (`read_base64` / `content_type`)        |
| `time`       | Durable wall-clock time (`now` / `sleep` / `sleep_until` / `watch`)                                        |
| `replay`     | The retry mechanism (`immediate` / `forever` / `exponential`), with the failure policy in a user converter |
| `webhook`    | Dynamically generated inbound HTTP endpoints (`inbound`)                                                   |
| `mcp`        | Scoped connections to MCP servers (`provide` / `call`), exposing one (`serve`), and the `auth` sum type    |
| `reflection` | Treats agents as first-class inspectable values (`get_metadata` / `call_agent`)                            |

<DocCards>
  <DocCard href="{docs}/{currentVersion}/standard-library/json" />
  <DocCard href="{docs}/{currentVersion}/standard-library/http" />
  <DocCard href="{docs}/{currentVersion}/standard-library/record" />
  <DocCard href="{docs}/{currentVersion}/standard-library/array" />
  <DocCard href="{docs}/{currentVersion}/standard-library/string" />
  <DocCard href="{docs}/{currentVersion}/standard-library/math" />
  <DocCard href="{docs}/{currentVersion}/standard-library/env" />
  <DocCard href="{docs}/{currentVersion}/standard-library/file" />
  <DocCard href="{docs}/{currentVersion}/standard-library/time" />
  <DocCard href="{docs}/{currentVersion}/standard-library/replay" />
  <DocCard href="{docs}/{currentVersion}/standard-library/webhook" />
  <DocCard href="{docs}/{currentVersion}/standard-library/mcp" />
  <DocCard href="{docs}/{currentVersion}/standard-library/reflection" />
</DocCards>
