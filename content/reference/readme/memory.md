# memory — persistent memory for resident agents

A single module, `memory`: five tools a model can call — `remember`, `recall`, `forget`,
`list_memories`, `search` — over the runtime's durable store. No FFI sidecar, no API, no secrets, and
**no provider**: the package only ever performs `prelude.store` operations, so it serves nothing and
needs nothing installed for it. Memory survives restarts because the store does.

The shape is **two layers**, and the split is the whole design: a cheap one-line summary per memory,
meant to sit in the model's context every turn, and the full note read back only when it is asked for.

- `memory.remember(key, summary, body)` — save (or overwrite) one note under a short path-like key.
- `memory.recall(key)` — read one note's full body back.
- `memory.forget(key)` — delete a note, summary and body together.
- `memory.list_memories()` — every saved memory as one `- key: summary` line, so the model can see
  what it has without guessing keys.
- `memory.search(pattern)` — scan **keys, summaries and full bodies** for a plain substring and answer
  with the matches (see [Searching bodies](#searching-bodies)).
- `memory.index_note()` — the every-turn injection: the same `- key: summary` lines under a
  `[memory index]` header that names both read paths (`recall(key)` for a note, `search(pattern)` for
  its contents), as a plain string, or `""` when nothing is saved. This one is for the *program*, not
  the model — hand it to whatever per-turn context injection your agent loop uses.

## What the store holds

Two kinds of row, under the facility's own subdirectory:

| row | holds |
| --- | --- |
| `memory/index` | ONE record: every saved key mapped to its one-line summary |
| `memory/entries/<key>` | one row per note — the full body, as the model wrote it |

Keys are **path-like and the model's to choose**: `user/name`, `prefs/timezone`, `notes`. A `/` is an
ordinary segment separator in the store, so `user/name` and `user/timezone` group under `user` — and a
key may itself hold a note while also having notes below it. Nothing here validates or rewrites a key;
re-using one overwrites the note that was there.

The index exists so that "what do I know?" is **one** store read instead of one per note. It is
therefore a read-modify-write, which is what makes the writes serialize (below).

## Where memory lands: the calling workspace decides

Every tool opens one fixed subdirectory scope — `use store.scope(path = "memory")` — around its own
store operations. That path is this package's only constant; **where that subdirectory lands is the
caller's decision**, made by the workspace the tools are called inside:

```katari
import memory

agent core_memory_index() -> string with store.get | store.set | store.delete | store.list {
  use store.workspace(path = "core")   // core's memory lives at core/memory/index, core/memory/entries/...
  memory.index_note()
}
```

Hand the same five tools to another desk under its own workspace and its memory lives in its own
corner, with nothing shared and nothing configured. Two agents share a memory exactly when they run
under the same workspace, and not otherwise — there is no name to collide on and no path to escape
through.

## The per-turn index, and what it costs

`index_note()` is the reason the two-layer split exists, and the thing to understand before adopting
this package: it renders **one line per saved memory — the key and its summary — and that text goes
into the prompt on every turn**, for every agent holding it.

The bound is **per line, not per index**, and that asymmetry is the whole decision:

- **Each line is bounded.** A summary is folded to one line and cut at 120 code points with an explicit
  `…(summary cut)`, so one model writing a paragraph where a line was wanted cannot inflate every turn.
  A cut line costs about 150 characters, key and marker included. The cut is display only — the stored
  summary is untouched.
- **The number of lines is not.** Nothing prunes the index or caps how many memories are listed. A
  project that saves memories forever pays for all of them on every turn, and the injection is rebuilt
  from a fresh store read each time it is called.

The second half is a documented limitation rather than an oversight, and `search` does not repair it: **a
model will not search for something it does not know exists.** A line that is not shown is a memory the
model has no reason to suspect, so no `+N more` marker recovers it — a count cap would trade
expensive-but-complete awareness for cheap-and-silently-incomplete awareness, which is the one trade this
package will not make quietly. Bounding a *line* hides no memory, which is exactly why that half is
capped and this half is not.

What keeps it affordable:

- **Summaries are identifiers, not abstracts** — which `remember`'s own tool doc now says, and the line
  cap enforces. A summary's job is to let the model recognize that a note exists and is the one it
  wants. It does not have to reproduce the note —
  `search` reads bodies, so a fact that lives only in a body is still findable. Before `search` existed
  the only way to make a body's content reachable was to hoist it into the summary, which is exactly
  the pressure that made the injection expensive.
- **`forget` is part of the loop.** Stale facts cost the same per turn as live ones. A resident agent
  that never prunes is paying rent on everything it ever wrote.
- **The injection is skipped when empty.** `index_note()` answers `""` with nothing saved, so an agent
  with no memories pays nothing.

Cost per call, for the record: `index_note()` and `list_memories()` are one store read each; `recall`
is one; `remember` and `forget` are one read plus two writes inside one critical section; `search` is
one listing per key group plus **one read per stored note** — it is a full scan, deliberately (see
below).

## Searching bodies

`search(pattern)` is one mechanism — scan and match — with the pattern supplied as data. There is no
query language, no ranking, no relevance score, no side index, and no model in the loop; the caller is
already a model.

- `pattern` is **plain text**, matched as a **substring**, **case-insensitively** on both sides
  (`docker` finds `Docker`). It is not a regular expression and not a glob.
- The haystack is the **key, the summary and the full body** of every saved note.
- Each match answers with its `- key: summary` line plus a one-line excerpt of the body **around the
  first occurrence**. A note that matched on its key or summary alone shows its opening instead.
- Matches arrive in stored key order (shallow keys first), **not** by relevance — nothing ranks.
- Nothing is written. A search never changes a memory, and it throws nothing — a missing or malformed
  note degrades to a partial answer rather than to a failure.

The answer is bounded, and every bound announces itself rather than truncating quietly — a model that
cannot tell it got a partial answer will answer as if it were complete:

| bound | value | what the model is told at the edge |
| --- | --- | --- |
| matches per search | 8 | a closing line: `(showing 8 of N matches — narrow the pattern to see the rest.)` |
| excerpt per match | 240 code points | the excerpt ends `…(excerpt cut — recall this key for the full note)` |
| lead before the occurrence | 60 code points | a window that does not start at the body's first point opens with `…` |
| summary per index line | 120 code points | the line ends `…(summary cut)` — see the section above |
| **number** of index lines | **none** | nothing, deliberately — see the section above |

The *scan* is complete even though the *answer* is capped: the count in that closing line has to be the
real number of matches, and a scan that stopped at the cap could not know it.

`search` enumerates the store's **listing** under `entries/` rather than the index's key set, which
matters twice: a note whose index row was somehow lost is still findable, and a malformed index degrades
to *missing summaries* rather than to an empty result — the one failure a searching model could not
detect.

## Writes serialize; reads are total

**Writes.** `remember` and `forget` each ride ONE `store.exclusive` critical section, because the index
is a read-modify-write and a turn's tool calls dispatch in parallel: two racing `remember`s would
otherwise lose one summary. The serial domain is the **caller's** — install it once per dispatch
(`store.workspace`, or a bare `store.serialize`) and every mutation lands in that FIFO. With none
installed, the runtime serves `exclusive` as the project-wide root domain, which is still correct, just
wider than it needs to be.

**Reads.** Every read in this package degrades instead of throwing, because an injection that runs every
turn must not be able to fail the run:

- a missing or malformed `index` reads as *no memories* (and search still finds every body);
- a note whose index row is missing keeps its match, with `(no summary)` in place of the summary;
- a body that is not a string (an operator edited it in the console, say) renders as its JSON;
- an empty or whitespace-only body says so in a search result instead of showing a blank excerpt;
- `recall` on an unknown key answers with a note saying so, not an error.

None of these are error channels the caller has to handle: `search`, `recall`, `list_memories` and
`index_note` throw nothing.

## Usage

```katari
import memory

@"Stands in for your own agent loop — this package knows nothing about it."
request your_model_loop(context: string, tools: array[agent never -> unknown with store.exclusive | store.get | store.set | store.delete | store.list], text: string) -> string

@"One turn of a resident desk: the memory index goes into the prompt, the memory tools go to the model."
agent take_turn(text: string) -> string with store.get | store.set | store.delete | store.list | your_model_loop {
  // The workspace decides WHERE this desk's memory lives, and serves the writes' serial domain.
  use store.workspace(path = "core")
  let context = memory.index_note()   // "" when nothing is saved, so an empty injection costs nothing
  your_model_loop(
    context = context,
    tools = [
      memory.remember, memory.recall, memory.forget, memory.list_memories, memory.search,
    ],
    text = text,
  )
}
```

Hand all five tools together, or hand a subset deliberately: a desk given `search` and `recall` but not
`remember` can read the project's memory without writing to it, and one given no memory tools at all
cannot see that memory exists.
