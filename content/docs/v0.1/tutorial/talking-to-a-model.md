---
title: Talking to a Model
description: Add the ai package, provide Anthropic with one use line, and hold a conversation over a typed history.
---

In chapter 2 you scripted the answer to `ask` with a handler. This chapter swaps the
script for an AI model — and the shape barely changes, because a model **provider** is
exactly what you just learned: a handler, shipped by a package, installed with one `use`
line.

## Add the `ai` package

```sh
katari add ai
```

Your `katari.toml`'s `[dependencies]` section now reads:

```toml
[dependencies]
registry = "https://raw.githubusercontent.com/katari-lang/katari-registry/main"
snapshot = "snapshot-2026-07-17-c47a6e67"
packages = ["ai"]
```

`katari init` pinned the registry and a **snapshot** — an immutable, curated set of
package versions guaranteed to compile together. `katari add` resolved `ai` inside that
snapshot and wrote the exact sources to `katari.lock`, so builds stay reproducible
offline. (More in [Packages]({docs}/{currentVersion}/guides/packages).)

What arrived: the provider-agnostic tool-calling loop (`ai`), its conversation vocabulary
(`ai.types`), and one module per model provider (`ai.anthropic`, `ai.gemini`,
`ai.openai`). The whole package is plain Katari over `http.post_json` — you can read it
like your own code, in [the reference](/reference/ai).

## Store the key as a secret

```sh
katari env set ANTHROPIC_API_KEY --secret
```

The CLI prompts for the value with echo off and stores it **in the runtime**, encrypted
at rest — not in a file in your repository. Programs read it with `env.get_secret`, and
what they get back is a `string of private`: a value the type system lets flow into an
API's auth header but never out into a run result or any other user-facing boundary. A
secret's value is also write-only over the API — once set, nothing reads it back out.
(More in
[Secrets and Credentials]({docs}/{currentVersion}/guides/secrets-and-credentials).)

## One `use` line to a model

Replace `src/bot.ktr`:

```katari
import ai
import ai.types
import ai.anthropic

// Everything the app anticipates going wrong: a provider step failing, or a missing secret.
type app_error = ai.step_error | env.missing_secret

@"One-shot: send a question to the model and return its reply."
agent chat(question: string) -> string with io {
  use handler {
    request prelude.throw(error: app_error) -> never {
      break f"error: ${json.to_text(value = error)}"
    }
  }
  use anthropic.provider(
    api_key = env.get_secret(key = "ANTHROPIC_API_KEY"),
    system = "You are a concise assistant.",
  )
  ai.reply(history = [types.turn(role = "user", text = question, files = [])])
}
```

Reading it top to bottom:

- **Imports go by their last segment**: `import ai.anthropic` is referenced as
  `anthropic.provider`, `import ai.types` as `types.turn`.
- **`use anthropic.provider(...)` is the integration.** The `ai` package's entire seam to
  a concrete model API is one request, `ai.infer_step`; the provider serves it for the
  rest of the block, exactly as your `use handler` served `ask`. `ai.reply` performs one
  step of it — a single model reply, no tools.
- **The error handler is a handler too.** A typed error in Katari is the request
  `prelude.throw`, and this clause catches by payload type: `app_error` joins what the
  provider can raise (`ai.step_error`: malformed provider JSON, a non-2xx status, a
  transport failure) with what `env.get_secret` can (`env.missing_secret`). `break` ends
  the surrounding block with a value — where `next` answers and continues, `break`
  abandons — so any anticipated failure becomes a readable string result instead of a
  failed run.
- **`with io`** — the network leaves the runtime, and the row says so.

```sh
katari apply
katari run bot.chat --arg '{"question": "In one sentence: what is an effect system?"}'
```

The reply comes back as the run's result. If you skipped setting the secret, you get
`error: {...}` naming the missing key — your `prelude.throw` handler at work.

## A conversation is a history

The model is stateless: each call sees exactly the `history` you pass and nothing else.
A conversation is therefore a value you build — an `array[types.message]`, where
`types.turn` records who spoke (`"user"` / `"model"`), what they said, and any attached
files. The complete `src/bot.ktr`:

```katari
import ai
import ai.types
import ai.anthropic

// Everything the app anticipates going wrong: a provider step failing, or a missing secret.
type app_error = ai.step_error | env.missing_secret

@"One-shot: send a question to the model and return its reply."
agent chat(question: string) -> string with io {
  use handler {
    request prelude.throw(error: app_error) -> never {
      break f"error: ${json.to_text(value = error)}"
    }
  }
  use anthropic.provider(
    api_key = env.get_secret(key = "ANTHROPIC_API_KEY"),
    system = "You are a concise assistant.",
  )
  ai.reply(history = [types.turn(role = "user", text = question, files = [])])
}

@"Two model calls over one growing history: the model sees the whole conversation each time."
agent interview(question: string, followup: string) -> string with io {
  use handler {
    request prelude.throw(error: app_error) -> never {
      break f"error: ${json.to_text(value = error)}"
    }
  }
  use anthropic.provider(
    api_key = env.get_secret(key = "ANTHROPIC_API_KEY"),
    system = "You are a concise assistant.",
  )
  let opening = [types.turn(role = "user", text = question, files = [])]
  let first = ai.reply(history = opening)
  let with_reply = array.append(target = opening, value = types.turn(role = "model", text = first, files = []))
  let second = ai.reply(history = array.append(target = with_reply, value = types.turn(role = "user", text = followup, files = [])))
  f"${first}\n---\n${second}"
}
```

```sh
katari apply
katari run bot.interview --arg '{"question": "Name a famous lighthouse.", "followup": "How tall is it?"}'
```

The follow-up answer resolves "it" because the first exchange rides along in the history.
Hold that thought: in the final bot, this growing array moves into a handler `var` — the
chapter 2 `roll_call` pattern — and becomes a channel's memory.

## Swapping the model

`anthropic.provider` defaults to the `claude-sonnet-5` model (pass `model = "..."` to
override, and `max_tokens` to raise the per-step output cap from its default of 4096).
Nothing outside the `use` line knows Anthropic exists, so switching providers is
replacing that one line — for example with
`use gemini.provider(model = "gemini-3.5-flash", api_key = env.get_secret(key = "GEMINI_API_KEY"))`
after an `import ai.gemini`. The loop, the history, and everything you build in the next
two chapters carry over untouched.

## Where you are

Your program talks to a model, with the key held as a secret and every anticipated
failure landing as a typed, catchable value. But the model can only answer from what it
already knows. Next, you hand it your agents —
[Giving the Model Tools]({docs}/{currentVersion}/tutorial/giving-the-model-tools).
