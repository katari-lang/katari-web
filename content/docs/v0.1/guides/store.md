---
title: Store
description: The project's durable key-value tree — state that outlives any single run, browsable in the console, reachable as requests you can intercept.
---

Katari keeps three kinds of state, differing by lifetime. A handler's `var` is state within a run;
the project env is operator-set configuration into a run, written from the CLI and only read by a
program; the store is state between runs — what one run writes, any later run reads.

## Workspaces

Keys are ambient: an operation names a path-like key and nothing else, and where that key lands is
the environment's decision rather than a handle's. `store.workspace` installs both halves of a
working directory for the rest of the block — the prefix every key resolves against, and the serial
domain critical sections queue in.

```katari
@"Write into `memos/`: the workspace prefixes every key for the rest of the block."
agent note(text: string) -> null with store.get | store.set | store.delete | store.list {
  use store.workspace(path = "memos")
  store.set(key = "latest", value = text)      // lands at memos/latest
}
```

Workspaces nest and their prefixes accumulate; an operation no workspace catches is project-root
access. A workspace descends only, and there is no `..`, so an agent dispatched inside one lives in
that subtree by construction. A path is `/`-separated segments of lowercase letters, digits, `-` and
`_`; a malformed one panics rather than opening a workspace elsewhere, so a name from outside the
program goes through `store.safe_segment` first. The install has five clauses: four that re-perform
each operation outward with the prefix applied, and one that serves `exclusive` as this workspace's
serial domain. That is why a workspace puts all four operations in your row even when the block only
writes.

## Read, write, delete

`get` answers a sum — `found` with the value, `absent` with the key — so a stored `null`
(`found(null)`) never blurs with a missing entry. `set` writes any Katari value, last write wins;
`delete` removes one. `absent` carries the key as the environment resolved it, the full project-root
path with every workspace prefix applied, which is the form to log rather than to hand back to a
caller that only knows its own relative key.

```katari
@"Remember a fact so a later run can read it back."
agent remember(fact: string) -> null with store.set {
  store.set(key = "facts/latest", value = fact)
}

@"Read what an earlier run remembered — `found` carries the value, `absent` the key."
agent recall() -> string with store.get {
  match (store.get(key = "facts/latest")) {
    case store.found(value => saved) -> json.text(target = saved)
    case store.absent(key => _) -> "(nothing remembered yet)"
  }
}

@"How many notes have been published; a missing cell and a wrong-shaped one both read as 0."
agent published() -> integer with store.get {
  store.get_or(key = "counters/published", fallback = 0)
}
```

`store.get_or[T]` is the typed read; `T` is taken off the fallback, so it is normally inferred
rather than written. Degrading is the semantics — a durable cell whose shape no longer fits was
written by an earlier version of the program, and a value the reader understands is the recovery.

## List the tree

`list` shows what sits directly under `path` in the current workspace: a `leaf` per value-holding
key and a `branch` per segment with entries below it. The default `""` lists the workspace itself.
It is the one operation carrying a path as an argument, a listing having no key to carry the prefix.

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

## Critical sections

`store.exclusive` runs its task as a critical section of the nearest enclosing workspace: that
workspace's sequential handler calls the task in its own body, so two sections of one domain run one
at a time and a read-modify-write is atomic, including against a turn's `parallel` tool batch. An
inner workspace shadows an outer one, and the task runs inside the prefix of the workspace serving
it. With no workspace above the perform, the runtime serves it at the project root, as one durable
project-wide FIFO across every run — which is the case the example below lands in.

```katari
@"Publish a note and bump the counter as one critical section of the nearest workspace, so the
read-modify-write cannot interleave with another section of the same workspace."
agent publish(key: string, body: string) -> integer with store.exclusive | prelude.throw[json.validation_error] {
  agent section(value: null) -> unknown with store.get | store.set {
    let already = store.get_or(key = "counters/published", fallback = 0)
    store.set(key = f"notes/${key}", value = body)
    store.set(key = "counters/published", value = already + 1)
    already + 1
  }
  json.validate[integer](value = store.exclusive(task = section))
}
```

