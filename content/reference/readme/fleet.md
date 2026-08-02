# fleet — the desired set behind a durable fiber fleet

A single module, `fleet`, for a system where a model can start a background fiber that must survive a
restart. A fleet has two sets:

- the **desired set** — one stored spec per fiber, durable, and the answer to *what should be running*;
- the **live set** — the nursery roster, and the answer to *what is running*.

This package owns the desired set — its store geometry, its numbering, its self-repair — and the pure
difference between the two. No provider, no secret, nothing to configure: it only performs
`prelude.store` operations. The **spec is yours**, crossing as `unknown` on the way in and coming back
through your own validator on the way out; so are the fiber bodies, the dispatcher from a spec onto
your nursery, every `region` call, and every word an operator or a model reads. No agent here takes a
nursery or forks anything — effects leave through `sweep`'s typed callback or through your own code.

## The surface

```text
data row[T](name: string, spec: T)
data sweep_result[T](kept: array[row[T]], dropped: array[string])
data gap(missing: array[string], orphans: array[string])

fleet.register(root, kind, spec) -> string                // mint "<kind>-<n>", persist, return the name
fleet.forget(root, name)         -> null                  // the one door out of the desired set
fleet.desired(root)              -> array[row[unknown]]   // the raw listing
fleet.sweep[T](root, validate)   -> sweep_result[T]       // validate-or-drop, the boot move
fleet.plan(desired, live)        -> gap                   // the pure difference; nothing is acted on
```

Plus two constants and two judgements: `specs_path()`, `counter_key()`, `legal_name(name)`,
`name_prefix(kind)`.

`sweep`'s `T` is read off the validator's return type, where inference does not reach, so instantiate it
explicitly: `fleet.sweep[monitor_spec](...)`. `plan`'s `orphans` describes this fleet when the live list
you pass holds this fleet's fibers alone; `missing` is well defined whatever else the nursery carries.

## Three properties

**Death does not edit the desired set.** `forget` is the only door out, and it is a decision — someone
said "stop this". A fiber that crashed, was cancelled, or simply ended leaves its spec where it was, so
the next boot brings it back. A dead fiber with a live spec is an ordinary state: show it, do not repair
it.

**Boot is validate-or-drop.** `sweep` reads the desired set, runs your total validator over each stored
value, deletes the ones that no longer parse, and hands their names back. A hand-edited cell or a spec
shape changed across a deploy neither fails the boot nor stays in the store.

**Numbering happens inside a critical section.** `register` mints the next number and writes the spec in
one `store.exclusive` of the shared place's serial domain, because minting is a read-modify-write.

## What the store holds

Under the `root` you pass — the app's own constant, not this package's:

| row | holds |
| --- | --- |
| `<root>/specs/<name>` | one row per fiber — the spec exactly as you handed it over |
| `<root>/next_id` | the name counter, read-modify-written inside `register`'s critical section |

The counter sits *beside* the subdirectory rather than in it, so listing the specs never has to skip a
row that is not one. A name is `<kind>-<n>`, kind first, so `repo-3` is a handle an operator can say
out loud.

## Where the specs live: the shared place

Every access rides **`store.shared`** and opens your `root` *inside* the task, so the cells land at the
app's `store.share` install site. The paths that touch a desired set stand in several places — an
approval fiber, the bridge that serves a stop, the boot reconciler — and none of them in a desk, so one
shared install gives them all one registry:

```text
use store.workspace(path = "tsukasa")   // the app's own workspace, and its serial domain
use store.share                         // fleet's cells land HERE
```

`root` is the *program's* geometry and reaches `store.workspace`, so a malformed one panics there. A
**name** is routinely a word a model chose, so `forget` judges it with `store.safe_segment` and ignores
anything that is not already a legal segment; `Repo-1` is refused rather than folded to `repo-1`, since
deleting `repo-1` on that spelling deletes a different row than the one that was named.

To host several fleets in one project, give each its own `root` (`f"${instance}/monitors"`): the counter
and the specs live under it, and two roots never touch. The desired set outlives every run, and runs of
the same project on the same runtime share it — one live run, and an apply replaces it.

## Effects

`register`, `desired` and `sweep` carry `store.shared | prelude.throw[json.validation_error]`; `forget`
carries `store.shared`; `plan` carries nothing. The `json.validation_error` is the shared place's own
narrowing (`json.validate` over what `store.shared` answers as `unknown`), not a spec check — it fires
only if the row shape this package writes fails to read back. `sweep`'s `validate` callback is typed
with no effects at all, so a boot cannot stall inside it.

## Usage

```katari
import fleet

agent registry_root() -> string { "monitors" }

// Your spec sum, and your validator.
data repo_watch(topic: string, schedule: string)
data reminder(moment: string, note: string)
type monitor_spec = repo_watch | reminder

agent validate_spec(value: unknown) -> monitor_spec | null {
  agent parse() -> monitor_spec with prelude.throw[json.validation_error] {
    json.validate[monitor_spec](value = value)
  }
  match (prelude.catch(task = parse)) {
    case json.validation_error(message => _) -> null
    case parsed -> parsed
  }
}

agent kind_of(spec: monitor_spec) -> string {
  match (spec) {
    case repo_watch(topic => _, schedule => _) -> "repo"
    case reminder(moment => _, note => _) -> "reminder"
  }
}

// The three app-owned moves this package does not hold.
@"The dispatcher from a spec onto your nursery." request fork_from_spec(name: string, spec: monitor_spec) -> string
@"Cancel one live fiber by its handle." request cancel_by_name(name: string) -> string
@"Where an operator hears about a spec dropped on restart." request warn(text: string) -> null

// START: desired first, then live.
agent start(spec: monitor_spec) -> string with store.shared | fork_from_spec | prelude.throw[json.validation_error] {
  let name = fleet.register(root = registry_root(), kind = kind_of(spec = spec), spec = spec)
  fork_from_spec(name = name, spec = spec)     // yours
}

// STOP: cancel, then forget. Cancelling is a fact; forgetting is the decision.
agent stop(name: string) -> string with store.shared | cancel_by_name {
  let note = cancel_by_name(name = name)       // yours
  let _forgotten = fleet.forget(root = registry_root(), name = name)
  note
}

// BOOT: sweep, then fork what survived.
agent rehydrate() -> null with store.shared | fork_from_spec | warn | prelude.throw[json.validation_error] {
  let swept = fleet.sweep[monitor_spec](root = registry_root(), validate = validate_spec)
  let _warned = for (let name in swept.dropped) {
    next warn(text = f"(dropped an unreadable spec '${name}' on restart)")   // yours
  }
  let _forked = for (let kept in swept.kept) {
    next fork_from_spec(name = kept.name, spec = kept.spec)
  }
  null
}
```
