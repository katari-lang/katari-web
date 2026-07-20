// Shared by the corpus generator (scripts/build-mcp-corpus.ts) and the Worker endpoint: the
// declaration mini-index stores first sentences, and the `packages` one-line rendering must cut
// docstrings at the same boundary. Lives under worker/ because the Worker bundle cannot import
// from scripts/ (Node-only), while tsx scripts can import from anywhere.

// Dotted abbreviations the docstrings actually use ("e.g." appears a dozen times) — their periods
// must not read as sentence boundaries. Masked to a control character during the boundary search.
const ABBREVIATION_PATTERN = /\b(?:e\.g\.|i\.e\.|etc\.)/gi;

/** The first sentence of a docstring / README paragraph, whitespace-normalized. Falls back to a
 *  truncated head when no sentence boundary is found. */
export function firstSentence(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const masked = normalized.replace(ABBREVIATION_PATTERN, (abbreviation) =>
    abbreviation.replaceAll(".", "\u0000"),
  );
  const match = masked.match(/^.*?[.!?](?=\s|$)/);
  if (match) return match[0].replaceAll("\u0000", ".");
  return normalized.length > 200 ? `${normalized.slice(0, 200)}…` : normalized;
}
