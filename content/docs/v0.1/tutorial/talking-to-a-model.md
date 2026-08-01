---
title: Talking to a Model
description: Add the ai package, provide Anthropic with one use line, and hold a conversation over a typed history.
---

Chapter 2 scripted the answer to `ask` with a handler. Swapping that script for an AI model
barely changes the shape, because a model **provider** is a handler too — shipped by a package,
installed with one `use` line.

## Add the `ai` package

```sh
katari add ai
```

Your `katari.toml`'s `[dependencies]` section now reads:

```toml
[dependencies]
registry = "https://raw.githubusercontent.com/katari-lang/katari-registry/main"
snapshot = "staging"
packages = ["ai"]
```

`katari init` pinned the registry and a **snapshot** — a curated set of package versions that
compile together. It scaffolds `staging`, the registry's rolling candidate set; `katari update
<snapshot-id>` moves you to a dated, immutable cut when you want one that cannot change under you.
`katari add` only appends to `packages`: it resolved `ai` inside the pinned snapshot and wrote the
exact sources to `katari.lock`, so builds stay reproducible offline. More in
[Packages]({docs}/{currentVersion}/guides/packages).

What arrived: the provider-agnostic loop (`ai`), its conversation vocabulary (`ai.types`), and
one module per model provider (`ai.anthropic`, `ai.gemini`, `ai.openai`). It is pure Katari with
no FFI sidecar — request bodies built and replies parsed as `json` values — so you can read it
like your own code, in [the reference](/packages/ai).

## Store the key as a secret

```sh
katari env set ANTHROPIC_API_KEY --secret
```

The CLI prompts with echo off and stores the value in the runtime, encrypted at rest and never
in a file in your repository. A secret is write-only over the API: once set, nothing reads it
back out. A program that does read one (`env.get_secret`) gets a `string of private` — a value
the type system lets flow into an API's auth header but never out to a run result.

Your program will not even read this one: it hands the provider the key's _name_, and the
provider resolves the current value at each request, so a rotated key lands without a restart
([Secrets and Credentials]({docs}/{currentVersion}/guides/secrets-and-credentials)).

## One `use` line to a model

Replace `src/bot.ktr`:

```katari
import ai
import ai.types
import ai.anthropic

// Everything the app anticipates going wrong: a provider step failing, a missing secret,
// or a dead stored credential.
type app_error = ai.step_error | env.missing_secret | oauth.server_error

@"One-shot: send a question to the model and return its reply."
agent chat(question: string) -> string with io {
  use handler {
    request prelude.throw(error: app_error) -> never {
      break f"error: ${json.stringify(value = error)}"
    }
  }
  use anthropic.provider(
    source = credentials.env(key = "ANTHROPIC_API_KEY"),
    system = "You are a concise assistant.",
  )
  ai.infer(history = [types.turn(role = types.user_role(), text = question)])
}
```

Reading it top to bottom:

- **Imports go by their last segment**: `import ai.anthropic` is referenced as
  `anthropic.provider`, `import ai.types` as `types.turn`.
- **`use anthropic.provider(...)` is the integration.** The `ai` package's entire seam to a
  concrete model API is one request, `ai.infer_step`; the provider serves it for the rest of the
  block, exactly as your `use handler` served `ask`. `ai.infer` performs one step of it — a
  single reply, no tools.
- **The error handler is a handler too.** A typed error in Katari is the request `prelude.throw`,
  and this clause catches by payload type: `ai.step_error` is what a model step can raise,
  `env.missing_secret` and `oauth.server_error` what resolving the credential source can.
  `break` ends the surrounding block with a value — where `next` answers and continues, `break`
  abandons — so an anticipated failure becomes a readable result rather than a failed run.
- **`with io`** — the network leaves the runtime, and the row says so.

```sh
katari apply
katari run bot.chat --arg '{"question": "In one sentence: what is an effect system?"}'
```

If you skipped setting the secret you get `error: {...}` naming the missing key: your
`prelude.throw` handler at work.

## A conversation is a history

The model is stateless. Each call sees exactly the `history` you pass and nothing else, so a
conversation is a value you build — an `array[types.message]`.

```katari
let opening = [types.turn(role = types.user_role(), text = question)]
let first = ai.infer(history = opening)
let answered = array.append(target = opening, value = types.turn(role = types.model_role(), text = first))
```

`types.turn` records who spoke, what they said, and any attached files (`files` defaults to
none). The role is a closed sum — `types.user_role()` or `types.model_role()` — so no provider's
spelling of "assistant" can leak into your program.

## A typed answer

`ai.infer` returns prose. `ai.infer_structured[T]` returns a value of your own type instead:
`reflection.schema_of[T]` reifies T's schema, the provider decodes against it natively, and the
reply is validated as T.

```katari
type verdict = { approved: boolean, reason: string }
```

The type is the contract — no "reply with JSON" prompting, no hand-parsing. Instantiate `T`
explicitly, since it appears only in the result and nothing infers it from the arguments.

## The whole file

The complete `src/bot.ktr`:

```katari
import ai
import ai.types
import ai.anthropic

