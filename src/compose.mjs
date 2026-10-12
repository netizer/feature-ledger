import crypto from "node:crypto";
import { isBlank, longDate } from "./util.mjs";

/**
 * What an edition says about what moved: a "What changed" note on every
 * updated entry, and the short lists it opens with — what's new, what changed
 * and, when there is any, what was already in place.
 *
 * Both are composed once per release, for the whole release, from three
 * things the CLI already holds: each entry as the last edition showed it, as
 * it stands now, and the events recorded between (what changed and why). Not
 * written as each change lands, because the reader compares two editions and
 * never saw anything in between: a note written mid-cycle describes a
 * "before" the client may never have had, and three notes on three steps are
 * drafts of one result. Composed from the two states, a note can only
 * describe a difference the client will see.
 *
 * It lives in .ledger/compositions.json, one per release:
 *
 *   changes   { id: ["bullet", …] } for every updated entry
 *   new, changed, in_place   the summary lists, items { text, covers }
 *   quiet     the entries the summary leaves out on purpose
 *   date, commit, inputs     the stamp `ledger compose complete` writes
 *   verified  the stamp `ledger verify complete` writes
 *
 * `inputs` fingerprints what each entry was composed from. An entry whose
 * state or events move afterwards puts the composition out of date, and
 * `ledger cut` refuses it. Editing the composed text by hand doesn't: nothing
 * it was composed from has moved, and the hand-edit is the point.
 */

/** The lists, in the order the edition prints them, keyed as in the file. */
export const LISTS = [["new", "What's new"], ["changed", "What changed"], ["in_place", "Already in place"]];

/** Long enough that it has stopped being an item in a list. */
export const ITEM_LIMIT = 160;

export function fingerprint(words) {
  return crypto.createHash("sha256").update(JSON.stringify(words)).digest("hex").slice(0, 16);
}

/* ---- which entries it accounts for ------------------------------------ */

/**
 * Whether `version`'s edition says what moved at all: only when it is
 * compared with an earlier one. A first edition, and the first after a
 * redraft, print as an inventory.
 */
export function composes(project, version) {
  return Boolean(project.releases.predecessorOf(version));
}

/**
 * The entries a composition has to account for, in reading order: every
 * client-facing entry recorded at `version` that is still in the product.
 * Removals and product-wide notes list themselves, under their own headings.
 */
