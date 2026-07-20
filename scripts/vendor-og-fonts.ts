/**
 * Vendor the static Lexend instances the OG images need into lib/og/fonts, so `next build` never
 * fetches a font while prerendering an image (a build-time reach to fonts.googleapis.com times out
 * on locked-down CI, and the whole export fails). Run this only when the family or weights change:
 *
 *   pnpm tsx scripts/vendor-og-fonts.ts
 *
 * Lexend and Lexend Tera are licensed under the SIL Open Font License 1.1, which permits bundling
 * and redistribution. Source: https://fonts.google.com/specimen/Lexend (and .../Lexend+Tera).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "lib", "og", "fonts");
mkdirSync(outDir, { recursive: true });

// An ancient User-Agent makes the CSS API serve TrueType (a modern UA yields WOFF2, which satori
// cannot parse).
const userAgent =
  "Mozilla/5.0 (Windows NT 6.1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/41.0.2272.118 Safari/537.36";

// Every glyph an English doc title, the site description, or the brand can use. Requesting an
// explicit text= returns one font whose first @font-face already carries all of them, sidestepping
// the "which subset did we get" ambiguity of an unscoped request.
const ogText =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 " +
  "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~" +
  "–—‘’“”…";

async function vendor(family: string, weight: number, outFile: string): Promise<void> {
  const cssUrl =
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}` +
    `&text=${encodeURIComponent(ogText)}`;
  const cssResponse = await fetch(cssUrl, { headers: { "User-Agent": userAgent } });
  if (!cssResponse.ok) {
    throw new Error(`Google Fonts CSS fetch failed for ${family} ${weight}: ${cssResponse.status}`);
  }
  const css = await cssResponse.text();
  const match = css.match(/url\((https?:\/\/[^)]+)\)\s*format\(['"]?(?:truetype|woff|opentype)/);
  if (!match) {
    throw new Error(`Could not extract a TrueType URL for ${family} ${weight}\nCSS:\n${css}`);
  }
  const fontResponse = await fetch(match[1]!);
  if (!fontResponse.ok) {
    throw new Error(`Font binary fetch failed: ${match[1]} (${fontResponse.status})`);
  }
  const bytes = Buffer.from(await fontResponse.arrayBuffer());
  writeFileSync(join(outDir, outFile), bytes);
  console.log(`[og-fonts] ${family} ${weight} -> ${outFile} (${bytes.length} bytes)`);
}

async function main(): Promise<void> {
  await vendor("Lexend", 300, "lexend-light.ttf");
  await vendor("Lexend", 700, "lexend-bold.ttf");
  await vendor("Lexend Tera", 900, "lexend-tera-black.ttf");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
