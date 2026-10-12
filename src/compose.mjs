import { isBlank, longDate } from "./util.mjs";
import { recordedLines } from "./store.mjs";

/**
 * What an edition says about what moved: a "What changed" note on every
 * updated entry, the short lists it opens with (what's new, what changed and,
 * when there is any, what was already in place), and the message it goes out
 * with.
 *
 * All of it is written once per release, for the whole release, by
 * `ledger prepare`, from three things the CLI already holds: each entry as the
 * last edition showed it, as it stands now, and the events recorded between
 * (what changed and why). Not as each change lands, because the reader
 * compares two editions and never saw anything in between: a note written
 * mid-cycle describes a "before" the client may never have had, and three
 * notes on three steps are drafts of one result.
 *
 * It lives in .ledger/compositions.json, one per release:
 *
 *   changes   { id: ["note", …] } for every updated entry
 *   new, changed, in_place   the summary lists, items { text, covers }
 *   quiet     the entries the summary leaves out on purpose (they still print in full)
 *   message   the text to send with the edition
 *   prepared  what `ledger prepare complete` saw: { date, commit, entries: { id: n }, notes }
 *
 * `prepared.entries` counts, per entry, the events it was written from.
 * Events are only ever appended, so one beyond that count is news since, and
 * an entry missing from it arrived since. Editing the words by hand never
 * counts: nothing the product did has moved.
 */

/** The lists, in the order the edition prints them, keyed as in the file. */
export const LISTS = [["new", "What's new"], ["changed", "What changed"], ["in_place", "Already in place"]];

/** Long enough that it has stopped being an item in a list. */
export const ITEM_LIMIT = 160;

/** Sentences per change in a "What changed" note before it is worth a word. */
export const NOTE_SENTENCES = 2;

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
  return releaseEntries(project, version).filter((f) => !f.entryAt(version).removed);
}

/** Every client-facing entry recorded at `version`, removals included, in reading order. */
export function releaseEntries(project, version) {
  const set = project.featureSet;
  const user = set.features({ audience: "user" });
  return set.categories({ audience: "user" })
    .flatMap((category) => set.bySize(user.filter((f) => f.category === category)))
    .filter((f) => Boolean(f.entryAt(version)));
}

/** How the edition draws an entry at `version`: "new", "updated", "in place" or "removed". */
export function kindAt(feature, version) {
  const h = feature.entryAt(version);
  if (h.removed) return "removed";
  if (h.backfilled) return "in place";
  return feature.firstVersion === version ? "new" : "updated";
}

/** An entry that existed in the last edition, and so gets a "What changed" note. */
export const needsNote = (feature, version) => feature.firstVersion < version && !feature.entryAt(version)?.removed;

/** Every summary item, with the list it is in. */
export function summaryItems(composition) {
  return LISTS.flatMap(([key]) => (Array.isArray(composition?.[key]) ? composition[key] : []).map((item) => ({ list: key, ...item })));
}

/** Whether a composition carries summary lists at all. An edition cut before
 *  summaries existed has notes only, and prints its entries by name. */
export const hasLists = (composition) => Boolean(composition) &&
  ["new", "changed", "in_place", "quiet"].some((k) => composition[k] !== undefined);

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
  if (composition.message !== undefined && composition.message !== null && typeof composition.message !== "string") {
    problems.push("\"message\" is text: what to send with the edition");
  }
  for (const item of summaryItems(composition)) {
    const where = `an item in "${item.list}"`;
    if (typeof item.text !== "string" || isBlank(item.text)) problems.push(`${where} has no "text"`);
    if (!Array.isArray(item.covers) || !item.covers.length || !item.covers.every((id) => typeof id === "string")) {
      problems.push(`${where} (${clip(String(item.text ?? ""), 40)}) needs "covers": the ids of the entries it sums up`);
    }
  }
  const changes = composition.changes ?? {};
  if (typeof changes !== "object" || Array.isArray(changes)) problems.push("\"changes\" maps an entry id to its list of notes");
  else {
    for (const [id, list] of Object.entries(changes)) {
      if (!Array.isArray(list) || !list.every((b) => typeof b === "string" && !isBlank(b))) {
        problems.push(`"changes"."${id}" is a list of notes, one or two sentences each`);
      }
    }
  }
  return problems;
}

