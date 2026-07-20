// Drives the /mcp Worker at both seams: `serveMcpMessage` + `docsMcpEndpoint` over an in-memory
// corpus (the protocol/tool contract), and the default fetch handler over a mocked ASSETS binding
// (method routing, CORS, asset fallback).

import { describe, expect, it } from "vitest";
import type { DocsCorpus, OnboardingCorpus, PackagesIndex } from "../corpus-types";
import { docsMcpEndpoint, type AssetReader } from "../endpoint";
import { serveMcpMessage, type Json, type McpServeEndpoint } from "../mcp-serve";
import worker from "../index";

// ---------------------------------------------------------------------------
// fixture corpus
// ---------------------------------------------------------------------------

const docsCorpus: DocsCorpus = {
  "/docs/v0.1/getting-started/quickstart": {
    href: "/docs/v0.1/getting-started/quickstart",
    title: "Quickstart",
    description: "A project running in five minutes.",
    markdown: "Scaffold a project with `katari init`, then `katari apply` and `katari run`.",
  },
  "/docs/v0.1/guides/webhooks": {
    href: "/docs/v0.1/guides/webhooks",
    title: "Webhooks",
    description: null,
    markdown: "Mint a webhook URL and park the run until the callback arrives.",
  },
};

const onboardingCorpus: OnboardingCorpus = {
  intro: "# What is Katari?\n\nKatari is a language for orchestrating AI agents.",
  pages: [
    {
      title: "Quickstart",
      href: "/docs/v0.1/getting-started/quickstart",
      description: "A project running in five minutes.",
    },
    { title: "Webhooks", href: "/docs/v0.1/guides/webhooks", description: null },
  ],
};

const packagesIndex: PackagesIndex = {
  packages: [
    {
      name: "prelude",
      version: "0.1.0",
      hasReadme: false,
      tagline: "the standard library",
      modules: [
        { name: "prelude", declarationCount: 1 },
        { name: "prelude.http", declarationCount: 1 },
      ],
    },
  ],
  declarations: [
    {
      package: "prelude",
      module: "prelude",
      name: "throw",
      kind: "primitive_agent",
      firstSentence: "Throw a typed error.",
      href: "/packages/prelude#prelude.throw",
    },
    {
      package: "prelude",
      module: "prelude.http",
      name: "fetch",
      kind: "primitive_agent",
      firstSentence: "Perform an HTTP request.",
      href: "/packages/prelude#prelude.http.fetch",
    },
  ],
};

const fixtures: { [path: string]: unknown } = {
  "/mcp-corpus/manifest.json": { latestVersion: "v0.1", versions: ["v0.1"] },
  "/search-index/v0.1.json": [
    {
      href: "/docs/v0.1/getting-started/quickstart",
      title: "Quickstart",
      description: "A project running in five minutes.",
      headings: ["Scaffold a project"],
      body: "Scaffold a project, start a local runtime, and answer an escalation.",
    },
    {
      href: "/docs/v0.1/guides/webhooks",
      title: "Webhooks",
      headings: ["Mint a URL"],
      body: "A webhook parks the run as a durable wait until the callback arrives.",
    },
  ],
  "/mcp-corpus/docs.json": docsCorpus,
  "/mcp-corpus/onboarding.json": onboardingCorpus,
  "/mcp-corpus/packages/index.json": packagesIndex,
  "/mcp-corpus/packages/prelude/prelude.json": {
    package: "prelude",
    version: "0.1.0",
    module: "prelude",
    declarations: [
      {
        name: "throw",
        kind: "primitive_agent",
        signature: "primitive agent throw[E](error: E) -> never",
        documentation: "Throw a typed error. The nearest matching catch receives it.",
        parameters: [{ label: "error", documentation: "The error value.", default: null }],
      },
    ],
  },
  "/mcp-corpus/packages/prelude/prelude.http.json": {
    package: "prelude",
    version: "0.1.0",
    module: "prelude.http",
    declarations: [
      {
        name: "fetch",
        kind: "primitive_agent",
        signature: 'primitive agent fetch(url: string, method: string ?= "GET") -> response',
        documentation: "Perform an HTTP request. Non-2xx responses are values, not errors.",
        parameters: [
          { label: "url", documentation: "The request URL.", default: null },
          { label: "method", documentation: "The HTTP method.", default: '"GET"' },
        ],
      },
    ],
  },
};

const fixtureReader: AssetReader = {
  async readJson(path: string): Promise<unknown | undefined> {
    return fixtures[path];
  },
};

// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------

let nextId = 0;

async function rpc(
  endpoint: McpServeEndpoint,
  method: string,
  params?: Json,
): Promise<{ status: number; body: Json | null }> {
  const id = (nextId += 1);
  const raw = JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
  return serveMcpMessage(endpoint, raw);
}

