// The katari-web Worker entry. `run_worker_first: ["/mcp", "/mcp/*"]` in wrangler.jsonc routes
// only the MCP paths here; everything else is served straight from Static Assets by the platform.
// The fallback to env.ASSETS.fetch below is the safety net for anything that still arrives
// (e.g. /mcp/<subpath>, which no tool serves — it falls through to the 404 page).
//
// POST /mcp speaks stateless MCP (Streamable HTTP, JSON responses only — see mcp-serve.ts). CORS
// is wide open: the endpoint serves public documentation and holds no credentials or session.

import { docsMcpEndpoint } from "./endpoint";
import { serveMcpMessage, type McpServeEndpoint } from "./mcp-serve";

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  // MCP clients send the protocol version and (even to a stateless server) a session id header.
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
} as const;

// One endpoint per isolate: the corpus memo inside it persists across requests, so repeated tool
// calls skip the asset round-trips. A new deploy replaces the isolate and thus the cache. The
// reader goes through this mutable ref because the platform hands `env` per request while the
// endpoint singleton must outlive any one of them.
const bindingRef: { assets?: Env["ASSETS"]; origin?: string } = {};

const endpoint: McpServeEndpoint = docsMcpEndpoint({
  async readJson(path: string): Promise<unknown | undefined> {
    if (!bindingRef.assets || !bindingRef.origin) return undefined;
    const response = await bindingRef.assets.fetch(new Request(new URL(path, bindingRef.origin)));
    if (!response.ok) return undefined;
    return response.json();
  },
});

async function serveMcp(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") {
    // The CORS preflight for browser-based MCP clients.
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    // Stateless serving has no SSE stream to GET and no session to DELETE.
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32000, message: "this MCP endpoint only accepts POST" },
      }),
      {
        status: 405,
        headers: { ...CORS_HEADERS, Allow: "POST, OPTIONS", "Content-Type": "application/json" },
      },
    );
  }
  bindingRef.assets = env.ASSETS;
  bindingRef.origin = new URL(request.url).origin;
  const reply = await serveMcpMessage(endpoint, await request.text());
  if (reply.body === null) {
    return new Response(null, { status: reply.status, headers: CORS_HEADERS });
  }
  return new Response(JSON.stringify(reply.body), {
    status: reply.status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

const handler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/mcp" || url.pathname === "/mcp/") {
      return serveMcp(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};

export default handler;
