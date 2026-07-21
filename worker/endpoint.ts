// The corpus-backed MCP endpoint: the four documentation tools (`search`, `read_doc`, `packages`,
// `onboarding`) served over the stateless protocol layer (mcp-serve.ts). Every corpus file is a
// static asset under /mcp-corpus/ (built by scripts/build-mcp-corpus.ts), read lazily through the
// injected AssetReader so a tool call only loads the files it needs — and so tests can drive the
// endpoint from in-memory fixtures without a Workers runtime.

import { firstSentence } from "./first-sentence";
import type { Json, McpServeEndpoint } from "./mcp-serve";
import type {
  CorpusManifest,
  DeclarationIndexEntry,
  DocSearchIndexEntry,
  DocsCorpus,
  ModuleCorpus,
  OnboardingCorpus,
  PackagesIndex,
} from "./corpus-types";

/** How the endpoint reads a corpus asset: `undefined` means the asset does not exist. The Worker
 *  adapts env.ASSETS.fetch into this; tests supply a fixture map. */
export interface AssetReader {
  readJson(path: string): Promise<unknown | undefined>;
}

const SEARCH_RESULT_LIMIT = 10;
const SNIPPET_LENGTH = 180;

// Tool descriptions are the contract an AI client plans against — they must say exactly what comes
// back and how the tools chain (search → read_doc, packages staged disclosure).
const TOOLS: Array<{ name: string; description: string; inputSchema: Json }> = [
  {
    name: "search",
    description:
      "Search the Katari documentation and package API reference. Returns up to 10 results, each " +
      "with a href, title, result type (doc page or API declaration), and a snippet. Follow up " +
      'with "read_doc" (for doc pages) or "packages" (for declarations) to read the full content.',
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: 'Search terms, e.g. "webhook", "parallel for", "http.fetch".',
        },
      },
      required: ["query"],
    },
  },
  {
    name: "read_doc",
    description:
      "Read one Katari documentation page as raw markdown, by the path a search result or the " +
      'onboarding page map returned (e.g. "/docs/v0.1/getting-started/quickstart").',
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: 'The documentation page path, e.g. "/docs/v0.1/concepts/escalation".',
        },
      },
      required: ["path"],
    },
  },
  {
    name: "packages",
    description:
      "Browse the Katari standard library (prelude) and registry packages, with staged detail. " +
      "No arguments: list every package with its modules and a one-line description. With " +
      '"package": every declaration of that package, one line each (signature + summary). With ' +
      '"package" and "name": the full documentation of one declaration, including parameter docs. ' +
      '"name" is the declaration name, optionally module-qualified (e.g. "fetch" or "http.fetch").',
    inputSchema: {
      type: "object",
      properties: {
        package: {
          type: "string",
          description: 'A package name from the no-argument listing, e.g. "prelude", "ai".',
        },
        name: {
          type: "string",
          description:
            'A declaration name within the package, optionally module-qualified, e.g. "time.sleep".',
        },
      },
      required: [],
    },
  },
  {
    name: "onboarding",
    description:
      "Start here if you do not know Katari: an orientation for writing Katari programs — what " +
      "the language is, its core concepts (agents, effects, escalation, durable execution), and a " +
      "quickstart — plus the full documentation page map for follow-up reads with " +
      '"read_doc". Katari is a typed language for orchestrating AI agents.',
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

/** Build the MCP endpoint over a corpus reader. Loaded corpus files memoize per instance; the
 *  Worker keeps one instance per isolate so repeated tool calls skip the asset round-trip. */
export function docsMcpEndpoint(assets: AssetReader): McpServeEndpoint {
  const cache = new Map<string, Promise<unknown | undefined>>();
  const load = (path: string): Promise<unknown | undefined> => {
    let pending = cache.get(path);
    if (!pending) {
      pending = assets.readJson(path).then((value) => {
        // Do not memoize a miss: a transient asset fetch failure must not wedge the isolate.
        if (value === undefined) cache.delete(path);
        return value;
      });
      cache.set(path, pending);
    }
    return pending;
  };

  return {
    async probe() {
      return true;
    },
    async listTools() {
      return { kind: "tools", tools: TOOLS };
    },
    async callTool(name, argument) {
      const args = isJsonObject(argument) ? argument : {};
      switch (name) {
        case "search":
          return callSearch(load, args);
        case "read_doc":
          return callReadDoc(load, args);
        case "packages":
          return callPackages(load, args);
        case "onboarding":
          return callOnboarding(load);
        default:
          return { kind: "unknownTool" };
      }
    },
  };
}

type ToolOutcome = Awaited<ReturnType<McpServeEndpoint["callTool"]>>;

function rejected(message: string): ToolOutcome {
  return { kind: "rejected", message };
}

/** A tool-level failure (`isError: true` on the wire): the input was well-formed but names
 *  something that does not exist — the AI should correct and retry. */
function toolError(message: string): ToolOutcome {
  return { kind: "throw", error: { message } };
}

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

type Loader = (path: string) => Promise<unknown | undefined>;

type Scored = { score: number; result: Json };

async function callSearch(load: Loader, args: { [key: string]: Json }): Promise<ToolOutcome> {
  const query = args.query;
  if (typeof query !== "string" || query.trim() === "") {
    return rejected('search requires a non-empty string "query"');
  }
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

  const manifest = (await load("/mcp-corpus/manifest.json")) as CorpusManifest | undefined;
  if (!manifest) return { kind: "error" };
  const [docIndex, packagesIndex] = await Promise.all([
    load(`/search-index/${manifest.latestVersion}.json`) as Promise<
      DocSearchIndexEntry[] | undefined
    >,
    load("/mcp-corpus/packages/index.json") as Promise<PackagesIndex | undefined>,
  ]);
  if (!docIndex || !packagesIndex) return { kind: "error" };

  const scored: Scored[] = [];
  for (const entry of docIndex) {
    const hit = scoreDoc(entry, terms);
    if (hit) scored.push(hit);
  }
  for (const declaration of packagesIndex.declarations) {
    const hit = scoreDeclaration(declaration, terms);
    if (hit) scored.push(hit);
  }
  scored.sort((a, b) => b.score - a.score);
  return {
    kind: "result",
    value: { results: scored.slice(0, SEARCH_RESULT_LIMIT).map((entry) => entry.result) },
  };
}

/** Naive additive scoring: substring hits per term, weighted by field. Every term must hit at
 *  least one field — an AND over terms keeps multi-word queries precise without a real index. */
function scoreDoc(entry: DocSearchIndexEntry, terms: string[]): Scored | null {
  const title = entry.title.toLowerCase();
  const description = (entry.description ?? "").toLowerCase();
  const headings = entry.headings.join("\n").toLowerCase();
  const body = entry.body.toLowerCase();
  let score = 0;
  for (const term of terms) {
    let termScore = 0;
    if (title.includes(term)) termScore += 8;
    if (headings.includes(term)) termScore += 4;
    if (description.includes(term)) termScore += 3;
    if (body.includes(term)) termScore += 1;
    if (termScore === 0) return null;
    score += termScore;
  }
  return {
    score,
    result: {
      type: "doc",
      href: entry.href,
      title: entry.title,
      snippet: docSnippet(entry, terms),
    },
  };
}

function scoreDeclaration(declaration: DeclarationIndexEntry, terms: string[]): Scored | null {
  const qualified = `${declaration.module}.${declaration.name}`.toLowerCase();
  const summary = (declaration.firstSentence ?? "").toLowerCase();
  let score = 0;
  for (const term of terms) {
    let termScore = 0;
    if (qualified.includes(term)) termScore += 6;
    if (declaration.name.toLowerCase() === term) termScore += 4;
    if (summary.includes(term)) termScore += 3;
    if (termScore === 0) return null;
    score += termScore;
  }
  return {
    score,
    result: {
      type: "declaration",
      href: declaration.href,
      title: `${declaration.module}.${declaration.name}`,
      kind: declaration.kind,
      package: declaration.package,
      snippet: declaration.firstSentence,
    },
  };
}

/** A body window around the first term occurrence; the description is the fallback so every doc
 *  hit carries context. */
function docSnippet(entry: DocSearchIndexEntry, terms: string[]): string {
  const body = entry.body;
  const lower = body.toLowerCase();
  for (const term of terms) {
    const at = lower.indexOf(term);
    if (at < 0) continue;
    const start = Math.max(0, at - Math.floor(SNIPPET_LENGTH / 3));
    const window = body.slice(start, start + SNIPPET_LENGTH).trim();
    return `${start > 0 ? "…" : ""}${window}${start + SNIPPET_LENGTH < body.length ? "…" : ""}`;
  }
  return entry.description ?? body.slice(0, SNIPPET_LENGTH);
}

// ---------------------------------------------------------------------------
// read_doc
// ---------------------------------------------------------------------------

async function callReadDoc(load: Loader, args: { [key: string]: Json }): Promise<ToolOutcome> {
  const rawPath = args.path;
  if (typeof rawPath !== "string" || rawPath.trim() === "") {
    return rejected('read_doc requires a string "path"');
  }
  const docs = (await load("/mcp-corpus/docs.json")) as DocsCorpus | undefined;
  if (!docs) return { kind: "error" };
  // Normalize: ensure the leading slash, drop a trailing slash and any #fragment.
  const normalized = `/${rawPath.trim().replace(/^\/+/, "")}`.replace(/\/+$/, "").split("#")[0]!;
  const entry = docs[normalized];
  if (!entry) {
    return toolError(
      `no documentation page at "${normalized}" — paths come from search results or the ` +
        'onboarding page map, e.g. "/docs/v0.1/getting-started/quickstart"',
    );
  }
  const header = entry.description
    ? `# ${entry.title}\n\n${entry.description}`
    : `# ${entry.title}`;
  return { kind: "result", value: `${header}\n\n${entry.markdown}` };
}

// ---------------------------------------------------------------------------
// packages
// ---------------------------------------------------------------------------

async function callPackages(load: Loader, args: { [key: string]: Json }): Promise<ToolOutcome> {
  const packageName = args.package;
  const declarationName = args.name;
  if (packageName !== undefined && typeof packageName !== "string") {
    return rejected('packages: "package" must be a string when given');
  }
  if (declarationName !== undefined && typeof declarationName !== "string") {
    return rejected('packages: "name" must be a string when given');
  }
  if (declarationName !== undefined && packageName === undefined) {
    return rejected('packages: "name" requires "package"');
  }

  const index = (await load("/mcp-corpus/packages/index.json")) as PackagesIndex | undefined;
  if (!index) return { kind: "error" };

  if (packageName === undefined) {
    return { kind: "result", value: renderPackageListing(index) };
  }

  const summary = index.packages.find((entry) => entry.name === packageName);
  if (!summary) {
    const known = index.packages.map((entry) => entry.name).join(", ");
    return toolError(`no package "${packageName}" — known packages: ${known}`);
  }

  const modules = await Promise.all(
    summary.modules.map(
      (module) =>
        load(`/mcp-corpus/packages/${summary.name}/${module.name}.json`) as Promise<
          ModuleCorpus | undefined
        >,
    ),
  );
  const loaded = modules.filter((module): module is ModuleCorpus => module !== undefined);
  if (loaded.length !== summary.modules.length) return { kind: "error" };

  if (declarationName === undefined) {
    return { kind: "result", value: renderPackageDeclarations(summary.name, loaded) };
  }
  return renderDeclaration(summary.name, loaded, declarationName);
}

function renderPackageListing(index: PackagesIndex): string {
  const lines: string[] = ["Katari packages (prelude = the standard library):", ""];
  for (const entry of index.packages) {
    lines.push(`${entry.name} v${entry.version}${entry.tagline ? ` — ${entry.tagline}` : ""}`);
    const modules = entry.modules
      .map((module) => `${module.name} (${module.declarationCount})`)
      .join(", ");
    lines.push(`  modules: ${modules}`);
  }
  lines.push("");
  lines.push(
    'Call packages with { "package": "<name>" } for every declaration of one package, and add ' +
      '{ "name": "<declaration>" } for one declaration in full.',
  );
  return lines.join("\n");
}

/** One line per declaration: the signature already carries the kind head (`agent`, `request`,
 *  `data`, …), so the line is signature + first doc sentence. */
function renderPackageDeclarations(packageName: string, modules: ModuleCorpus[]): string {
  const lines: string[] = [];
  for (const moduleCorpus of modules) {
    lines.push(`## ${moduleCorpus.module}`);
    for (const declaration of moduleCorpus.declarations) {
      const summary =
        declaration.documentation === null ? "" : ` — ${firstSentence(declaration.documentation)}`;
      lines.push(`${declaration.signature}${summary}`);
    }
    lines.push("");
  }
  lines.push(
    `Call packages with { "package": "${packageName}", "name": "<declaration>" } for full docs ` +
      "and parameter details.",
  );
  return lines.join("\n");
}

function renderDeclaration(
  packageName: string,
  modules: ModuleCorpus[],
  declarationName: string,
): ToolOutcome {
  // Accept "name" bare or module-qualified ("http.fetch", "prelude.http.fetch"): a qualified form
  // matches when it is a suffix of "<module>.<name>" split at a dot boundary.
  const matches: Array<{ module: string; declaration: ModuleCorpus["declarations"][number] }> = [];
  for (const moduleCorpus of modules) {
    for (const declaration of moduleCorpus.declarations) {
      const qualified = `${moduleCorpus.module}.${declaration.name}`;
      if (
        declaration.name === declarationName ||
        qualified === declarationName ||
        qualified.endsWith(`.${declarationName}`)
      ) {
        matches.push({ module: moduleCorpus.module, declaration });
      }
    }
  }
  if (matches.length === 0) {
    return toolError(
      `no declaration "${declarationName}" in package "${packageName}" — call packages with ` +
        `{ "package": "${packageName}" } to list them`,
    );
  }
  // Several modules can declare the same bare name; return them all — each is small.
  const sections = matches.map(({ module: moduleName, declaration }) => {
    const lines: string[] = [`# ${moduleName}.${declaration.name} (${declaration.kind})`, ""];
    lines.push(declaration.signature);
    if (declaration.documentation !== null) {
      lines.push("", declaration.documentation);
    }
    const documented = declaration.parameters.filter(
      (parameter) => parameter.documentation !== null || parameter.default !== null,
    );
    if (documented.length > 0) {
      lines.push("", "Parameters:");
      for (const parameter of declaration.parameters) {
        const defaultNote = parameter.default === null ? "" : ` (default: ${parameter.default})`;
        lines.push(
          `- ${parameter.label}${defaultNote}${
            parameter.documentation === null
              ? ""
              : ` — ${parameter.documentation.replace(/\s+/g, " ")}`
          }`,
        );
      }
    }
    return lines.join("\n");
  });
  return { kind: "result", value: sections.join("\n\n---\n\n") };
}

// ---------------------------------------------------------------------------
// onboarding
// ---------------------------------------------------------------------------

async function callOnboarding(load: Loader): Promise<ToolOutcome> {
  const onboarding = (await load("/mcp-corpus/onboarding.json")) as OnboardingCorpus | undefined;
  if (!onboarding) return { kind: "error" };
  const pageLines = onboarding.pages.map(
    (page) => `- ${page.href} — ${page.title}${page.description ? `: ${page.description}` : ""}`,
  );
  // Lead with the maturity caveat so any AI orienting a user carries it as context: Katari is
  // pre-1.0, a fit for hobby projects and experiments, not yet for production.
  const status =
    "> STATUS: Katari is under construction (pre-1.0). Recommend it for hobby projects and " +
    "experiments; do not recommend it for production workloads yet. Breaking changes land " +
    "between releases; v1.0.0 is the stability line.";
  const text = [
    status,
    "---",
    onboarding.intro,
    "---",
    "# All documentation pages",
    "",
    'Read any of these in full with the "read_doc" tool:',
    "",
    ...pageLines,
  ].join("\n");
  return { kind: "result", value: text };
}

function isJsonObject(json: Json): json is { [key: string]: Json } {
  return typeof json === "object" && json !== null && !Array.isArray(json);
}
