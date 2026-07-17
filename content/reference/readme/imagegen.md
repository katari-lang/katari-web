# imagegen — edit images with the Gemini image model, as a Katari tool

A single module, `imagegen`, plus its FFI sidecar `src/imagegen.ts`: hand it an image `file` and an
instruction, get an edited image `file` back. The API call lives in the sidecar because the response
image must become a blob — the sidecar uploads it over the blob side channel and returns the handle,
which lifts into a `file` for the caller.

- `imagegen.edit_image(image, instruction)` — the tool: e.g. "make the sky a sunset", "remove the
  text". Returns a new image `file` the caller can view or post.
- `imagegen.provider(api_key = ..., model? = "gemini-2.5-flash-image")` — provides the image-model
  API key (and model id) for the extent of a continuation.

## Secrets / env

- `GEMINI_API_KEY` — a Google Generative Language API key (the image model is served there). Store it
  in the runtime: `katari env set GEMINI_API_KEY --secret`. It is a `string of private`, passed to
  the sidecar and never surfaced elsewhere. (The same key the `ai.gemini` provider uses.)

## Sidecar dependencies

`src/imagegen.ts` imports `@katari-lang/port` (the image API is called with the built-in `fetch`).
It is declared in `package.json`; run `pnpm install` (or `npm install`) in this package so
`katari apply` can bundle the sidecar. (A pure-Katari consumer that never applies this package does
not need it.)

## Usage

```katari
import imagegen

agent recolor(image: file) -> file with io {
  use imagegen.provider(api_key = env.get_secret(key = "GEMINI_API_KEY"))
  imagegen.edit_image(image = image, instruction = "make the sky a sunset")
}
```

Hand `imagegen.edit_image` to an AI loop's tool list to let the model edit images on its own.
