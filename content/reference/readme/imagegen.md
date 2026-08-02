# imagegen — generate and edit images with the Gemini image model

Generate an image `file` from a text prompt, or hand it an image `file` and an instruction to get an
edited image `file` back. Pure Katari, no FFI sidecar: an edit's input image rides the request body as
a `file` value, which `http.json` base64s at the send boundary, so its bytes never enter the value
plane.

- `imagegen.generate_image(prompt)` — returns a new image `file`.
- `imagegen.edit_image(image, instruction)` — returns a new image `file`.
- `imagegen.provider(source = ..., model ?= "gemini-2.5-flash-image")` — provides the image-model
  capability for the extent of a continuation. Its one request, `imagegen.credential`, answers the
  whole `imagegen.connection(model, api_key)`.

## Failures

- A reply carrying no image — the model refused, or answered in text — throws the typed
  `imagegen.no_image(message)` with whatever it said, so a tool wrapper can hand the text back to the
  model instead of failing the run.
- A failed call throws `http.api_failure`: `http.auth_error` for a 401/403, `http.api_error` for every
  other non-2xx. Both carry `status`, `context` (`"image generation"` / `"image edit"`) and the
  server's own body as `message`.
- A request that never completes throws `http.fetch_error`; a 2xx that is not JSON throws
  `json.parse_error`.

## Secrets / env

`GEMINI_API_KEY` — a Google Generative Language API key (the same one `ai.gemini` uses). Store it with
`katari env set GEMINI_API_KEY --secret` and name it with `credentials.env(key = "GEMINI_API_KEY")`.
It is a `string of private` and rides the `x-goog-api-key` header. The credential resolves per call, so
a rotation lands without a restart.

## Usage

```katari
import imagegen

agent recolor(image: file) -> file with io | prelude.throw[imagegen.no_image | files.gone | files.malformed_base64 | http.api_failure | http.fetch_error | json.parse_error | env.missing_secret | oauth.server_error] {
  use imagegen.provider(source = credentials.env(key = "GEMINI_API_KEY"))
  imagegen.edit_image(image = image, instruction = "make the sky a sunset")
}
```
