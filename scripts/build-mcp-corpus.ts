/**
 * Generate the MCP corpus under public/mcp-corpus/ for the `/mcp` Worker (worker/index.ts).
 * Runs before `next build` (same pattern as scripts/build-search-index.ts) so the corpus rides
 * into out/ as static assets the Worker reads lazily via its ASSETS binding.
 *
 * Outputs:
 *   manifest.json                     — the docs version pointer
 *   docs.json                         — href → full page markdown (the `read_doc` tool)
 *   onboarding.json                   — orientation text + nav-ordered page map (`onboarding`)
 *   packages/index.json               — package/module listing + declaration mini-index
 *   packages/<pkg>/<module>.json      — per-module declaration docs (`packages`, staged loads)
 */
import fs from "node:fs";
import path from "node:path";
import { getDoc, getNavigation, latestVersion, listVersions } from "../lib/content";
import { getPackageDocs, getPackageReadme, listReferencePackages } from "../lib/reference/data";
import type { Declaration } from "../lib/reference/types";
import type {
  CorpusManifest,
  DeclarationIndexEntry,
  DocsCorpus,
  ModuleCorpus,
  OnboardingCorpus,
  PackageSummary,
  PackagesIndex,
} from "../worker/corpus-types";
import { firstSentence } from "../worker/first-sentence";

const outDir = path.join(process.cwd(), "public", "mcp-corpus");
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, "packages"), { recursive: true });

function writeJson(relativePath: string, value: unknown): void {
  const filePath = path.join(outDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value));
  console.log(`[mcp-corpus] ${path.relative(process.cwd(), filePath)}`);
}

/** Expand the `{docs}` / `{currentVersion}` / `{latestVersion}` link variables the docs sources
 *  use (lib/mdx/resolve-href.ts) so the corpus carries real, followable paths. */
function expandLinkVariables(markdown: string, version: string): string {
  return markdown
    .replaceAll("{docs}", "/docs")
    .replaceAll("{currentVersion}", version)
    .replaceAll("{latestVersion}", latestVersion());
}

// ---------------------------------------------------------------------------
// manifest.json
// ---------------------------------------------------------------------------

const versions = listVersions();
const version = latestVersion();
const manifest: CorpusManifest = { latestVersion: version, versions };
writeJson("manifest.json", manifest);

// ---------------------------------------------------------------------------
// docs.json + onboarding.json — both walk the same nav, so build them together.
// ---------------------------------------------------------------------------

const navigation = getNavigation(version);
const docs: DocsCorpus = {};
const pages: OnboardingCorpus["pages"] = [];
for (const section of navigation.sections) {
  for (const item of section.items) {
    const doc = getDoc(version, item.slug);
    if (!doc) continue;
    docs[doc.href] = {
      href: doc.href,
      title: doc.frontmatter.title,
      description: doc.frontmatter.description ?? null,
      markdown: expandLinkVariables(doc.body, version),
    };
    pages.push({
      title: doc.frontmatter.title,
      href: doc.href,
      description: doc.frontmatter.description ?? null,
    });
  }
}
writeJson("docs.json", docs);

/** The onboarding intro: the "what is Katari" page and the quickstart, joined as one read so an
 *  AI that knows nothing about Katari can orient and write a first program without extra calls. */
function onboardingIntro(): string {
  const parts: string[] = [];
  for (const slug of [["getting-started"], ["getting-started", "quickstart"]]) {
    const doc = getDoc(version, slug);
    if (!doc) continue;
    const header = doc.frontmatter.description
      ? `# ${doc.frontmatter.title}\n\n${doc.frontmatter.description}`
      : `# ${doc.frontmatter.title}`;
    parts.push(`${header}\n\n${expandLinkVariables(doc.body, version)}`);
  }
  return parts.join("\n\n---\n\n");
}

const onboarding: OnboardingCorpus = { intro: onboardingIntro(), pages };
writeJson("onboarding.json", onboarding);

// ---------------------------------------------------------------------------
// packages/ — the reference JSON split per module, plus the listing/mini-index.
// ---------------------------------------------------------------------------

/** A package's one-line tagline. The generated READMEs open with `# <name> — <tagline>`, so the
 *  H1 tail is the intended one-liner; the first body sentence is the fallback. */
function taglineOf(packageName: string): string | null {
  const readme = getPackageReadme(packageName);
  if (readme === undefined) return null;
  const heading = readme.match(/^#\s+(.+)$/m);
  if (heading) {
    const tail = heading[1]!.split("—")[1]?.trim();
    if (tail) return tail;
  }
  const paragraph = readme
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .find((block) => block !== "" && !block.startsWith("#"));
  return paragraph ? firstSentence(paragraph) : null;
}

/** The per-module corpus row for one declaration — everything the site's declaration card shows
 *  except the wire schema (bulky, and the surface signature is what an AI reads). */
function declarationRow(declaration: Declaration): ModuleCorpus["declarations"][number] {
  return {
    name: declaration.name,
    kind: declaration.kind,
    signature: declaration.signature,
    documentation: declaration.documentation,
    parameters: declaration.parameters.map((parameter) => ({
      label: parameter.label,
      documentation: parameter.documentation,
      default: parameter.default === null ? null : parameter.default.rendered,
    })),
  };
}

const summaries: PackageSummary[] = [];
const declarationIndex: DeclarationIndexEntry[] = [];
for (const entry of listReferencePackages()) {
  const packageDocs = getPackageDocs(entry.name);
  if (!packageDocs) {
    console.warn(`[mcp-corpus] content/reference/${entry.name}.json not found — skipped`);
    continue;
  }
  summaries.push({
    name: entry.name,
    version: entry.version,
    hasReadme: entry.hasReadme,
    tagline: taglineOf(entry.name),
    modules: packageDocs.modules.map((module) => ({
      name: module.name,
      declarationCount: module.declarations.length,
    })),
  });
  for (const docsModule of packageDocs.modules) {
    const corpus: ModuleCorpus = {
      package: entry.name,
      version: entry.version,
      module: docsModule.name,
      declarations: docsModule.declarations.map(declarationRow),
    };
    writeJson(path.join("packages", entry.name, `${docsModule.name}.json`), corpus);
    for (const declaration of docsModule.declarations) {
      declarationIndex.push({
        package: entry.name,
        module: docsModule.name,
        name: declaration.name,
        kind: declaration.kind,
        firstSentence:
          declaration.documentation === null ? null : firstSentence(declaration.documentation),
        href: `/packages/${entry.name}#${docsModule.name}.${declaration.name}`,
      });
    }
  }
}

const packagesIndex: PackagesIndex = { packages: summaries, declarations: declarationIndex };
writeJson(path.join("packages", "index.json"), packagesIndex);

console.log(
  `[mcp-corpus] ${Object.keys(docs).length} docs, ${summaries.length} packages, ${declarationIndex.length} declarations`,
);
