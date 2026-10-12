import { openProject } from "../store.mjs";
import { fail, today, longDate, COPY_BLOCK } from "../util.mjs";
import * as git from "../git.mjs";
import {
  LISTS, ITEM_LIMIT, composes, composeTargets, kindAt, needsNote, accountingProblems, textProblems,
  composeReportFor, composeLine, stamped,
} from "../compose.mjs";
import { eventLine } from "../diff.mjs";

const out = (s) => process.stdout.write(`${s}\n`);

/**
 * `ledger compose` prints the brief for writing what an edition says about
 * what moved: the "What changed" note under every updated entry, and the
 * short lists the edition opens with. `ledger compose complete` checks what
 * was written and stamps it. See src/compose.mjs for why it is composed per
 * release rather than written as each change lands.
 *
 * The brief carries everything the agent needs: each entry as the client's
 * last edition showed it, as it stands now, and the events between. So the
 * agent reads nothing else, not even the code, and the step is cheap enough
 * for `ledger preview --run` to run whenever the release has moved.
 */
export async function cmdCompose({ flags, positional }) {
  const sub = positional[0] ?? "brief";
  if (sub === "brief") return brief(flags);
  if (sub === "complete") return complete(flags);
  fail("usage: ledger compose | compose complete");
}

/* ---- compose complete -------------------------------------------------- */

/**
 * Refuses what would print wrong whatever the prose says: an updated entry
 * with no note, a note on an entry the client has never seen, an entry the
 * summary neither covers nor leaves out, an id that is no entry in this
 * release, and an item that won't read as a sentence of its own. Then stamps
 * what it was composed from, and prints the lists the way the edition will.
 */
function complete(flags) {
  const project = openProject(flags);
  const version = project.workingVersion;
  if (!composes(project, version)) {
    fail(`v${version} is a first edition: it prints as an inventory, with nothing marked as new or changed`);
  }
  const composition = project.compositionOf(version);
  if (!composition) {
    fail(`.ledger/compositions.json has nothing for v${version} — \`ledger compose\` prints the brief for writing it`);
  }

  const targets = composeTargets(project, version);
  const problems = accountingProblems(project, version, composition);
  for (const [text, found] of textProblems(composition)) {
    problems.push(`“${text.length > 60 ? `${text.slice(0, 59)}…` : text}” ${found.join(" and ")}; it prints as a ` +
      "sentence of its own, so reword one that opens on a command or a file name");
  }
  if (problems.length) {
    fail(`the composition of v${version} isn't ready to be marked complete:\n${problems.map((p) => `  ${p}`).join("\n")}\n` +
      "Fix these in .ledger/compositions.json, then run `ledger compose complete` again.");
  }

  const next = stamped(project, composition, {
    date: today(),
    commit: git.available(project.root) ? git.head(project.root) : null,
  });
  if (flags["dry-run"]) {
    out(JSON.stringify(next, null, 2));
    out("(--dry-run: nothing written)");
    return;
  }
  project.saveComposition(next);
  const notes = Object.keys(next.changes).length;
  out(`recorded the composition of v${version} (${next.date}): ${notes} "What changed" note${notes === 1 ? "" : "s"}, and a summary ` +
    `of ${targets.length} client-facing entr${targets.length === 1 ? "y" : "ies"}. Recording a change to one of them puts it out of date; ` +
    "editing its words by hand doesn't.");
  out("");
  out(printedLists(next));
}

/** The lists as the edition prints them, with the ids each item covers in place of its links. */
export function printedLists(composition) {
  const lines = [];
  for (const [key, title] of LISTS) {
    const items = Array.isArray(composition[key]) ? composition[key] : [];
    if (!items.length) continue;
    if (lines.length) lines.push("");
    lines.push(title);
    items.forEach((item, i) => lines.push(`  ${String(i + 1).padStart(2)}. ${item.text}  [${item.covers.join(", ")}]`));
  }
  if (composition.quiet?.length) {
    if (lines.length) lines.push("");
    lines.push(`Left out: ${composition.quiet.join(", ")}`);
  }
  return lines.join("\n");
}

/* ---- the brief --------------------------------------------------------- */

