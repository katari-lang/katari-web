# tavily — web search as a Katari tool

Web search over the [Tavily](https://tavily.com) API. Pure Katari over the prelude's `http.post_json`,
no FFI sidecar.

- `tavily.search(query, max_results ?= 5)` — structured hits: `array[tavily.result]`, one
  `result(title, url, content)` each, for a program to route, filter or rank.
- `tavily.digest(query, max_results ?= 5)` — the same search rendered as one `- title (url)` line with
  its snippet per hit; this is the one you hand a model.
- `tavily.provider(source = ...)` — provides the credential capability for the extent of a
  continuation, so no call takes the key as an argument.

A reply without a `results` array degrades to the empty list.

## Failures

A failed call throws `http.api_failure`: `http.auth_error` for a 401/403, `http.api_error` for every
other non-2xx. Both carry `status`, `context` (`"tavily.search"`) and the server's own body as
`message`, so one `supervise` converter in the app covers this package alongside every other
authenticated REST integration. A request that never completes throws `http.fetch_error`; a 2xx that
is not JSON throws `json.parse_error`.

## Secrets / env

`TAVILY_API_KEY` — store it with `katari env set TAVILY_API_KEY --secret` and name it with
`credentials.env(key = "TAVILY_API_KEY")`. It is a `string of private` and rides the `Authorization`
header. The credential resolves per call, so a rotation lands without a restart.

## Usage

```katari
import tavily

agent search_the_web(query: string) -> string with io | prelude.throw[http.api_failure | http.fetch_error | json.parse_error | env.missing_secret | oauth.server_error] {
  use tavily.provider(source = credentials.env(key = "TAVILY_API_KEY"))
  tavily.digest(query = query)
}
```
