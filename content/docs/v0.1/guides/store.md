---
title: Store
description: The project's durable key-value tree — state that outlives any single run, browsable in the console, reachable as four requests you can intercept.
---

Katari keeps three kinds of state, and they differ by lifetime. A handler's `var` is state
**within** a run — it vanishes when the run ends. The project **env** is operator-set
configuration **into** a run — you write it from the CLI, a program only reads it. The **store**
is state **between** runs: a durable key-value tree any run can write and any later run can read,
that the operator browses and edits in the console, and that an AI can read a saved note back out
of. It is the project's own memory.

## The store, scoped

**Keys are ambient.** There is no store handle to pass around: an operation names a path-like key
and nothing else, and _where_ that key lands is decided by the **environment** rather than by a
value threaded through the code. `store.scope` is the store's `cd` — installed with `use`, it
prefixes every operation in the rest of the block, and nested scopes accumulate. An operation no
scope catches is project-root access.

```katari
@"Write into `memos/`: the scope prefixes every key for the rest of the block."
agent note(text: string) -> null with store.get | store.set | store.delete | store.list {
  use store.scope(path = "memos")
  store.set(key = "latest", value = text)   // lands at memos/latest
}
```

A scope catches all four operations and re-performs each one outward with the prefix applied, so
installing it puts all four in your row even when the block only writes — the row says what the
_block_ may pass on, not what it happens to use.

An agent dispatched inside a scope lives in that subtree **by construction** — it holds no value it
could widen, and there is deliberately no `..`. A path is `/`-separated segments of lowercase
letters, digits, `-` and `_`; a malformed one **panics** rather than quietly opening a workspace
somewhere else, so a name that came from outside the program goes through `store.safe_segment`
first.

## Read, write, delete

Four operations resolve their key against the surrounding scope. `get` returns a **sum** — `found`
with the value or `absent` with the key — so a stored `null` (`found(null)`) never blurs with a
missing key. `set` writes any Katari value (last write wins); `delete` removes an entry.

```katari
@"Remember a fact so a later run can read it back."
agent remember(fact: string) -> null with store.set {
  store.set(key = "facts/latest", value = fact)
}

@"Read what an earlier run remembered — `found` carries the value, `absent` the missing key.
Pin an expected shape on the found value with `json.validate[T]`."
agent recall() -> string with store.get {
  match (store.get(key = "facts/latest")) {
    case store.found(value => saved) -> json.text(target = saved)
    case store.absent(key => _) -> "(nothing remembered yet)"
  }
}
```

## List the tree

`list` shows what sits **directly** under `path` in the current scope: a `leaf` per value-holding key
and a `branch` per path segment with entries below it — the file-system face of the tree. The default
`path` of `""` lists the scope itself; a deeper path descends. It is the one operation that carries a
prefix as an argument, because a listing has no key to carry it.

```katari
@"What sits directly under `facts/`: a name per stored key, a `name/` per sub-path."
agent facts() -> array[string] with store.list {
  for (let entry in store.list(path = "facts")) {
    next match (entry) {
      case store.leaf(key => key) -> key
      case store.branch(name => name) -> f"${name}/"
    }
  }
}
```

## The four operations are requests

`get`, `set`, `delete`, and `list` are **requests**, part of a run's environment — which is what
makes the store testable. A handler in scope can catch any of them (the same machinery that catches
`prelude.throw`) to intervene: a test stub that answers from an in-memory map, a sandbox that
redirects writes to a scratch subtree.

```katari
@"Test the logic above without touching the real store: a handler answers `get` from a fixture."
agent recall_test() -> string {
  use handler {
    request store.get(key: string) {
      next store.found(value = "seeded fact")
    }
  }
  recall()
}
```

Left unhandled, a store request escalates like any request — but to the run's **outermost**
environment, the runtime itself, which machine-answers it against the project's durable rows. It is
never surfaced as a question to a human operator. The answer is durable, so a re-run during
recovery observes the same value the first attempt did: the store is replay-deterministic.

## Files join the project library

Storing a `file` joins its bytes to the project's **file library**: the stored file becomes a
project file, listed on the console's Files page, that outlives the run that wrote it. Overwriting
or deleting the entry never frees the file — the store only forgets the reference. A file is removed
only by an explicit delete through the file API or the Files page, and a stored reference to a file
that was explicitly deleted reads as `gone`.

## Hand the model a narrowed store

Don't let a model read the store directly. Wrap it in small app tools and install the scope **around
their dispatch** — with ambient keys the attenuation is the install site, not a value the tool holds.
The model sees `save_memo` / `read_memo`, never the tree:

```katari
@"Tool: save a short memo the assistant can recall later."
agent save_memo(key: string, text: string) -> string with store.set {
  store.set(key = key, value = text)
  f"saved ${key}"
}

@"Tool: read back a memo saved earlier, or a note that it is missing."
agent read_memo(key: string) -> string with store.get {
  match (store.get(key = key)) {
    case store.found(value => text) -> json.text(target = text)
    case store.absent(key => missing) -> f"(no memo at ${missing})"
  }
}
```

Pass `[save_memo, read_memo]` to `ai.infer_with_tools` from inside `use store.scope(path = "memos")`
and the model can persist and recall notes across sessions while every key either tool names lands
under `memos/` — a tool dispatched inside a scope is confined by it. The tools carry no prefix, and
that is the point: **where** a toolset's data lives is the calling scope's decision, so the same pair
serves one agent's memos under `core/memos/` and another's under `workers/scribe/memos/` with nothing
changed in the tools.

## Inject memory every turn

To give a model standing memory — a profile it always sees — wrap the provider seam. `ai.infer_step`
is a request, so an ordinary handler is middleware over it: read the saved note from the store,
prepend it to the step's history, and re-perform `infer_step` so the augmented history reaches the
real provider installed above.

```katari
@"Memory middleware: every `ai.infer_step` in the block first gets the saved note prepended.
Install it UNDER your provider — `use gemini.provider(...)` then `use with_memory(...)` — so the
re-performed step reaches the provider. The note is read from the SURROUNDING scope, so which
subtree it comes from is the install site's decision."
agent with_memory[R, effect E](
  body: agent (value: null) -> R with E | ai.infer_step,
) -> R with E | ai.infer_step | store.get {
  use handler {
    request ai.infer_step(
      history: array[types.message],
      tool_metas: array[reflection.agent_metadata],
    ) {
      let note = match (store.get(key = "profile")) {
        case store.found(value => saved) -> json.text(target = saved)
        case store.absent(key => _) -> "(nothing saved yet)"
      }
      next ai.infer_step(
        history = array.concat(
          left = [types.turn(role = types.user_role(), text = f"What you remember about the user:\n${note}", files = [])],
          right = history,
        ),
        tool_metas = tool_metas,
      )
    }
  }
  body(value = null)
}
```

Because the handler re-performs `infer_step` rather than answering it, the request passes through —
the middleware's row still carries `ai.infer_step`, and stacking two `with_memory` blocks injects
two notes. The model never learns it is being fed memory; it just always knows.

## Where to go next

- [Effects and handlers]({docs}/{currentVersion}/concepts/effects-and-handlers) — the request /
  handler machinery the four operations ride on.
- [Secrets and credentials]({docs}/{currentVersion}/guides/secrets-and-credentials) — the env tier,
  and secrets you can also seal at rest in the store.
- The `prelude.store` module in the [reference](/packages/prelude).
