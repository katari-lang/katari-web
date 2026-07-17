---
title: finally
description: The statement that arms a finalizer guaranteed to run when an instance ends, on normal completion and on cancellation, but not on panic.
---

A long-lived agent instance can have cleanup that must run at the very end regardless of whether
it terminates normally or is canceled (releasing an acquired resource, notifying an external
system that it is no longer in use, and so on). `finally` is a dedicated **statement** equivalent
to Go's `defer`, and expresses that cleanup without gaps.

## Syntax and meaning

`finally { <block> }` is a statement, and returns no value. Evaluating it pushes the block onto
the current instance's **finalizer stack** (arming). The body takes no parameters, and reads the
enclosing scope through the normal parent chain.

```katari title="finalizers.ktr"
@"Capability used for cleanup, provided and discharged inside the finalizer that uses it."
request cleanup() -> null

agent run() -> string {
  finally { let _note = "bookkeeping done" }
  finally {
    use handler {
      request cleanup() -> null { next null }
    }
    let _released = cleanup()
  }
  "work complete"
}
```

## Firing order and timing

An armed finalizer runs in **the reverse order of arming**, immediately before the instance acks
its own terminal. Passing through the same `finally` twice (as in a loop body) arms it twice; this
is stack discipline.

| Situation                                                         | Does the finalizer run?                                        |
| ----------------------------------------------------------------- | -------------------------------------------------------------- |
| Normal completion (immediately before the delegate ack)           | Runs                                                           |
| Cancellation arrives (immediately before the cancel ack)          | Runs                                                           |
| Panic (abnormal instance termination)                             | Does not run                                                   |
| Suspended waiting on a handler (cancellation has not yet arrived) | Does not run (it runs only once cancellation actually arrives) |

Both the normal-completion ack and the cancellation ack drain the same finalizer stack, one step
before the terminal is finalized. Panic breaks the precondition for cleanup, that the scope is
sound, so finalizers are deliberately not run.

## The io-only rule (K3021)

A finalizer body's **residual effect row must stay within `io`**. A finalizer can run while the
parent is already waiting on this instance's cancellation. `io` flows to a sibling reactor without
passing through the parent, but a request (an escalation) is proxied through the parent, so an
escalation from a finalizer could deadlock against that wait. To prevent this, requests remaining
in the residual are forbidden at compile time (K3021).

- A request **handled locally** in the body by a `use handler` does not appear in the residual, so
  it is fine (`cleanup` in the example above is this case).
- Control escapes (`return` / `break` / `next`) also have nowhere to go at termination, so they
  trigger K3021 if they remain in the residual.
- The check imposes `⊆ io` only on the **residual row** that the existing inference already
  computes.

Because the effects a correct finalizer can perform are limited to `io`, that is also the only
thing it contributes to the enclosing effect row (an agent whose `finally` body performs io
carries `io` on its row).

## Atomicity and panic

- A turn during which a finalizer is executing is not interrupted even if a cancellation arrives,
  and folds into a single atomic commit (riding on the existing turn batching). A cancellation
  that arrives is held until after execution completes, and the eventual ack is translated
  accordingly; a finalizer is never run twice.
- If a finalizer itself panics, it is treated as a panic of the instance (a failure in cleanup is
  not swallowed).
- Known trade-off: if a finalizer hangs on `io` (an external call), that finalizer cannot be
  interrupted, and the instance's terminal waits for that io to complete. Long-running external
  work belongs in the ordinary body, not in a finalizer.

## Related

<DocCards>
  <DocCard href="{docs}/{currentVersion}/language-reference/providers" />
  <DocCard href="{docs}/{currentVersion}/language-reference/effects" />
</DocCards>
