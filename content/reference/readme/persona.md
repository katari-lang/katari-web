# persona — a layered, capped, evolving character

A single module, `persona`: the machinery every character or assistant agent otherwise hand-rolls. A
persona here is an **ordered set of layers**, and this package does two things with them — assemble one
role's per-turn injection note, and rewrite one layer under a hard character cap.

The **data is yours**. Every layer (its name, header label, cap, seed, hard lines, and which roles see
it) is a value you supply, and so is the role set. The package is a general machine over that data and
knows nothing about your app. There is no provider and nothing to configure: it serves nothing, it only
performs.

## The layer

```katari
import persona

agent soul_seed() -> string { "You are Kiri, a research assistant." }
agent never_lie() -> string { "You never claim to be human." }

agent soul() -> persona.layer {
  persona.layer(
    name = "soul",              // the store key, and what `refine` targets
    label = "soul",             // the `[label]` header this section wears
    cap = 2400,                 // the HARD character ceiling `refine` enforces
    seed = soul_seed(),         // the in-code body, shown until a refinement is stored
    roles = ["core", "herald"], // which roles SEE this layer
    hard_lines = never_lie(),   // an uneditable prefix, above the refinable body (optional)
  )
}
```

One ordered list of these drives every role's note. A layer a role does not see is skipped, so adding a
role costs a `roles` entry, not a second list.

## The two mechanisms

- `persona.assemble(layers, role)` — concatenate, in order, the layers this role sees: each renders as
  a `[label]` header, then its hard lines when it has any, then its **live** body (the stored
  refinement once one exists, the in-code seed until then). A role that sees nothing assembles to the
  empty string.

  Assembly reads the store **fresh**, which buys two properties worth relying on: a refinement is live
  on the very next turn, and a conversation compaction can never eat the persona — it is not in the
  conversation, it is re-injected.

- `persona.refine(layers, name, text)` — overwrite one layer's body, **rejected when the text exceeds
  that layer's cap**. The rejection comes back carrying the cap and the overshoot, so a model
  compresses instead of accumulating.

  The cap is a *mechanism*, not advice. It is what lets a character evolve indefinitely without growing
  monotonically: every rewrite must fit the same ceiling, so new material has to earn its place against
  the old. An unknown layer name answers with a corrective note listing the layers — never a crash,
  since the name is model-supplied.

- `persona.find_layer(layers, name)` / `persona.layer_names(layers)` — the lookup and the name list,
  exposed because the caller usually needs them for its own decisions (for example: whether a rewrite
  of this layer would reach a public-facing role, and therefore whether it deserves an approval step).

### Cap and hard lines are opposite guarantees

The cap bounds a layer's **growth**. The hard lines bound its **erasure**: they are never stored and
never touched by `refine`, and they ride above the refinable body at every assembly. So a model can
retune a layer it owns and still cannot sand off the line you fixed in code. A layer with both can be
rewritten freely and remains itself.

## Where the layers live

`persona` is a **facility** in the store's sense — a workspace-relative toolset. Every read and write
opens the one fixed subdirectory `persona/` around its own store operations, and **where that
subdirectory lands is the calling workspace's decision**:

- Dispatch a role's turn under `use store.scope(path = "core")` and its persona lives at
  `core/persona/...`, private to that desk.
- Or serve `assemble` / `refine` from a proxy installed **above** several desks, opening a shared
  subtree in its own body — and every desk assembles from the one shared persona. The sharing geometry
  is yours, expressed as a named request the desks cannot capture.

The package hard-codes the subdirectory *name*, never the full location.

Reads are **total**: a missing layer degrades to its seed, and a malformed stored value renders as its
JSON rather than throwing inside an every-turn injection. A refine is a whole-key overwrite —
last-write-wins, no read-modify-write — so it needs no critical section of its own.

## Secrets / env

None.

## Usage

```katari
import persona

agent identity_seed() -> string {
  "You are Kiri, a research assistant. Concise, concrete, never flattering."
}

agent house_rules_seed() -> string {
  "Answer the question that was asked. Say when you do not know."
}

agent all_layers() -> array[persona.layer] {
  [
    persona.layer(
      name = "identity",
      label = "identity",
      cap = 600,
      seed = identity_seed(),
      hard_lines = "You never claim to be human.",
      roles = ["assistant", "public"],
    ),
    persona.layer(name = "rules", label = "house rules", cap = 1200, seed = house_rules_seed(), roles = ["assistant"]),
  ]
}

@"The persona note to inject into this role's turn."
agent note_for(role: string) -> string {
  persona.assemble(layers = all_layers(), role = role)
}

@"Tool: rewrite one layer of your own persona. Over the cap, it is rejected — compress and retry."
agent refine_self(name: string, text: string) -> string {
  persona.refine(layers = all_layers(), name = name, text = text)
}
```

Inject `note_for(role)` at the top of the role's turn, and hand `refine_self` to the model's tool list
to let a character tune itself within the ceilings you set. The `"public"` role above sees `identity`
and not `rules` — one list, two audiences.

One thing to expect from the effect row: both of those escalate **all four** store requests —
`store.get`, `store.set`, `store.delete`, `store.list` — including the read-only `assemble`. That is
not the persona operation asking for write access; it is `store.scope`, which handles the whole store
request set and so re-emits the whole set upward. Whatever serves the scope decides what the writes
actually reach.
