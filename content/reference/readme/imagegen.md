# imagegen — generate and edit images with the Gemini image model, as Katari tools

A single module, `imagegen`: generate an image `file` from a text prompt, or hand it an image `file`
and an instruction to get an edited image `file` back. **Pure Katari — no FFI sidecar.** The request is
the prelude's `http.post_json` and the reply's first image part becomes a real `file` through
`files.from_base64`; an edit's input image rides the request body as a `file` value in the
`inlineData.data` slot, which `http.json` base64s only at the send boundary, so its bytes never enter
the value plane.

- `imagegen.generate_image(prompt)` — the tool: e.g. "a watercolor fox", "a minimalist mountain logo".
  Returns a new image `file` the caller can view or post.
- `imagegen.edit_image(image, instruction)` — the tool: e.g. "make the sky a sunset", "remove the
  text". Returns a new image `file`.
- `imagegen.provider(source = ..., model ?= "gemini-2.5-flash-image")` — provides the image-model
  capability for the extent of a continuation. One request, `imagegen.credential`, hands a call the
  whole `imagegen.connection(model, api_key)`: the model id is provider **configuration** held in the
  handler's state, not a capability of its own (0.3.0 — it used to be a second request,
  `imagegen.image_model`, which is gone).

## Failures

- A reply that carries **no image** — the model refused, or answered in text — is the typed
  `imagegen.no_image(message)`, carrying whatever it said. Never a panic, so a tool wrapper can hand
  the text back to the model instead of failing the run.
- A failed call is `http.api_failure`, classified by the stdlib's `http.classify_status` (0.3.0 — this
  package used to carry its own copy of the same two-arm match): **`http.auth_error`** for a 401/403
  (the key is what failed, so a fresh *resolution* is the recovery — the shape a `replay` converter
  composes around) and **`http.api_error`** for every other non-2xx (a rejected prompt, a rate limit,
  an unknown model). Both carry `status`, `context` (`"image generation"` / `"image edit"`) and
  `message` (the server's own body verbatim, the diagnosis a model reads and adjusts to), so a retry
  policy downstream reads a **number** instead of searching a sentence. One converter in the app
  covers this package alongside every other authenticated REST integration it composes.
- A request that never completes is `http.fetch_error`; a 2xx that is not JSON is `json.parse_error`.

**Breaking in 0.3.0**: the `imagegen.image_model` request is gone — drop it from any effect row that
spelled it, and configure the model through `provider(model = ...)` as before. `imagegen.credential`
now answers `imagegen.connection(model, api_key)` rather than a bare `string of private`.
`imagegen.classify_error` is gone — call `http.classify_status(status, context, message)`. The failure
`message` is now the server's body alone; the call name and the status ride on the error's own
`context` / `status` fields rather than being folded into the sentence.

## Secrets / env

- `GEMINI_API_KEY` — a Google Generative Language API key (the image model is served there). Store it
  in the runtime: `katari env set GEMINI_API_KEY --secret`, and name it with
  `credentials.env(key = "GEMINI_API_KEY")`. It is a `string of private`, riding the request's
  `x-goog-api-key` header and never leaving as anything else. (The same key the `ai.gemini` provider
  uses.) The credential resolves per call, so a rotation lands without a restart.

## Usage

```katari
import imagegen

agent recolor(image: file) -> file with io | prelude.throw[imagegen.no_image | files.gone | files.malformed_base64 | http.api_failure | http.fetch_error | json.parse_error | env.missing_secret | oauth.server_error] {
  use imagegen.provider(source = credentials.env(key = "GEMINI_API_KEY"))
  imagegen.edit_image(image = image, instruction = "make the sky a sunset")
}
```

Hand `imagegen.generate_image` and `imagegen.edit_image` to an AI loop's tool list to let the model
make and revise images on its own.
