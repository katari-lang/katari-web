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
delivery failure rejects the promise and the watch dies — resilience composes around it with a
`replay` provider, exactly as for
[scheduled jobs]({docs}/{currentVersion}/guides/scheduled-jobs).

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
    "@katari-lang/port": "0.1.0"
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
  call and keeps it alive, so module-level state (the `discord` package's client map, `e2b`'s
  sandbox handles) persists across calls — for the life of the process, not durably. Its stderr
  is passed through as the sidecar's log.
- **Crashes are contained.** A crashed sidecar is respawned; the calls in flight fail as panics
  rather than hanging forever.
- **Execution is at-most-once.** The runtime never re-runs a handler: a call in flight across a
  runtime restart fails with an "interrupted" panic instead of silently running twice. Whether to
  retry is a Katari-level decision — a panic converter plus a `replay` provider, composed by the
  caller.

## Survive a runtime restart

Here is that composition — a panic converter plus a `replay` provider — for a long-lived bot. A
sidecar's client handle is process-local (the `slack` / `discord` client map lives in the subprocess,
not the durable log), so a runtime restart resumes the run holding a handle to a connection that no
longer exists, and its next `watch` / `send` fails as an `interrupted` panic. The converter turns that
panic into a `replay.interrupted` signal and `replay.forever` re-runs the block — and because
`slack.provider` sits **inside** the replay scope, each replay reconnects with a fresh handle:

```katari
import slack

@"Reply to one message. A transient `api_error` is caught so one failed send never ends the bot; an
`auth_error` (a bad token) surfaces and stops it loudly — the per-message channel, a typed throw."
agent reply(channel: string, user: string, text: string, thread_ts: string | null, files: array[file]) -> null with io | slack.connection | prelude.throw[slack.auth_error] {
  use handler {
    request prelude.throw(error: slack.slack_error) -> never {
      match (error) {
        case slack.api_error(_) -> { break null }
        case slack.auth_error(message => message) -> { prelude.throw(error = slack.auth_error(message = message)) }
      }
    }
  }
  slack.send_message(channel = channel, text = f"you said: ${text}", files = [], thread_ts = thread_ts)
}

@"The restart-resilient bot: the panic converter re-runs connect-and-serve after a capped backoff, and
`slack.provider` — inside the replay scope — reconnects each time with a fresh Socket Mode client."
agent main(channel: string) -> never with io | prelude.throw[slack.slack_error | env.missing_secret | oauth.server_error] {
  use replay.forever(initial_delay_milliseconds = 1000, factor = 2, max_delay_milliseconds = 60000)
  use handler {
    request panic(msg: string) -> never {
      replay.interrupted(failure = msg)
    }
  }
  use slack.provider(
    bot_source = credentials.env(key = "SLACK_BOT_TOKEN"),
    app_source = credentials.env(key = "SLACK_APP_TOKEN"),
  )
  slack.watch_messages(channel = channel, deliver_to = reply)
}
```

The two failure channels stay separate: a per-message send failure is a typed `slack_error` caught in
`reply`, while the restart failure is a panic caught by the converter. `replay.forever` sleeps its
capped backoff durably and re-runs the block, so a fresh `create_slack_client` mints a live handle
where the journal replayed a dead one — the same `replay` composition
[scheduled jobs]({docs}/{currentVersion}/guides/scheduled-jobs) use for a `time.watch`, catching a
panic instead of a throw.

## Where to go next

- [Packages]({docs}/{currentVersion}/guides/packages) — publishing to the registry, and what
  consumers see.
- [Durable execution]({docs}/{currentVersion}/concepts/durable-execution) — where the FFI
  boundary sits in the recovery story.
- The `@katari-lang/port` API in the [reference](/packages).
