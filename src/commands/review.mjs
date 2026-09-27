import crypto from "node:crypto";
import { openProject } from "../store.mjs";
import { fail, today, longDate, COPY_RULE } from "../util.mjs";
import { unauditedReport, unauditedLine } from "./audit.mjs";
import * as git from "../git.mjs";

const out = (s) => process.stdout.write(`${s}\n`);

/**
 * Reading a release the way the client will, before it is handed over.
 *
 * Every entry in a release is written at the moment its work landed, one
 * `ledger update` at a time, and each update's bullet says what the feature
 * was *just before that update*. Each of those bullets was true when it was
 * written. Read together against the previous edition — which is the only
 * thing the client compares with — they often are not: a "before" that never
 * shipped because the thing it mentions is itself new this cycle, a fix to
 * something the client has never seen, a chart introduced in one bullet and
 * redesigned in the next three. Nothing in a single write can see that. Only
 * a read of the whole release can, which is what this is.
 *
 * Like `audit`, the command prints a brief rather than doing the work, and
 * does the cheap deterministic half first: what arrived this cycle, which
 * entries are in it, and a few mechanical hints about where the drafts show.
 * `review complete` then stamps what was read, and `release cut` refuses an
 * edition whose client-facing entries changed after that.
 */
export async function cmdReview({ flags, positional }) {
  const sub = positional[0] ?? "brief";
  if (sub === "brief") return brief(flags);
  if (sub === "complete") return complete(flags);
  fail("usage: ledger review | review complete");
}

/* ---- what a review covers ---------------------------------------------- */

/**
 * Everything the client edition prints as news at `version`: the user-facing
 * entries written at it, and the product-wide notes. Team-only entries are
 * left out on purpose — they never reach the client, and a gate that fired on
 * a dev note would be one people learn to --force past.
 *
 * Each is fingerprinted by the words the client reads, not by the file, so
 * confirming an inferred reason or editing dev notes does not ask for another
 * review, while a new bullet, a rewritten description or a new entry does.
 */
function reviewTargets(project, version) {
  const targets = new Map();
  for (const f of project.featureSet.features({ audience: "user" })) {
    const h = f.entryAt(version);
    if (!h) continue;
    const words = h.removed
      ? { removed: true, reason: h.reason, backfilled: Boolean(h.backfilled) }
      : { name: h.name ?? null, description: h.description, changes: h.changes ?? null, backfilled: Boolean(h.backfilled) };
    targets.set(f.id, { label: f.currentName, hash: fingerprint(words) });
  }
  for (const c of project.featureSet.otherChanges({ version })) {
    if (c.audience !== "user") continue;
    const hash = fingerprint({ other: c.description });
    targets.set(`other:${hash}`, { label: `product-wide note “${clip(c.description, 50)}”`, hash });
  }
  return targets;
}

