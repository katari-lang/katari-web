# web — fetch a web page as a Katari tool

A single module, `web`: an HTTP GET exposed as a tool the model can call. Pure Katari over the
prelude's `http.fetch`. No FFI sidecar, and no capability to provide — it reads public pages, so there
is no key and nothing to `use`.

- `web.fetch_page(url)` — the tool: fetches the page and returns its body text, truncated to roughly
  a page so several fetches in one turn do not blow the context window. A non-2xx status comes back
  as text (the model can react); only a request that never completes throws (`http.fetch_error`).

## Secrets / env

None.

## Usage

```katari
import web

agent read(url: string) -> string with io {
  web.fetch_page(url = url)
}
```

Hand `web.fetch_page` to an AI loop's tool list to let the model read pages on its own.
