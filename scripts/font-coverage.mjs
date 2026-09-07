#!/usr/bin/env node
/**
 * Regenerates assets/fonts/coverage.json — the exact set of codepoints the
 * bundled font files can actually draw.
 *
 * Run it after replacing or adding a font file. It reads the `cmap` straight
 * out of each WOFF rather than trusting a hand-maintained list of ranges,
 * because a hand-maintained list is exactly the thing that goes quietly out
 * of date and lets a missing glyph reach a client's PDF as a silent Arial
 * fallback.
 *
 *   node scripts/font-coverage.mjs
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "fonts");

/** Pull one table out of a WOFF container, inflating it if it's compressed. */
function woffTable(buf, wanted) {
  if (buf.toString("ascii", 0, 4) !== "wOFF") throw new Error("not a WOFF file");
  const numTables = buf.readUInt16BE(12);
  for (let i = 0; i < numTables; i++) {
    const off = 44 + i * 20;
    const tag = buf.toString("ascii", off, off + 4);
    const offset = buf.readUInt32BE(off + 4);
    const compLength = buf.readUInt32BE(off + 8);
    const origLength = buf.readUInt32BE(off + 12);
    if (tag !== wanted) continue;
    const slice = buf.subarray(offset, offset + compLength);
    return compLength < origLength ? zlib.inflateSync(slice) : slice;
  }
  return null;
}

/** Codepoints in a cmap subtable — formats 4 and 12, which is everything a
 *  modern Google Fonts file uses. */
function readSubtable(cmap, off, into) {
  const format = cmap.readUInt16BE(off);
  if (format === 4) {
    const segX2 = cmap.readUInt16BE(off + 6);
    const seg = segX2 / 2;
    const ends = off + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const ranges = deltas + segX2;
    for (let i = 0; i < seg; i++) {
      const end = cmap.readUInt16BE(ends + i * 2);
      const start = cmap.readUInt16BE(starts + i * 2);
      const delta = cmap.readInt16BE(deltas + i * 2);
      const rangeOffset = cmap.readUInt16BE(ranges + i * 2);
      if (start === 0xffff) continue;
      for (let c = start; c <= end && c !== 0x10000; c++) {
        let gid;
        if (rangeOffset === 0) {
          gid = (c + delta) & 0xffff;
        } else {
          const gi = ranges + i * 2 + rangeOffset + (c - start) * 2;
          if (gi + 1 >= cmap.length) continue;
          gid = cmap.readUInt16BE(gi);
          if (gid !== 0) gid = (gid + delta) & 0xffff;
        }
        if (gid !== 0) into.add(c);
      }
    }
  } else if (format === 12) {
    const nGroups = cmap.readUInt32BE(off + 12);
    for (let i = 0; i < nGroups; i++) {
      const g = off + 16 + i * 12;
      const start = cmap.readUInt32BE(g);
      const end = cmap.readUInt32BE(g + 4);
      for (let c = start; c <= end; c++) into.add(c);
    }
  }
}

function coverage(file) {
  const cmap = woffTable(fs.readFileSync(file), "cmap");
  if (!cmap) throw new Error(`${file}: no cmap table`);
  const numTables = cmap.readUInt16BE(2);
  const set = new Set();
  for (let i = 0; i < numTables; i++) {
    const rec = 4 + i * 8;
    readSubtable(cmap, cmap.readUInt32BE(rec + 4), set);
  }
  return set;
}

/** Collapse a sorted codepoint list into [start, end] ranges. */
function toRanges(sorted) {
  const out = [];
  for (const c of sorted) {
    const last = out[out.length - 1];
    if (last && c === last[1] + 1) last[1] = c;
    else out.push([c, c]);
  }
  return out;
}

const files = fs.readdirSync(FONT_DIR).filter((f) => f.endsWith(".woff")).sort();
if (!files.length) throw new Error(`no .woff files in ${FONT_DIR}`);

// The intersection, not the union: a character is only safe if EVERY bundled
// face can draw it. A word set in the serif that only the sans covers would
// fall back for that one glyph, which is the failure this exists to catch.
let common = null;
for (const f of files) {
  const set = coverage(path.join(FONT_DIR, f));
  common = common === null ? set : new Set([...common].filter((c) => set.has(c)));
  process.stdout.write(`${f.padEnd(26)} ${set.size} codepoints\n`);
}

const ranges = toRanges([...common].sort((a, b) => a - b));
fs.writeFileSync(
  path.join(FONT_DIR, "coverage.json"),
  `${JSON.stringify({ files, codepoints: common.size, ranges }, null, 0)}\n`,
);
process.stdout.write(`\ncommon to all ${files.length}: ${common.size} codepoints in ${ranges.length} ranges → assets/fonts/coverage.json\n`);