// Everything the app anticipates going wrong: a provider step failing, a missing secret,
// or a dead stored credential.
type app_error = ai.step_error | env.missing_secret | oauth.server_error

@"One-shot: send a question to the model and return its reply."
agent chat(question: string) -> string with io {
  use handler {
    request prelude.throw(error: app_error) -> never {
      break f"error: ${json.stringify(value = error)}"
    }
  }
  use anthropic.provider(
    source = credentials.env(key = "ANTHROPIC_API_KEY"),
    system = "You are a concise assistant.",
  )
  ai.infer(history = [types.turn(role = types.user_role(), text = question)])
}

@"Two model calls over one growing history: the model sees the whole conversation each time."
agent interview(question: string, followup: string) -> string with io {
  use handler {
    request prelude.throw(error: app_error) -> never {
      break f"error: ${json.stringify(value = error)}"
    }
  }
  use anthropic.provider(
    source = credentials.env(key = "ANTHROPIC_API_KEY"),
    system = "You are a concise assistant.",
  )
  let opening = [types.turn(role = types.user_role(), text = question)]
  let first = ai.infer(history = opening)
  let answered = array.append(target = opening, value = types.turn(role = types.model_role(), text = first))
  let second = ai.infer(history = array.append(target = answered, value = types.turn(role = types.user_role(), text = followup)))
  f"${first}\n---\n${second}"
}

type verdict = { approved: boolean, reason: string }

@"A typed answer: the model decodes against `verdict`'s schema and the reply validates as one."
agent review(diff: string) -> verdict {
  use anthropic.provider(source = credentials.env(key = "ANTHROPIC_API_KEY"))
  ai.infer_structured[verdict](
    history = [types.turn(role = types.user_role(), text = f"Ship this diff? ${diff}")],
  )
}
```

```sh
katari apply
katari run bot.interview --arg '{"question": "Name a famous lighthouse.", "followup": "How tall is it?"}'
```

The follow-up resolves "it" because the first exchange rides along in the history. In the final
bot this growing array moves inside the `ai` package's own serving handler and becomes a
channel's memory.

## Swapping the model

`anthropic.provider` defaults to the `claude-sonnet-5` model; pass `model = "..."` to override,
and `max_output_tokens` to raise the per-step cap from its default of 4096. Nothing outside the
`use` line knows Anthropic exists, so switching providers is replacing that one line — say with
`use gemini.provider(model = "gemini-3.5-flash", source = credentials.env(key = "GEMINI_API_KEY"))`
after an `import ai.gemini`. Everything the next three chapters build carries over untouched.

## Next

The model can only answer from what it already knows. Chapter 4 hands it your agents.

<DocCards>
  <DocCard href="{docs}/{currentVersion}/tutorial/giving-the-model-tools" />
  <DocCard href="{docs}/{currentVersion}/guides/packages" />
  <DocCard href="{docs}/{currentVersion}/guides/secrets-and-credentials" />
</DocCards>
