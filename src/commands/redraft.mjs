import fs from "node:fs";
import path from "node:path";
import { openProject, Project, ARCHIVE_DIRNAME, ARCHIVED_MARKER } from "../store.mjs";
import { ReleaseSet } from "../model/release-set.mjs";
import { fail, readJson, writeJson, exists, today, longDate, COPY_RULE } from "../util.mjs";
import * as git from "../git.mjs";

const out = (s) => process.stdout.write(`${s}\n`);

/**
 * Starting the corpus again from scratch, without starting the client's
 * record again.
 *
 * A ledger written one change at a time drifts into the shape its history
 * gave it: areas that made sense three releases ago, an entry that grew two
 * capabilities inside it, names from before the product found its own words.
 * Past a point the cheapest way to a document that reads well is a fresh
 * survey. What must not start again is everything the client already holds:
 * the version numbers on the editions they were handed, those editions
 * themselves, and every fact those editions told them.
 *
 * So a redraft is three steps, and the CLI does the mechanical ends of it:
 *
 *   ledger redraft start      sets the corpus aside in .ledger/archive/<label>/,
 *                             keeps its releases in the timeline as `archived`,
 *                             and opens the next version on an empty corpus
 *   ledger bootstrap          the survey, from scratch; it knows it's a redraft
 *                             and stops before the cut
 *   ledger redraft check      a brief for an agent to read the old corpus against
 *                             the new one and restore whatever the survey lost
 *   ledger redraft complete   stamps that in redrafts.json
 *
 * Bare `ledger redraft` says where a redraft stands and what comes next, so
 * it is always safe to run.
 *
 * Until the stamp is there, `ledger build` warns and `ledger release cut`
 * refuses: a redrafted edition nobody has checked against the old one can
 * quietly drop something the client was told.
 */
export async function cmdRedraft({ flags, positional }) {
  const sub = positional[0] ?? "status";
  if (sub === "status") return status(flags);
  if (sub === "start") return start(flags);
  if (sub === "check") return brief(flags);
  if (sub === "complete") return complete(flags);
  fail('usage: ledger redraft [start [--force] | check | complete [--note "…"]]');
}

/* ---- where it stands --------------------------------------------------- */

function status(flags) {
  const project = openProject(flags);
  const last = project.redrafts[project.redrafts.length - 1] ?? null;
  if (!last) {
    out("No redraft yet. `ledger redraft start` sets the corpus aside in .ledger/archive/ and opens the next");
    out("version on an empty one, keeping the version numbers and every edition already printed.");
    return;
  }
  const report = redraftReport(project);
  if (!report.ok) {
    out(`Unfinished redraft: ${report.line}.`);
    out("");
    out("Next:");
    out(redraftSteps(report));
    return;
  }
  out(`The last redraft is complete: ${rangeLabel(last.versions)} ${last.versions.length === 1 ? "is" : "are"} archived in ` +
    `.ledger/${last.archive}/ (${longDate(last.started.date)}), and the v${last.opens} corpus was checked against ` +
    `${last.versions.length === 1 ? "it" : "them"} on ${longDate(last.reconciled.date)}.`);
  if (last.note) out(`The v${last.opens} edition tells the client: ${last.note}`);
  out("`ledger redraft check` prints the check again, if you want a second one.");
}

/** "v1–v2", or "v3" for a single release — how a range reads in prose. */
export function rangeLabel(versions) {
  const [first, last] = [versions[0], versions[versions.length - 1]];
  return first === last ? `v${first}` : `v${first}–v${last}`;
}

/* ---- what is outstanding ----------------------------------------------- */

/**
 * Whether a redraft is waiting to be checked against the corpus it replaced,
 * and what to do about it. `ok` when there is none.
 *
 * `steps` is the one list `ledger build`, `ledger release cut` and
 * `ledger status` all print, so they can't drift apart in what they ask for.
 */
