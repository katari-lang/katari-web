# fleet — the desired set behind a durable fiber fleet

A single module, `fleet`: the bookkeeping every resident system re-invents the moment a model can start
a background fiber that must survive a restart. A fleet has **two sets** —

- the **desired set**: one stored spec per fiber, durable, and the answer to *what should be running*;
- the **live set**: the nursery roster, and the answer to *what is running*.

This package owns the desired set — its store geometry, its numbering, its self-repair — and the pure
difference between the two. It owns nothing else. There is no provider, no secret and nothing to
configure: it only performs `prelude.store` operations.

The **spec is yours**. It crosses as `unknown` on the way in and comes back through *your* validator on
the way out, so this package never learns your spec type and cannot constrain it.

## The surface

```text
data row[T](name: string, spec: T)
data sweep_result[T](kept: array[row[T]], dropped: array[string])
data gap(missing: array[string], orphans: array[string])

fleet.register(root, kind, spec) -> string          // mint "<kind>-<n>", persist, return the name
fleet.forget(root, name)         -> null            // the one door OUT of the desired set
fleet.desired(root)              -> array[row[unknown]]   // the raw listing
fleet.sweep[T](root, validate)   -> sweep_result[T]  // validate-or-drop, the boot move
fleet.plan(desired, live)        -> gap              // the pure difference; nothing is acted on
```

Plus two constants and two judgements you rarely call directly: `specs_path()`, `counter_key()`,
`legal_name(name)`, `name_prefix(kind)`.

## Three invariants, none of them a knob

**1. Death does not edit the desired set.** `forget` is the only door out, and it is a *decision* —
someone said "stop this". A fiber that crashed, was cancelled by a supervisor, or simply ended leaves
its spec exactly where it was, so the next boot brings it back. There is deliberately no `on_death`
hook to hang the opposite policy on: a fleet that forgets what it was asked to do because a poll timed
out shrinks silently, and the shrinking is invisible precisely because the store is the only record of
what was ever wanted. A dead fiber with a live spec is an **ordinary state** — show it, do not repair
it.

**2. Boot is validate-or-drop.** `sweep` reads the desired set, runs your total validator over each
stored value, deletes the ones that no longer parse, and hands their names back. A hand-edited cell or
a spec shape changed across a deploy must not be able to fail a boot — the rest of the fleet has
standing orders too — and must not be able to sit in the store forever pretending to be one.

**3. Numbering happens inside a critical section.** `register` mints the next number and writes the spec
in one `store.exclusive` of the shared place's serial domain, because minting is a read-modify-write.
Two approvals granted in the same instant would otherwise mint the same name, and a duplicate name makes
every later handle ambiguous.

## What the store holds

Under the `root` you pass — the app's own constant, not this package's:

| row | holds |
| --- | --- |
| `<root>/specs/<name>` | one row per fiber — the spec exactly as you handed it over |
| `<root>/next_id` | the name counter, read-modify-written inside `register`'s critical section |

The counter sits *beside* the subdirectory rather than in it, so listing the specs never has to skip a
row that is not one. A name is `<kind>-<n>` — kind first, so a name reads as its kind at a glance and
`repo-3` is a handle an operator can say out loud.

## Where the specs live: the shared place, not a workspace

This is the one place `fleet` differs from `memory` and `persona`, and it is not a style choice. Every
access here rides **`store.shared`** and opens your `root` *inside* the task, so the cells land at the
app's `store.share` install site.

The paths that touch a desired set stand in four different places — an approval fiber that just got a
yes, the bridge that serves a stop, the boot reconciler, a fiber forgetting itself after a one-shot —
and **none of them stands in a desk**. A facility that opened a workspace-relative corner would give
each of them a different registry. So:

```katari
import fleet

agent app_root(value: null) -> array[fleet.row[unknown]] with store.get | store.set | store.delete | store.list | prelude.throw[json.validation_error] {
  use store.workspace(path = "tsukasa")   // the app's own workspace, and its serial domain
  use store.share                         // fleet's cells land HERE
  // ... desks, bridges, boot below
  fleet.desired(root = "monitors")
}
```

