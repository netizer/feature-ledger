import path from "node:path";
import fs from "node:fs";
import { longDate, writeJson, readJson, exists } from "./util.mjs";
import { ownership } from "./paths.mjs";
import { fingerprint } from "./compose.mjs";
import * as git from "./git.mjs";

/**
 * What the open release holds, worked out from the corpus and git alone: no
 * agent, no model, nothing to pay for. The size readout prints it, `ledger
 * preview` opens with it, and the compose and verify briefs carry it, so all
 * of them agree about what moved.
 *
 * Per entry: how the edition draws it, its state in the edition it is
 * compared with and now, the events recorded between, and how many lines of
 * its code moved. Per release: the code no entry owns, and where the record
 * and the code disagree about how much happened.
 */

/** How much of the product an entry is, for weighing a release. */
const WEIGHT = { Big: 3, Medium: 2, Small: 1 };

/** Lines of an entry's code that can move without its record saying so
 *  before that is worth a word. Below it, it's usually a fix or a tidy. */
const QUIET_CHURN = 30;

export function kindOf(feature, version) {
  const h = feature.entryAt(version);
  if (!h) return null;
  if (h.removed) return h.backfilled ? "gone" : "removed";
  if (h.backfilled) return "in place";
  return feature.firstVersion === version ? "new" : "updated";
}

/**
 * The release against an earlier edition: by default the one it will be
 * compared with when it's cut, or any earlier version (`base`).
 */
export function releaseDiff(project, { base = undefined } = {}) {
  const version = project.releases.current.version;
  const previous = base === undefined ? project.releases.predecessorOf(version) : base;
  const set = project.featureSet;

  const entries = set.features()
    .filter((f) => f.history.some((h) => h.version > (previous?.version ?? 0) && h.version <= version))
    .map((f) => {
      const h = f.entryAt(version) ?? f.history.filter((x) => x.version <= version).pop();
      const kind = previous && f.firstVersion > previous.version ? (h.backfilled ? "in place" : "new")
        : h.removed ? (h.backfilled ? "gone" : "removed") : h.backfilled ? "in place" : previous ? "updated" : "new";
      return {
        feature: f,
        id: f.id,
        audience: f.audience,
        size: f.size,
        kind,
        before: previous ? f.stateAt(previous.version) : null,
        after: f.stateAt(version),
        events: f.events.filter((e) => e.version > (previous?.version ?? 0) && e.version <= version),
        lines: 0,
      };
    });

  const notes = project.otherChangesList.filter((c) => c.version > (previous?.version ?? 0) && c.version <= version);
  const code = codeMoved(project, previous?.commit ?? null, entries);
  return { version, previous, entries, notes, code, flags: disagreements(project, entries, code, version) };
}

/** Lines moved since `from`, working tree included, by entry and unowned. */
function codeMoved(project, from, entries) {
  const root = project.root;
  if (!from || !git.available(root)) return { available: false, from };
  const own = ownership(project);
  const perEntry = new Map();
  // Lines in files only one entry owns: a module several entries share moves
  // with any of them, so only an entry's own code says that it moved.
  const alone = new Map();
  const unowned = [];
  let total = 0;
  let owned = 0;
  for (const [file, lines] of git.churn(root, from)) {
    if (!own.product(file)) continue;
    total += lines;
    const owners = own.owners(file);
    // A file that is gone can't be claimed; its lines still count.
    if (owners.length) owned += lines;
    else if (fs.existsSync(path.join(root, file))) unowned.push({ file, lines });
    for (const f of owners) perEntry.set(f.id, (perEntry.get(f.id) ?? 0) + lines);
    if (owners.length === 1) alone.set(owners[0].id, (alone.get(owners[0].id) ?? 0) + lines);
  }
  for (const e of entries) e.lines = perEntry.get(e.id) ?? 0;
  return { available: true, from, total, owned, perEntry, alone, unowned: unowned.sort((a, b) => b.lines - a.lines), owners: own.features.length };
}

/**
 * Where the record and the code disagree about how much happened: code that
 * moved under an entry the release says nothing about, and an entry recorded
 * as moved whose code didn't. Neither is a verdict, both are where to look.
 */
function disagreements(project, entries, code, version) {
  if (!code.available) return [];
  const flags = [];
  const recorded = new Set(entries.map((e) => e.id));
  for (const [id, lines] of code.alone) {
    if (lines >= QUIET_CHURN && !recorded.has(id)) {
      flags.push({ id, text: `${lines} lines of its own code moved, and the ledger says nothing changed` });
    }
  }
  for (const e of entries) {
    if (["updated", "new"].includes(e.kind) && e.feature.paths.length && e.lines === 0 && e.feature.entryAt(version)) {
      flags.push({ id: e.id, text: `recorded as ${e.kind}, and none of its code moved` });
    }
  }
  return flags;
}

