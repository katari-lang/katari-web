---
title: FFI sidecars
description: Implement external agents in TypeScript with @katari-lang/port, move files across the boundary, and ship the sidecar in a package.
---

When an integration needs a real client library — a gateway socket, a sandbox SDK — you declare
an `external agent` in Katari and implement it in a TypeScript **sidecar**: a file with the same
basename, bundled by `katari apply` and run by the runtime as a long-lived subprocess. The
typed boundary stays in Katari; the TypeScript is as small as the client library demands.

## Declare and implement

The Katari half — in a project named `sensors`, so `src/sensors.ktr` is the package's own
module — an `external agent` has a signature but no body:

```katari
@"Read one sensor's current value; implemented in `sensors.ts` beside this file."
external agent read_sensor(id: string) -> number

agent main(id: string) -> string {
  f"sensor ${id} reads ${string.to_string(value = read_sensor(id = id))}"
}
```

The TypeScript half, in `src/sensors.ts` — handlers register with
[`@katari-lang/port`](/packages) under the file's module path, so `katari.agent("read_sensor",
...)` implements exactly the `sensors.read_sensor` the compiler lowered:

```typescript
import { katari } from "@katari-lang/port";

katari.agent<{ id: string }>("read_sensor", async ({ id }) => {
  const response = await fetch(`https://sensors.internal/api/${id}`);
  const body = (await response.json()) as { millivolts: number };
  return body.millivolts;
});
```

The handler's argument is the agent's declared input record; the return value is encoded against
the declared output. The call site was already type-checked in Katari, so the sidecar assumes its
argument shape — the boundary contract lives in one place, the `.ktr` signature.

## Move files across the boundary

`file` values cross in both directions; the bytes ride a blob side channel, never the argument
JSON:

```katari
@"Render recent readings as a PNG; the bytes ride the blob side channel back as a `file`."
external agent render_chart(series: array[number]) -> file

@"The sidecar downloads the file's bytes and measures them."
external agent byte_length(content: file) -> integer
```

```typescript
import { katari, type KatariFile } from "@katari-lang/port";

katari.agent<{ series: number[] }>("render_chart", async ({ series }, context) =>
  context.file(renderPng(series), { contentType: "image/png" }),
);

katari.agent<{ content: KatariFile }>(
  "byte_length",
  async ({ content }) => (await content.bytes()).length,
);
```

`context.file` uploads bytes (or UTF-8 text) and returns a `KatariFile` you can return or pass
onward; an incoming `file` argument arrives as a `KatariFile` whose `bytes()` / `contentType()`
download on demand. The `discord` package uses both directions at once: incoming message
attachments download from Discord's CDN and lift into `file` values, and outgoing `file` values
attach to posts.

## Raise a typed error

Declare the throw on the external agent's row, and raise it with `katari.throw` carrying a
`KatariData` value — the Katari side catches it like any typed error:

```katari
@"The typed error `parse_reading` raises for malformed text."
data bad_reading(message: string)

@"Parse a reading; the sidecar raises `throw[bad_reading]` on malformed text."
external agent parse_reading(text: string) -> number with prelude.throw[bad_reading]

@"Fall back to zero on a malformed reading."
agent parse_or_zero(text: string) -> number {
  use handler {
    request prelude.throw(error: bad_reading) -> never { break 0 }
  }
  parse_reading(text = text)
}
```

```typescript
import { katari, KatariData } from "@katari-lang/port";

