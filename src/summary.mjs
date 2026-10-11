import crypto from "node:crypto";
import { isBlank, longDate } from "./util.mjs";

/**
 * The short lists an edition opens with, from the second edition on: what's
 * new, what changed and, when there is any, what was already in place.
 *
 * They are written once per release, from the whole release, rather than one
 * sentence per entry as each entry is recorded. What a client finds worth
 * reading on that page is a judgment about the release, not about an entry:
 * three changes to the booking form, the fee and the day-of form are one item
 * when all three follow from booking with only a city, and a change can be
 * interesting for something it implies rather than for what its bullet says.
 * Nobody recording one entry can see either. So each item says what it says
 * in its own words and lists the entries it sums up (`covers`), and every
 * entry the edition prints as news is either covered or deliberately left
 * out (`quiet`).
 *
 * It lives in .ledger/summaries.json, one per release. The items, `covers`
 * and `quiet` are written by hand or by an agent; `ledger summary complete`
 * stamps `date`, `commit` and `entries`, a fingerprint of each entry as it
 * read when the summary was written. That stamp is what makes "is it up to
 * date?" a question with an answer: an entry recorded, changed or dropped
 * since then puts the summary out of date, and `ledger cut` refuses it.
 * Editing an item's text afterwards doesn't, since nothing it was written
 * from has moved.
 */

/** The lists, in the order the edition prints them, keyed as in the file. */
export const LISTS = [["new", "What's new"], ["changed", "What changed"], ["in_place", "Already in place"]];

/** Long enough that it has stopped being an item in a list. */
export const ITEM_LIMIT = 160;

/* ---- what the client reads -------------------------------------------- */

/**
 * An entry's words as the client reads them, which is what both the summary
 * and the review fingerprint: confirming an inferred reason or editing dev
 * notes changes the file without changing anything a summary or a review was
 * written from.
 */
export function entryWords(h) {
  return h.removed
    ? { removed: true, reason: h.reason, backfilled: Boolean(h.backfilled) }
    : { name: h.name ?? null, description: h.description, changes: h.changes ?? null, backfilled: Boolean(h.backfilled) };
}

export function fingerprint(words) {
  return crypto.createHash("sha256").update(JSON.stringify(words)).digest("hex").slice(0, 16);
}

/* ---- which entries it sums up ----------------------------------------- */

/**
 * Whether `version`'s edition prints a summary at all: only when it is
 * compared with an earlier one. A first edition, and the first after a
 * redraft, print as an inventory.
 */
export function printsSummary(project, version) {
  return Boolean(project.releases.predecessorOf(version));
}

/**
 * The entries the summary has to account for, in reading order: every
 * client-facing entry recorded at `version` that is still in the product.
 * Removals and product-wide notes list themselves, under their own headings.
 */
export function summaryTargets(project, version) {
  const set = project.featureSet;
  const user = set.features({ audience: "user" });
  return set.categories({ audience: "user" })
    .flatMap((category) => set.bySize(user.filter((f) => f.category === category)))
    .filter((f) => {
      const h = f.entryAt(version);
      return Boolean(h) && !h.removed;
    });
}

/** How the edition draws an entry at `version`: "new", "updated" or "in place". */
export function kindAt(feature, version) {
  if (feature.entryAt(version).backfilled) return "in place";
  return feature.firstVersion === version ? "new" : "updated";
}

/** Every item, with the list it is in. */
export function summaryItems(summary) {
  return LISTS.flatMap(([key]) => (Array.isArray(summary?.[key]) ? summary[key] : []).map((item) => ({ list: key, ...item })));
}

/* ---- what is wrong with one ------------------------------------------- */

/**
 * What is wrong with an item's text on its face. Each item is a sentence of
 * its own, so it starts with a capital: one that opens on a command or a file
 * name reads as a fragment in a list of sentences, and the fix is to reword
 * it, never to capitalize the command.
 */