/**
 * Whether a composition accounts for the release as it stands: every entry
 * covered or quiet, every updated entry with its note, no note on an entry
 * the client has never seen, nothing named that isn't an entry. What
 * `prepare complete` refuses, so the agent fixes it while it is still in the
 * session.
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
      `v${version} is summed up by an item or left off the summary on purpose`);
  }
  const unknown = [...named].filter((id) => !ids.has(id));
  if (unknown.length) {
    problems.push(`not a client-facing entry in v${version}: ${unknown.join(", ")}. \`ledger prepare\` lists the ones that are`);
  }
  const changes = composition.changes ?? {};
  const unnoted = targets.filter((f) => needsNote(f, version) && !changes[f.id]?.length).map((f) => f.id);
  if (unnoted.length) {
    problems.push(`updated with no "What changed" note in "changes": ${unnoted.join(", ")}. Each says what it was in ` +
      `v${project.releases.predecessorOf(version)?.version} and why it moved`);
  }
  const misplaced = Object.keys(changes).filter((id) => !targets.some((f) => f.id === id && needsNote(f, version)));
  if (misplaced.length) {
    problems.push(`a "What changed" note on what isn't an updated entry in v${version}: ${misplaced.join(", ")}. ` +
      "A new entry has no \"before\" for the client; its description says what it does");
  }
  return problems;
}

/** Text problems per item, for `ledger status` and `prepare complete`. */
export function textProblems(composition) {
  return summaryItems(composition)
    .filter((item) => typeof item.text === "string")
    .map((item) => [item.text, itemTextProblems(item.text)])
    .filter(([, problems]) => problems.length);
}