`root` is the *program's* geometry and reaches `store.scope`, so a malformed one panics there — the
store's own rule, and this package does not soften it. A **name**, by contrast, is routinely a word a
model chose, so `forget` judges it with `store.safe_segment` and ignores anything that is not already a
legal segment. Nothing here builds a store key out of unvalidated text, and nothing here canonicalises
one either: `Repo-1` is refused rather than folded to `repo-1`, because deleting `repo-1` on that
spelling deletes a *different* row than the one that was named.

## What stays in your app

The package holds the side nobody wants to think about twice. Everything that carries a *judgement*
stays with you:

| yours | why |
| --- | --- |
| the spec type (a sum, usually) and its validator | the package crosses it as `unknown` and never learns it |
| the fiber bodies, and the one dispatcher from spec to fiber | forking is supervision, and supervision is the app's tree |
| the nursery, and every `region` call | a package holding your nursery decides your supervision for you |
| which handles may **not** be stopped | infrastructure names are the app's, and the set is often a predicate, not a list |
| rendering a spec, and every word an operator or model reads | the vocabulary is the app's |
| the gate, if starting one needs approval | approval is a conversation, not bookkeeping |
| who hears about a dropped spec | `sweep` returns names; the sentence is yours |

## Effects

| agent | row |
| --- | --- |
| `register` | `store.shared \| prelude.throw[json.validation_error]` |
| `forget` | `store.shared` |
| `desired` | `store.shared \| prelude.throw[json.validation_error]` |
| `sweep` | `store.shared \| prelude.throw[json.validation_error]` |
| `plan` | *(nothing)* |

The `json.validation_error` is the typed-shared-place wrapper's, not a spec check: it fires only if the
row shape this package itself writes fails to read back, which is a defect rather than a condition to
recover from. `sweep`'s `validate` callback is typed with **no** effects at all — a validator that could
throw or reach the network would let a boot stall before the fleet is running.

## Usage

```katari
import fleet

agent registry_root() -> string { "monitors" }

// YOUR spec sum, YOUR validator.
data repo_watch(topic: string, schedule: string)
data reminder(moment: string, note: string)
type monitor_spec = repo_watch | reminder

agent validate_spec(value: unknown) -> monitor_spec | null {
  json.try_validate[monitor_spec](value = value)
}

agent kind_of(spec: monitor_spec) -> string {
  match (spec) {
    case repo_watch(topic => _, schedule => _) -> "repo"
    case reminder(moment => _, note => _) -> "reminder"
  }
}

// YOURS: the three app-owned moves this package deliberately does not hold.
@"The dispatcher from a spec onto your nursery." request fork_from_spec(name: string, spec: monitor_spec) -> string
@"Cancel one live fiber by its handle." request cancel_by_name(name: string) -> string
@"Where an operator hears about a spec dropped on restart." request warn(text: string) -> null

// START: desired FIRST, then live — so a fiber that starts is one the store already wants back.
agent start(spec: monitor_spec) -> string with store.shared | fork_from_spec | prelude.throw[json.validation_error] {
  let name = fleet.register(root = registry_root(), kind = kind_of(spec = spec), spec = spec)
  fork_from_spec(name = name, spec = spec)     // yours: the dispatcher onto your nursery
}

// STOP: cancel, then forget. Cancelling is a fact; forgetting is the decision.
agent stop(name: string) -> string with store.shared | cancel_by_name {
  let note = cancel_by_name(name = name)       // yours
  let _forgotten = fleet.forget(root = registry_root(), name = name)
  note
}

// BOOT: sweep, then fork what survived. No gate is re-opened — a spec is stored precisely BECAUSE it
// was approved when it was first started.
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

And the listing, which is where `plan` earns its place — the live set joined with the desired one, with
the gap shown rather than papered over:

```katari continues
@"Yours: the nursery roster — what IS running." request live_names() -> array[string]

agent listing() -> fleet.gap with store.shared | live_names | prelude.throw[json.validation_error] {
  let stored = fleet.desired(root = registry_root())
  let names = for (let entry in stored) { next entry.name }
  let gap = fleet.plan(desired = names, live = live_names())
  // gap.missing — persisted but not running: say so, and say it revives on the next restart.
  gap
}
```

Read `gap.orphans` **only** when the live list you passed holds this fleet's fibers alone. A nursery
that also carries sources, crons, approval fibers or queued mail lists every one of them as an orphan,
because nothing desires them and nothing here can tell them apart. `gap.missing` is well defined
whatever else is running, since a desired name is this fleet's by construction.
