---
title: Approval gates
description: Ask a human before an action without freezing the run — the approval-as-a-fiber idiom, where one general mechanism serves every gate and each gate's difference is plain data.
---

A resident agent often must ask a human before it acts — post to a public channel, send an email,
launch a task. The hard constraint is timing: **the human takes seconds to minutes, and a serial
handler must not block that long.** A chat desk is one sequential
[handler]({docs}/{currentVersion}/guides/handler-geometry); if a gated tool blocked on the human's
click, that desk would freeze until the operator answered, and every later message would queue behind
one pending button.

The idiom that dissolves this is **approval as a fiber**: the gated tool does not wait. It performs a
request that forks a background fiber to do the asking and the acting, and **returns at once**. The
turn ends, the desk stays live, and the human's decision arrives later — as data — to a callback that
does the action.

## The mechanism, and what it leaves to you

The `approval` package is the general mechanism. It is deliberately small: two declarations.

```katari
@"Ask a human ASYNCHRONOUSLY. The performing turn returns at once with null; the ask happens later,
in a fiber. When the human decides, the fiber runs `on_decide` with the verdict — which owns the whole
branch (approve → act and confirm; deny → post a notice) and does its own side effects, because a
fiber carries no result to hand back."
request approve_async[effect E](
  description: string,
  on_decide: agent (approved: boolean) -> null with E,
) -> null

@"Serve `approve_async` for the extent of the block. Owns its own region: it opens a nursery, forks
one fiber per request and returns immediately, and hands the nursery back so the caller decides where
to `region.watch` it. `ask` is the ask surface AS DATA — render the question however you like and
return the verdict."
agent serve[effect E lacks approve_async, R, effect Eouter lacks approve_async](
  ask: agent (description: string) -> boolean with E,
  continuation: /* ... */,
) -> R with Eouter | region.crashed | io
```

Everything specific to _your_ application is **data you pass in**, never package configuration:

- **The ask surface** is the `ask` closure — how this app asks a human. Discord buttons, a run-root
  [escalation]({docs}/{currentVersion}/concepts/escalation), a CLI prompt: all the same to the
  package, which knows nothing of channels or models. It only calls `ask`, inside the fiber.
- **The decision branch** is the `on_decide` closure — what to do with the boolean. `on_decide`
  receives the verdict and owns the _whole_ branch: on approve, the action and its confirmation; on
  deny, a notice. This is deliberately better than a library-baked `on_grant` / `on_deny` split:
  the package owns only the async-ask-over-a-region mechanism, and the app owns what its actions and
  notices are.

This is the general shape the owner settled on for approval: **one mechanism, and each gate's
difference carried as data** — not a package that grows a parameter per gate.

## Writing a gate

A gate is a tool that builds a `description` and an `on_decide` closure, performs `approve_async`, and
returns a "carry on" note the model reads and moves past. Here is the whole of one:

```katari
@"Tool: publish to the public feed. This crosses into public view, so it is GATED and ASYNC —
request approval and return AT ONCE. On approval it publishes and a confirmation follows; on denial a
note arrives. Do NOT wait or re-request."
agent publish(text: string) -> string {
  let description = f"Publish to the public feed: ${text}"
  @"On the operator's decision: approve → publish and confirm; deny → post a short note."
  agent on_decide(approved: boolean) -> null with gate_ceiling {
    match (approved) {
      case true -> {
        put_public(text = text)
        notify(text = "(approved — published.)")
      }
      case false -> {
        notify(text = f"(declined: ${description})")
      }
    }
  }
  approval.approve_async(description = description, on_decide = on_decide)
  "(requested approval — carry on; it publishes on approval, a note arrives on denial.)"
}
```

`publish` performs `approve_async` and returns immediately; the model gets the pending note and keeps
going. The human is asked later in a fiber, and `on_decide` runs there with the verdict — doing its
**own** side effects (`put_public`, `notify`), because a fiber carries no result back to the turn that
already returned.

**Many gates, one shape.** The reference bot gates nine crossings — every public post, every digest
publish, each outbound email, each worker launch — and every one is this exact shape. What differs
between them is only the two data values: the `description` string the human sees, and the action
inside `on_decide`. There is no per-gate mechanism to write; a new gate is a new closure over new
data.

## Wiring it in

`approval.serve` is a scoped provider: `use` it, bind the nursery it hands back, and `region.watch`
that nursery somewhere below — that watch is the one channel out of the approval fibers, where every
`on_decide` and `ask` escalation surfaces.

```katari
@"The ask surface as DATA: how THIS app asks a human. Here, it escalates a yes/no to the operator."
agent ask_operator(description: string) -> boolean with confirm {
  confirm(description = description)
}

agent main() -> R with Eouter | region.crashed | io {
  let approval_nursery: region.nursery[approval.approval_scope, gate_ceiling] =
    use approval.serve(ask = ask_operator)
  // Install your desks/handlers here — BELOW `serve`, so a gated tool's `approve_async`
  // reaches serve's handler, and its `on_decide` escalations surface at the watch below.
  region.watch(nursery = approval_nursery)
}
```

Position is the one thing to get right, and it follows the
[handler geometry]({docs}/{currentVersion}/guides/handler-geometry) rules: `serve` must sit **above**
the desks whose tools perform `approve_async`, so it wraps the whole session; the desks that handle the
fiber ceiling `E` sit **below** the watch. `serve` owns its region — its fibers live exactly while the
continuation runs and are cancelled when it returns — and its residual stays precise: a caller whose
desks serve the ceiling below the watch pays nothing for them, only its genuine leftovers (store ops, a
fatal proxy) escalate past `serve`. The two-tail generics and the `lacks approve_async` discipline that
make this both infer without type arguments _and_ keep the residual precise are detailed on the
`approval` package's reference page.

## When to reach for it

- A serial handler must trigger a **slow human decision** — a click, an OAuth authorization, any
  human-latency step — without freezing its own queue.
- The outcome is an **action, not a value the caller needs inline**. If the same turn must have the
  answer to continue, this is the wrong shape — you want a synchronous ask, and you must accept the
  block.
- A durable restart may drop the pending decision **harmlessly**. A fork interrupted mid-ask loses
  only that one pending approval (its buttons go stale); the conversation is untouched, and the
  interrupted ask surfaces as a `region.crashed` event, not a session crash. If losing the pending
  decision is unacceptable, persist the ask differently.

Because the gated tool **returns at once** rather than waiting, it needs no exemption from any
tool-call deadline — the human wait lives in the fiber, which no deadline races.

## Where to go next

- [Handler geometry]({docs}/{currentVersion}/guides/handler-geometry) — why `serve` sits outermost and
  the desks sit below the watch.
- [Parallelism]({docs}/{currentVersion}/concepts/parallelism) — regions, fibers, and the `watch` an
  approval fiber reports through.
- [Escalation]({docs}/{currentVersion}/concepts/escalation) — the run-root question an `ask` closure
  can raise when a human, not a channel, is the surface.
- The `approval` package in the [reference](/packages) — the two declarations in full, with the
  two-tail signature and its `lacks` discipline.
