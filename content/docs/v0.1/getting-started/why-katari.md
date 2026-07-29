---
title: Why Katari
description: Why agent orchestration is a language problem — and how one rule about unhandled requests replaces a workflow engine, a graph SDK, and a bolted-on approval service.
---

The obvious shape for a tool that orchestrates AI agents is a visual builder: drag a node,
wire it to the next one, ship a workflow. Katari is a text language instead, and the reason
for that choice is the reason the whole language exists.

## Graphs do not diff

A visual builder is genuinely good for the first hour, and the artifact it produces is a node
graph. A node graph does not survive contact with how software is actually written:

- **It does not diff.** Moving a box rewrites coordinates. Two people editing the same flow
  produce a merge conflict no reviewer can read, in a file no reviewer was meant to read.
- **It does not review.** There is no unit of change smaller than "the flow", and no line to
  leave a comment on.
- **A model cannot write it.** An AI can emit a syntactically valid graph document, but the
  meaning of that document lives in the builder's renderer and runtime — whether a branch is
  reachable, whether a variable is in scope at a node, whether a tool's arguments fit — so
  nothing catches a wrong one until it runs, if then.

Everything that makes AI-generated code workable is a property of **text**: `git diff`, code
review, tests, search, blame, a compiler that rejects the plausible-but-wrong. Being a text
language is not the conservative choice here; it is the AI-first one. So the orchestration
layer — branching, retries, fan-out, a pause for a human — is source that a model writes, a
person reviews, and a compiler checks before anything runs.

## One mechanism, three products

Teams building agent systems usually assemble three separate things: a durable workflow
engine, an agent orchestration framework, and something homemade for human approvals. In
Katari all three fall out of two language rules — **an agent is a function**, and **an effect
is a request whose meaning the caller chooses**.

### Durable execution, as semantics instead of an SDK

Durable execution engines buy one property: a program that outlives the process running it.
The usual price is shape. Your code splits into workflow and activity halves, the workflow
half must be deterministic, and replay-safety is a discipline you maintain by hand — no
wall-clock reads, no unversioned edits to running code.

Katari puts the property in the language. Effects go through the runtime, the runtime commits
them, and recovery replays committed state rather than re-running your effects. There is no
workflow/activity split to design around, because every step is already on that side of the
line:

```katari
@"Post one week's digest. @time@ is the scheduled epoch millisecond."
agent post_digest(time: number) -> null with io {
  null
}

@"Every Monday 09:00 in Tokyo, forever. The next occurrence is persisted, so a restart
re-arms it and an occurrence missed while the runtime was down fires once on recovery."
agent weekly() -> never with io {
  time.watch(
    schedule = time.cron(expression = "0 9 * * 1", timezone = "Asia/Tokyo"),
    deliver_to = post_digest,
  )
}
```

`time.sleep(milliseconds = 7 * 24 * 3600 * 1000)` is a week-long sleep written as a line, not
a scheduled job plus a resume endpoint plus a row somewhere recording which stage you were in.
`time.now()` reads the clock through the runtime, so the instant becomes durable with the step
that observed it and a recovered run agrees with itself about what time it was. See
[Durable execution]({docs}/{currentVersion}/concepts/durable-execution).

### Agent orchestration, as functions instead of a graph API

Graph-building frameworks model an agent system as a value you assemble at startup: nodes,
edges, conditional routing, a shared state object every node reads and writes. It is an
expressive shape, and it moves your program's structure out of the language — into a data
structure the type checker sees as a graph of callbacks, with routing errors that appear on
the unlucky input and state whose shape is whatever the last node put there.

In Katari the topology **is** the call graph. Delegation is a call. Fan-out is `parallel for`.
Routing is `match` over a data type. State is arguments and return values, each with a schema
the compiler derived. The thing a graph API needs a graph for — knowing what a run may do
before it does it — is in the types instead: an agent's effect row lists the requests it may
perform, and the compiler checks that someone handles them. Go-to-definition and find-references
work, because there is nothing to look up but functions.

### Human approval, as the default meaning of an unanswered question

This is the one every stack adds late. Approval usually arrives as a feature bolted onto an
execution model with no room for it: a special node type, a wait-for-signal API you must
remember to make idempotent, a callback URL, a hand-rolled table of pending decisions, and a
UI to work it. It is a feature because "the program stops here, possibly for three days, and a
person decides" is not something the underlying model can say.

Katari can already say it, and spends no feature on it. The rule is one line, and it is a rule
about requests in general, not about approvals: **a request with no handler in scope
escalates.** The performing thread parks, the question becomes a durable row owned by the
runtime, and the answer — whenever it comes — resumes the run exactly where it stopped.

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

Nothing in `deploy` decides **who** answers. The caller does, and it decides by choosing a
handler:

- **No handler.** The question escalates. The run parks — for minutes or a week — and the
  admin console lists it in an inbox with a form derived from the request's answer schema
  (here, a boolean). `katari ls escalations` shows it, `katari answer <id> --value true`
  resolves it. Restart the runtime in between and nothing is lost: the open escalation is the
  state.