export function redraftReport(project) {
  const pending = project.pendingRedraft;
  if (!pending) return { ok: true };
  const empty = project.featureSet.features().length === 0;
  const range = rangeLabel(pending.versions);
  const last = pending.versions[pending.versions.length - 1];

  const line = `the ledger was redrafted on ${longDate(pending.started.date)}: ${range} ${pending.versions.length === 1 ? "is" : "are"} ` +
    `archived in .ledger/${pending.archive}/, and the new corpus ${empty ? "is still empty" : "hasn't been checked against it yet"}, ` +
    `so this edition may have lost something the client was told in v${last}`;

  const steps = [];
  if (empty) {
    steps.push("run `ledger bootstrap` and hand the prompt to your coding agent. It surveys the product from scratch, " +
      `records everything at v${pending.opens}, and stops before the cut`);
  }
  steps.push("commit the current state of .ledger/, so the check's edits are a diff of their own");
  steps.push("run `ledger redraft check` and hand the prompt it prints to your coding agent. It compares the new entries " +
    "with the archived ones, restores anything the survey lost, and ends with `ledger redraft complete`");
  steps.push("commit its edits");
  return { ok: false, redraft: pending, empty, line, steps };
}

/** The report as an indented, numbered block, for the places that print it whole. */
export function redraftSteps(report, indent = "  ") {
  return report.steps.map((s, i) => `${indent}${i + 1}. ${s}`).join("\n");
}

/* ---- redraft start ----------------------------------------------------- */

function start(flags) {
  const project = openProject(flags);
  project.assertWritable();
  const root = project.root;
  const releases = project.releases;
  const current = releases.current;

  if (project.pendingRedraft) {
    const r = project.pendingRedraft;
    fail(`a redraft started on ${longDate(r.started.date)} hasn't been finished yet. Finish it first ` +
      "(`ledger status` says what's left), or undo it with git.");
  }

  // Everything the client has actually been handed since the last redraft.
  const shipped = releases.releases.filter((r) => r.released);
  if (!shipped.length) {
    fail("no edition has been handed to a client yet, so there is nothing to keep: no version numbers, no " +
      "documents, no facts a reader already holds. Rewrite the corpus in place (or empty .ledger/features/ and " +
      "run `ledger bootstrap` again) instead.");
  }

  // Work recorded on the open release hasn't been shown to anybody. Redraft
  // over it and it arrives in an edition that marks nothing as new or
  // changed, so the client is never told it moved. Cutting first gives it the
  // edition that says so.
  const open = current.future ? current.version : null;
  if (open && project.recordedAt(open) && !flags.force) {
    const n = project.featureSet.features().filter((f) => f.touchedAt(open)).length
      + project.featureSet.otherChanges({ version: open }).length;
    fail(`v${open} already has ${n} entr${n === 1 ? "y" : "ies"} recorded that the client hasn't seen. The first ` +
      "edition after a redraft marks nothing as new or changed, so those would reach the client unannounced. Cut " +
      `v${open} first (\`ledger release cut\`), so it gets an edition that highlights them, then redraft. Pass ` +
      "--force to fold them into the redraft unmarked.");
  }

  const ledgerRel = path.relative(root, project.ledgerDir) || ".ledger";
  if (git.available(root) && !flags.force) {
    const dirty = git.uncommitted(root, ledgerRel);
    if (dirty.length) {
      fail(`${ledgerRel}/ has uncommitted changes (${dirty.slice(0, 4).join(", ")}${dirty.length > 4 ? ", …" : ""}). ` +
        "Commit them first, so the corpus being set aside is one the history already holds. --force skips this.");
    }
  }

  const versions = shipped.map((r) => r.version);
  const label = versions.length === 1 ? `v${versions[0]}` : `v${versions[0]}-v${versions[versions.length - 1]}`;
  const archiveRel = `${ARCHIVE_DIRNAME}/${label}`;
  const archiveAbs = path.join(project.ledgerDir, archiveRel);
  if (exists(archiveAbs)) fail(`.ledger/${archiveRel}/ already exists — move it out of the way first`);

  const opens = open ?? current.version + 1;
  const commit = git.available(root) ? git.head(root) : null;
  const featureCount = project.featureSet.features().length;

  if (flags["dry-run"]) {
    out(`would archive ${rangeLabel(versions)} (${featureCount} features) to ${ledgerRel}/${archiveRel}/`);
    out(`would open v${opens} on an empty corpus, keeping config, brand, tone and theme`);
    out("(--dry-run: nothing written)");
    return;
  }

  // Everything but earlier archives, which stay where they are: an archive is
  // a corpus, never a corpus of corpora.
  fs.mkdirSync(archiveAbs, { recursive: true });
  for (const entry of fs.readdirSync(project.ledgerDir)) {
    if (entry === ARCHIVE_DIRNAME) continue;
    fs.cpSync(path.join(project.ledgerDir, entry), path.join(archiveAbs, entry), { recursive: true });
  }
  writeJson(path.join(archiveAbs, ARCHIVED_MARKER), {
    note: "A corpus set aside by `ledger redraft`. Read-only: the editions listed here are printed from it.",
    versions,
    archived: today(),
    commit,
    superseded_at: opens,
  });

  // The live corpus starts again. Config, brand, the tone and the theme are
  // the project's, not the corpus's, and carry straight over — except the
  // areas, because deciding those afresh is most of the point.
  for (const f of fs.readdirSync(project.featuresDir)) {
    if (f.endsWith(".json")) fs.unlinkSync(path.join(project.featuresDir, f));
  }
  const rawConfig = readJson(project.configPath);
  rawConfig.categories = [];
  writeJson(project.configPath, rawConfig);
  writeJson(project.subcategoriesPath, []);
  writeJson(project.otherChangesPath, []);
  writeJson(project.indexPath, { order: [] });
  // Both logs describe the old corpus — which entries a review read, what an
  // audit recorded — and are kept, whole, in the archive. The survey records
  // the new corpus's first full sweep on its own.
  writeJson(project.auditsPath, { audits: [] });
  if (exists(project.reviewsPath)) fs.unlinkSync(project.reviewsPath);

  const timeline = releases.releases
    .filter((r) => !r.future)
    .map((r) => (r.released ? { ...r, status: "archived", archive: archiveRel } : r));
  timeline.push({ version: opens, name: null, date: null, commit: null, status: "future" });
  project.releases = new ReleaseSet(timeline);
  project.saveReleases();

  project.redrafts.push({
    opens,
    archive: archiveRel,
    versions,
    started: { date: today(), commit },
    reconciled: null,
    // Client-facing: printed in the first edition after the redraft, under
    // the standard "this edition is reorganized" paragraph. Wording, so it
    // is yours to edit in place.
    note: null,
  });
  project.saveRedrafts();

  out(`archived ${rangeLabel(versions)} (${featureCount} feature${featureCount === 1 ? "" : "s"}) to ${ledgerRel}/${archiveRel}/`);
  out(`the corpus now opens at v${opens}, empty. ${rangeLabel(versions)} ${versions.length === 1 ? "stays in the timeline as an archived release" : "stay in the timeline as archived releases"}, ` +
    "so the numbering carries on and every edition already printed keeps its number and its file.");
  out("");
  out("Next:");
  out(redraftSteps(redraftReport(openProject(flags))));
  out("");
  out(`Then as usual: \`ledger release cut\` and \`ledger build\`. The v${opens} edition prints as an inventory, with a note ` +
    "telling the client the ledger was reorganized.");
}