function fingerprint(words) {
  return crypto.createHash("sha256").update(JSON.stringify(words)).digest("hex").slice(0, 16);
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * What in the open release has not been read since it was last written.
 *
 * `ok` when there is nothing to review: no release in progress, a first
 * edition (there is no earlier one to compare it with, so it prints nothing as
 * new or changed), or nothing client-facing recorded yet — the empty-release
 * guard in `release cut` already covers that one.
 */
export function unreviewedReport(project) {
  const current = project.releases.current;
  if (!current.future) return { ok: true, reason: "no release in progress" };
  const version = current.version;
  if (!project.releases.predecessorOf(version)) {
    return { ok: true, reason: "a first edition has nothing to be compared with" };
  }

  const targets = reviewTargets(project, version);
  if (!targets.size) return { ok: true, reason: "nothing client-facing recorded yet" };

  const last = project.lastReviewOf(version);
  const seen = last?.entries ?? {};
  const pending = [...targets].filter(([key, t]) => seen[key] !== t.hash).map(([key, t]) => ({ key, label: t.label }));
  return { ok: pending.length === 0, version, last, pending, total: targets.size };
}

/** One sentence for the gate and for `ledger status`, so they can't drift. */
export function unreviewedLine(report) {
  const names = report.pending.filter((p) => !p.key.startsWith("other:")).map((p) => p.key);
  const others = report.pending.length - names.length;
  const shown = names.slice(0, 6).join(", ") + (names.length > 6 ? `, and ${names.length - 6} more` : "");
  const what = [shown, others ? `${others} product-wide note${others === 1 ? "" : "s"}` : ""].filter(Boolean).join("; ");
  if (!report.last) {
    return `v${report.version} has not been reviewed: ${report.total} client-facing entr${report.total === 1 ? "y has" : "ies have"} ` +
      "never been read against the previous edition as one release";
  }
  return `${report.pending.length} client-facing entr${report.pending.length === 1 ? "y has" : "ies have"} changed since ` +
    `v${report.version} was reviewed on ${longDate(report.last.date)} (${what})`;
}

/* ---- review complete --------------------------------------------------- */

/**
 * Stamps what the review read. It refuses the two shapes that are wrong on
 * their face, whatever the prose says, so a review cannot be recorded over
 * them: a feature new in this release carrying a "What changed" note (it has
 * no "before" for the client), and one marked changed with nothing saying
 * what changed.
 */
function complete(flags) {
  const project = openProject(flags);
  const version = project.workingVersion;
  const problems = shapeProblems(project, version);
  if (problems.length) {
    fail(
      `v${version} isn't ready to be marked reviewed:\n${problems.map((p) => `  ${p}`).join("\n")}\n` +
      "Fix these in .ledger/features/<id>.json, run `ledger status`, then `ledger review complete` again.",
    );
  }

  const targets = reviewTargets(project, version);
  const entry = {
    version,
    date: today(),
    commit: git.available(project.root) ? git.head(project.root) : null,
    entries: Object.fromEntries([...targets].map(([key, t]) => [key, t.hash])),
  };
  if (flags["dry-run"]) {
    out(JSON.stringify(entry, null, 2));
    out("(--dry-run: nothing written)");
    return;
  }
  project.recordReview(entry);
  out(`recorded a review of v${version} (${entry.date}) covering ${targets.size} client-facing entr${targets.size === 1 ? "y" : "ies"}`);
  out("A later `ledger add`, `update` or hand-edit to one of them asks for another before `ledger release cut`.");
}

function shapeProblems(project, version) {
  const problems = [];
  for (const f of project.featureSet.features({ audience: "user" })) {
    const h = f.entryAt(version);
    if (!h || h.removed) continue;
    if (f.firstVersion === version && h.changes?.length) {
      problems.push(`${f.id} is new in v${version} but still carries "changes" — set it to null, and move anything worth keeping into the description`);
    } else if (f.firstVersion < version && !h.changes?.length) {
      problems.push(`${f.id} is marked changed in v${version} with no bullet — say what changed, or delete its v${version} entry if nothing did`);
    }
  }
  return problems;
}

/* ---- hints ------------------------------------------------------------- */

/** Words that make a description narrate its own history. They belong in a
 *  change bullet, if anywhere; a description says what the product does. */
const NARRATING = /\b(now|no longer|any ?more|used to|previously|as before|is really|are really|actually)\b/gi;

/** Capitalised words that start nothing and name nothing — mid-sentence they
 *  are still just English. */
const COMMON = new Set(("I A An The This That These Those It Its If When While Before After Now Then Each Every " +
  "No Not Nothing Only Both Either Neither One Two Three Four Five And Or But So Yes Ok OK").split(" "));

/**
 * Terms a bullet uses that appear nowhere in the previous edition: quoted
 * labels, and capitalised words that don't open a sentence. A bullet whose
 * "before" involves one of them is usually describing a state the client
 * never saw — "Events synced from Acuity no longer appear under Unpaid" when
 * the Acuity sync is itself new this cycle. It is a hint, not a verdict: the
 * "now" half of a sound bullet can name something new as well.
 */
function unseenTerms(bullets, vocabulary) {
  const found = new Set();
  for (const b of bullets) {
    for (const m of b.matchAll(/[“"]([^”"]{2,60})[”"]/g)) found.add(`“${m[1]}”`);
    for (const sentence of b.split(/(?<=[.!?:;])\s+/)) {
      const words = sentence.split(/\s+/).slice(1);
      for (const w of words) {
        const clean = w.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
        if (/^[A-Z][a-zA-Z]+$/.test(clean) && !COMMON.has(clean)) found.add(clean);
      }
    }
  }
  return [...found].filter((t) => !vocabulary.includes(t.replace(/[“”]/g, "").toLowerCase()));
}

/** Everything the client has already read in the previous edition, as one
 *  lowercased text to test terms against. */
function editionText(project, version) {
  const parts = [];
  for (const f of project.featureSet.features({ audience: "user" })) {
    const s = f.stateAt(version);
    if (!s || s.removed) continue;
    parts.push(s.name, s.description, ...(s.changes ?? []));
  }
  for (const c of project.otherChangesList) if (c.version <= version && c.audience === "user") parts.push(c.description);
  return parts.join("\n").toLowerCase();
}

/* ---- the brief --------------------------------------------------------- */

function brief(flags) {
  const project = openProject(flags);
  const version = project.workingVersion;
  const previous = project.releases.predecessorOf(version);
  const set = project.featureSet;
  const product = project.config.product;

  const touched = set.features({ audience: "user" }).filter((f) => f.touchedAt(version));
  const kindOf = (f) => {
    const h = f.entryAt(version);
    if (h.removed) return h.backfilled ? "gone" : "removed";
    if (f.firstVersion === version) return h.backfilled ? "in place" : "new";
    return h.backfilled ? "in place" : "updated";
  };
  const others = set.otherChanges({ version }).filter((c) => c.audience === "user");
  if (!touched.length && !others.length) {
    fail(`nothing client-facing is recorded against v${version} yet, so there is nothing to review`);
  }

  const report = unreviewedReport(project);
  const incremental = Boolean(report.last) && !report.ok;
  const pendingKeys = new Set((report.pending ?? []).map((p) => p.key));
  const count = (k) => touched.filter((f) => kindOf(f) === k).length;
  const tally = [["new", count("new")], ["updated", count("updated")], ["already in place", count("in place")],
    ["removed", count("removed") + count("gone")], ["product-wide notes", others.length]]
    .filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(", ");

  const vocabulary = previous ? editionText(project, previous.version) : "";
  const P = previous ? `v${previous.version}` : null;
  const N = `v${version}`;

  /* ---- the part for the human ---- */
  out(`ledger review — ${N}${previous ? `, read against the ${P} edition (${longDate(previous.date)})` : ", the first edition"}`);
  out("");
  out(`${touched.length + others.length} client-facing entries: ${tally}.`);
  if (report.last) {
    out(report.ok
      ? `Reviewed on ${longDate(report.last.date)}, and nothing has changed since. Run it again only if you want a second read.`
      : `Reviewed on ${longDate(report.last.date)}; ${report.pending.length} changed since. The brief covers the whole release and marks those.`);
  }
  const unaudited = unauditedReport(project);
  if (!unaudited.ok) {
    out("");
    out(`! ${unauditedLine(unaudited)}. Run \`ledger audit\` first: whatever it records`);
    out("  lands in this release, and would need reviewing again.");
  }
  out("");
  out("The prompt itself is everything under the rule below. Copy it whole, from");
  out("there to the end of this output, into a fresh agent session in the project");
  out("root. It reads the release the way the client will, against the edition they");
  out("already have, and rewrites the entries in place so they agree with that edition");
  out("and with each other. It changes wording, never what the ledger says the product");
  out("does. It stamps the review, and ends by listing what it couldn't settle without you.");
  out("");
  out(COPY_RULE);
  out("");

  /* ---- the part for the agent ---- */
  const lines = [];
  const p = (s = "") => lines.push(s);

  p(`Review the ${N} edition of the feature ledger of ${product} before it goes to the client.`);
  p("");
  p("The ledger is a client-facing record of what this product does, one entry per");
  if (previous) {
    p(`capability. The client already has the ${P} edition (${longDate(previous.date)}). The ${N} edition`);
    p(`marks everything that differs from ${P}: green for a new capability, blue for an`);
    p("updated one with a \"What changed\" note under it, grey for one that was already in");
    p("the product and is only now on the record.");
  } else {
    p("capability. This is its first edition, so nothing in it prints as new or changed;");
    p("the review is about the entries agreeing with each other and reading well.");
  }
  p("");
  p("Each entry was written when its work landed, one update at a time, by whoever did");
  p("the work. Nobody has read the release as a whole, the way the client will. That");
  p("is your job: make the new and updated entries accurate against what the client");
  p("already has, consistent with each other, and good to read.");
  p("");
  p("You are editing words, not recording work. Every change you make is a hand-edit");
  p("of .ledger/features/<id>.json, or of .ledger/other-changes.json for the");
  p("product-wide notes. Do not run `ledger add`, `update`, `remove` or `other-change`:");
  p("those record that the product moved, and nothing about the product moves in a");
  p("review.");
  p("");
  p("Before your first edit, run `ledger rules` and `ledger style`. Every sentence you");
  p("leave behind has to be in that voice.");
  p("");

  if (previous) {
    p("## The one fact everything here turns on");
    p("");
    p(`The client compares ${N} with ${P}. They never saw anything in between.`);
    p("");
    p("A feature can change several times in one release. Each `ledger update` rewrites");
    p(`the same ${N} entry and usually adds a bullet saying what the feature was just`);
    p("before that update. Every one of those bullets was true when it was written.");
    p(`Read together, against ${P}, they often are not. From another product's ledger:`);
    p("");
    p("- The \"before\" never shipped. \"Events synced from Acuity no longer appear under");
    p("  Unpaid. Before, they were listed there alongside the app's own bookings.\" But");
    p(`  the Acuity sync is itself new in ${N}. In ${P} there were no Acuity events to list,`);
    p("  so the client reads a fix to a problem they never had.");
    p("- The bullet fixes something that is itself new. \"Confirm all is now near the top");
    p(`  of the page instead of below the fold\", when ${P} had no Confirm all at all.`);
    p("- A capability arrives in one bullet and is reworked in the next three. \"Added an");
    p("  events chart\", then \"The events chart's weekly view now puts canceled events");
    p("  below the line\", then \"The 10-year view now overlays the years\". The client");
    p("  should read one sentence about a new chart, not its drafts.");
    p("- Two bullets cancel out, or a later one partly reverses an earlier one.");
    p("- A new feature carries a change note at all. It has no \"before\" for the client.");
    p("");
    p(`The test for every bullet: its \"before\" must be true of the ${P} edition.`);
    p(`\`ledger show <id> --history\` prints an entry's history. The last entry before ${N}`);
    p("is what the client has in front of them: that, not the state the last update");
    p("started from, is \"before\".");
    p("");

    const arrived = touched.filter((f) => kindOf(f) === "new");
    const gone = touched.filter((f) => ["removed", "gone"].includes(kindOf(f)));
    if (arrived.length || gone.length) {
      p(`## What arrived in ${N}`);
      p("");
      p(`The new ones did not exist in ${P}, so no bullet anywhere in this release may`);
      p("describe a \"before\" in which one of them was there. Their own descriptions are");
      p("where they are explained; everywhere else, name them and point. The removed");
      p("ones are gone, so nothing else in the release may still describe them.");
      p("");
      for (const f of arrived) p(`  new      ${f.id.padEnd(34)} ${f.currentName}`);
      for (const f of gone) p(`  removed  ${f.id.padEnd(34)} ${f.currentName}`);
      p("");
    }

    const hints = [];
    for (const f of touched) {
      const h = f.entryAt(version);
      if (h.removed) continue;
      const kind = kindOf(f);
      const notes = [];
      if (kind === "new" && h.changes?.length) notes.push(`new, but carries ${h.changes.length} change bullet${h.changes.length === 1 ? "" : "s"}`);
      if (f.firstVersion < version && !h.changes?.length) notes.push("marked changed with no bullet");
      if (f.firstVersion < version && h.changes?.length) {
        const terms = unseenTerms(h.changes, vocabulary);
        if (terms.length) notes.push(`bullets name what ${P} never mentioned: ${terms.slice(0, 6).join(", ")}${terms.length > 6 ? ", …" : ""}`);
        if (h.changes.length > 4) notes.push(`${h.changes.length} bullets`);
      }
      const narrating = [...new Set([...(h.description.matchAll(NARRATING))].map((m) => m[0].toLowerCase()))];
      if (narrating.length) notes.push(`description narrates: ${narrating.map((w) => `“${w}”`).join(", ")}`);
      if (notes.length) hints.push([f, notes]);
    }
    for (const c of others) {
      const terms = unseenTerms([c.description], vocabulary);
      if (terms.length) hints.push([{ id: "other-change", currentName: clip(c.description, 40) }, [`names what ${P} never mentioned: ${terms.slice(0, 6).join(", ")}`]]);
    }
    if (hints.length) {
      p("## Where the drafts probably show");
      p("");
      p("Worked out mechanically, so read these as places to look first, not verdicts.");
      p(`\"Never mentioned\" means the term appears nowhere in the ${P} edition: a bullet`);
      p("whose \"before\" involves one of them is almost always describing a state the");
      p("client never saw, though the \"now\" half of a sound bullet can name one too.");
      p("");
      for (const [f, notes] of hints) {
        p(`  ${f.id}`);
        for (const n of notes) p(`      ${n}`);
      }
      p("");
    }
  }

  p("## The entries, area by area");
  p("");
  p("Work through the areas in order, one at a time, without stopping between them.");
  p("For each entry run `ledger show <id> --history`, and read the files of the entries");
  p("in an area together before you edit any of them.");
  if (incremental) {
    p(`\`*\` marks an entry that changed after the last review (${longDate(report.last.date)}). Give those`);
    p("the full treatment, and read the rest only for whether they still agree with them.");
  }
  p("");
  for (const category of set.categories({ audience: "user" })) {
    const inCat = set.bySize(touched.filter((f) => f.category === category));
    if (!inCat.length) continue;
    p(category);
    for (const f of inCat) {
      const h = f.entryAt(version);
      const mark = incremental && pendingKeys.has(f.id) ? "*" : " ";
      const bullets = h.changes?.length ? `  (${h.changes.length} bullet${h.changes.length === 1 ? "" : "s"})` : "";
      p(` ${mark} ${kindOf(f).padEnd(9)} ${f.id.padEnd(34)} ${f.currentName}${bullets}`);
    }
    p("");
  }
  if (others.length) {
    p(`Product-wide notes in ${N} (.ledger/other-changes.json):`);
    others.forEach((c, i) => {
      const mark = incremental && pendingKeys.has(`other:${fingerprint({ other: c.description })}`) ? "*" : " ";
      p(` ${mark}${String(i + 1).padStart(2)}. ${c.description}`);
    });
    p("");
  }

  if (previous) {
    p("## Each updated entry");
    p("");
    p(`1. Read the ${P} entry and the ${N} one side by side. Work out what a client who`);
    p(`   knows ${P} will actually notice is different. That, and only that, is what the`);
    p("   bullets say.");
    p(`2. Drop every bullet whose \"before\" is not true of ${P}. If what it describes still`);
    p("   matters, it belongs in the description, as how the feature works now, or in");
    p("   the new entry that owns it.");
    p("3. Merge bullets that are steps toward one result into one bullet about the");
    p("   result. Keep the reasons they already give; the reason for a step that no");
    p("   longer exists goes with it.");
    p(`4. Every bullet that survives says what the feature was in ${P} and why it moved,`);
    p("   one change per bullet. Two or three sentences is normal. Say what it is now");
    p("   only where the description doesn't already make it obvious.");
    p("5. When the change is that a new capability arrived and this feature now works");
    p("   with it, write one short bullet that points to the new entry by name (\"see");
    p("   “Office sign-off on every assignment”\") instead of explaining it again.");
    p("   Explain it fully once, in the entry that owns it.");
    p("   When there was no earlier state at all (in the Acuity example, there were no");
    p("   Acuity events in the dashboard's lists or anywhere else), don't invent a");
    p("   \"before\": say how this feature treats the new capability, and point to it.");
    p("6. If nothing is left that the client would notice (it moved during the release");
    p("   and came back, or all it did was take part in a new entry that already says");
    p(`   so), the entry shouldn't print as updated. Delete its ${N} object from`);
    p("   \"history\". If its wording is better than the old entry's and says nothing new,");
    p("   carry that wording back into the previous entry first. Wording is reprinted");
    p("   in every edition anyway.");
    p("7. The description is the full current state, in the present tense. \"Now\", \"no");
    p("   longer\", \"used to\" and \"before\" belong in the bullets, not here.");
    p("");
    p("## Each new entry");
    p("");
    p("- \"changes\" is null. A new capability has no \"before\" for the client, and the");
    p("  edition prints no \"What changed\" note for it. Anything in a leftover bullet");
    p("  worth keeping goes into the description, as what the product does.");
    p("- The description says what the product does as if it had always been there. Not");
    p("  \"Every email the platform writes is now actually delivered\" but \"Every email");
    p("  the platform writes is delivered\". No \"now\", \"no longer\", \"really\", \"still\"");
    p("  or \"used to\": each one tells the reader a story about a version they can't see.");
    p("- The name states the capability, not the news. \"Email delivery\", not \"Emails are");
    p("  really sent\". `ledger rules` has the test for a name.");
    p("- Two new entries that are really one capability become one. Fold the text into");
    p("  the entry with the better id and delete the other's file. That is only allowed");
    p(`  for a feature whose history starts at ${N}.`);
    p("- With the whole release in view, check that the size and the area still fit.");
    p("");
    p("## Grey entries (\"already in place\")");
    p("");
    p("The capability was already in the product before this cycle; only the record is");
    p("new. Nothing in its description or its bullets may say or imply that it arrived");
    p("or changed in this cycle.");
    p("");
  }

  p("## Across the release");
  p("");
  p("When every area is done, read the release once more as one document:");
  p("");
  p("- One thing, one name. If the office \"confirms\" in one entry and \"signs off\" in");
  p("  another, or a button is quoted two ways, pick what the product itself says and");
  p("  use it everywhere in the release.");
  p("- A fact stated in more than one entry agrees everywhere: times, numbers, limits,");
  p("  who can do what. \"About an hour before\" in one entry and \"90 minutes before\"");
  p("  in another can't both be right. Check the code and fix the wrong one, even in an");
  p("  unchanged entry; that is only a wording fix.");
  p("- Each change is explained once, where a reader would look for it. Other entries");
  p("  name it and point.");
  p("- Every \"see …\" names an entry that exists, by its current name.");
  if (previous) {
    p(`- Product-wide notes pass the same test against ${P}. A note that only makes sense`);
    p("  against a state inside this release (\"those events were being left out of the");
    p("  sync\", when the sync is new) loses that part.");
  }
  p("- Nothing that is only for the team: people's names, test copies, environments,");
  p("  database changes, internal tooling, tracking mechanics. If the team needs it,");
  p("  move it to that entry's \"dev_notes\".");
  p("- A long list of bullets usually means drafts, not a big change. An entry with");
  p("  more than four deserves a second look. Group what belongs together.");
  p("");
  p("## Limits");
  p("");
  p("- Change the wording, never the facts. Every sentence you leave must be something");
  p("  a reader could confirm by using the product. When two entries disagree or you");
  p("  can't tell what the product does now, read the code. Don't reconcile texts by");
  p("  guessing.");
  p("- Never invent a reason. When you merge bullets, keep the reasons already written.");
  p("  A surviving bullet with no reason stays without one, and goes on your list for");
  p("  the human.");
  p(`- Leave entries outside ${N} alone, except to make a stated fact agree, and then`);
  p("  only the words.");
  p("- The only structural edits a review makes are: setting \"changes\" to null on a new");
  p(`  entry; deleting the ${N} object of an updated entry whose net change is nothing;`);
  p("  and deleting the file of a new entry merged into another. Never add a history");
  p("  entry, never change a \"version\", and never touch releases.json, audits.json or");
  p("  reviews.json.");
  p("- Leave a \"reason_inferred\" flag where it is. Only the human can confirm a reason.");
  p("- Don't run `ledger build` or `ledger release cut`.");
  p("");
  p("## When you're done");
  p("");
  p("1. Run `ledger status`. It validates every file you touched. Fix what it reports.");
  p("2. Run `ledger review complete`. It refuses while a new entry still carries a");
  p("   change note or an updated one has none, and names them.");
  p("3. Then print a short report for the human:");
  p("   - per entry, one line for each bullet you dropped because its \"before\" never");
  p("     shipped, and for each group of bullets you merged;");
  p("   - the entries you took off the updated list, and the new entries you merged;");
  p("   - a numbered list of questions: bullets left without a reason, facts you");
  p("     couldn't confirm, and anything you would have changed if it hadn't meant");
  p("     changing what the ledger says the product does.");
  p("   Leave out every edit that was only wording. The list is for someone to check");
  p("   quickly.");

  out(lines.join("\n"));
}
