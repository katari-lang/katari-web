---
title: prelude.http
description: The runtime's built-in HTTP client (fetch / post_json); header and body values form a private-capable submission surface.
---

The runtime's built-in HTTP client. Calls route to the runtime's `http` reactor (no FFI sidecar;
the same "external call built into the runtime" pattern as `mcp` and `webhook`). It is called
qualified as `http.` via default import. Because it is an external call, it performs `io`, adding
`io` to the caller's effect row.

## Information flow for private values: only the submission surface to the destination server lets them through

A private value is allowed to leave the runtime only **when it is headed to the request's
destination server**. That deliberate submission surface, header values **and** `body`, is typed
as `string of private`, so a secret (an auth token, a form-encoded `refresh_token`, and the like)
can be passed through directly. Both are revealed at a single transport boundary, at which point
the request departs to the one server the program named.

`url` and `method` remain public `string`s; passing a private value produces a type error. The URL
can leak into logs, caches, proxies, and the `Referer` header, meaning it flows to places other
than the destination server. The response is public (already declassified): it is the server's
response rather than a function of a secret, so the response to a request with a private body is
not tainted either.

## Types

### `http.fetch_error`

```katari
data fetch_error(message: string)
```

The request did not complete: DNS failure, connection refused, timeout, or a runtime restart
mid-flight. Thrown by `fetch`. If a response arrives, it is not an error regardless of `status`;
branch on `status` instead.

### `http.status_error`

```katari
data status_error(status: integer, body: string)
```

The JSON API returned a non-2xx status. Thrown by `post_json` (the raw `fetch` does not treat an
arrived response as an error; only this wrapper assumes JSON API conventions).

## Agents

### `http.fetch`

```katari
external agent fetch(
  url: string,
  method: string,
  headers: record[string of private],
  body: string of private,
) -> { status: integer, headers: record[string], body: string } with prelude.throw[fetch_error] from "http"
```

Sends a request to `url` with `method` (`"GET"`, `"POST"`, and so on). Each header value and `body`
may be secret (both are submitted only to the server at `url`, while `url` and `method` remain
public). Returns the response's `status`, `headers` (names lowercased, duplicate headers joined
with `", "`), and `body` text. If the request does not complete, it throws `fetch_error`.

```katari
agent get_item(token: string) -> string with io | prelude.throw[http.fetch_error] {
  let response = http.fetch(
    url = "https://api.example.com/items",
    method = "GET",
    headers = record.set(target = record.empty(), key = "Authorization", value = "Bearer " ++ token),
    body = "",
  )
  match (response.status) {
    case 200 -> response.body
    case _ -> "request failed"
  }
}
```

- **Throws** `fetch_error` (the request did not complete).

### `http.post_json`

```katari
agent post_json(
  url: string,
  body: string of private,
  headers: record[string of private],
) -> string with io | prelude.throw[status_error | fetch_error] {
  let effective_headers = record.merge(
    left = record.set(target = record.empty(), key = "Content-Type", value = "application/json"),
    right = headers,
  )
  let response = fetch(url = url, method = "POST", headers = effective_headers, body = body)
  if (response.status >= 200 && response.status < 300) {
    response.body
  } else {
    prelude.throw(error = status_error(status = response.status, body = response.body))
  }
}
```

POSTs `body` to `url` as `application/json`. `body` and each header value may be secret (both are
submitted only to the server at `url`). It adds `Content-Type: application/json` by default, but
the caller's own value for the same key wins. Returns the response body text. A one-shot call for
JSON API integration: build the body as `json` in Katari, POST it, and read the response as `json`
in Katari.

```katari
agent respond(prompt: string, api_key: string of private) -> string with io | prelude.throw[http.status_error | http.fetch_error] {
  let body = json.to_text(value = { model = "gpt-5", input = prompt })
  let headers = record.set(target = record.empty(), key = "Authorization", value = "Bearer " ++ api_key)
  http.post_json(url = "https://api.example.com/responses", body = body, headers = headers)
}
```

- **Throws** `status_error` (a non-2xx response), `fetch_error` (the request did not complete).

## Related

<DocCards>
  <DocCard href="{docs}/{currentVersion}/standard-library/json" />
  <DocCard href="{docs}/{currentVersion}/standard-library/webhook" />
  <DocCard href="{docs}/{currentVersion}/language-reference/types" />
</DocCards>
