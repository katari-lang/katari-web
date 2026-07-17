# tavily — web search as a Katari tool

A single module, `tavily`: web search over the [Tavily](https://tavily.com) API, exposed as a tool
the model can call. Pure Katari — the request body is built as `json`, the POST is the prelude's
`http.post_json`, and the response is parsed as `json`. No FFI sidecar.

- `tavily.search(query)` — the tool: returns the top results as a compact digest (title, URL, and a
  content snippet per hit), small enough to feed straight back to the model.
- `tavily.provider(api_key = ...)` — provides the API key capability for the extent of a
  continuation, so `search` never takes the key as an argument.

## Secrets / env

- `TAVILY_API_KEY` — your Tavily API key. Store it in the runtime:
  `katari env set TAVILY_API_KEY --secret`. It is a `string of private`, riding the search call's
  `Authorization` header and never leaving as anything else.

## Usage

```katari
import tavily

agent search_the_web(query: string) -> string with io {
  use tavily.provider(api_key = env.get_secret(key = "TAVILY_API_KEY"))
  tavily.search(query = query)
}
```

Hand `tavily.search` to an AI loop's tool list to let the model search on its own.