function asObject(value: Json | null | undefined): { [key: string]: Json } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`expected a JSON object, got ${JSON.stringify(value)}`);
  }
  return value;
}

/** The `result` of a successful JSON-RPC reply. */
function resultOf(reply: { status: number; body: Json | null }): { [key: string]: Json } {
  expect(reply.status).toBe(200);
  const body = asObject(reply.body);
  expect(body.error).toBeUndefined();
  return asObject(body.result);
}

/** The first text content block of a tool result. */
function textOf(result: { [key: string]: Json }): string {
  const content = result.content;
  if (!Array.isArray(content)) throw new Error("expected content array");
  const first = asObject(content[0]);
  if (typeof first.text !== "string") throw new Error("expected text content");
  return first.text;
}

function callTool(
  endpoint: McpServeEndpoint,
  name: string,
  args?: Json,
): Promise<{ status: number; body: Json | null }> {
  return rpc(endpoint, "tools/call", { name, ...(args !== undefined ? { arguments: args } : {}) });
}

// ---------------------------------------------------------------------------
// protocol layer
// ---------------------------------------------------------------------------

describe("serveMcpMessage over the docs endpoint", () => {
  const endpoint = docsMcpEndpoint(fixtureReader);

  it("initialize echoes a known protocol version and names the server", async () => {
    const result = resultOf(await rpc(endpoint, "initialize", { protocolVersion: "2025-06-18" }));
    expect(result.protocolVersion).toBe("2025-06-18");
    expect(asObject(result.serverInfo).name).toBe("katari-docs-mcp");
    expect(asObject(result.capabilities).tools).toEqual({});
  });

  it("offers the newest protocol version to an unknown revision", async () => {
    const result = resultOf(await rpc(endpoint, "initialize", { protocolVersion: "1999-01-01" }));
    expect(result.protocolVersion).toBe("2025-11-25");
  });

  it("acknowledges notifications with 202 and no body", async () => {
    const reply = await serveMcpMessage(
      endpoint,
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    );
    expect(reply).toEqual({ status: 202, body: null });
  });

  it("rejects an unknown method with method-not-found", async () => {
    const reply = await rpc(endpoint, "resources/list");
    expect(reply.status).toBe(200);
    expect(asObject(asObject(reply.body).error).code).toBe(-32601);
  });

  it("rejects a non-JSON body with 400", async () => {
    const reply = await serveMcpMessage(endpoint, "not json");
    expect(reply.status).toBe(400);
    expect(asObject(asObject(reply.body).error).code).toBe(-32700);
  });

  it("lists the four documentation tools with object input schemas", async () => {
    const result = resultOf(await rpc(endpoint, "tools/list"));
    const tools = result.tools;
    if (!Array.isArray(tools)) throw new Error("expected tools array");
    expect(tools.map((tool) => asObject(tool).name)).toEqual([
      "search",
      "read_doc",
      "packages",
      "onboarding",
    ]);
    for (const tool of tools) {
      const schema = asObject(asObject(tool).inputSchema);
      expect(schema.type).toBe("object");
      expect(typeof asObject(tool).description).toBe("string");
    }
    const searchSchema = asObject(asObject(tools[0]).inputSchema);
    expect(searchSchema.required).toEqual(["query"]);
  });

  it("rejects an unknown tool with invalid params", async () => {
    const reply = await callTool(endpoint, "no_such_tool");
    expect(asObject(asObject(reply.body).error).code).toBe(-32602);
  });
});

// ---------------------------------------------------------------------------
// tools
// ---------------------------------------------------------------------------

describe("search", () => {
  const endpoint = docsMcpEndpoint(fixtureReader);

  it("finds doc pages and declarations, structured", async () => {
    const result = resultOf(await callTool(endpoint, "search", { query: "webhook" }));
    const structured = asObject(result.structuredContent);
    const results = structured.results;
    if (!Array.isArray(results)) throw new Error("expected results array");
    const hrefs = results.map((entry) => asObject(entry).href);
    expect(hrefs).toContain("/docs/v0.1/guides/webhooks");
    // Doc results carry a snippet windowed around the hit.
    const doc = asObject(results.find((entry) => asObject(entry).type === "doc"));
    expect(String(doc.snippet)).toContain("webhook");
  });

  it("ranks a declaration name hit for an API query", async () => {
    const result = resultOf(await callTool(endpoint, "search", { query: "http.fetch" }));
    const results = asObject(result.structuredContent).results;
    if (!Array.isArray(results)) throw new Error("expected results array");
    const first = asObject(results[0]);
    expect(first.type).toBe("declaration");
    expect(first.title).toBe("prelude.http.fetch");
    expect(first.href).toBe("/packages/prelude#prelude.http.fetch");
  });

  it("rejects a missing query", async () => {
    const reply = await callTool(endpoint, "search", {});
    expect(asObject(asObject(reply.body).error).code).toBe(-32602);
  });
});