/* ---- redraft complete -------------------------------------------------- */

function complete(flags) {
  const project = openProject(flags);
  project.assertWritable();
  const redraft = project.pendingRedraft;
  if (!redraft) {
    fail(project.redrafts.length
      ? "the last redraft is already complete — there is nothing to stamp"
      : "there is no redraft to complete. `ledger redraft start` begins one");
  }
  if (!project.featureSet.features().length) {
    fail("the new corpus is empty, so there is nothing to have checked. Run `ledger bootstrap` first.");
  }

  // The first edition after a redraft is an inventory: it prints no "What
  // changed" note, so a bullet left on an entry is text nobody will read.
  const problems = project.featureSet.features({ audience: "user" })
    .filter((f) => f.entryAt(redraft.opens)?.changes?.length)
    .map((f) => `${f.id} carries "changes", which the v${redraft.opens} edition never prints — fold anything worth ` +
      "keeping into the description, and set it to null");
  if (problems.length) {
    fail(`the redraft isn't ready to be marked complete:\n${problems.map((p) => `  ${p}`).join("\n")}\n` +
      "Fix these in .ledger/features/<id>.json, run `ledger status`, then `ledger redraft complete` again.");
  }

  if (flags.note !== undefined && flags.note !== true) redraft.note = String(flags.note).trim() || null;
  redraft.reconciled = { date: today(), commit: git.available(project.root) ? git.head(project.root) : null };

  if (flags["dry-run"]) {
    out(JSON.stringify(redraft, null, 2));
    out("(--dry-run: nothing written)");
    return;
  }
  project.saveRedrafts();
  out(`recorded the redraft as complete: the v${redraft.opens} corpus has been checked against ${rangeLabel(redraft.versions)}`);
  if (redraft.note) out(`the v${redraft.opens} edition will tell the client: ${redraft.note}`);
  out("Commit the result. `ledger release cut` and `ledger build` work as usual from here.");
}

