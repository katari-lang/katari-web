// Prepares a package README for embedding in the reference package page.

/** The package page already carries the h1 (the package name), so every README heading is
 *  demoted one level (h1 → h2, capped at h6) to keep the page outline sound. READMEs are
 *  plain markdown, so `<https://…>` autolinks — which MDX rejects as malformed JSX — are
 *  rewritten to explicit links. Lines inside fenced code blocks are left untouched — a
 *  `# comment` there is not a heading and a `<url>` there is code. */
export function prepareReadme(markdown: string): string {
  let insideFence = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        insideFence = !insideFence;
        return line;
      }
      if (insideFence) return line;
      return line
        .replace(/^(#{1,6})(?=\s)/, (hashes) => "#".repeat(Math.min(hashes.length + 1, 6)))
        .replace(/<(https?:\/\/[^ >]+)>/g, (_match, url: string) => `[${url}](${url})`);
    })
    .join("\n");
}