describe("read_doc", () => {
  const endpoint = docsMcpEndpoint(fixtureReader);

  it("returns the full markdown with the title header", async () => {
    const result = resultOf(
      await callTool(endpoint, "read_doc", { path: "/docs/v0.1/getting-started/quickstart" }),
    );
    const text = textOf(result);
    expect(text).toContain("# Quickstart");
    expect(text).toContain("A project running in five minutes.");
    expect(text).toContain("katari init");
  });

  it("normalizes a path without the leading slash", async () => {
    const result = resultOf(
      await callTool(endpoint, "read_doc", { path: "docs/v0.1/guides/webhooks/" }),
    );
    expect(textOf(result)).toContain("# Webhooks");
  });

  it("answers a missing page as a tool error naming the path", async () => {
    const result = resultOf(await callTool(endpoint, "read_doc", { path: "/docs/v9.9/nope" }));
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("/docs/v9.9/nope");
  });
});

describe("packages", () => {
  const endpoint = docsMcpEndpoint(fixtureReader);

  it("lists packages with modules and taglines when called bare", async () => {
    const text = textOf(resultOf(await callTool(endpoint, "packages", {})));
    expect(text).toContain("prelude v0.1.0 — the standard library");
    expect(text).toContain("prelude.http (1)");
  });

  it("lists one-line declarations for a package", async () => {
    const text = textOf(resultOf(await callTool(endpoint, "packages", { package: "prelude" })));
    expect(text).toContain("## prelude.http");
    expect(text).toContain(
      'primitive agent fetch(url: string, method: string ?= "GET") -> response — Perform an HTTP request.',
    );
    // The one-line view cuts the docstring at the first sentence.
    expect(text).not.toContain("Non-2xx responses");
  });

  it("returns one declaration in full, with parameter docs and defaults", async () => {
    const text = textOf(
      resultOf(await callTool(endpoint, "packages", { package: "prelude", name: "http.fetch" })),
    );
    expect(text).toContain("# prelude.http.fetch (primitive_agent)");
    expect(text).toContain("Non-2xx responses are values, not errors.");
    expect(text).toContain('- method (default: "GET") — The HTTP method.');
  });

  it("answers an unknown package as a tool error listing known ones", async () => {
    const result = resultOf(await callTool(endpoint, "packages", { package: "nope" }));
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("prelude");
  });

  it("rejects a name without a package", async () => {
    const reply = await callTool(endpoint, "packages", { name: "fetch" });
    expect(asObject(asObject(reply.body).error).code).toBe(-32602);
  });
});

describe("onboarding", () => {
  const endpoint = docsMcpEndpoint(fixtureReader);

  it("returns the orientation text and the read_doc page map", async () => {
    const text = textOf(resultOf(await callTool(endpoint, "onboarding", {})));
    expect(text).toContain("What is Katari?");
    expect(text).toContain("- /docs/v0.1/getting-started/quickstart — Quickstart");
    expect(text).toContain("read_doc");
  });
});

// ---------------------------------------------------------------------------
// worker fetch handler (method routing, CORS, asset fallback)
// ---------------------------------------------------------------------------

function fixtureEnv(): { ASSETS: { fetch(request: Request): Promise<Response> } } {
  return {
    ASSETS: {
      async fetch(request: Request): Promise<Response> {
        const { pathname } = new URL(request.url);
        const fixture = fixtures[pathname];
        if (fixture === undefined) {
          return new Response("asset fallback", { status: 404 });
        }
        return new Response(JSON.stringify(fixture), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  };
}

describe("worker fetch", () => {
  it("answers GET /mcp with 405 and Allow: POST", async () => {
    const response = await worker.fetch(new Request("https://example.com/mcp"), fixtureEnv());
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST, OPTIONS");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("answers the CORS preflight", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/mcp", { method: "OPTIONS" }),
      fixtureEnv(),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
  });

  it("serves initialize over POST /mcp with CORS headers", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-06-18" },
        }),
      }),
      fixtureEnv(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const body = asObject((await response.json()) as Json);
    expect(asObject(body.result).protocolVersion).toBe("2025-06-18");
  });

  it("serves a tools/call end to end through the ASSETS binding", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "packages", arguments: {} },
        }),
      }),
      fixtureEnv(),
    );
    expect(response.status).toBe(200);
    const body = asObject((await response.json()) as Json);
    expect(textOf(asObject(body.result))).toContain("prelude v0.1.0");
  });

  it("falls back to assets for non-mcp paths", async () => {
    const response = await worker.fetch(new Request("https://example.com/docs/v0.1"), fixtureEnv());
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("asset fallback");
  });
});
