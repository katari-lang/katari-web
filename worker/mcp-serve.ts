// The MCP serve protocol layer for katari-web's `POST /mcp` endpoint: a dependency-free, stateless
// JSON-RPC handler. It is ported verbatim in shape from the Katari runtime's `serveMcpMessage`
// (typescript/runtime/src/modules/mcp/mcp-serve.ts) so the two servers share a wire contract, with
// the actor-specific adapter dropped — here the endpoint is backed by static docs/package corpus,
// not a live project actor. Stateless MCP (`sessionIdGenerator: undefined` in SDK terms) needs
// exactly: `initialize`, the `notifications/*` acks, `ping`, `tools/list`, and `tools/call` — all
// POST-only JSON responses (no SSE stream, no session id).
//
// `Json` is defined locally rather than imported from `@katari-lang/types`: this worker bundle must
// stay self-contained for the Cloudflare deploy.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** The Json-level port `serveMcpMessage` serves from. The corpus-backed implementation lives in
 *  `endpoint.ts`; this module only maps its outcomes onto JSON-RPC. */
export interface McpServeEndpoint {
  /** Whether a live endpoint holds the token (the `initialize` liveness probe). Always true here. */
  probe(): Promise<boolean>;
  listTools(): Promise<
    | { kind: "unknown" }
    | {
        kind: "tools";
        tools: Array<{ name: string; description: string; inputSchema: Json; outputSchema?: Json }>;
      }
  >;
  callTool(
    name: string,
    argument: Json,
  ): Promise<
    | { kind: "unknown" }
    | { kind: "gone" }
    | { kind: "unknownTool" }
    /** Rejected before the tool ran (undecodable / schema-violating arguments). */
    | { kind: "rejected"; message: string }
    | { kind: "result"; value: Json }
    | { kind: "throw"; error: Json }
    /** The tool call failed; details stay server-side. */
    | { kind: "error" }
  >;
}

/** One handled inbound MCP message, as the HTTP reply the route writes: a `202` acknowledges a
 *  notification (no body); everything else carries a JSON-RPC response body. */
export interface McpServeHttpReply {
  status: 200 | 202 | 400 | 404 | 405 | 410;
  body: Json | null;
}

// The standard JSON-RPC error codes plus one server-defined code for a dead capability URL.
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
const ENDPOINT_UNAVAILABLE = -32000;

/** The protocol revisions this stateless server knows to be compatible with its POST-only JSON
 *  responses. `initialize` echoes the client's requested revision when it is one of these, and offers
 *  the newest otherwise (the spec's downgrade path). */
const KNOWN_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];

/** Handle one inbound MCP POST body against an endpoint. Exactly the stateless method set: `initialize`
 *  (a liveness probe + capability advertisement), notifications (acknowledged and dropped — no session
 *  to advance), `ping`, `tools/list`, and `tools/call`. */