export function composeTargets(project, version) {
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

/** An entry that existed in the last edition, and so gets a "What changed" note. */
export const needsNote = (feature, version) => feature.firstVersion < version;

/* ---- what it was composed from ---------------------------------------- */

const stateWords = (s) => (!s ? null : s.removed
  ? { removed: true, reason: s.reason }
  : { name: s.name, description: s.description, backfilled: Boolean(s.backfilled) });

/** Everything one entry's note and summary item are composed from. */
export function inputsOf(project, feature, version) {
  const previous = project.releases.predecessorOf(version);
  return {
    before: previous ? stateWords(feature.stateAt(previous.version)) : null,
    after: stateWords(feature.stateAt(version)),
    // Not where a reason came from: vouching for one changes nothing a note says.
    events: feature.eventsAt(version).map((e) => ({ kind: e.kind ?? "change", what: e.what, why: e.why ?? null })),
  };
}

export function currentInputs(project, version) {
  return Object.fromEntries(composeTargets(project, version).map((f) => [f.id, fingerprint(inputsOf(project, f, version))]));
}

/** Every summary item, with the list it is in. */
export function summaryItems(composition) {
  return LISTS.flatMap(([key]) => (Array.isArray(composition?.[key]) ? composition[key] : []).map((item) => ({ list: key, ...item })));
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

/** What makes the file unreadable as a composition, as short sentences. */
export function shapeProblems(composition) {
  const problems = [];
  for (const [key] of LISTS) {
    if (composition[key] !== undefined && !Array.isArray(composition[key])) problems.push(`"${key}" is a list of items`);
  }
  if (composition.quiet !== undefined && !(Array.isArray(composition.quiet) && composition.quiet.every((id) => typeof id === "string"))) {
    problems.push("\"quiet\" is a list of entry ids");
  }
  for (const item of summaryItems(composition)) {
    const where = `an item in "${item.list}"`;
    if (typeof item.text !== "string" || isBlank(item.text)) problems.push(`${where} has no "text"`);
    if (!Array.isArray(item.covers) || !item.covers.length || !item.covers.every((id) => typeof id === "string")) {
      problems.push(`${where} (${clip(String(item.text ?? ""), 40)}) needs "covers": the ids of the entries it sums up`);
    }
  }
  const changes = composition.changes ?? {};
  if (typeof changes !== "object" || Array.isArray(changes)) problems.push("\"changes\" maps an entry id to its list of bullets");
  else {
    for (const [id, list] of Object.entries(changes)) {
      if (!Array.isArray(list) || !list.every((b) => typeof b === "string" && !isBlank(b))) {
        problems.push(`"changes"."${id}" is a list of bullets, each a sentence or two`);
      }
    }
  }
  return problems;
}

/**
 * Whether a composition accounts for the release as it stands, whatever its
 * stamp says: every entry covered or quiet, every updated entry with its
 * note, no note on an entry the client has never seen, nothing named that
 * isn't an entry. What `compose complete` refuses.
 */
export function accountingProblems(project, version, composition) {
  const targets = composeTargets(project, version);
  const ids = new Set(targets.map((f) => f.id));
  const problems = [...shapeProblems(composition)];
  const named = new Set([
    ...summaryItems(composition).flatMap((i) => (Array.isArray(i.covers) ? i.covers : [])),
    ...(Array.isArray(composition.quiet) ? composition.quiet : []),
  ]);
  const uncovered = targets.filter((f) => !named.has(f.id)).map((f) => f.id);
  if (uncovered.length) {
    problems.push(`in no item's "covers" and not in "quiet": ${uncovered.join(", ")}. Every client-facing entry in ` +
      `v${version} is summed up by an item or left out on purpose`);
  }
  const unknown = [...named].filter((id) => !ids.has(id));
  if (unknown.length) {
    problems.push(`not a client-facing entry in v${version}: ${unknown.join(", ")}. \`ledger compose\` lists the ones that are`);
  }
  const changes = composition.changes ?? {};
  const unnoted = targets.filter((f) => needsNote(f, version) && !changes[f.id]?.length).map((f) => f.id);
  if (unnoted.length) {
    problems.push(`updated with no "What changed" note in "changes": ${unnoted.join(", ")}. Each says what differs from ` +
      `v${project.releases.predecessorOf(version)?.version} and why`);
  }
  const misplaced = Object.keys(changes).filter((id) => !targets.some((f) => f.id === id && needsNote(f, version)));
  if (misplaced.length) {
    problems.push(`a "What changed" note on what isn't an updated entry in v${version}: ${misplaced.join(", ")}. ` +
      "A new entry has no \"before\" for the client; its description says what it does");
  }
  return problems;
}

/** Text problems per item, for `ledger status` and `compose complete`. */
export function textProblems(composition) {
  return summaryItems(composition)
    .filter((item) => typeof item.text === "string")
    .map((item) => [item.text, itemTextProblems(item.text)])
    .filter(([, problems]) => problems.length);
}

/* ---- is it up to date ------------------------------------------------- */

/** The composition for the open release, checked. See `composeReportFor`. */
export function composeReport(project) {
  const current = project.releases.current;
  if (!current.future) return { ok: true, reason: "no release in progress" };
  return composeReportFor(project, current.version);
}

/**
 * Whether `version`'s composition can be printed as it stands. `ok` when there
 * is nothing to compose (a first edition, or nothing client-facing recorded
 * yet), or when it accounts for every entry, is well formed, and nothing it
 * was composed from has moved since `ledger compose complete`.
 */
export function composeReportFor(project, version) {
  if (!composes(project, version)) return { ok: true, reason: "a first edition prints no notes on what changed" };
  const targets = composeTargets(project, version);
  if (!targets.length) return { ok: true, reason: "nothing client-facing recorded yet" };

  const composition = project.compositionOf(version);
  const base = { version, composition, total: targets.length };
  if (!composition) return { ...base, ok: false, missing: true, stale: targets.map((f) => f.id) };

  const ids = new Set(targets.map((f) => f.id));
  const seen = composition.inputs ?? null;
  const now = currentInputs(project, version);
  const added = seen ? targets.map((f) => f.id).filter((id) => !(id in seen)) : [];
  const changed = seen ? targets.map((f) => f.id).filter((id) => id in seen && seen[id] !== now[id]) : [];
  const dropped = seen ? Object.keys(seen).filter((id) => !ids.has(id)) : [];
  const problems = accountingProblems(project, version, composition)
    // An entry recorded since is reported as that, not also as uncovered.
    .filter((p) => !added.length || !p.startsWith("in no item"));
  const stale = seen ? [...added, ...changed] : targets.map((f) => f.id);

  const ok = Boolean(seen) && !problems.length && ![added, changed, dropped].some((l) => l.length);
  return { ...base, ok, incomplete: !seen, problems, added, changed, dropped, stale };
}

const list = (ids) => ids.slice(0, 6).join(", ") + (ids.length > 6 ? `, and ${ids.length - 6} more` : "");
const entries = (n) => `${n} entr${n === 1 ? "y" : "ies"}`;
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** One sentence for the cut check, `ledger status` and `preview`, so they can't drift. */
export function composeLine(report) {
  if (report.ok) {
    if (report.reason) return report.reason;
    return `the composition of v${report.version} accounts for all ${entries(report.total)}, and nothing has moved since ` +
      `it was composed${report.composition.date ? ` (${longDate(report.composition.date)})` : ""}`;
  }
  const V = `v${report.version}`;
  if (report.missing) {
    return `${V} has nothing composed yet, so its edition would list ${entries(report.total)} by name, with the changes as recorded`;
  }
  const parts = [];
  if (report.incomplete) parts.push("it was never marked complete");
  if (report.added.length) parts.push(`${entries(report.added.length)} recorded since (${list(report.added)})`);
  if (report.changed.length) parts.push(`${report.changed.length} moved since (${list(report.changed)})`);
  if (report.dropped.length) parts.push(`${report.dropped.length} no longer in the release (${list(report.dropped)})`);
  if (report.problems.length) parts.push(report.problems.join("; "));
  const when = report.composition.date ? `, composed ${longDate(report.composition.date)},` : "";
  return `the composition of ${V}${when} is out of date: ${parts.join("; ")}`;
}

/**
 * The composition with the stamp `ledger compose complete` writes, keys in
 * one order so a rewritten file diffs in a line or two.
 */
export function stamped(project, composition, { date, commit }) {
  return ordered(project, { ...composition, date, commit, inputs: currentInputs(project, composition.version) });
}

export function ordered(project, composition) {
  const out = { version: composition.version };
  const changes = composition.changes ?? {};
  // In reading order, so the file reads like the edition.
  const order = composeTargets(project, composition.version).map((f) => f.id);
  const ids = Object.keys(changes).sort((a, b) => (order.indexOf(a) + 1 || 1e9) - (order.indexOf(b) + 1 || 1e9));
  out.changes = Object.fromEntries(ids.map((id) => [id, changes[id]]));
  for (const [key] of LISTS) {
    if (Array.isArray(composition[key]) && composition[key].length) {
      out[key] = composition[key].map(({ text, covers, ...rest }) => ({ text, covers, ...rest }));
    }
  }
  out.quiet = composition.quiet ?? [];
  for (const key of ["date", "commit", "inputs", "verified"]) if (composition[key] !== undefined) out[key] = composition[key];
  return out;
}

/* ---- verified --------------------------------------------------------- */

/** Everything a verify reads: the composed text, and the descriptions it is about. */
export function verifyFingerprint(project, version) {
  const c = project.compositionOf(version);
  return fingerprint({
    changes: c?.changes ?? {},
    lists: summaryItems(c).map(({ list: l, text, covers }) => ({ l, text, covers })),
    entries: composeTargets(project, version).map((f) => [f.id, f.stateAt(version).description]),
  });
}

/** Whether the opt-in `verify` check is on for this project. */
export const verifyOn = (project) => project.config.checks?.verify === true;

export function verifyReport(project) {
  const current = project.releases.current;
  if (!verifyOn(project)) return { ok: true, off: true, reason: "off (`\"checks\": { \"verify\": true }` in config.json turns it on)" };
  if (!current.future) return { ok: true, reason: "no release in progress" };
  const version = current.version;
  if (!composes(project, version) || !composeTargets(project, version).length) return { ok: true, reason: "nothing composed to verify" };
  const v = project.compositionOf(version)?.verified;
  if (!v) return { ok: false, version, line: `v${version}'s composed text hasn't been checked against the code` };
  if (v.fingerprint !== verifyFingerprint(project, version)) {
    return { ok: false, version, line: `v${version}'s composed text changed after it was verified (${longDate(v.date)})` };
  }
  return { ok: true, version, reason: `verified ${longDate(v.date)}, nothing changed since` };
}
