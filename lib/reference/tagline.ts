// A package's one-line description, derived from its generated README. Shared by the build
// scripts that need a listing line for every package: the MCP corpus (scripts/build-mcp-corpus.ts)
// and /llms.txt (scripts/build-llms-txt.ts). Node-only — it reads content/reference/.

import { firstSentence } from "../../worker/first-sentence";
import { getPackageReadme } from "./data";

/** The generated READMEs open with `# <name> — <tagline>`, so the H1 tail is the intended
 *  one-liner; the first body sentence is the fallback. `null` when the package ships no README. */
export function packageTagline(packageName: string): string | null {
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