export function itemTextProblems(text) {
  const problems = [];
  if (/^[^A-Z0-9“"‘'(]/.test(text.trim())) problems.push("starts with a lower-case letter");
  if (text.length > ITEM_LIMIT) problems.push(`runs past ${ITEM_LIMIT} characters`);
  return problems;
}

/** What makes the file unreadable as a summary, as short sentences. */
export function shapeProblems(summary) {
  const problems = [];
  for (const [key] of LISTS) {
    if (summary[key] !== undefined && !Array.isArray(summary[key])) problems.push(`"${key}" is a list of items`);
  }
  if (summary.quiet !== undefined && !(Array.isArray(summary.quiet) && summary.quiet.every((id) => typeof id === "string"))) {
    problems.push("\"quiet\" is a list of entry ids");
  }
  for (const item of summaryItems(summary)) {
    const where = `an item in "${item.list}"`;
    if (typeof item.text !== "string" || isBlank(item.text)) problems.push(`${where} has no "text"`);
    if (!Array.isArray(item.covers) || !item.covers.length || !item.covers.every((id) => typeof id === "string")) {
      problems.push(`${where} (${clip(String(item.text ?? ""), 40)}) needs "covers": the ids of the entries it sums up`);
    }
  }
  return problems;
}

/**
 * Whether a summary accounts for the release as it stands, whatever its
 * stamp says: every entry covered or quiet, nothing named that isn't an
 * entry, and every item well formed. What `summary complete` and
 * `review complete` refuse.
 */
export function accountingProblems(project, version, summary) {
  const targets = summaryTargets(project, version);
  const ids = new Set(targets.map((f) => f.id));
  const named = new Set([
    ...summaryItems(summary).flatMap((i) => (Array.isArray(i.covers) ? i.covers : [])),
    ...(Array.isArray(summary.quiet) ? summary.quiet : []),
  ]);
  const problems = [...shapeProblems(summary)];
  const uncovered = targets.filter((f) => !named.has(f.id)).map((f) => f.id);
  if (uncovered.length) {
    problems.push(`in no item's "covers" and not in "quiet": ${uncovered.join(", ")}. Every client-facing entry in ` +
      `v${version} is summed up by an item or left out on purpose`);
  }
  const unknown = [...named].filter((id) => !ids.has(id));
  if (unknown.length) {
    problems.push(`not a client-facing entry in v${version}: ${unknown.join(", ")}. \`ledger summary\` lists the ones that are`);
  }
  return problems;
}

/** Text problems per item, for `ledger status` and `summary complete`. */
export function textProblems(summary) {
  return summaryItems(summary)
    .filter((item) => typeof item.text === "string")
    .map((item) => [item.text, itemTextProblems(item.text)])
    .filter(([, problems]) => problems.length);
}

/* ---- is it up to date ------------------------------------------------- */

/** The fingerprint of every entry the summary has to account for, by id. */
export function currentFingerprints(project, version) {
  return Object.fromEntries(summaryTargets(project, version)
    .map((f) => [f.id, fingerprint(entryWords(f.entryAt(version)))]));
}

/** The summary for the open release, checked. See `summaryReportFor`. */
export function summaryReport(project) {
  const current = project.releases.current;
  if (!current.future) return { ok: true, reason: "no release in progress" };
  return summaryReportFor(project, current.version);
}

/**
 * Whether `version`'s summary can be printed as it stands. `ok` when there is
 * nothing to summarize (a first edition, or nothing client-facing recorded
 * yet), or when the summary accounts for every entry, is well formed, and
 * nothing it was written from has moved since `ledger summary complete`.
 */
export function summaryReportFor(project, version) {
  if (!printsSummary(project, version)) return { ok: true, reason: "a first edition prints no summary" };
  const targets = summaryTargets(project, version);
  if (!targets.length) return { ok: true, reason: "nothing client-facing recorded yet" };

  const summary = project.summaryOf(version);
  const base = { version, summary, total: targets.length };
  if (!summary) return { ...base, ok: false, missing: true };

  const ids = new Set(targets.map((f) => f.id));
  const problems = shapeProblems(summary);
  const items = summaryItems(summary);
  const named = new Set([
    ...items.flatMap((i) => (Array.isArray(i.covers) ? i.covers : [])),
    ...(Array.isArray(summary.quiet) ? summary.quiet : []),
  ]);
  const seen = summary.entries ?? null;
  const now = currentFingerprints(project, version);

  const added = seen ? targets.map((f) => f.id).filter((id) => !(id in seen)) : [];
  const changed = seen ? targets.map((f) => f.id).filter((id) => id in seen && seen[id] !== now[id]) : [];
  const dropped = seen ? Object.keys(seen).filter((id) => !ids.has(id)) : [];
  const uncovered = targets.map((f) => f.id).filter((id) => !named.has(id) && !added.includes(id));
  const unknown = [...named].filter((id) => !ids.has(id) && !dropped.includes(id));

  const ok = Boolean(seen) && !problems.length && ![added, changed, dropped, uncovered, unknown].some((l) => l.length);
  return { ...base, ok, incomplete: !seen, problems, added, changed, dropped, uncovered, unknown };
}

const list = (ids) => ids.slice(0, 6).join(", ") + (ids.length > 6 ? `, and ${ids.length - 6} more` : "");
const entries = (n) => `${n} entr${n === 1 ? "y" : "ies"}`;
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** One sentence for the cut check, `ledger status` and `preview`, so they can't drift. */
export function summaryLine(report) {
  if (report.ok) {
    if (report.reason) return report.reason;
    return `the summary of v${report.version} accounts for all ${entries(report.total)}, and none has changed since ` +
      `it was written${report.summary.date ? ` (${longDate(report.summary.date)})` : ""}`;
  }
  const V = `v${report.version}`;
  if (report.missing) {
    return `${V} has no summary yet, so its edition would open with ${entries(report.total)} listed by name`;
  }
  const parts = [];
  if (report.incomplete) parts.push("it was never marked complete");
  if (report.added.length) parts.push(`${entries(report.added.length)} recorded since (${list(report.added)})`);
  if (report.changed.length) parts.push(`${report.changed.length} changed since (${list(report.changed)})`);
  if (report.dropped.length) parts.push(`${report.dropped.length} no longer in the release (${list(report.dropped)})`);
  if (report.uncovered.length) parts.push(`${entries(report.uncovered.length)} in no item and not quiet (${list(report.uncovered)})`);
  if (report.unknown.length) parts.push(`it names ${list(report.unknown)}, which ${report.unknown.length === 1 ? "is" : "are"} no client-facing entry in ${V}`);
  if (report.problems.length) parts.push(report.problems.join("; "));
  const when = report.summary.date ? `, written ${longDate(report.summary.date)},` : "";
  return `the summary of ${V}${when} is out of date: ${parts.join("; ")}`;
}

/**
 * The summary with the stamp `ledger summary complete` writes, keys in one
 * order so a rewritten file diffs in a line or two.
 */
export function stamped(project, summary, { date, commit }) {
  return ordered({ ...summary, date, commit, entries: currentFingerprints(project, summary.version) });
}

export function ordered(summary) {
  const out = { version: summary.version };
  for (const [key] of LISTS) {
    if (Array.isArray(summary[key]) && summary[key].length) {
      out[key] = summary[key].map(({ text, covers, ...rest }) => ({ text, covers, ...rest }));
    }
  }
  out.quiet = summary.quiet ?? [];
  for (const key of ["date", "commit", "entries"]) if (summary[key] !== undefined) out[key] = summary[key];
  return out;
}
