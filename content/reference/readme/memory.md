# memory — persistent memory for resident agents

A single module, `memory`: five tools a model can call — `remember`, `recall`, `forget`,
`list_memories`, `search` — over the runtime's durable store. No FFI sidecar, no API, no secrets and
**no provider**: the package only performs `prelude.store` operations, so nothing has to be installed
for it. Memory survives restarts because the store does.

The shape is **two layers**: a cheap one-line summary per memory, meant to sit in the model's context
every turn, and the full note read back only when it is asked for.

- `memory.remember(key, summary, body)` — save (or overwrite) one note under a short path-like key.
- `memory.recall(key)` — read one note's full body back.
- `memory.forget(key)` — delete a note, summary and body together, answering `forgot(message)` or
  `was_absent(message)`; the two are a sum, so a caller with a person behind it can say which happened.
- `memory.list_memories()` — every saved memory as one `- key: summary` line.
- `memory.search(pattern)` — scan **keys, summaries and full bodies** for a plain substring.
- `memory.index_note()` — the every-turn injection: the same lines under a `[memory index]` header, or
  `""` when nothing is saved. This one is for the *program* — hand it to your per-turn context
  injection, not to the model.

## What the store holds

| row | holds |
| --- | --- |
| `memory/index` | one record: every saved key mapped to its one-line summary |
| `memory/entries/<key>` | one row per note — the full body, as the model wrote it |

Keys are path-like and the model's to choose (`user/name`, `prefs/timezone`, `notes`). A `/` is an
ordinary segment separator, so `user/name` and `user/timezone` group under `user`, and a key may itself
hold a note while also having notes below it. Nothing validates or rewrites a key; re-using one
overwrites the note that was there.

## Where memory lands: the calling workspace decides

Every tool opens one fixed subdirectory — `use store.workspace(path = "memory")` — around its own store
operations. That path is this package's only constant; **where it lands is the caller's decision**:

```katari
import memory

agent core_memory_index() -> string with store.get | store.set | store.delete | store.list {
  use store.workspace(path = "core")   // core's memory lives at core/memory/index, core/memory/entries/...
  memory.index_note()
}
```

Two agents share a memory exactly when they run under the same workspace, and not otherwise.

## The per-turn index

`index_note()` renders one line per saved memory, and that text goes into the prompt on every turn. The
bound is **per line, not per index**:

- A summary is folded to one line and fitted to 120 code points with an explicit `…(summary cut)`. The
  120 covers the whole line, marker included; the cut is display only.
- The number of lines is not bounded. Nothing prunes the index, and a project that saves memories
  forever pays for all of them every turn.

Bounding a line hides no memory, which is why that half is capped: a line that is not shown is a memory
the model has no reason to suspect, and `search` cannot reach what nothing suggests exists. What keeps
the injection affordable is writing summaries as identifiers rather than abstracts, and treating
`forget` as part of the loop — stale facts cost the same per turn as live ones.

## Searching bodies

`search(pattern)` is one mechanism — scan and match — with the pattern supplied as data. No query
language, no ranking, no side index. `pattern` is plain text, matched as a **substring**,
**case-insensitively**, against the key, the summary and the full body of every saved note. Each match
answers with its `- key: summary` line plus a one-line excerpt around the first occurrence (a note that
matched on its key or summary alone shows its opening instead), matches arrive in stored key order
rather than by relevance, and nothing is written.

Every bound announces itself at the edge, so a partial answer reads as one:

| bound | value | what the model is told at the edge |
| --- | --- | --- |
| matches per search | 8 | `(showing 8 of N matches — narrow the pattern to see the rest.)` |
| excerpt per match | 240 code points | the excerpt ends `…(excerpt cut — recall this key for the full note)` |
| lead before the occurrence | 60 code points | a window not starting at the body's first point opens with `…` |
| summary per index line | 120 code points | the line ends `…(summary cut)` |
| **number** of index lines | **none** | nothing, deliberately |

The *scan* is complete even though the *answer* is capped, and it enumerates the store's listing under
`entries/` rather than the index's key set — so a note whose index row was lost is still findable.

## Writes serialize; reads are total

`remember` and `forget` each ride ONE `store.exclusive` critical section, because the index is a
read-modify-write and a turn's tool calls dispatch in parallel. The serial domain is the **caller's**:
`store.workspace` opens the prefix and the FIFO in one install, and with none installed the runtime
serves `exclusive` as the project-wide root domain. `forget`'s verdict is read inside that same section,
so its answer describes the state the delete acted on.

Every read degrades instead of throwing, so an injection that runs every turn cannot fail the run: a
missing or malformed `index` reads as *no memories*, a note whose index row is missing keeps its match
with `(no summary)`, a body that is not a string renders as its JSON, and `recall` on an unknown key
answers with a note saying so. `search`, `recall`, `list_memories` and `index_note` throw nothing.

`forget` alone carries `prelude.throw[json.validation_error]`, because its verdict crosses
`store.exclusive` and is narrowed back with `json.validate`; it fires only on a defect in this package.
Handing `forget` to a model as a tool costs nothing, since a tool set's row already bounds throws.

## Secrets / env

None.

## Usage

```katari
import memory

@"Stands in for your own agent loop — this package knows nothing about it."
request your_model_loop(context: string, tools: array[agent never -> unknown with store.exclusive | store.get | store.set | store.delete | store.list | prelude.throw[unknown]], text: string) -> string

@"One turn of a resident desk: the memory index goes into the prompt, the memory tools go to the model."
agent take_turn(text: string) -> string with store.get | store.set | store.delete | store.list | your_model_loop {
  use store.workspace(path = "core")
  let context = memory.index_note()
  your_model_loop(
    context = context,
    tools = [
      memory.remember, memory.recall, memory.forget, memory.list_memories, memory.search,
    ],
    text = text,
  )
}
```

Hand all five tools together, or a subset deliberately: a desk given `search` and `recall` but not
`remember` reads the project's memory without writing to it.
