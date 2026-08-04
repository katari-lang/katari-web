---
title: Why Katari
description: Orchestration as a language problem — durable execution as semantics, effects in the signature, and one rule for the question a program cannot answer itself.
---

The obvious shape for a tool that orchestrates AI agents is a visual builder: drag a node, wire it
to the next one, ship a workflow. Katari is a text language instead, and that choice is where the
rest of the design comes from.

## Text is what review and compilers work on

A node graph is good for the first hour, and then it stops fitting how software is written. It does
not diff — moving a box rewrites coordinates. It does not review — there is no unit of change
smaller than "the flow", and no line to comment on. And a model cannot write it: an AI can emit a
syntactically valid graph document, but its meaning lives in the builder's renderer, so nothing
catches a wrong one until it runs.

Everything that makes AI-written code workable is a property of text: `git diff`, code review,
tests, search, blame, a compiler that rejects the plausible-but-wrong. So the orchestration layer —
branching, retries, fan-out, a pause for a human — is source a model writes, a person reviews, and a
compiler checks before anything runs.

## Durable execution is semantics, not an SDK

Effects go through the runtime, the runtime commits them, and recovery replays committed state
rather than re-running your effects. There is no deterministic half of the program to keep apart,
because every step is already on that side of the line:

```katari
@"Post one week's digest. @time@ is the scheduled epoch millisecond."
agent post_digest(time: number) -> null with io { null }

@"Every Monday 09:00 in Tokyo, forever. The next occurrence is persisted, so a restart re-arms it
and an occurrence missed while the runtime was down fires once on recovery."
agent weekly() -> never with io {
  time.watch(
    schedule = time.cron(expression = "0 9 * * 1", timezone = "Asia/Tokyo"),
    deliver_to = post_digest,
  )
}
```

`time.sleep(milliseconds = 7 * 24 * 3600 * 1000)` is a week-long sleep written as a line, not a
scheduled job plus a resume endpoint plus a row recording which stage you were in. `time.now()`
reads the clock through the runtime, so the instant becomes durable with the step that observed it,
and a recovered run agrees with itself about what time it was.

## The topology is the call graph

Delegation is a call. Fan-out is `parallel for`. Routing is `match` over a data type. State is
arguments and return values, each carrying a schema the compiler derived. What a run may do is in
the types: an agent's effect row lists the requests it may perform, and the compiler checks that
someone handles them. Go-to-definition and find-references work, because there is nothing to look
up but functions.

## A request with no handler escalates

That is the rule, and it is about requests in general rather than about approvals. The performing
thread parks, the question becomes a durable row owned by the runtime, and the answer — whenever it
comes — resumes the run exactly where it stopped.

```katari
@"Approval before an irreversible action. This program declares it and never answers it."
request approve(summary: string) -> boolean

@"Deploy, if a human says yes. `with approve` is in the type: this agent may stop and ask."
agent deploy(summary: string) -> string with approve | io {
  if (approve(summary = summary)) {
    time.sleep(milliseconds = 1000) // stand in for the irreversible part
    "deployed"
  } else {
    "cancelled"
  }
}
```

Nothing in `deploy` decides who answers. The caller does, by choosing a handler. With none, the
question escalates: the run parks for minutes or a week, the console lists it with a form derived
from the request's answer schema, and `katari answer <id> --value true` resolves it — restart the
runtime in between and nothing is lost, because the open escalation is the state. A handler over
`discord.ask` turns it into a button an operator clicks. A handler that answers in-process lets CI
deploy without a human, from the same agent:

```katari
@"The same agent, with the question answered in-process — no human, no parking."
agent deploy_in_ci(summary: string) -> string with io {
  use handler {
    request approve(summary: string) { next true }
  }
  deploy(summary = summary)
}
```

A parked run is exactly as durable as any other: waiting on a human and waiting on a cron tick are
the same persisted thread, not a live process holding a socket open. And `with approve` is part of
`deploy`'s type, so every caller either handles the request or carries it up to the run root.

## What the type checker checks

An effect row is a claim about what a piece of code may do, and the compiler holds every caller to
it. Drop `approve` from `deploy`'s row and `katari check` says so, at the perform site:

```text
bot:16:1 K3001: The actual effect performs `bot.approve`, which the expected effect does not allow. Either name that request in the expected `with` row, or serve it here with a `use handler` clause.
  expected: io
  actual:   approve | io
```

The same machinery carries capabilities that are not questions. An MCP connection hands its tools
out stamped with a scope marker that only the `mcp.provide` block discharges, so a tool stashed and
called after the connection closed carries `mcp.scope` into a row that does not admit it, and prints
the same shape of error ([MCP]({docs}/{currentVersion}/guides/mcp)). No runtime guard rejects the
stale call, because the program that would make it does not compile.

## What Katari is not

- **Frozen.** 0.1 is released and usable, but pre-1.0: a minor version may still ship breaking
  changes. Prefer hobby projects over production workloads until 1.0, and pin what you deploy —
  `katari.lock` and the runtime image tag exist for that.
- **For low-latency work.** Every step is persisted before the run proceeds. Serve the
  latency-critical path directly and let Katari orchestrate around it.
- **Embeddable.** A compiler plus a runtime server with a database, not a library you import.
  Integration runs inbound — a [webhook]({docs}/{currentVersion}/guides/webhooks), an MCP tool call,
  the runtime's HTTP API — and existing TypeScript joins as an
  [FFI sidecar]({docs}/{currentVersion}/guides/ffi-sidecars).
- **A large ecosystem.** One editor extension, a [handful of packages](/packages), and a language
  nobody has written before. The docs close that gap for AI-assisted work, but it is a real cost.

## Start here

```sh
npm install -g @katari-lang/cli
katari init hello --dir hello
```

Point your AI assistant at `https://katari-lang.dev/mcp` too: it serves these pages and the whole
package API as tools, so the model reads real signatures instead of guessing.

<DocCards>
  <DocCard href="{docs}/{currentVersion}/getting-started/quickstart" />
  <DocCard href="{docs}/{currentVersion}/getting-started/docs-for-ai-agents" />
  <DocCard href="{docs}/{currentVersion}/concepts/escalation" />
  <DocCard href="{docs}/{currentVersion}/concepts/durable-execution" />
</DocCards>
