import { openProject } from "../store.mjs";
import { fail, today, longDate, COPY_BLOCK } from "../util.mjs";
import * as git from "../git.mjs";
import {
  LISTS, ITEM_LIMIT, printsSummary, summaryTargets, kindAt, accountingProblems, textProblems,
  summaryReportFor, summaryLine, stamped,
} from "../summary.mjs";

const out = (s) => process.stdout.write(`${s}\n`);

/**
 * `ledger summary` prints the brief for writing the short lists the edition
 * opens with; `ledger summary complete` checks what was written and stamps it.
 * See src/summary.mjs for what a summary is and why it is written per release.
 *
 * Meant to be cheap enough to run every day, for `ledger preview --run`: the
 * brief carries the text of every entry it covers, so the agent reads nothing
 * but the brief, and nothing in the code.
 */
export async function cmdSummary({ flags, positional }) {
  const sub = positional[0] ?? "brief";
  if (sub === "brief") return brief(flags);
  if (sub === "complete") return complete(flags);
  fail("usage: ledger summary | summary complete");
}

/* ---- summary complete -------------------------------------------------- */

/**
 * Refuses what would print wrong whatever the prose says: an item with no
 * text or no entries, an entry the summary neither covers nor leaves out, an
 * id that is no entry in this release, and an item that won't read as a
 * sentence of its own. Then stamps the entries it was written from, and
 * prints the lists the way the edition will.
 */
function complete(flags) {
  const project = openProject(flags);
  const version = project.workingVersion;
  if (!printsSummary(project, version)) {
    fail(`v${version} is a first edition: it prints as an inventory, with no summary of what changed`);
  }
  const summary = project.summaryOf(version);
  if (!summary) {
    fail(`.ledger/summaries.json has no summary for v${version} — \`ledger summary\` prints the brief for writing one`);
  }

  const targets = summaryTargets(project, version);
  const problems = accountingProblems(project, version, summary);
  for (const [text, found] of textProblems(summary)) {
    problems.push(`“${text.length > 60 ? `${text.slice(0, 59)}…` : text}” ${found.join(" and ")}; it prints as a ` +
      "sentence of its own, so reword one that opens on a command or a file name");
  }
  if (problems.length) {
    fail(`the summary of v${version} isn't ready to be marked complete:\n${problems.map((p) => `  ${p}`).join("\n")}\n` +
      "Fix these in .ledger/summaries.json, then run `ledger summary complete` again.");
  }

  const next = stamped(project, summary, {
    date: today(),
    commit: git.available(project.root) ? git.head(project.root) : null,
  });
  if (flags["dry-run"]) {
    out(JSON.stringify(next, null, 2));
    out("(--dry-run: nothing written)");
    return;
  }
  project.saveSummary(next);
  out(`recorded the summary of v${version} (${next.date}), written from ${targets.length} client-facing ` +
    `entr${targets.length === 1 ? "y" : "ies"}. A later \`ledger add\`, \`update\` or hand-edit to one of them puts it out of date.`);
  out("");
  out(printedLists(next));
  const reviewed = project.lastReviewOf(version);
  if (reviewed) {
    out("");
    out(`v${version} was reviewed on ${longDate(reviewed.date)}. The summary is client-facing text, so a changed one asks ` +
      "for another `ledger review` before the cut.");
  }
}

