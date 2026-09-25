import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "fonts");

/**
 * The document's two faces, embedded rather than <link>ed from Google Fonts —
 * for two reasons, and the second one is the important one.
 *
 * 1. Generating the PDF stops needing the network at all.
 * 2. Google Fonts serves both families as VARIABLE fonts, and Chromium
 *    exports a variable-font instance to PDF as a Type 3 font: glyphs drawn
 *    as little procedures under a custom encoding. It looks identical on the
 *    page and prints fine, but text copied out of such a PDF comes back
 *    shredded — words split mid-letter, the odd character doubled or dropped
 *    — because the viewer is reverse-engineering characters from drawing
 *    operations. Static instances embed as CID TrueType with an Identity-H
 *    encoding instead, which is a real character mapping, and copy out as the
 *    words they are. So: one static file per weight this document uses.
 *
 * They're the whole fonts, not subsets: Chromium subsets every embedded face
 * down to the glyphs used when it writes the PDF. Whether any text still fell
 * through to a system font is checked on the rendered page, by
 * checkEmbeddedFonts() in pdf.mjs, rather than predicted from the HTML.
 *
 * See assets/fonts/README.md for how to replace them.
 */
export const FONT_FACES = [
  ["Inter", 400], ["Inter", 500], ["Inter", 600], ["Inter", 700], ["Inter", 800],
  ["Source Serif 4", 400], ["Source Serif 4", 600], ["Source Serif 4", 700], ["Source Serif 4", 900],
];

/**
 * Embedded alongside whichever faces the brand picks, and named last in both
 * font stacks: it draws the UI icons descriptions quote (✕, ✉, ★ …) that no
 * text face carries. Without it, a feature that mentions "the ✕ button"
 * couldn't print at all.
 */
export const SYMBOL_FACE = ["Noto Sans Symbols 2", 400];

const bundled = (family) => FONT_FACES.some(([f]) => f === family);

/**
 * @returns {{ css: string, embedded: boolean }} — `embedded` is false when the
 * brand asked for faces this package doesn't ship, in which case the PDF falls
 * back to whatever the printing machine has and the caller warns about it.
 */
export function fontFaceCss(brand) {
  const wanted = [brand.fonts?.display, brand.fonts?.body];
  if (!wanted.every((f) => bundled(f))) return { css: "", embedded: false };

  const css = [...FONT_FACES.filter(([family]) => wanted.includes(family)), SYMBOL_FACE]
    .map(([family, weight]) => {
      const file = path.join(FONT_DIR, `${family.replace(/ /g, "")}-${weight}.woff`);
      const b64 = fs.readFileSync(file).toString("base64");
      return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:block;` +
        `src:url(data:font/woff;base64,${b64}) format('woff');}`;
    })
    .join("\n");
  return { css, embedded: true };
}