/* ---- matching ---------------------------------------------------------- */

const STOP = new Set(("the and for with that this from into each every their them they its are was were can has have " +
  "not but all any one two when what which who how than then also only more most other such some own same very " +
  "your you our out about over under between while where there here does done being been just like").split(" "));

function words(text) {
  return new Set((String(text).toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? []).filter((w) => !STOP.has(w)));
}

function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}

/**
 * The entry in the new corpus an old one most likely went to: the same id, or
 * else the one whose name and description share the most words with it. A
 * hint for where to look first, not a verdict. A survey that merged three old
 * entries into one produces three old entries pointing at the same new one,
 * which is exactly what the agent needs to see.
 */
function counterparts(oldEntries, newEntries) {
  const index = newEntries.map((n) => ({ n, name: words(n.name), all: words(`${n.name} ${n.description}`) }));
  return oldEntries.map((o) => {
    const same = newEntries.find((n) => n.id === o.id);
    if (same) return { o, match: same, how: "same id" };
    const name = words(o.name);
    const all = words(`${o.name} ${o.description}`);
    let best = null;
    for (const c of index) {
      const score = overlap(all, c.all) + 0.5 * overlap(name, c.name);
      if (!best || score > best.score) best = { n: c.n, score };
    }
    return best && best.score >= 0.12 ? { o, match: best.n, how: "wording" } : { o, match: null, how: null };
  });
}

function entriesOf(project, version) {
  return project.featureSet.features()
    .map((f) => ({ f, s: f.stateAt(version) }))
    .filter(({ s }) => s && !s.removed)
    .map(({ f, s }) => ({ id: f.id, audience: f.audience, category: f.category, name: s.name, description: s.description, f }));
}

/* ---- the brief --------------------------------------------------------- */

