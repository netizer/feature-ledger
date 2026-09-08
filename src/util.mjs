import fs from "node:fs";
import path from "node:path";

// Anything thrown with this is a message for the person (or agent) running
// the command, not a bug — bin/ledger.mjs prints it without a stack.
export class UserError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = "UserError";
    this.exitCode = exitCode;
  }
}

export const fail = (msg) => {
  throw new UserError(msg);
};

/**
 * The line every printed brief puts between the part addressed to the person
 * running the command and the part meant to be pasted into a coding agent.
 *
 * Shared rather than repeated because it is load-bearing: someone is going to
 * select from it to the end of the output, and three briefs that draw the
 * boundary three different ways teach them to look for three different things.
 */
export const COPY_RULE = "═════════════════════  COPY EVERYTHING BELOW THIS LINE  ═════════════════════";

export function readJson(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    fail(`can't read ${file}`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    fail(`${file} isn't valid JSON: ${e.message}`);
  }
}

// Every write goes through here so the corpus has exactly one formatting —
// 2-space indent, keys in the order the writer emitted them, one trailing
// newline. An agent editing one feature should produce a one-hunk diff, not
// a whole-file reflow because its JSON serializer disagreed about spacing.
export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

export function exists(p) {
  return fs.existsSync(p);
}

export const isBlank = (v) => v === null || v === undefined || String(v).trim() === "";

export function slugify(s) {
  return String(s)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

export function titleSlug(s) {
  // For filenames a client sees (Acme-Bookings-Feature-Ledger_3.pdf), so
  // words keep their capitals and only the spaces collapse.
  return String(s)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// "2026-08-21" -> "August 21, 2026". Parsed by hand rather than through Date,
// which would drag the machine's timezone into a date that has none.
export function longDate(iso) {
  if (isBlank(iso)) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).trim());
  if (!m) return String(iso);
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

export const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * A deliberately small flag parser: `--flag value`, `--flag=value`, bare
 * `--flag` booleans, `--no-flag`, and positionals. Repeated flags collect
 * into an array, which is what lets `--change "…" --change "…"` work.
 */
export function parseArgs(argv, { booleans = [] } = {}) {
  const flags = {};
  const positional = [];
  const put = (k, v) => {
    if (k in flags) flags[k] = [].concat(flags[k], v);
    else flags[k] = v;
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const body = a.slice(2);
    const eq = body.indexOf("=");
    if (eq !== -1) {
      put(body.slice(0, eq), body.slice(eq + 1));
      continue;
    }
    if (body.startsWith("no-")) {
      flags[body.slice(3)] = false;
      continue;
    }
    const next = argv[i + 1];
    if (booleans.includes(body) || next === undefined || next.startsWith("--")) {
      flags[body] = true;
    } else {
      put(body, next);
      i++;
    }
  }
  return { flags, positional };
}

export const asList = (v) => (v === undefined ? [] : [].concat(v));

/** Read a whole stdin stream — how every mutating command takes its payload. */
export async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/* ---------------------------------------------------------------------- *
 * Color — used to derive a whole accent family from the one hex a client
 * actually gives you. See src/render/brand.mjs.
 * ---------------------------------------------------------------------- */

export function hexToHsl(hex) {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(hex).trim());
  if (!m) fail(`not a hex color: ${hex}`);
  let h6 = m[1];
  if (h6.length === 3) h6 = h6.split("").map((c) => c + c).join("");
  const r = parseInt(h6.slice(0, 2), 16) / 255;
  const g = parseInt(h6.slice(2, 4), 16) / 255;
  const b = parseInt(h6.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

export function hslToHex({ h, s, l }) {
  const hh = ((h % 360) + 360) % 360;
  const ss = Math.min(100, Math.max(0, s)) / 100;
  const ll = Math.min(100, Math.max(0, l)) / 100;
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  const seg = Math.floor(hh / 60) % 6;
  const [r, g, b] = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ][seg];
  const hex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