katari.agent<{ text: string }>("parse_reading", ({ text }) => {
  const value = Number.parseFloat(text);
  if (Number.isNaN(value)) {
    katari.throw(new KatariData("sensors.bad_reading", { message: `not a number: ${text}` }));
  }
  return value;
});
```

An ordinary exception (a rejected promise, a `throw new Error(...)`) is not typed: it fails the
call as a **panic**, which escalates like any defect. Reserve `katari.throw` for the failures the
signature anticipates, and let genuine bugs panic.

**An anticipated failure returns as a result value, not as a raise.** A sidecar's own failure — the SDK
refused, the socket dropped, the sandbox is gone — belongs in the handler's **return value** (`{ ok, ... }`,
read on the Katari side), which is why no `e2b` sidecar function throws. Two reasons, one per channel. A
raw exception is a panic, and a panic is not something a Katari handler can answer at all — it would tear
the whole run down for a failure the caller was ready to absorb. And even a typed `katari.throw` is only
catchable where it surfaces: if the external agent is called from a handler body, the throw is raised at
that handler's install site, above whoever performed the request, so the performer could not have caught it
either. This is the outcome-as-value convention in
[Handler geometry]({docs}/{currentVersion}/guides/handler-geometry#answer-with-the-failure), at the
boundary — and it draws the line in the same place: what heals comes back as a value, what will never heal
raises.

## Call back into Katari

A handler can delegate back through the runtime mid-call — so the sidecar stays a thin adapter
and the logic stays typed:

```katari
@"Convert a raw reading; the sidecar calls this agent back through the runtime."
agent celsius_of(millivolts: number) -> number {
  (millivolts - 500) / 10
}

@"Read a sensor and convert it, with the conversion running in Katari."
external agent read_celsius(id: string) -> number
```

```typescript
katari.agent<{ id: string }>("read_celsius", async ({ id }, context) => {
  const millivolts = await context.call<number>("sensors.read_sensor", { id }, { reactor: "ffi" });
  return context.call<number>("sensors.celsius_of", { millivolts });
});
```

`context.call` reaches a Katari agent by qualified name (the default), or another FFI handler by
key with `reactor: "ffi"`. A callee that runs and then fails does not reject the promise — its
failure unwinds up the delegation to Katari-side handlers, so you catch a callee's error in
Katari, not in TypeScript.

## Serve a long-lived stream

An external agent can take an agent **argument** and deliver into it repeatedly — the shape of
`discord.watch_messages`, and the FFI twin of `time.watch`:

```katari
@"Deliver each upstream event into Katari as it arrives; the sidecar owns the socket. Shaped like
`time.watch`: it never resolves on its own, and @deliver_to@'s effects flow to the caller's handlers."
external agent watch_events[effect E](
  channel: string,
  deliver_to: agent (payload: string) -> null with E,
) -> never with E

@"React to one event."
agent on_event(payload: string) -> null with io | prelude.throw[http.fetch_error] {
  let _response = http.fetch(
    url = "https://api.example.com/ingest",
    method = "POST",
    headers = record.empty(),
    body = http.text(content = payload),
  )
  null
}

agent main() -> never with io | prelude.throw[http.fetch_error] {
  watch_events(channel = "alerts", deliver_to = on_event)
}
```

```typescript
import { katari, type KatariAgent } from "@katari-lang/port";

