import fs from "node:fs";
import path from "node:path";
import { escapeHtml, exists, hexToHsl, hslToHex } from "../util.mjs";

/*
 * THE PALETTE — three jobs, three hue families, no overlap.
 *
 *   1. The ACCENT is the document's own voice: rules, section numbers, and
 *      the Big/Medium/Small scale. It's the one hue a new client re-tunes.
 *   2. GREEN means new since last time. Nothing else is ever green.
 *   3. BLUE means reworked since last time. Nothing else is ever blue.
 *
 * Which is why the accent may not itself be green, blue or teal: a warm
 * accent can never be misread as one of the two "what's different" colours.
 * `ledger check` warns when a brand picks one that can.
 *
 * A client gives you one hex. The other four accent tints are derived from
 * it below by the same relationships the hand-tuned original used, so a
 * whole coherent family drops out of `"accent": "#1f6f8b"`. Any of them can
 * still be pinned explicitly in brand.json when a brand guide says so.
 */
const RESERVED_HUES = [[145, 200], [200, 265]]; // green-through-teal, and blue

export function resolveBrand(brand) {
  const accent = brand.accent ?? "#8e2a58";
  const { h, s, l } = hexToHsl(accent);

  const derived = {
    accent,
    // A darker, slightly more saturated cousin: the ink for accent-coloured
    // text that has to hold up at 9pt on white.
    accent_deep: hslToHex({ h, s: Math.min(s + 5, 100), l: l * 0.7 }),
    // Muted and lifted — the label ink on the palest chip, where full
    // saturation would shout.
    accent_quiet: hslToHex({ h: h - 5, s: s * 0.42, l: Math.min(l * 1.22, 55) }),
    // The two backgrounds. Fixed lightness rather than scaled, because
    // "pale enough to print type on" is an absolute, not a ratio.
    accent_mid: hslToHex({ h: h - 8, s: 45, l: 81 }),
    accent_pale: hslToHex({ h: h - 8, s: 45, l: 92 }),
  };

  return {
    ...derived,
    ...Object.fromEntries(
      ["accent_deep", "accent_quiet", "accent_mid", "accent_pale"]
        .filter((k) => brand[k])
        .map((k) => [k, brand[k]]),
    ),
    name: brand.name,
    fonts: brand.fonts ?? { display: "Source Serif 4", body: "Inter" },
    logo: brand.logo ?? null,
    logo_height: brand.logo_height ?? 32,
  };
}

/** True when the chosen accent collides with green ("new") or blue ("updated"). */
export function accentCollides(accent) {
  const { h, s } = hexToHsl(accent);
  if (s < 12) return false; // a near-grey can't be mistaken for either
  return RESERVED_HUES.some(([lo, hi]) => h >= lo && h < hi);
}

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp" };

/**
 * The masthead. A logo file if brand.json points at one — embedded as a data
 * URI so a finished PDF never depends on a path — and otherwise the product
 * name set as a wordmark, which is a perfectly respectable front page and
 * means a new project produces a real-looking ledger before anyone has found
 * the client's asset files.
 */
export function mastheadHtml(brand, root) {
  if (brand.logo) {
    const file = path.resolve(root, brand.logo);
    if (!exists(file)) {
      throw new Error(`brand.json points at a logo that isn't there: ${brand.logo} (looked in ${file})`);
    }
    const mime = MIME[path.extname(file).toLowerCase()];
    if (!mime) throw new Error(`unsupported logo type: ${path.extname(file)} — use PNG, JPG, SVG or WebP`);
    const b64 = fs.readFileSync(file).toString("base64");
    return `<img src="data:${mime};base64,${b64}" alt="${escapeHtml(brand.name)}" style="height:${brand.logo_height}px">`;
  }
  return `<div class="wordmark">${escapeHtml(brand.name)}</div>`;
}