/** Sentences in a note, counted the way a reader would: a full stop followed by a capital. */
export const sentences = (text) => String(text).trim().split(/(?<=[.!?])\s+(?=[A-Z“"(])/).filter(Boolean).length;

/** Notes that run past NOTE_SENTENCES for one change: [id, note]. */
export function longNotes(composition) {
  return Object.entries(composition?.changes ?? {})
    .flatMap(([id, list]) => (Array.isArray(list) ? list : []).map((n) => [id, n]))
    .filter(([, n]) => typeof n === "string" && sentences(n) > NOTE_SENTENCES);
}

/* ---- what has moved since the last prepare ---------------------------- */

/** What `prepare` stamps: per client-facing entry in the release, how many events it had. */
export function preparedSnapshot(project, version) {
  return {
    entries: Object.fromEntries(releaseEntries(project, version).map((f) => [f.id, f.eventsAt(version).length])),
    notes: project.featureSet.otherChanges({ version, audience: "user" }).length,
  };
}

/**
 * The open release against what the last `ledger prepare` saw. Counts the
 * changes recorded in all, and those since, so `ledger`, `preview` and `cut`
 * say the same thing: whether there is anything a prepare hasn't read.
 */
export function prepareReport(project, version = project.releases.current.version) {
  const entries = releaseEntries(project, version);
  const notes = project.featureSet.otherChanges({ version, audience: "user" }).length;
  // A change is an event, or an entry recorded with none (a new one, or a
  // description moved without a "what"), or a product-wide note.
  const changesOf = (f) => Math.max(f.eventsAt(version).length, 1);
  const recorded = entries.reduce((n, f) => n + changesOf(f), 0) + notes;
  const composition = project.compositionOf(version);
  const prepared = composition?.prepared?.entries ? composition.prepared : null;
  const base = { version, composition, prepared, recorded, applies: composes(project, version) };
  if (!recorded) return { ...base, ok: true, since: 0, arrived: [], moved: [], notesSince: 0, nothing: true };
  if (!prepared) {
    return { ...base, ok: false, never: true, since: recorded, arrived: entries.map((f) => f.id), moved: [], notesSince: notes };
  }
  const arrived = entries.filter((f) => !(f.id in prepared.entries)).map((f) => f.id);
  const moved = entries.filter((f) => f.id in prepared.entries && f.eventsAt(version).length > prepared.entries[f.id]).map((f) => f.id);
  const notesSince = Math.max(0, notes - (prepared.notes ?? 0));
  const since = entries.reduce((n, f) => n + (f.id in prepared.entries
    ? Math.max(0, f.eventsAt(version).length - prepared.entries[f.id])
    : changesOf(f)), 0) + notesSince;
  return { ...base, ok: since === 0, since, arrived, moved, notesSince };
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (ids) => ids.slice(0, 5).join(", ") + (ids.length > 5 ? `, and ${ids.length - 5} more` : "");

/** One sentence for `ledger`, `preview` and the cut, so they can't drift. */
export function prepareLine(report) {
  if (report.nothing) return "nothing client-facing recorded yet";
  if (report.never) return `${plural(report.recorded, "change")} recorded, and \`ledger prepare\` hasn't run for v${report.version}`;
  const when = report.prepared.date ? ` (${longDate(report.prepared.date)})` : "";
  if (report.ok) return `prepared${when}, and nothing recorded since`;
  const where = [...report.arrived, ...report.moved];
  const what = [where.length ? list(where) : null, report.notesSince ? plural(report.notesSince, "product-wide note") : null]
    .filter(Boolean).join(", and ");
  return `${plural(report.since, "change")} recorded since the last prepare${when}${what ? `, on ${what}` : ""}`;
}

/** Updated entries whose edition would print the changes as recorded, for want of a prepared note. */
export function unpreparedNotes(project, version) {
  if (!composes(project, version)) return [];
  const changes = project.compositionOf(version)?.changes ?? {};
  return composeTargets(project, version).filter((f) => needsNote(f, version) && !changes[f.id]?.length && f.eventsAt(version).length);
}

/**
 * Events at `version` whose reason nobody has vouched for: [{ feature, event,
 * index }]. A change to an entry removed in the same release prints nowhere,
 * so its reason isn't worth anyone's time; the removal's own reason is.
 */
export function unknownReasons(project, version) {
  return project.featureSet.features().flatMap((f) => {
    const gone = Boolean(f.entryAt(version)?.removed);
    return f.events
      .map((event, index) => ({ feature: f, event, index }))
      .filter(({ event }) => event.version === version && event.why_from !== "person" && (!gone || event.kind === "remove"));
  });
}

/* ---- writing it ------------------------------------------------------- */

/**
 * The composition with the stamp `ledger prepare complete` writes, keys in one
 * order so a rewritten file diffs in a line or two.
 */
export function stamped(project, composition, { date, commit }) {
  return ordered(project, { ...composition, prepared: { date, commit, ...preparedSnapshot(project, composition.version) } });
}

export function ordered(project, composition) {
  const out = { version: composition.version };
  const changes = composition.changes ?? {};
  // In reading order, so the file reads like the edition.
  const order = releaseEntries(project, composition.version).map((f) => f.id);
  const ids = Object.keys(changes).sort((a, b) => (order.indexOf(a) + 1 || 1e9) - (order.indexOf(b) + 1 || 1e9));
  out.changes = Object.fromEntries(ids.map((id) => [id, changes[id]]));
  for (const [key] of LISTS) {
    if (Array.isArray(composition[key]) && composition[key].length) {
      out[key] = composition[key].map(({ text, covers, ...rest }) => ({ text, covers, ...rest }));
    }
  }
  // Only when there is one: a composition with no lists at all is how an
  // edition knows to list its entries by name instead.
  if (composition.quiet !== undefined) out.quiet = composition.quiet;
  if (!isBlank(composition.message)) out.message = composition.message;
  // Anything else an older edition's composition carries is kept as it is.
  for (const [key, value] of Object.entries(composition)) if (!(key in out) && key !== "prepared" && value !== undefined) out[key] = value;
  if (composition.prepared) out.prepared = composition.prepared;
  return out;
}

/**
 * At the cut: the lines an updated entry prints for want of a prepared note
 * are written into the composition, so the edition handed over reprints
 * exactly, whatever happens to the events afterwards.
 */
export function frozenForCut(project, version) {
  const unprepared = unpreparedNotes(project, version);
  if (!unprepared.length) return null;
  const existing = project.compositionOf(version);
  const changes = { ...(existing?.changes ?? {}) };
  for (const f of unprepared) changes[f.id] = recordedLines(f.eventsAt(version));
  return ordered(project, { ...(existing ?? {}), version, changes });
}

/* ---- the message ------------------------------------------------------ */

/**
 * The text to paste into an email or a chat with the edition: one opening
 * line, the summary items as a short list, and a line on anything removed.
 * `prepare` writes one that reads well; this is the plain one a cut builds
 * when it didn't.
 */
export function defaultMessage(project, version) {
  const product = project.brand.name ?? project.config.product;
  const label = project.releases.printedAs(version);
  const lines = [`Version ${label} of the ${product} feature ledger is attached.`];
  const composition = project.compositionOf(version);
  const previous = project.releases.predecessorOf(version);
  if (previous) {
    const items = summaryItems(composition);
    const fallback = composeTargets(project, version).map((f) => f.stateAt(version).name);
    const shown = items.length ? items.map((i) => i.text) : fallback;
    if (shown.length) {
      lines.push("", `Since the edition of ${longDate(previous.date)}:`, "");
      for (const t of shown) lines.push(`- ${t}`);
    }
    const removed = releaseEntries(project, version).filter((f) => f.entryAt(version).removed);
    if (removed.length) {
      lines.push("", `No longer available: ${removed.map((f) => f.currentName).join(", ")}. The edition says why.`);
    }
  } else {
    const n = project.featureSet.features({ audience: "user" }).filter((f) => { const s = f.stateAt(version); return s && !s.removed; }).length;
    lines.push("", `It describes the ${plural(n, "capability", "capabilities")} ${product} has today, one entry each.`);
  }
  return `${lines.join("\n")}\n`;
}

/** The message a cut writes: what `prepare` wrote, or the plain one. */
export function messageFor(project, version) {
  const written = project.compositionOf(version)?.message;
  return isBlank(written) ? defaultMessage(project, version) : `${String(written).trimEnd()}\n`;
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