katari.agent<{ channel: string; deliver_to: KatariAgent }>(
  "watch_events",
  ({ channel, deliver_to }, context) =>
    new Promise<never>((_resolve, reject) => {
      const socket = connectTo(channel);
      socket.onEvent((payload: string) => {
        deliver_to.call({ payload }).catch((error: unknown) => {
          socket.close();
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      });
      // The runtime cancelled the call (run cancel / teardown): stop listening and settle.
      context.signal.addEventListener("abort", () => {
        socket.close();
        reject(new Error("watch cancelled"));
      });
    }),
);
```

The handler's promise never resolves; each event becomes an inner delegation whose effects flow
to the caller's handlers. Observe `context.signal` so a cancelled run tears the socket down. A
delivery failure rejects the promise and the watch dies; so does a runtime restart, under
at-most-once. Recovery is to **call again** — see [What may cross the
boundary](#what-may-cross-the-boundary), which is also why `channel` is a remote name here and never a
handle the sidecar minted.

Note what the socket's lifetime is tied to: **this call**, and nothing wider. Opening it in a `provider`
so several calls could share one handle is the mistake [What may cross the
boundary](#what-may-cross-the-boundary) is about; sharing it _inside_ the sidecar, keyed by whatever the
calls were given, is free.

## Ship it in a package

A sidecar package is a normal Katari package whose source directory holds both halves — `e2b`
(one file each way) and `discord` (a gateway client) are the working references:

```
katari-package-e2b/
  katari.toml        # [package] name = "e2b" — no [sidecar] section needed
  package.json       # depends on @katari-lang/port + the client SDK
  src/
    e2b.ktr          # the typed surface: externals, provider, tools
    e2b.ts           # the sidecar: katari.agent(...) handlers
```

```json
{
  "name": "katari-package-e2b",
  "private": true,
  "type": "module",
  "dependencies": {
    "@e2b/code-interpreter": "^1.5.0",
    "@katari-lang/port": "0.1.1"
  }
}
```

**Your `@katari-lang/port` pin governs your typecheck, not what ships.** The bundler resolves
`@katari-lang/port` to exactly one module — its own, from the toolchain — because the port holds
process-wide state and a bundle containing two copies of it would not work. Two things follow. The
good one: a package cannot drift its sidecar's wire format away from the runtime it will run
against, however old its pin. The one to watch: a pin left behind type-checks your sidecar against
an ABI it will never actually speak, and nothing fails until a signature you use happens to have
moved. So keep it level with the toolchain you build against, and read a port release's notes even
though the version you name is not the version that runs.

The sidecar's source root defaults to `[package].src`, so `.ts` files simply live beside the
`.ktr` files; a package with a different layout sets `[sidecar] sourceRoots` in its
`katari.toml`. On `katari apply`, the CLI bundles every package's sidecar sources (via the
`katari-bundle` helper from `@katari-lang/bundle`) into the snapshot it deploys — consumers of
your package never run a build step.

Three consequences of the process model worth designing for:

- **One long-lived process per snapshot.** The runtime spawns the sidecar lazily on the first
  call and keeps it alive, so module-level state (`e2b`'s live sandbox objects, `discord`'s
  gateway sockets) persists across calls — for the life of the process, not durably. Its stderr
  is passed through as the sidecar's log. The next section is the one rule that state has to obey.
- **Crashes are contained.** A crashed sidecar is respawned; the calls in flight fail as panics
  rather than hanging forever.
- **Execution is at-most-once.** The runtime never re-runs a handler: a call in flight across a
  runtime restart fails with an "interrupted" panic instead of silently running twice. That much is
  unavoidable. What it costs — and how little it should cost — is the next section.

## What may cross the boundary

One law governs everything a sidecar hands back, and it is short:

> A durable program may hold only **durable values**. A pointer into the sidecar's process memory is
> not one, so it must not cross back into Katari.

Katari has obeyed this on the data plane from the start: the [store]({docs}/{currentVersion}/guides/store)
hands out a **key**, never a row pointer, which is why a store handle cannot go stale across a restart.
The FFI plane gets the same discipline from one rule:

> **An FFI call takes what it needs to act: the remote name, and the credential.** The sidecar may
> cache whatever it likes keyed by those, and no durable value may point at that cache.

"The remote name plus the credential" is not a convention, it is what makes a reference
**self-sufficient**: hold those two and _any_ process reaches the same remote thing. So there is
nothing to re-establish after a restart, and no staleness to detect — the concept of re-establishing a
reference does not arise.

### The worked example: `e2b`

The `e2b` package has had this shape all along. Its reference is a pair, and both halves are values:

```katari
@"An open sandbox and the key it is reached with: the remote NAME plus the credential."
data session_data(session_id: string, api_key: string of private)

@"Run @code@ in the sandbox @session@ names, authenticating with @api_key@."
external agent e2b_run_in(session: string, code: string, api_key: string of private) -> unknown
```

Nothing in that signature names anything local. The sidecar _does_ keep a `Map` of live `Sandbox`
objects, because reconnecting on every call would be wasteful — but the map is keyed by the **session
id**, so a miss is not an error. It is a reconnect:

```typescript
// A miss is ORDINARY: a fresh sidecar process, or a sandbox that timed out. Reconnect by name.
async function sandboxFor(session: string, apiKey: string): Promise<Sandbox> {
  const cached = sandboxes.get(session);
  if (cached !== undefined) return cached;
  let sandbox: Sandbox;
  try {
    sandbox = await Sandbox.connect(session, { apiKey });
  } catch {
    sandbox = await Sandbox.create({ apiKey });
  }
  sandboxes.set(session, sandbox);
  return sandbox;
}
```

That cache is a pure optimization nothing can observe. Delete it and every program still works, one
round trip slower. **That is the test to apply to your own sidecar: if emptying the cache breaks a
program, a durable value was pointing into the cache.**

The counter-example is worth knowing because it shipped. Before `discord` 0.7.0 / `slack` 0.5.0, the
provider connected once and served the sidecar's **handle** for that client through a `connection`
request; the sidecar's map was keyed by the handle, and a miss was documented as "a program defect". But
a restart produces a miss legitimately — recovery replays committed state rather than re-running
effects, so the _same_ handle came back in a _new_ process — and every call through it failed. Worse,
the documented recovery (re-fork the watcher) handed the replacement the same dead handle, turning a
merely disconnected bot into a silent crash loop. The fix was not to detect the staleness. It was to
stop the pointer crossing: both packages now take the token on every call, and their sockets are leased
per token inside the sidecar, refcounted, named by nothing.

### What a restart costs, and what a re-fork gets back

Under the rule, a runtime restart costs exactly one thing:

|                             | what a restart does to it                                                            |
| --------------------------- | ------------------------------------------------------------------------------------ |
| the external call in flight | **dies, once** — at-most-once is unavoidable; it arrives as a catchable panic        |
| everything durable          | **untouched**: run state, handler `var`s, a desk's conversation, `store` rows        |
| a re-forked watcher         | **connects again** — the fresh call resolves the credential and opens its own socket |
| events during the gap       | **not delivered** — a socket nobody was holding received nothing                     |

So the recovery for a long-lived watcher is the plain one, and it is the whole of it:

```katari
import slack

@"Reply to one message. A transient `api_error` is caught so one failed send never ends the bot; an
`auth_error` (a bad token) surfaces and stops it loudly — the per-message channel, a typed throw."
agent reply(value: slack.message) -> null with io | slack.credential | prelude.throw[slack.auth_error] {
  use handler {
    request prelude.throw(error: slack.slack_error) -> never {
      match (error) {
        case slack.api_error(_) -> { break null }
        // The residual is exactly `auth_error` — rethrown as bound, no reconstruction.
        case rest -> { prelude.throw(error = rest) }
      }
    }
  }
  let _ts = slack.send_message(channel = value.channel, text = f"you said: ${value.text}", files = [], thread_ts = value.thread)
  null
}

@"The whole bot: provide the tokens, serve the channel. Nothing here supervises a connection, because
nothing here holds one — `watch_messages` opens a socket for its own call and that is the only thing a
restart can take away."
agent main(channel: string) -> never with io | prelude.throw[slack.slack_error | env.missing_secret | oauth.server_error] {
  use slack.provider(
    bot_source = credentials.env(key = "SLACK_BOT_TOKEN"),
    app_source = credentials.env(key = "SLACK_APP_TOKEN"),
  )
  slack.watch_messages(channel = channel, deliver_to = reply)
}
```

There is no `supervise` provider here and no panic converter, and that is not an omission. `main`'s watch
_is_ the run: if the interrupted call ends it, the run ends, and the runtime tells you so. A resident
that must outlive its watcher runs the watch as a **fiber**, and then the recovery has somewhere to
live — one `region.crashed` clause:

```katari
@"The watcher raised a typed failure no reconnect can fix."
data watcher_failed(name: string, detail: string)

@"The nursery's scope marker: one nullary phantom per nursery."
effect bot_scope

// The fiber ceiling: what a fiber of this nursery may RAISE — throws excluded, because a fiber's
// uncaught throw never crosses the region as a throw. (Type synonyms take no docs.)
type bot_ceiling = slack.credential | io

@"The watcher, as a fiber: serve the channel forever. `fork` applies it to the channel id — the
parameter is named `input` because `fork` declares its task as `agent (input: A) -> null`."
agent channel_source(input: string) -> never {
  slack.watch_messages(channel = input, deliver_to = reply)
}

@"The same bot with the watcher detached, so the resident can serve other traffic while it listens.
The recovery is one clause: `crashed` forks another watch, which connects; `failed` stops loudly,
because no reconnect fixes a revoked token."
agent resident(channel: string) -> never with io | prelude.throw[watcher_failed | env.missing_secret | oauth.server_error] {
  use slack.provider(
    bot_source = credentials.env(key = "SLACK_BOT_TOKEN"),
    app_source = credentials.env(key = "SLACK_APP_TOKEN"),
  )
  let nursery: region.nursery[bot_scope, bot_ceiling] = use region.provide[bot_scope, bot_ceiling]
  use handler {
    request region.crashed(id: string, name: string, message: string) {
      // The interrupted call died with the restart; a fresh one resolves the tokens and connects.
      let _replacement = region.fork(nursery = nursery, task = channel_source, argument = channel, name = name)
      next null
    }
    request region.failed(id: string, name: string, error: unknown) {
      prelude.throw(error = watcher_failed(name = name, detail = json.stringify(value = error)))
    }
  }
  let _watcher = region.fork(nursery = nursery, task = channel_source, argument = channel, name = "channel-watcher")
  region.watch(nursery = nursery)
}
```

**`crashed` = fork it again; `failed` = stop loudly.** A panic means the call was interrupted, which a
fresh call fixes. A typed throw is the program's own anticipated failure — a revoked token, a channel
the bot was removed from — which no number of fresh calls will. Both ride `watch`'s row, so `katari
check` holds you to writing both. And note where the watcher's `slack_error` went: it is not on
`bot_ceiling` and not on `resident`'s row, because a fiber's uncaught throw is trapped at the region
boundary and arrives as `failed`'s `error` — which is why `watcher_failed` is `resident`'s own throw and
the package's is not.

Note what is _not_ in either listing: no `supervise` provider around the provider install, no `panic`
converter, no epoch to compare, no session to rebuild. If you find yourself reaching for that
machinery to keep an FFI reference alive, the reference is the thing to fix.

### Where `replay` still belongs

`replay` is for a failure that **heals on a retry** — a rate limit, a 5xx, a cold upstream. That is
what [scheduled jobs]({docs}/{currentVersion}/guides/scheduled-jobs) wrap a `time.watch` delivery in,
and it is unaffected by any of the above: the failure there is a typed throw the converter chooses to
replay, not a pointer that went stale.

What it is _not_ for is re-establishing a reference. It is worth knowing the cost you avoid by not
needing it here, because that cost is what made the old recipe expensive: everything installed inside a
replay scope is **rebuilt per attempt** (the rule, and its one strict precondition, is in
[Durable execution]({docs}/{currentVersion}/concepts/durable-execution#what-a-replay-rebuilds-and-what-it-keeps)).
For a resident, "everything" included the desk holding the conversation, so a bot supervised that way
came back having forgotten it — and the desk could not simply be hoisted above the scope to save it,
because its own clause performs the requests the providers _inside_ the scope serve. Under the rule none
of that arises: nothing is rebuilt, so nothing has to be hoisted out of the way of a rebuild.

## Where to go next

- [Packages]({docs}/{currentVersion}/guides/packages) — publishing to the registry, and what
  consumers see.
- [Durable execution]({docs}/{currentVersion}/concepts/durable-execution) — where the FFI
  boundary sits in the recovery story.
- The `@katari-lang/port` API in the [reference](/packages).
