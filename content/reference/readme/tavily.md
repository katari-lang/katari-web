# tavily — web search as a Katari tool

A single module, `tavily`: web search over the [Tavily](https://tavily.com) API, exposed as a tool
the model can call. Pure Katari — the request body is built as a plain value tree, the POST is the
prelude's `http.post_json`, and the response is read with the `json` readers. No FFI sidecar.

- `tavily.search(query, max_results ?= 5)` — the **structured** search: `array[tavily.result]`, one
  `result(title, url, content)` per hit, so the program can route the urls, filter, and rank.
- `tavily.render(results)` — the model-facing digest of a hit list: one `- title (url)` line with its
  snippet per hit, or a short note for the empty list.
- `tavily.digest(query, max_results ?= 5)` — the **tool**: `render` over `search`, the one-call string
  shape an app hands a model.
- `tavily.provider(source = ...)` — provides the credential capability for the extent of a
  continuation, so no call takes the key as an argument.

A reply without the promised `results` array degrades to the empty list — the API never contractually
promised the shape.

## Failures

A failed call is `http.api_failure`, classified by the stdlib's `http.classify_status` (0.3.0 — this
package used to carry its own copy of the same two-arm match): **`http.auth_error`** for a 401/403
(the key is what failed, so a fresh *resolution* is the recovery — the shape a `replay` converter
composes around) and **`http.api_error`** for every other non-2xx (a rejected query, a rate limit, an
exhausted balance). Both carry `status`, `context` (`"tavily.search"`) and `message` (the server's own
body verbatim), so a retry policy downstream reads a **number** instead of searching a sentence. One
converter in the app covers this package alongside every other authenticated REST integration it
composes. A request that never completes is `http.fetch_error`; a 2xx that is not JSON is
`json.parse_error`.

**Breaking in 0.3.0**: `tavily.classify_error` is gone — call `http.classify_status(status, context,
message)`. The failure `message` is now the server's body alone; the call name and the status ride on
the error's own `context` / `status` fields rather than being folded into the sentence. `tavily.post`
takes a `context` argument.

## Secrets / env

- `TAVILY_API_KEY` — your Tavily API key. Store it in the runtime:
  `katari env set TAVILY_API_KEY --secret`, and name it with
  `credentials.env(key = "TAVILY_API_KEY")`. It is a `string of private`, riding the search call's
  `Authorization` header and never leaving as anything else. The credential resolves per call, so a
  rotation lands without a restart.

## Usage

```katari
import tavily

agent search_the_web(query: string) -> string with io | prelude.throw[http.api_failure | http.fetch_error | json.parse_error | env.missing_secret | oauth.server_error] {
  use tavily.provider(source = credentials.env(key = "TAVILY_API_KEY"))
  tavily.digest(query = query)
}
```

Hand `tavily.digest` to an AI loop's tool list to let the model search on its own; reach for
`tavily.search` when the program itself wants the hits as values.