- **A handler that asks a chat platform.** The operator answers with a Discord or Slack button;
  the run resumes when they click.
- **A handler that answers immediately.** CI deploys without a human, from the same agent:

```katari
@"The same agent, with the question answered in-process — no human, no parking."
agent deploy_in_ci(summary: string) -> string with io {
  use handler {
    request approve(summary: string) { next true }
  }
  deploy(summary = summary)
}
```

Three things follow, and they are the reason this is worth a language rather than a library.

**A parked run is exactly as durable as any other.** Waiting on a human and waiting on a cron
tick are the same mechanism — a persisted thread, not a live process holding a socket open. A
run can be blocked on a question through a deploy, a restart, and a long weekend.

**You cannot forget the human.** `with approve` is part of `deploy`'s type. Every caller either
handles the request or carries it in its own row, all the way to the run root. Approval is not
a code path an unlucky branch can skip; it is in the signature, and the compiler propagates it
for you.

**Test and production differ by a handler, not by a fork.** The agent under test and the agent
in production are the same source. This symmetry is what makes requests the right boundary for
human-in-the-loop logic at all — see
[Escalation]({docs}/{currentVersion}/concepts/escalation) and
[Approval gates]({docs}/{currentVersion}/guides/approval-gates).

## What the type checker actually checks

Effect rows are not documentation. Here are two claims in one program: this agent may ask a
human, and the tools it uses belong to an open connection.

```katari
@"Write through one of a connected server's tools, but only after a human signs off.
The row carries both facts: `approve` — this may stop and ask a person — and `mcp.scope`,
the marker every tool of an open connection is stamped with."
agent apply_change(tools: mcp.toolbox[mcp.scope], summary: string) -> string with approve | mcp.scope | io | prelude.throw[mcp.server_error | mcp.auth_error | reflection.call_error] {
  if (approve(summary = summary)) {
    match (record.get(target = tools, key = "create_page")) {
      case null -> "no such tool"
      case tool -> json.stringify(value = reflection.call_agent(target = tool, args = { title = summary }))
    }
  } else {
    "declined"
  }
}

@"The connection is the block: `provide` mints the scope for its body and discharges it
from its own row, so `main` carries no trace of it."
agent main(url: string, summary: string) -> string with approve | io | prelude.throw[mcp.server_error | mcp.auth_error | reflection.call_error] {
  let tools : mcp.toolbox[mcp.scope] = use mcp.provide[mcp.scope](url = url, auth = mcp.headers(values = record.empty()))
  apply_change(tools = tools, summary = summary)
}
```

Drop `approve` from `apply_change`'s row and `katari check` fails: the body performs a request
the signature does not admit. Take a tool out of the connection — stash it, return it, call it
after the block ended — and it fails the same way, because the scope marker rides the tool's
type and only `provide` discharges it:

```text
K3001: Left effect performs a request not present in the right effect: prelude.mcp.scope
  expected: throw[auth_error | server_error | call_error] | io
  actual:   throw[auth_error | server_error | call_error] | scope | io
```

No runtime guard rejects the stale tool call, because the program that would make it does not
compile. Both checks are the same machinery — an effect row is a claim about what a piece of
code may do, and the compiler holds every caller to it.

## What Katari is not

- **It is not production-ready.** v0.1.0 is pre-1.0 and breaking changes land between
  releases. It is a good fit for hobby projects, internal tools, and experiments where you are
  willing to be told "this changed". `v1.0.0` is the stability line; until then, do not put
  something you cannot afford to migrate on it.
- **It is not for low-latency work.** Every step is persisted before the run proceeds. That is
  the whole point when a run must survive a restart, and it is pure overhead when the budget is
  a few milliseconds. Serve your latency-critical path directly and let Katari orchestrate
  around it.
- **It is not embeddable in an existing service.** Katari is a compiler plus a runtime server
  with a database, not a library you import into a TypeScript app. Integration runs inbound —
  a [webhook]({docs}/{currentVersion}/guides/webhooks), an MCP tool call, the runtime's HTTP
  API — and TypeScript you already have joins as an
  [FFI sidecar]({docs}/{currentVersion}/guides/ffi-sidecars) a Katari program calls. If what
  you want is a few durable steps inside an app you already run, a library in that app's
  language will fit better.
- **Its ecosystem is small.** One editor extension, a
  [handful of packages](/packages), and a language nobody has written before. The docs are
  built to close that gap for AI-assisted work — see below — but it is a real cost, and worth
  counting.

## Start here

```sh
npm install -g @katari-lang/cli
katari init hello --dir hello
```

[Quickstart]({docs}/{currentVersion}/getting-started/quickstart) takes it from there: a local
runtime, a first run, and an escalation you answer yourself.

If you write Katari with an AI assistant, point it at the documentation MCP server first — it
serves the docs and the whole package API as tools, so the model reads the real signatures
instead of guessing at a language it has never seen:

```sh
claude mcp add --transport http katari-docs https://katari-lang.dev/mcp
```

[Docs for AI agents]({docs}/{currentVersion}/getting-started/docs-for-ai-agents) has the
configuration for other clients, and what each tool returns.
