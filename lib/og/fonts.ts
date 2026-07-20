// satori (next/og) can't rasterize a variable font, so the OG images use static instances of the
// Lexend family. They are vendored under ./fonts as TrueType-flavoured WOFF subsets that carry every
// glyph an English title, the description, or the brand can use — so prerendering an OG image never
// reaches the network. (Regenerate them with scripts/vendor-og-fonts if the family or weights change.)
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// force-static OG routes render at build time, where the working directory is the project root.
const fontsDir = join(process.cwd(), "lib/og/fonts");

async function loadFont(file: string): Promise<ArrayBuffer> {
  const buffer = await readFile(join(fontsDir, file));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

export type OgFonts = {
  lexendRegular: ArrayBuffer;
  lexendBold: ArrayBuffer;
  lexendTeraBlack: ArrayBuffer;
};

export async function loadOgFonts(): Promise<OgFonts> {
  const [lexendRegular, lexendBold, lexendTeraBlack] = await Promise.all([
    loadFont("lexend-light.ttf"),
    loadFont("lexend-bold.ttf"),
    loadFont("lexend-tera-black.ttf"),
  ]);
  return { lexendRegular, lexendBold, lexendTeraBlack };
}
