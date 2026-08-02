# web — fetch a web page as a Katari tool

An HTTP GET exposed as a tool the model can call. Pure Katari over the prelude's `http.fetch`: no FFI
sidecar, and no capability to provide, since it reads public pages.

- `web.fetch_page(url, max_characters ?= 16000)` — fetches the page and returns its body text, cut to
  `max_characters` code points. The budget covers the whole answer, truncation marker included, and a
  cut page says how long the real page was.

That is the entire surface.

## Failures

A non-2xx status throws `http.api_failure` — `http.auth_error` for a 401/403, `http.api_error` for
everything else — carrying `status`, `context` (`"web.fetch_page <url>"`) and the server's own body as
`message`. A request that never completes throws `http.fetch_error`. A failure is a throw rather than a returned
string, so an AI loop hands the model the error and records `tool_failed`.

## Secrets / env

None.

## Usage

```katari
import web

agent read(url: string) -> string with io | prelude.throw[http.api_failure | http.fetch_error] {
  web.fetch_page(url = url)
}
```