function brief(flags) {
  const project = openProject(flags);
  const redraft = project.pendingRedraft ?? project.redrafts[project.redrafts.length - 1] ?? null;
  if (!redraft) fail("there is no redraft to check. `ledger redraft start` begins one.");

  const oldProject = new Project(path.join(project.ledgerDir, redraft.archive));
  const oldTarget = oldProject.releases.latestVersion;
  const shown = redraft.versions[redraft.versions.length - 1];
  const shownRelease = project.releases.at(shown);
  const N = `v${redraft.opens}`;
  const range = rangeLabel(redraft.versions);
  const archive = `.ledger/${redraft.archive}`;

  const newEntries = entriesOf(project, redraft.opens);
  if (!newEntries.length) {
    fail("the new corpus is empty, so there is nothing to compare yet. Run `ledger bootstrap` (it knows about the " +
      "redraft and stops before the cut), commit what it records, then run this again.");
  }
  const oldEntries = entriesOf(oldProject, oldTarget);
  const pairs = counterparts(oldEntries, newEntries);
  const matched = new Set(pairs.filter((p) => p.match).map((p) => p.match.id));
  const orphans = pairs.filter((p) => !p.match);
  const fresh = newEntries.filter((n) => !matched.has(n.id));
  // Recorded on the old corpus's open release and folded into the redraft
  // with --force: true of the product, never shown to the client.
  const touchedUnseen = oldTarget > shown ? oldProject.featureSet.features().filter((f) => f.touchedAt(oldTarget)) : [];
  const unseen = touchedUnseen.filter((f) => !f.entryAt(oldTarget).removed).map((f) => f.id);
  const unseenRemoved = touchedUnseen.filter((f) => f.entryAt(oldTarget).removed).map((f) => f.id);

  const ledgerRel = path.relative(project.root, project.ledgerDir) || ".ledger";
  const dirty = git.available(project.root) ? git.uncommitted(project.root, ledgerRel) : [];

  /* ---- the part for the human ---- */
  out(`ledger redraft check — the new ${N} corpus, checked against the archived ${range} (${archive}/)`);
  out("");
  out(`The archive has ${oldEntries.length} entries; the new corpus has ${newEntries.length}. By id or by wording, ` +
    `${pairs.length - orphans.length} old entries have a likely counterpart, and ${orphans.length} have none: those are where to look first.`);
  if (!project.pendingRedraft) {
    out("");
    out(`This redraft was already marked complete on ${longDate(redraft.reconciled.date)}. Run the prompt again only if you want a second check.`);
  }
  if (dirty.length) {
    out("");
    out(`! ${ledgerRel}/ has uncommitted changes. Commit them before you start, so the check's edits`);
    out("  show up as a diff of their own and you can read exactly what it restored.");
  }
  out("");
  out("The prompt itself is everything under the rule below. Copy it whole, from");
  out("there to the end of this output, into a fresh agent session in the project");
  out("root. It reads every archived entry against the new corpus, restores what the");
  out("survey lost, writes the note the client reads about the new arrangement, stamps");
  out("the redraft complete, and ends by listing what it couldn't settle without you.");
  out("Commit its edits when it's done.");
  out("");
  out(COPY_RULE);
  out("");

  /* ---- the part for the agent ---- */
  const lines = [];
  const p = (s = "") => lines.push(s);

  p(`Check the redrafted feature ledger of ${project.config.product} against the one it replaced, so nothing is lost.`);
  p("");
  p("The ledger is a client-facing record of what this product does, one entry per");
  p(`capability. It was just rewritten from scratch by a fresh survey of the code, so it`);
  p("reads better than the one it replaces. A fresh survey also misses things: a detail");
  p("only someone who knew the product would have written down, a capability hidden");
  p("behind a setting, the client's own word for something. Your job is to find what");
  p("the old ledger said that the new one no longer does, and put it back, without");
  p("undoing the new structure.");
  p("");
  p(`- The old corpus is archived, read-only, in ${archive}/. The client has`);
  p(`  its last edition, v${shown}${shownRelease.date ? ` (${longDate(shownRelease.date)})` : ""}.`);
  p(`- The new corpus is the live one in .ledger/. Everything in it is recorded at ${N},`);
  p("  the next edition the client will get.");
  p("");
  p("Before your first edit, run `ledger rules` and `ledger style`. Every sentence you");
  p("write has to be in that voice.");
  p("");
  p("## Reading the two corpora");
  p("");
  p("```");
  p(`ledger list --dir ${archive}            # the old corpus, one line per entry`);
  p(`ledger show <id> --dir ${archive}       # one old entry; --history for its past`);
  p("ledger list                                     # the new corpus");
  p("ledger show <id>                                # one new entry");
  p("```");
  p("");
  p("Never write to the archive. The CLI refuses to, and a hand-edit there would change");
  p("editions the client already holds.");
  p("");
  p("## Where each old entry probably went");
  p("");
  p("Worked out mechanically, from ids and shared words, so read these as places to");
  p("look first, not verdicts. Several old entries pointing at one new entry usually");
  p("means the survey merged them, and a merge is where detail gets lost.");
  p("");
  for (const category of oldProject.featureSet.categories()) {
    const inCat = pairs.filter((x) => x.o.category === category);
    if (!inCat.length) continue;
    p(category);
    for (const { o, match, how } of inCat) {
      const target = match ? `→ ${match.id}${how === "wording" ? " ?" : ""}` : "→ (none found)";
      p(`  ${o.id.padEnd(32)} ${target.padEnd(36)} ${o.audience === "dev" ? "dev  " : ""}${o.name}`);
    }
    p("");
  }
  if (orphans.length) {
    p(`No likely counterpart (${orphans.length}): ${orphans.map((x) => x.o.id).join(", ")}.`);
    p("");
  }
  if (fresh.length) {
    p("New entries no old entry points at. The survey may have found something the old");
    p("ledger missed, which is fine, or described one thing twice:");
    p("");
    for (const n of fresh) p(`  ${n.id.padEnd(32)} ${n.name}`);
    p("");
  }
  if (unseen.length || unseenRemoved.length) {
    p(`The old corpus recorded work after v${shown} that the client has never seen, and the`);
    p(`${N} edition marks nothing as new, changed or removed. If any of it matters to the`);
    p("client, list it for the human.");
    p("");
    if (unseen.length) p(`  changed since v${shown}:  ${unseen.join(", ")}`);
    if (unseenRemoved.length) p(`  removed since v${shown}:  ${unseenRemoved.join(", ")}`);
    p("");
  }

  p("## Each old entry");
  p("");
  p("Work through the old areas in order, one at a time, without stopping between them.");
  p("For every old entry, client-facing and dev alike:");
  p("");
  p("1. Read it with `ledger show <id> --dir …`, and read the new entry or entries it");
  p("   went to.");
  p("2. Take the old description one statement at a time. For each, find where the new");
  p("   corpus says the same thing: in the counterpart, in another entry, or in");
  p("   \"dev_notes\". Most statements will already be there, in other words. That's fine.");
  p("3. For a statement the new corpus doesn't make, check the code.");
  p("   - Still true: put it back where a reader would look for it, as a hand-edit of");
  p("     .ledger/features/<id>.json. A description, or \"dev_notes\" if it's for the");
  p("     team. Write it in the new entry's voice; don't paste the old sentence in.");
  p("   - No longer true: leave it out, and put it on your list for the human. The");
  p("     client was told it in an earlier edition.");
  p("4. A whole capability the survey missed, still in the product, gets an entry of");
  p("   its own: `ledger add <id>`, the same way the survey recorded everything else.");
  p("   It lands on " + N + ". Never pass --backfilled: in a redrafted ledger every entry is");
  p("   part of the same new inventory.");
  p("5. Keep the old wording where it was better: the client's own word for a thing,");
  p("   a name the client already knows the capability by, a sentence that says what");
  p("   a feature is *for*. Where the new name is clearer, keep the new one.");
  p("6. Old \"What changed\" bullets are not carried over. The first edition after a");
  p("   redraft prints none. A reason in one that explains what a feature is for can");
  p("   go into the description, as how the feature works.");
  p("7. Old \"dev_notes\" carry over to the entry that now owns the capability.");
  p("");
  p("Also read the archive's sub-section intros (subcategories.json) and product-wide");
  p("notes (other-changes.json) for anything a description should still say.");
  p("");
  p("## Limits");
  p("");
  p("- Keep the new structure. Don't re-split, re-merge or re-file entries to match");
  p("  the old corpus. The new arrangement is the point of the redraft. Two new entries");
  p("  that are one capability described twice are the one exception: fold one into");
  p("  the other and delete its file.");
  p("- Change what the ledger says only to make it true and complete. Every sentence you");
  p("  leave must be something a reader could confirm by using the product.");
  p(`- Every entry stays at ${N}, with "changes" set to null. Don't run \`ledger update\``);
  p("  or `ledger remove`, and don't touch releases.json, redrafts.json or the archive.");
  p("- Don't run `ledger build` or `ledger release cut`.");
  p("");
  p("## The note for the client");
  p("");
  p(`The ${N} edition opens with a standard paragraph telling the client the ledger has`);
  p(`been reorganized since v${shown}, so its areas, names and descriptions won't match`);
  p("earlier editions line for line. Under it goes a note you write: one to three");
  p("sentences on what changed in the arrangement, so a reader who knows the old");
  p("edition can find their way. Name the areas they'll now find things under, and any");
  p("capability they'd look for by its old name. For example: \"Bookings and Payments are");
  p("one area, Bookings. Deposit refunds, previously its own entry, is part of Checkout.\"");
  p("Present tense, in the house style. Nothing about how the ledger was rewritten or");
  p("who rewrote it.");
  p("");
  p("## When you're done");
  p("");
  p("1. Run `ledger status`. It validates every file you touched. Fix what it reports.");
  p("2. Run `ledger redraft complete --note \"…\"` with the note. It refuses while an");
  p("   entry still carries a change note, and names it.");
  p("3. Then print a short report for the human:");
  p("   - per old entry, one line for each statement you put back, and where;");
  p("   - the entries you added;");
  p("   - the old statements that are no longer true of the product. The client read");
  p("     them in an earlier edition, so the human decides whether to tell them;");
  p("   - a numbered list of questions: anything you couldn't confirm in the code.");
  p("   Leave out every old statement the new corpus already made. The list is for");
  p("   someone to check quickly.");

  out(lines.join("\n"));
}
