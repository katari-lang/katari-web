/**
 * Generate public/llms.txt — the llms.txt convention: one markdown file listing every page of the
 * site as a link plus a one-line description, so an AI client that reads URLs (rather than calling
 * the MCP tools) can find its way in one fetch.
 *
 * Built from the same sources the site renders (nav order + frontmatter + the reference index), for
 * the same reason the search index and the MCP corpus are: a hand-written list drifts. Runs before
 * `next build`; `output: "export"` copies public/ into out/, so the file is served at /llms.txt.
 */
import fs from "node:fs";
import path from "node:path";
import { getDoc, getNavigation, latestVersion, stripMarkdown } from "../lib/content";
import { listReferencePackages } from "../lib/reference/data";
import { packageTagline } from "../lib/reference/tagline";
import { siteConfig } from "../lib/site-config";
import { firstSentence } from "../worker/first-sentence";

const base = siteConfig.url.replace(/\/$/, "");
const version = latestVersion();

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** A page's one-liner: the frontmatter description, or the first sentence of the body. */
function summarize(description: string | undefined, body: string): string {
  if (description !== undefined && description.trim() !== "") return oneLine(description);
  return firstSentence(stripMarkdown(body));
}

const lines: string[] = [
  `# ${siteConfig.name}`,
  "",
  `> ${siteConfig.description} Agents are functions, the effects they may perform are visible in their types, and execution is durable — a run survives restarts and can park on a human's answer for days.`,
  "",
  `Katari is under construction (pre-1.0). It is a good fit for hobby projects and experiments; breaking changes land between releases, so hold off on production workloads until v1.0.0. The documentation below is ${version}, the current release.`,
  "",
  "Every page listed here also serves its raw markdown through the documentation MCP server at " +
    `${base}/mcp — a stateless Streamable HTTP endpoint with four tools: onboarding, search, ` +
    "read_doc, and packages. See " +
    `${base}/docs/${version}/getting-started/docs-for-ai-agents.`,
];

// Docs — one section per nav category, in nav order, so the file reads in the site's own order.
let pageCount = 0;
for (const section of getNavigation(version).sections) {
  const bullets: string[] = [];
  for (const item of section.items) {
    const doc = getDoc(version, item.slug);
    if (!doc) continue;
    const summary = summarize(doc.frontmatter.description, doc.body);
    bullets.push(`- [${doc.frontmatter.title}](${base}${doc.href}): ${summary}`);
    pageCount += 1;
  }
  if (bullets.length === 0) continue;
  lines.push("", `## ${section.label}`, "", ...bullets);
}

// Packages — the generated API reference, one line per package.
const packages = listReferencePackages();
if (packages.length > 0) {
  const bullets = packages.map((entry) => {
    // `prelude` ships no README (it is the language's own standard library, documented by the
    // pages above), so it has no tagline to read.
    const tagline =
      packageTagline(entry.name) ??
      (entry.name === "prelude" ? "The Katari standard library." : "Package API reference.");
    return `- [${entry.name}](${base}/packages/${entry.name}): ${oneLine(tagline)} (v${entry.version})`;
  });
  lines.push(
    "",
    "## Package reference",
    "",
    `Every declaration of every published package, with signatures and parameter docs. Listing: ${base}/packages`,
    "",
    ...bullets,
  );
}

lines.push("");

const outPath = path.join(process.cwd(), "public", "llms.txt");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lines.join("\n"));
console.log(
  `[llms-txt] ${pageCount} pages, ${packages.length} packages → ${path.relative(process.cwd(), outPath)}`,
);
