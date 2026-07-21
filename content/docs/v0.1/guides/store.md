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

A `store` value is a **prefix** — a view of one subtree, and nothing more. `store.root()` is the
whole tree; `store.scope` narrows a view to a sub-path. The value is plain data, not a permission,
so handing an agent a scoped store is composition, not enforcement — it simply cannot name a key
outside its prefix.

```katari
let everything = store.root()                                 // the whole tree
let memos = store.scope(target = everything, path = "memos")  // just the memos/ subtree
```

## Read, write, delete

Four operations resolve their key under a view's prefix. `get` returns a **sum** — `found` with
the value or `absent` with the key — so a stored `null` (`found(null)`) never blurs with a missing
key. `set` writes any Katari value (last write wins); `delete` removes an entry.

```katari
@"Remember a fact so a later run can read it back."
agent remember(fact: string) -> null with store.set {
  store.set(target = store.root(), key = "facts/latest", value = fact)
}

@"Read what an earlier run remembered — `found` carries the value, `absent` the missing key.
Pin an expected shape on the found value with `json.validate[T]`."
agent recall() -> string with store.get {
  match (store.get(target = store.root(), key = "facts/latest")) {
    case store.found(value => saved) -> json.text(target = saved)
    case store.absent(key => _) -> "(nothing remembered yet)"
  }
}
```

## List the tree

`list` shows what sits **directly** under a view's prefix: a `leaf` per value-holding key and a
`branch` per path segment with entries below it — the file-system face of the tree. Descend a
branch with `scope`.

```katari
@"What sits directly under `facts/`: a name per stored key, a `name/` per sub-path."
agent facts() -> array[string] with store.list {
  for (let entry in store.list(target = store.scope(target = store.root(), path = "facts"))) {
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
    request store.get(target: store, key: string) {
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

Don't let a model read the store directly. Scope it down and wrap it in small app tools — the
capability attenuation _is_ the tool design. The model sees `save_memo` / `read_memo`, never the
tree:

```katari
@"Tool: save a short memo the assistant can recall later."
agent save_memo(key: string, text: string) -> string with store.set {
  store.set(target = store.scope(target = store.root(), path = "memos"), key = key, value = text)
  f"saved ${key}"
}

@"Tool: read back a memo saved earlier, or a note that it is missing."
agent read_memo(key: string) -> string with store.get {
  match (store.get(target = store.scope(target = store.root(), path = "memos"), key = key)) {
    case store.found(value => text) -> json.text(target = text)
    case store.absent(key => missing) -> f"(no memo at ${missing})"
  }
}
```

Pass `[save_memo, read_memo]` to `ai.infer_with_tools` and the model can persist and recall notes
across sessions while every write stays inside `memos/`.

## Inject memory every turn

To give a model standing memory — a profile it always sees — wrap the provider seam. `ai.infer_step`
is a request, so an ordinary handler is middleware over it: read the saved note from the store,
prepend it to the step's history, and re-perform `infer_step` so the augmented history reaches the
real provider installed above.

```katari
@"Memory middleware: every `ai.infer_step` in the block first gets the saved note prepended.
Install it UNDER your provider — `use gemini.provider(...)` then `use with_memory(...)` — so the
re-performed step reaches the provider."
agent with_memory[R, effect E](
  notes: store,
  body: agent (value: null) -> R with E | ai.infer_step,
) -> R with E | ai.infer_step | store.get {
  use handler {
    request ai.infer_step(
      history: array[types.message],
      tool_metas: array[reflection.agent_metadata],
    ) {
      let note = match (store.get(target = notes, key = "profile")) {
        case store.found(value => saved) -> json.text(target = saved)
        case store.absent(key => _) -> "(nothing saved yet)"
      }
      next ai.infer_step(
        history = array.concat(
          left = [types.turn(role = "user", text = f"What you remember about the user:\n${note}", files = [])],
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