function brief(flags) {
  const project = openProject(flags);
  const version = project.workingVersion;
  const previous = project.releases.predecessorOf(version);
  const product = project.config.product;
  const N = `v${version}`;

  if (!previous) {
    fail(`${N} is a first edition${version > 1 ? " after a redraft" : ""}: it prints as an inventory, with nothing ` +
      "marked as new or changed, so there is nothing to compose");
  }
  const P = `v${previous.version}`;
  const targets = composeTargets(project, version);
  if (!targets.length) fail(`nothing client-facing is recorded against ${N} yet, so there is nothing to compose`);

  const composition = project.compositionOf(version);
  const report = composeReportFor(project, version);
  const stale = new Set(report.stale ?? []);
  const arrived = targets.filter((f) => f.firstVersion === version);
  const noted = targets.filter((f) => needsNote(f, version));

  /* ---- the part for the human ---- */
  out(`ledger compose — ${N}, read against the ${P} edition (${longDate(previous.date)})`);
  out("");
  out(`${targets.length} client-facing entr${targets.length === 1 ? "y" : "ies"} in ${N}, ${noted.length} of them updated. ` +
    `${report.ok ? "The composition is up to date." : `${composeLine(report).replace(/^./, (c) => c.toUpperCase())}.`}`);
  out("");
  out("The prompt writes the \"What changed\" note under every updated entry and the");
  out("short lists the edition opens with, from each entry as the client's last edition");
  out("showed it, as it stands now, and what was recorded between. It reads no code, so");
  out("it is cheap to run whenever the release has moved, and it keeps every note that");
  out("nothing has moved under, including your own edits.");
  out("");
  out(COPY_BLOCK);
  out("");

  /* ---- the part for the agent ---- */
  const lines = [];
  const p = (s = "") => lines.push(s);

  p(`Compose what the ${N} edition of the feature ledger of ${product} says about what moved since ${P}.`);
  p("");
  p("The ledger is a client-facing record of what this product does, one entry per");
  p(`capability. The client has the ${P} edition (${longDate(previous.date)}) and never saw anything`);
  p(`in between. The ${N} edition marks what differs: green for a new capability, blue for`);
  p("an updated one with a \"What changed\" note under it, grey for one that was already");
  p("in the product and is only now on the record. It opens with short numbered lists of");
  p("what differs. You write the notes and the lists.");
  p("");
  p("Everything you need is in this prompt. Don't read the code, the git history or the");
  p("rest of .ledger/. Run `ledger style` once for the voice, and nothing else until you");
  p("are done.");
  p("");
  p("## Where it goes");
  p("");
  p(`The object with \`"version": ${version}\` in the "compositions" list in .ledger/compositions.json.`);
  p("Create the file as `{ \"compositions\": [ … ] }` if it doesn't exist. Edit only that object,");
  p("and leave \"date\", \"commit\", \"inputs\" and \"verified\" alone: the CLI writes them.");
  p("");
  p("```json");
  p("{");
  p(`  "version": ${version},`);
  p("  \"changes\":  { \"entry-id\": [\"One bullet.\", \"Another, for a second difference.\"] },");
  p("  \"new\":      [{ \"text\": \"One sentence.\", \"covers\": [\"entry-id\", \"another-entry-id\"] }],");
  p("  \"changed\":  [{ \"text\": \"One sentence.\", \"covers\": [\"entry-id\"] }],");
  p("  \"in_place\": [],");
  p("  \"quiet\":    [\"entry-id\"]");
  p("}");
  p("```");
  p("");
  p("## The notes (\"changes\")");
  p("");
  p("Every entry marked `updated` below gets one, keyed by its id, and nothing else");
  p(`does: a new entry has no "before" for the client. The client reads the note under`);
  p(`the entry, having read what ${P} said about it.`);
  p("");
  p(`- Each bullet is one difference the client will notice between the ${P} text and`);
  p(`  now: what it was in ${P}, and why it moved. Two or three sentences is normal.`);
  p("- The reason comes from the events, and only from them. Where an event's reason is");
  p("  \"not recorded\", say what changed and stop. Never supply one.");
  p("- Events are steps; a note is the result. Several events toward one result are one");
  p("  bullet. An event a later one undid is no bullet at all.");
  if (arrived.length) {
    p(`- An event whose "before" involves something itself new in ${N} has no "before" for`);
    p("  the client. Say how this entry works with the new thing, point to it by name");
    p("  (\"see “Name”\"), and stop. Explain a change once, in the entry that owns it.");
  }
  p("- An event marked [combined] is an older note that carries its own reason. Use its");
  p("  words as both; a separate \"why\" on it, where there is one, wins.");
  p("- If nothing a client would notice is left, write the one real difference you can");
  p("  find, and run `ledger questions add <id> \"May not have moved: …\"` so the human");
  p("  decides whether the entry should print as updated at all.");
  p("");
  p("## The summary (\"new\", \"changed\", \"in_place\", \"quiet\")");
  p("");
  p("Many readers stop at this page, so it lists what is worth knowing, not everything");
  p("that moved. Each item is one sentence, followed in the edition by numbered links to");
  p("the entries it sums up (\"covers\", the one that says most first).");
  p("");
  p("- \"new\" is what someone can do that they couldn't before; \"changed\" what a client");
  p(`  who knows ${P} will notice is different; "in_place" only for entries marked \`in place\`,`);
  p("  and nothing in those may say or imply they arrived or changed this cycle.");
  p("- Fold consequences into their cause: three entries that moved because of one new");
  p("  capability are one item covering all of them.");
  p("- Leave out what a client wouldn't miss (plumbing, defaults, small polish) by putting");
  p("  it in \"quiet\". Every entry below ends up in an item's \"covers\" or in \"quiet\".");
  p("- Most interesting first. Usually under fifteen words, never more than");
  p(`  ${ITEM_LIMIT} characters; it starts with a capital, never with a command or a file name.`);
  p("- An item may say who a change helps when the entries say so. It never gives a");
  p("  reason the events don't.");
  p("- The voice of the ledger: not \"we\", and nothing promotional.");
  p("");
  if (composition) {
    p("## Keep what holds");
    p("");
    p(`There is a composition already${composition.date ? `, composed ${longDate(composition.date)}` : ""}. Someone may have edited it`);
    p("by hand since. An entry not marked `*` below hasn't moved since: keep its note exactly");
    p("as it is. Rewrite the notes of the `*` entries, then the summary as a whole, keeping");
    p("the items that still hold.");
    p("");
    p("```json");
    p(JSON.stringify(withoutStamp(composition), null, 2));
    p("```");
    p("");
  }
  p(`## The release`);
  p("");
  for (const f of targets) {
    const kind = kindAt(f, version);
    const s = f.stateAt(version);
    const before = f.stateAt(previous.version);
    const label = needsNote(f, version) ? (kind === "in place" ? "updated, in place" : "updated") : kind;
    p(`${stale.has(f.id) ? "*" : " "} ${label.padEnd(9)} ${f.id}  —  ${s.name}  (${f.size ?? "unsized"})`);
    if (needsNote(f, version) && before && !before.removed) {
      p(`    in ${P}: ${before.description}`);
      if (before.name !== s.name) p(`    called “${before.name}” in ${P}`);
    }
    p(`    now:${" ".repeat(needsNote(f, version) && before && !before.removed ? P.length : 0)} ${s.description}`);
    const events = f.eventsAt(version);
    if (needsNote(f, version) && events.length) {
      p("    events:");
      for (const e of events) p(`      - ${eventLine(e)}${e.combined ? "  [combined]" : ""}`);
    }
    p("");
  }
  const removed = project.featureSet.features({ audience: "user" }).filter((f) => f.entryAt(version)?.removed);
  const notes = project.featureSet.otherChanges({ version }).filter((c) => c.audience === "user");
  if (removed.length || notes.length) {
    p("The edition lists removals and product-wide notes under their own headings, so");
    p("they need no item. Read them only for context:");
    p("");
    for (const f of removed) p(`  removed: ${f.currentName} — ${f.entryAt(version).reason}`);
    for (const c of notes) p(`  note: ${c.description}`);
    p("");
  }
  p("## When you're done");
  p("");
  p("1. Run `ledger compose complete`. It refuses an updated entry with no note, a note");
  p("   on an entry that isn't updated, an entry neither covered nor quiet, and an item");
  p("   that won't read as a sentence of its own. Fix what it reports.");
  p("2. Then a short report for the developer: each entry in \"quiet\" and why, each note");
  p("   that went out with no reason because none was recorded, and any question you filed.");

  out(lines.join("\n"));
}

/** The parts of a composition its writer edits, without the stamp. */
function withoutStamp(composition) {
  const { date, commit, inputs, verified, ...rest } = composition;
  return rest;
}