/* ---- the readout ------------------------------------------------------ */

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const thousands = (n) => n.toLocaleString("en-US");

function bySize(list) {
  const counts = ["Big", "Medium", "Small"].map((s) => [s, list.filter((e) => e.size === s).length]).filter(([, n]) => n);
  return counts.map(([s, n]) => (list.length === 1 ? s : `${n} ${s}`)).join(" · ");
}

/** The size of the release, in a few lines a person can take in at a glance. */
export function sizeReadout(project, diff) {
  const lines = [];
  const user = diff.entries.filter((e) => e.audience === "user");
  const dev = diff.entries.filter((e) => e.audience === "dev");
  const head = diff.previous
    ? `v${diff.version} so far, against v${diff.previous.version}${diff.previous.date ? ` (${longDate(diff.previous.date)})` : ""}:`
    : `v${diff.version} so far, a first edition:`;
  lines.push(head);
  const row = (label, list, tail = "") => {
    if (!list.length) return;
    lines.push(`  ${label.padEnd(9)} ${String(list.length).padStart(3)}   ${bySize(list).padEnd(tail ? 32 : 0)}${tail}`.trimEnd());
  };
  const events = (list) => list.reduce((n, e) => n + e.events.length, 0);
  const updated = user.filter((e) => e.kind === "updated");
  row("new", user.filter((e) => e.kind === "new"));
  row("updated", updated, events(updated) ? plural(events(updated), "event") : "");
  row("in place", user.filter((e) => e.kind === "in place"));
  row("removed", user.filter((e) => ["removed", "gone"].includes(e.kind)));
  const notes = diff.notes.filter((c) => c.audience === "user").length;
  if (notes) lines.push(`  ${"notes".padEnd(9)} ${String(notes).padStart(3)}   product-wide`);
  if (!user.length && !notes) lines.push("  nothing client-facing recorded yet");
  const weight = user.filter((e) => ["new", "updated"].includes(e.kind)).reduce((n, e) => n + (WEIGHT[e.size] ?? 1), 0);
  if (weight) lines.push(`  ${"weight".padEnd(9)} ${String(weight).padStart(3)}   new and updated, Big 3 · Medium 2 · Small 1`);
  if (dev.length) lines.push(`  ${"team".padEnd(9)} ${String(dev.length).padStart(3)}   team-only entries, not in the client edition`);

  const code = diff.code;
  if (!diff.previous) {
    // nothing to measure code against
  } else if (!code.available) {
    lines.push(`  ${"code".padEnd(9)}   –   ${diff.previous.commit ? "no git repository" : `v${diff.previous.version} has no commit recorded (\`ledger releases amend\`)`}`);
  } else {
    const unownedLines = code.unowned.reduce((n, u) => n + u.lines, 0);
    let text = `${thousands(code.total)} lines since ${git.shortSha(code.from)}, working tree included`;
    if (code.owners) text += ` · ${thousands(code.owned)} under ${plural(code.perEntry.size, "entry", "entries")}`;
    if (code.unowned.length) text += ` · ${thousands(unownedLines)} in ${plural(code.unowned.length, "file")} no entry owns`;
    lines.push(`  ${"code".padEnd(9)}       ${text}`);
    if (!code.owners) lines.push(`  ${"".padEnd(9)}       no entry has "paths" yet, so the code can't be tied to the record (\`ledger paths\`)`);
  }
  for (const [i, f] of diff.flags.entries()) {
    lines.push(`  ${(i ? "" : "check").padEnd(9)}       ${f.id}: ${f.text}`);
  }
  return lines.join("\n");
}

/* ---- since your last look --------------------------------------------- */

const LAST_LOOK = "last-look.json";

function snapshot(project) {
  const version = project.releases.current.version;
  const entries = {};
  for (const f of project.featureSet.features()) {
    const h = f.entryAt(version);
    if (!h) continue;
    // The entry's own words, not what was composed about it: composing is
    // not something that happened to the product.
    const st = f.stateAt(version);
    const words = st.removed ? { removed: true, reason: st.reason } : { name: st.name, description: st.description, backfilled: st.backfilled };
    entries[f.id] = { state: fingerprint(words), events: f.eventsAt(version).length };
  }
  return {
    at: new Date().toISOString(),
    version,
    commit: git.available(project.root) ? git.head(project.root) : null,
    entries,
    notes: project.featureSet.otherChanges({ version }).length,
  };
}

/** Remembers what was just looked at. Kept in .ledger/.cache/, which is
 *  gitignored: when somebody last looked is theirs, not the project's. */
export function rememberLook(project) {
  if (project.archivedAs || !project.releases.current.future) return;
  writeJson(path.join(project.cacheDir, LAST_LOOK), snapshot(project));
}

export function lastLook(project) {
  const file = path.join(project.cacheDir, LAST_LOOK);
  return exists(file) ? readJson(file) : null;
}

/** What moved since the last look, in a line or two, or null when there was none. */
export function sinceLastLook(project) {
  const was = lastLook(project);
  if (!was) return null;
  const now = snapshot(project);
  const when = new Date(was.at);
  const label = Number.isNaN(when.getTime()) ? "your last look"
    : `your last look (${longDate(was.at.slice(0, 10))}, ${was.at.slice(11, 16)} UTC${was.commit ? `, at ${git.shortSha(was.commit)}` : ""})`;
  if (was.version !== now.version) return `Since ${label}: v${was.version} was cut, and v${now.version} opened.`;

  const added = Object.keys(now.entries).filter((id) => !was.entries[id]);
  const moved = Object.keys(now.entries).filter((id) => was.entries[id] && was.entries[id].state !== now.entries[id].state);
  const events = Object.entries(now.entries).map(([id, e]) => [id, e.events - (was.entries[id]?.events ?? 0)]).filter(([, n]) => n > 0);
  const commits = was.commit && now.commit && was.commit !== now.commit ? git.countCommits(project.root, was.commit) : 0;
  const parts = [];
  if (added.length) parts.push(`${plural(added.length, "entry", "entries")} newly in the release (${added.slice(0, 5).join(", ")}${added.length > 5 ? ", …" : ""})`);
  const newEvents = events.reduce((n, [, k]) => n + k, 0);
  if (newEvents) parts.push(`${plural(newEvents, "event")} on ${events.filter(([id]) => !added.includes(id)).map(([id]) => id).slice(0, 5).join(", ") || "them"}`);
  const reworded = moved.filter((id) => !events.some(([e]) => e === id));
  if (reworded.length) parts.push(`${plural(reworded.length, "entry", "entries")} reworded (${reworded.slice(0, 5).join(", ")})`);
  if (now.notes > was.notes) parts.push(plural(now.notes - was.notes, "product-wide note"));
  if (commits) parts.push(`${plural(commits, "commit")}`);
  return `Since ${label}: ${parts.length ? parts.join(", ") : "nothing has moved"}.`;
}

/* ---- the whole packet, for reading ------------------------------------ */

/** Every entry's two states and its events, as `ledger diff --full` prints them. */
export function fullText(diff) {
  const lines = [];
  for (const e of diff.entries) {
    lines.push(`${e.kind.padEnd(9)} ${e.id}  —  ${e.after?.removed ? e.feature.currentName : e.after?.name}  (${e.size ?? "unsized"}, ${e.audience}` +
      `${diff.code.available ? `, ${e.lines} lines` : ""})`);
    if (e.before && !e.before.removed && e.kind !== "in place") lines.push(`  in v${diff.previous.version}: ${e.before.description}`);
    if (e.after?.removed) lines.push(`  removed: ${e.after.reason}`);
    else lines.push(`  now:${" ".repeat(e.before && !e.before.removed && e.kind !== "in place" ? String(diff.previous.version).length + 1 : 0)} ${e.after.description}`);
    for (const ev of e.events) lines.push(`  - ${eventLine(ev)}`);
    lines.push("");
  }
  return lines.join("\n");
}

/** One event as a line: what, then why and where the why came from. */
export function eventLine(e) {
  if (e.combined) return `${e.what}${e.why_from === "commit" ? "  [reason from a commit message]" : ""}`;
  const why = e.why_from === "unknown" ? "why: not recorded" : `why: ${e.why}${e.why_from === "commit" ? "  [from a commit message]" : ""}`;
  return `${e.what}  — ${why}`;
}

export function diffJson(diff) {
  return {
    version: diff.version,
    against: diff.previous ? { version: diff.previous.version, date: diff.previous.date, commit: diff.previous.commit ?? null } : null,
    entries: diff.entries.map((e) => ({
      id: e.id, audience: e.audience, size: e.size, kind: e.kind, lines: diff.code.available ? e.lines : null,
      before: e.before, after: e.after, events: e.events,
    })),
    notes: diff.notes,
    code: diff.code.available
      ? { from: diff.code.from, total: diff.code.total, unowned: diff.code.unowned, by_entry: Object.fromEntries(diff.code.perEntry) }
      : null,
    checks: diff.flags,
  };
}
