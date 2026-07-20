// The shapes of the MCP corpus files under `public/mcp-corpus/` (mirrored to `out/mcp-corpus/` at
// build). Single source of truth shared by the generator (`scripts/build-mcp-corpus.ts`) and the
// Worker endpoint (`worker/endpoint.ts`), so a change to the on-disk format is a type error on both
// sides. The Worker reads these lazily via `env.ASSETS.fetch`; nothing here touches `node:fs`.

/** `mcp-corpus/manifest.json` — the small pointer the Worker reads first to learn which docs version's
 *  search index (`search-index/<version>.json`, built separately) is current. */
export interface CorpusManifest {
  latestVersion: string;
  versions: string[];
}

/** One docs page in `mcp-corpus/docs.json`, keyed by its site href so a search hit's href round-trips
 *  straight into `read_doc`. `markdown` is the full page source with the `{docs}` / `{currentVersion}`
 *  link variables already expanded to real paths. */
export interface DocCorpusEntry {
  href: string;
  title: string;
  description: string | null;
  markdown: string;
}
export type DocsCorpus = { [href: string]: DocCorpusEntry };

/** `mcp-corpus/onboarding.json` — the pre-assembled orientation text plus the nav-ordered page map. */
export interface OnboardingCorpus {
  intro: string;
  pages: Array<{ title: string; href: string; description: string | null }>;
}

/** `mcp-corpus/packages/index.json` — the listing half (packages → modules) and a flat declaration
 *  mini-index (name / kind / first sentence) that `search` and `packages` both read. Signatures and
 *  full docs live in the per-module files to keep this index small. */
export interface PackageSummary {
  name: string;
  version: string;
  hasReadme: boolean;
  /** The README's first sentence, when the package ships one — a one-line tagline. */
  tagline: string | null;
  modules: Array<{ name: string; declarationCount: number }>;
}
export interface DeclarationIndexEntry {
  package: string;
  module: string;
  name: string;
  kind: string;
  firstSentence: string | null;
  /** The site anchor: `/packages/<pkg>#<module>.<name>`. */
  href: string;
}
export interface PackagesIndex {
  packages: PackageSummary[];
  declarations: DeclarationIndexEntry[];
}

/** One declaration in a per-module file `mcp-corpus/packages/<pkg>/<module>.json`. The wire schema
 *  (input/output JSON Schema) is deliberately omitted — it is bulky and not useful for an AI reading
 *  the surface API. */
export interface ModuleDeclaration {
  name: string;
  kind: string;
  signature: string;
  documentation: string | null;
  parameters: Array<{ label: string; documentation: string | null; default: string | null }>;
}
export interface ModuleCorpus {
  package: string;
  version: string;
  module: string;
  declarations: ModuleDeclaration[];
}

/** The subset of a `search-index/<version>.json` entry (built by `scripts/build-search-index.ts`)
 *  that the Worker's `search` tool reads. */
export interface DocSearchIndexEntry {
  href: string;
  title: string;
  description?: string;
  headings: string[];
  body: string;
}
