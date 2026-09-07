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
 * See assets/fonts/README.md for how to replace them.
 */
export const FONT_FACES = [
  ["Inter", 400], ["Inter", 500], ["Inter", 600], ["Inter", 700], ["Inter", 800],
  ["Source Serif 4", 400], ["Source Serif 4", 600], ["Source Serif 4", 700], ["Source Serif 4", 900],
];

/**
 * What the bundled files can actually draw — read out of their own `cmap`
 * tables by scripts/font-coverage.mjs, not maintained by hand, because a
 * hand-maintained list is exactly the thing that drifts and lets a missing
 * glyph reach a client's PDF. It's the *intersection* across every bundled
 * face: a character only one of them covers would still fall back.
 */
let coverage = null;
function ranges() {
  if (!coverage) coverage = JSON.parse(fs.readFileSync(path.join(FONT_DIR, "coverage.json"), "utf8"));
  return coverage.ranges;
}

const bundled = (family) => FONT_FACES.some(([f]) => f === family);

/**
 * @returns {{ css: string, embedded: boolean }} — `embedded` is false when the
 * brand asked for faces this package doesn't ship, in which case the PDF falls
 * back to whatever the printing machine has and the caller warns about it.
 */
export function fontFaceCss(brand) {
  const wanted = [brand.fonts?.display, brand.fonts?.body];
  if (!wanted.every((f) => bundled(f))) return { css: "", embedded: false };

  const css = FONT_FACES.filter(([family]) => wanted.includes(family))
    .map(([family, weight]) => {
      const file = path.join(FONT_DIR, `${family.replace(/ /g, "")}-${weight}.woff`);
      const b64 = fs.readFileSync(file).toString("base64");
      return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:block;` +
        `src:url(data:font/woff;base64,${b64}) format('woff');}`;
    })
    .join("\n");
  return { css, embedded: true };
}

/**
 * A character the embedded faces can't draw doesn't fail loudly — it silently
 * falls back to Arial for that one glyph, which nobody notices until the
 * client is holding the PDF. So fail here instead.
 *
 * The bundled faces cover Latin-1 and Latin Extended-A, so European names and
 * prose (Polish, Czech, Turkish, the Nordic languages) are safe. A script
 * outside that — Greek, Cyrillic, CJK — needs its own faces; see
 * assets/fonts/README.md.
 */
export function checkGlyphs(html) {
  const text = html.replace(/data:[^"')]+/g, ""); // skip the base64 payloads
  const rs = ranges();
  const missing = [...new Set([...text])].filter((c) => {
    const cp = c.codePointAt(0);
    if (cp < 0x20 || cp === 0x7f) return false; // newlines and tabs draw nothing
    return !rs.some(([lo, hi]) => cp >= lo && cp <= hi);
  });
  if (missing.length === 0) return;

  const list = missing
    .map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")} (${c})`)
    .join(", ");
  throw new Error(
    `the ledger uses characters the bundled fonts can't draw: ${list}. ` +
    "Either replace them in the text, or bundle faces that cover them and re-run " +
    "`node scripts/font-coverage.mjs` (see assets/fonts/README.md).",
  );
}