/** The lists as the edition prints them, with the ids each item covers in place of its links. */
export function printedLists(summary) {
  const lines = [];
  for (const [key, title] of LISTS) {
    const items = Array.isArray(summary[key]) ? summary[key] : [];
    if (!items.length) continue;
    if (lines.length) lines.push("");
    lines.push(title);
    items.forEach((item, i) => lines.push(`  ${String(i + 1).padStart(2)}. ${item.text}  [${item.covers.join(", ")}]`));
  }
  if (summary.quiet?.length) {
    if (lines.length) lines.push("");
    lines.push(`Left out: ${summary.quiet.join(", ")}`);
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
    fail(`${N} is a first edition${version > 1 ? " after a redraft" : ""}: it prints as an inventory, with no ` +
      "summary of what changed, so there is nothing to write");
  }
  const P = `v${previous.version}`;
  const targets = summaryTargets(project, version);
  if (!targets.length) fail(`nothing client-facing is recorded against ${N} yet, so there is nothing to summarize`);

  const summary = project.summaryOf(version);
  const report = summaryReportFor(project, version);
  const moved = new Set(summary ? [...report.added, ...report.changed, ...report.uncovered] : []);
  const reviewed = project.lastReviewOf(version);

  /* ---- the part for the human ---- */
  out(`ledger summary — ${N}, read against the ${P} edition (${longDate(previous.date)})`);
  out("");
  out(`${targets.length} client-facing entr${targets.length === 1 ? "y" : "ies"} in ${N}. ${sentence(summaryLine(report))}.`);
  out("");
  out("The edition opens with short numbered lists of what differs from the one the");
  out("client already has: what's new and what changed, a sentence an item, each");
  out("followed by links to the entries it sums up. The prompt writes those lists from");
  out("the entries below, and only from them: it reads no code, so it is cheap to run");
  out("whenever the release has moved. It folds changes that follow from something new");
  out("into that item, leaves out what a client wouldn't miss, and ends by listing what");
  out("it left out and every reason it supplied itself, for you to check.");
  if (reviewed) {
    out("");
    out(`! ${N} was reviewed on ${longDate(reviewed.date)}. The summary is client-facing text, so one written`);
    out("  or changed now asks for another `ledger review` before the cut.");
  }
  out("");
  out(COPY_BLOCK);
  out("");

  /* ---- the part for the agent ---- */
  const lines = [];
  const p = (s = "") => lines.push(s);

  p(`Write the summary that opens the ${N} edition of the feature ledger of ${product}.`);
  p("");
  p("The ledger is a client-facing record of what this product does, one entry per");
  p(`capability. The client already has the ${P} edition (${longDate(previous.date)}). The ${N}`);
  p(`edition opens with a page of short numbered lists of what differs from ${P}. Many`);
  p("readers stop there, so it is the list of what is worth knowing, not an index of");
  p("everything that moved: the full entries follow, and each item links to the ones");
  p("it sums up.");
  p("");
  p("Everything you need is in this prompt. Don't read the code, the git history or");
  p("the rest of .ledger/. Run `ledger style` once for the voice, and nothing else");
  p("until you're done.");
  p("");
  p("## Where it goes");
  p("");
  p(`The summary is the object with \`"version": ${version}\` in the "summaries" list in`);
  p(".ledger/summaries.json. Create the file as `{ \"summaries\": [ … ] }` if it doesn't");
  p(`exist. Edit only that object, and leave "date", "commit" and "entries" in it alone:`);
  p("`ledger summary complete` writes them.");
  p("");
  p("```json");
  p("{");
  p(`  "version": ${version},`);
  p("  \"new\":      [{ \"text\": \"One sentence.\", \"covers\": [\"entry-id\", \"another-entry-id\"] }],");
  p("  \"changed\":  [{ \"text\": \"One sentence.\", \"covers\": [\"entry-id\"] }],");
  p("  \"in_place\": [],");
  p("  \"quiet\":    [\"entry-id\"]");
  p("}");
  p("```");
  p("");
  p("- \"new\" is \"What's new\": what someone can do that they couldn't before.");
  p(`- \"changed\" is \"What changed\": what a client who knows ${P} will notice is different.`);
  p("- \"in_place\" is \"Already in place\", only for entries marked `in place` below:");
  p("  capabilities that were in the product all along and are only now on the record.");
  p("  Nothing in these items may say or imply they arrived or changed this cycle.");
  p("- \"covers\" lists the ids of the entries an item sums up. They print after it as");
  p("  numbered links, in that order, so put the entry that says the most first.");
  p("- \"quiet\" lists the entries you leave out on purpose.");
  p("");
  p(`Every entry below ends up in at least one item's \"covers\" or in \"quiet\".`);
  p("");
  p("## What goes in");
  p("");
  p("- **Fold consequences into their cause.** A change that follows from something new");
  p("  is part of that item, not one of its own. If venues can now be booked with only");
  p("  a city, then the booking form asking for a city, the travel fee counted from the");
  p("  city's center and the day-of form asking for the street are all one item, \"Clients");
  p("  can book before the exact address is known\", which covers all four entries.");
  p("- **Say what follows from the entries together.** An item can state what no single");
  p("  sentence does, when it follows from what the entries say. If one entry now saves an");
  p("  inquiry as soon as a date is picked, and its description says every inquiry shows");
  p("  the browser and IP address for 90 days, then the news is that the product keeps");
  p("  that for everyone who picks a date, even if they go no further.");
  p("- **Leave out what a client wouldn't miss.** Plumbing, defaults, fallbacks, small");
  p("  polish and changes the reader would only notice by comparing screenshots go in");
  p("  \"quiet\". So does an entry whose whole news is already said by another item.");
  p("- **Most interesting first**, within each list.");
  p("- An entry can sit in an item of any list: an updated entry whose change is part");
  p("  of something new is covered by that \"new\" item.");
  p("");
  p("## How an item reads");
  p("");
  p("- One sentence that makes sense on its own, saying which part of the product it");
  p("  is about in the words someone using it would use.");
  p(`- Usually under fifteen words; never more than ${ITEM_LIMIT} characters. It starts with a`);
  p("  capital letter, never with a command or a file name, and ends with a period.");
  p("- The level of detail a client cares about, not the mechanics. \"Clients can return");
  p("  to an unfinished booking\", not which steps it remembers and for how long.");
  p("- For a change, the old and the new state when both fit in the sentence: \"The event");
  p("  details reminder goes out two weeks and one week before the event, instead of once.\"");
  p("- It may say why, or who it helps (\"for admins entering a booking over the phone\"),");
  p("  even when the entry doesn't say so, as long as it follows plausibly from the entry.");
  p("  A developer reads the summary before the client does and corrects it; list every");
  p("  such item in your report so they know where to look.");
  p("- The voice of the ledger (`ledger style`). Not \"we\", and nothing promotional:");
  p("  not \"powerful\", \"seamless\" or \"exciting\".");
  p("");
  if (summary) {
    p("## The summary as it stands");
    p("");
    p(`There is one already${summary.date ? `, written ${longDate(summary.date)}` : ""}. Read it as a draft: keep the`);
    p("items that still hold, rework the rest, and write the summary again as a whole,");
    p("so the items in each list are phrased alike and ordered by interest.");
    if (moved.size) p("Entries marked `*` below were recorded or changed after it was written.");
    p("");
    p("```json");
    p(JSON.stringify(summaryOnly(summary), null, 2));
    p("```");
    p("");
  }
  p(`## The entries in ${N}`);
  p("");
  p(`Each with its ${N} text: \`new\` arrived this cycle, \`updated\` existed in ${P}, and its`);
  p(`bullets say what it was in ${P} and why it moved; \`in place\` was already there.`);
  p("");
  for (const f of targets) {
    const h = f.entryAt(version);
    const st = f.stateAt(version);
    p(`${moved.has(f.id) ? "*" : " "} ${kindAt(f, version).padEnd(9)} ${f.id}  —  ${st.name}`);
    p(`    ${st.description}`);
    for (const c of h.changes ?? []) p(`    - ${c}`);
    p("");
  }
  const removed = project.featureSet.features({ audience: "user" }).filter((f) => f.entryAt(version)?.removed);
  const notes = project.featureSet.otherChanges({ version }).filter((c) => c.audience === "user");
  if (removed.length || notes.length) {
    p("The edition lists removals and product-wide notes under their own headings, so");
    p("they need no item. Don't repeat them; read them only for context:");
    p("");
    for (const f of removed) p(`  removed: ${f.currentName}`);
    for (const c of notes) p(`  note: ${c.description}`);
    p("");
  }
  p("## When you're done");
  p("");
  p("1. Run `ledger summary complete`. It refuses an entry that is neither covered nor");
  p("   quiet, an id that isn't in the list above, and an item that won't read as a");
  p("   sentence of its own. Fix what it reports. It ends by printing the lists.");
  p("2. Under them, print a short report for the developer:");
  p("   - each entry in \"quiet\", with a few words on why it was left out;");
  p("   - each item that says a reason, a benefit or a consequence the entries don't");
  p("     state, and what you based it on;");
  p("   - each entry whose text didn't make clear what is different.");

  out(lines.join("\n"));
}

/** The parts of a summary the brief's reader writes, without the stamp. */
function summaryOnly(summary) {
  const { date, commit, entries, ...rest } = summary;
  return rest;
}

/** A line from summaryLine as a sentence of its own; one that opens on a version stays as it is. */
const sentence = (s) => (/^v\d/.test(s) ? s : s.charAt(0).toUpperCase() + s.slice(1));