The task's row is fixed to the store operations, so a section never blocks on a model or a network:
compute everything else before entering and close over it, and narrow the `unknown` it answers with.
One lane per workspace, so a section excludes the other sections of its own workspace and
interleaves with every other lane's.

## A shared place

Data several workspaces share travels as a `store.shared` request served above them. `use
store.share` opens the shared place where it is installed, exactly as a workspace is its own place,
and runs each task there — under that site's workspaces, over its serial domain — so a caller's own
workspace does not travel with the task.

```katari
@"Read one line of the shared roster. `shared` runs its task at the `share`'s install site, so
this answers the same wherever it is performed from."
agent roster_line(name: string) -> string with store.shared {
  agent section(value: null) -> unknown with store.get {
    store.get_or(key = f"roster/${name}", fallback = "(unknown)")
  }
  json.text(target = store.shared(task = section))
}

@"The install order: the app's workspace, then the shared place, then one workspace per AI."
agent serve() -> string {
  use store.workspace(path = "app")
  use store.share
  let root = use ai.route[app_effects]()
  let _scribe = ai.spawn[app_effects](name = "scribe", max_steps = 8, tools = [save_memo, read_memo, roster_line], persona = persona, workspace = "scribe")
  region.watch(nursery = root)
}
```

A task lands in the shared place and opens whichever subdirectory it wants as its first move, which
is what lets one `share` serve every shared cell instead of one named request per cell. It binds to
the nearest enclosing `share`, so an inner shared place shadows an outer one — and unlike the four
operations and `exclusive`, it is not runtime-served, so with no `share` above it a `shared` rides to
the run root as an unanswered request and the effect row is the guard.

## Hand the model a narrowed store

Wrap the store in small app tools and install the workspace around their dispatch — with ambient
keys the attenuation is the install site, not a value the tool holds. The model sees `save_memo` and
`read_memo`, never the tree:

```katari
@"Tool: save a short memo you can recall later."
agent save_memo(@"A short path-like key." key: string, @"The memo." text: string) -> string with store.set {
  store.set(key = key, value = text)
  f"saved ${key}"
}

@"Tool: read back a memo saved earlier, or a note that it is missing."
agent read_memo(@"The key to read." key: string) -> string with store.get {
  match (store.get(key = key)) {
    case store.found(value => text) -> json.text(target = text)
    case store.absent(key => _) -> "(no memo saved under that key)"
  }
}
```

`ai.spawn(..., workspace = "scribe")` runs a whole AI inside one workspace, so every key its tools
touch is confined to that subtree. The tools carry no prefix, and that is the point: the same pair
serves one AI's memos under `app/scribe/` and another's under `app/editor/`, unchanged. `read_memo`
drops the `absent` key for the same reason: that key is the resolved project-root path, so passing it
into the reply would show the model the layout the workspace resolves for it.

## The operations are requests

`get`, `set`, `delete`, `list`, `exclusive` and `shared` are requests, part of a run's environment.
A handler in scope catches any of them the same way it catches `prelude.throw`, which is what makes
the store testable: a stub answering `get` from a fixture, a sandbox redirecting writes to a scratch
subtree.

Left unhandled, the four operations escalate to the run's outermost environment, the runtime, which
machine-answers them against the project's durable rows at the project root rather than putting them
to a human. The answer is durable, so a re-run during recovery observes the value the first attempt
did. `exclusive` is runtime-served too, as the outermost serial domain.

`shared` is the one the runtime does not serve. With no `share` installed above it, a `shared` rides
to the run root as an ordinary unanswered request and waits there for an operator, so the effect row
carrying `store.shared` out of your signature is what tells you a shared place is still missing.

Storing a `file` joins its bytes to the project's file library, so it outlives the run that wrote it
and appears on the console's Files page. Overwriting or deleting the entry forgets the reference and
leaves the file; only an explicit delete through the file API removes it.

## Where to go next

<DocCards>
  <DocCard href="{docs}/{currentVersion}/guides/residents" />
  <DocCard href="{docs}/{currentVersion}/guides/handler-geometry" />
  <DocCard href="{docs}/{currentVersion}/guides/secrets-and-credentials" />
</DocCards>
