// Shiki highlighting for reference signature blocks, using the same katari grammar and dual
// themes as the MDX pipeline (lib/mdx/options.ts) so code looks identical across /docs and
// /reference. The `--shiki-light` / `--shiki-dark` variables are switched by the
// `.reference-code` rules in app/globals.css.

import { createHighlighter, type Highlighter, type LanguageRegistration } from "shiki";
import katariGrammarRaw from "@katari-lang/language/grammar";

const katariGrammar: LanguageRegistration = {
  ...(katariGrammarRaw as unknown as LanguageRegistration),
  name: "katari",
};

// A highlighter is expensive to create; share one across every declaration render.
let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighter({
    themes: ["github-light", "github-dark"],
    langs: [katariGrammar],
  });
  return highlighterPromise;
}

/** Highlight a Katari snippet to HTML with per-token light/dark CSS variables. */
export async function highlightKatari(code: string): Promise<string> {
  const highlighter = await getHighlighter();
  return highlighter.codeToHtml(code, {
    lang: "katari",
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
  });
}
