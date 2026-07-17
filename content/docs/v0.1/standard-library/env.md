---
title: prelude.env
description: Project-scoped environment access, get_secret (private, throw) and get_all (public).
---

Project-scoped environment access. This is a host primitive that the runtime binds to the
project's `env_entries` store at startup, called qualified as `env.` via the default import.
Reading is split between secrets and everything else: secrets are read one key at a time with
`get_secret`, and the result is `string of private` (it cannot cross a user-facing boundary; it
can only be passed to a sink such as a header or an FFI call). Entries that are not secrets are
read together with `get_all` as a public `string`.

Setting, listing, and deleting secrets are CLI operations. See
[CLI › env]({docs}/{currentVersion}/katari-toolchains/cli#env).

## Types

### `env.missing_secret`

```katari
data missing_secret(key: string, message: string)
```

No secret entry is configured under `key`. Thrown by `get_secret`. It is modeled as an expected
failure the program can recover from, such as an optional setting falling back to a default. If
uncaught, the run fails.

## Agents

### `env.get_secret`

```katari
primitive agent get_secret(key: string) -> string of private with prelude.throw[missing_secret]
```

Reads the secret entry for `key` as a private string (the value is tainted as secret and cannot
flow to a user-facing boundary). Throws `missing_secret` if the key is absent (it carries `key`,
so callers can branch on which secret is missing).

```katari
agent optional_api_key() -> string of private {
  use handler {
    request prelude.throw(error: env.missing_secret) -> never { break "" }
  }
  env.get_secret(key = "OPTIONAL_API_KEY")
}
```

- **Throws** `missing_secret` (no entry under `key`).

### `env.get_all`

```katari
primitive agent get_all() -> record[string]
```

Reads every non-secret env entry as a record of public strings keyed by the env key.

## Related

<DocCards>
  <DocCard href="{docs}/{currentVersion}/language-reference/types" />
  <DocCard href="{docs}/{currentVersion}/language-reference/providers" />
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/cli" />
</DocCards>
