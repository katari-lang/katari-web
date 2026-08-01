---
title: Docs for AI agents
description: These docs are served as an MCP server at katari-lang.dev/mcp — onboarding, search, page reads, and the full package API — plus /llms.txt for anything that just wants links.
---

Katari is newer than every model's training data, so an assistant asked to write it will
confidently invent syntax that does not exist. The fix is to hand it the real documentation as
tools: `https://katari-lang.dev/mcp` is a public MCP server that serves this site — every page,
the search index, and the whole package API reference.

No account, no key, nothing to install. It is read-only public documentation.

## Connect

**Claude Code** — add it once with `--scope user` and every project has it:

```sh
claude mcp add --transport http --scope user katari-docs https://katari-lang.dev/mcp
```

**Cursor** — in `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "katari-docs": {
      "url": "https://katari-lang.dev/mcp"
    }
  }
}
```

**Any MCP client that speaks Streamable HTTP** — the same entry, with the transport named
explicitly (some clients require the field, others infer it from `url`):

```json
{
  "mcpServers": {
    "katari-docs": {
      "type": "http",
      "url": "https://katari-lang.dev/mcp"
    }
  }
}
```

**A client that only launches stdio servers** — bridge it:

```json
{
  "mcpServers": {
    "katari-docs": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://katari-lang.dev/mcp"]
    }
  }
}
```

To check the endpoint by hand, or from something that is not an MCP client at all:

```sh
curl -s -X POST https://katari-lang.dev/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## The tools

- **`onboarding`** — start here with no arguments. Returns the maturity caveat, "What is
  Katari?" and the Quickstart in full, the four complete
  [example projects](https://github.com/katari-lang/examples), and a map of every documentation
  page with its description. One call is enough context to write a first program and know what
  to read next.
- **`search`** — one query string over the docs **and** the package API. Up to ten results, each
  with a path, a title, whether it is a page or a declaration, and a snippet.
- **`read_doc`** — one page as raw markdown, by the path a search result or the page map gave
  (`/docs/v0.1/concepts/escalation`).
- **`packages`** — the standard library and registry packages, disclosed in stages: no arguments
  lists every package and its modules; `package` gives one line per declaration; `package` plus
  `name` gives one declaration in full, with parameter docs and defaults.

A useful first instruction for an assistant: _call `onboarding`, then `search` before writing
any Katari — the language is not in your training data._

## What it is, exactly

Stateless MCP over Streamable HTTP: `POST /mcp` with a JSON-RPC body, JSON responses, no SSE
stream and no session to keep. `GET` and `DELETE` are not served — there is no session state to
resume or discard. Protocol revisions `2025-11-25`, `2025-06-18` and `2025-03-26` are accepted;
the server echoes the one the client asks for when it knows it. CORS is open, so a browser-based
client can connect directly. The corpus is a build artifact of this site, so the server and the
pages you are reading can never disagree.

## /llms.txt

[`/llms.txt`](/llms.txt) is the same map without the protocol: every documentation page, every
package reference page, and the four example projects, as URLs with a one-line description each,
in navigation order. It is generated from the same content at build time, so it does not drift.
Point anything that reads a site rather than calling tools at it — and note that each page has a
**Copy** button that yields its raw markdown, which is what `read_doc` returns.

## Related

<DocCards>
  <DocCard href="{docs}/{currentVersion}/guides/mcp" />
  <DocCard href="{docs}/{currentVersion}/getting-started/why-katari" />
  <DocCard href="{docs}/{currentVersion}/getting-started/quickstart" />
</DocCards>
