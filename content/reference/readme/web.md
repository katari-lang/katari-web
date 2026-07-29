# web — fetch a web page as a Katari tool

A single module, `web`: an HTTP GET exposed as a tool the model can call. Pure Katari over the
prelude's `http.fetch`. No FFI sidecar, and no capability to provide — it reads public pages, so there
is no key and nothing to `use`.

- `web.fetch_page(url, max_characters ?= 16000)` — the tool: fetches the page and returns its body
  text, truncated to `max_characters` code points (the default keeps roughly a page, so several
  fetches in one turn do not blow the context window).
- `web.truncate(text, max_characters ?= 16000)` — the truncation on its own, with an explicit marker
  when anything was cut: how much is shown, how much there was, and that the rest is missing.

## Failures

A non-2xx status **throws** `http.api_failure` (0.2.0), classified by the stdlib's
`http.classify_status`: `http.auth_error` for a 401/403, `http.api_error` for everything else, both
carrying the `status`, the `context` (`"web.fetch_page <url>"`) and the server's own body as
`message`. A request that never completes throws `http.fetch_error`.

It used to come back as the text `(fetch failed with status N)`, which made this tool **succeed on
every 404**: an AI loop shows the model the text either way, but the app's `tool_events` recorded a
`tool_succeeded` for a page nobody read. Absorbing a tool's throw is the loop's job — it hands the
model the error *and* reports `tool_failed` — so throwing is what keeps both readings true. A caller
outside a loop catches `http.api_failure` (the same converter every other REST integration needs).

The truncation marker changed with it: `(...truncated)` said nothing about how much was lost, so a
model could not tell how big a fragment it held. It now reads
`[… TRUNCATED: the first X of Y characters of this page are shown; …]`, the same shape
`ai.file_text_note` and `memory`'s excerpts use.

## Secrets / env

None.

## Usage

```katari
import web

agent read(url: string) -> string with io | prelude.throw[http.api_failure | http.fetch_error] {
  web.fetch_page(url = url)
}
```

Hand `web.fetch_page` to an AI loop's tool list to let the model read pages on its own.