export async function serveMcpMessage(
  endpoint: McpServeEndpoint,
  raw: string,
): Promise<McpServeHttpReply> {
  let message: Json;
  try {
    message = raw === "" ? null : (JSON.parse(raw) as Json);
  } catch {
    return { status: 400, body: errorBody(null, PARSE_ERROR, "the request body is not JSON") };
  }
  if (!isJsonObject(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    // Batching was removed from the protocol (2025-06-18) and a stateless server has no in-flight
    // requests a client-sent response could answer, so anything but a single request/notification
    // frame is an invalid request.
    return {
      status: 400,
      body: errorBody(null, INVALID_REQUEST, "expected a single JSON-RPC 2.0 request"),
    };
  }
  const method = message.method;
  const id = message.id;
  if (typeof id !== "string" && typeof id !== "number") {
    // A notification (`notifications/initialized`, `notifications/cancelled`): acknowledged and
    // dropped — stateless serving has no session to advance and no request registry to cancel into.
    return { status: 202, body: null };
  }
  const params = isJsonObject(message.params) ? message.params : {};
  switch (method) {
    case "initialize": {
      if (!(await endpoint.probe())) {
        return { status: 404, body: unavailableBody(id) };
      }
      const requested = params.protocolVersion;
      return {
        status: 200,
        body: resultBody(id, {
          protocolVersion:
            typeof requested === "string" && KNOWN_PROTOCOL_VERSIONS.includes(requested)
              ? requested
              : (KNOWN_PROTOCOL_VERSIONS[0] ?? "2025-06-18"),
          capabilities: { tools: {} },
          serverInfo: { name: "katari-docs-mcp", version: "0.1.0" },
        }),
      };
    }
    case "ping":
      return { status: 200, body: resultBody(id, {}) };
    case "tools/list": {
      const listing = await endpoint.listTools();
      if (listing.kind === "unknown") {
        return { status: 404, body: unavailableBody(id) };
      }
      const tools: Json[] = listing.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.outputSchema !== undefined ? { outputSchema: tool.outputSchema } : {}),
      }));
      return { status: 200, body: resultBody(id, { tools }) };
    }
    case "tools/call":
      return serveToolCall(endpoint, id, params);
    default:
      return {
        status: 200,
        body: errorBody(id, METHOD_NOT_FOUND, `method "${method}" is not supported`),
      };
  }
}

/** The `tools/call` half of the handler: dispatch the named tool and map its outcome onto the wire. */
async function serveToolCall(
  endpoint: McpServeEndpoint,
  id: string | number,
  params: { [key: string]: Json },
): Promise<McpServeHttpReply> {
  const name = params.name;
  if (typeof name !== "string") {
    return {
      status: 200,
      body: errorBody(id, INVALID_PARAMS, "tools/call requires a string tool name"),
    };
  }
  const outcome = await endpoint.callTool(name, params.arguments ?? {});
  switch (outcome.kind) {
    case "unknown":
      return { status: 404, body: unavailableBody(id) };
    case "gone":
      return {
        status: 410,
        body: errorBody(id, ENDPOINT_UNAVAILABLE, "this MCP endpoint is no longer serving"),
      };
    case "unknownTool":
      return {
        status: 200,
        body: errorBody(id, INVALID_PARAMS, `tool "${name}" is not served here`),
      };
    case "rejected":
      return { status: 200, body: errorBody(id, INVALID_PARAMS, outcome.message) };
    case "result":
      return { status: 200, body: resultBody(id, callToolResultOf(outcome.value)) };
    case "throw":
      return {
        status: 200,
        body: resultBody(id, {
          content: [{ type: "text", text: JSON.stringify(outcome.error) }],
          isError: true,
        }),
      };
    case "error":
      return { status: 200, body: errorBody(id, INTERNAL_ERROR, "the tool call failed") };
  }
}

/** A tool result's wire form: a bare string is text content; an object rides as `structuredContent`
 *  with the spec-required text fallback; any other JSON rides as its text form only (the spec types
 *  `structuredContent` as an object). */
function callToolResultOf(value: Json): Json {
  if (typeof value === "string") {
    return { content: [{ type: "text", text: value }] };
  }
  const text = JSON.stringify(value);
  if (isJsonObject(value)) {
    return { content: [{ type: "text", text }], structuredContent: value };
  }
  return { content: [{ type: "text", text }] };
}

function resultBody(id: string | number, result: Json): Json {
  return { jsonrpc: "2.0", id, result };
}

function errorBody(id: string | number | null, code: number, message: string): Json {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** The one dead-token error body (`404` rides it). Unreachable for this always-live corpus server,
 *  but kept so the handler's shape matches the runtime's. */
function unavailableBody(id: string | number): Json {
  return errorBody(id, ENDPOINT_UNAVAILABLE, "no MCP endpoint serves this token");
}

function isJsonObject(json: Json | null | undefined): json is { [key: string]: Json } {
  return typeof json === "object" && json !== null && !Array.isArray(json);
}
