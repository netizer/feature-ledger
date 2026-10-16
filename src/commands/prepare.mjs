import { openProject } from "../store.mjs";
import { fail, today, longDate, isBlank, COPY_BLOCK } from "../util.mjs";
import * as git from "../git.mjs";
import {
  LISTS, ITEM_LIMIT, ITEM_WORDS, hasSummary, composes, composeTargets, releaseEntries, kindAt, needsNote, accountingProblems,
  shapeProblems, textProblems, prepareReport, prepareLine, unknownReasons, stamped,
} from "../compose.mjs";
import { eventLine } from "../diff.mjs";
import { codeSince, stampSweep } from "../state.mjs";

const out = (s) => process.stdout.write(`${s}\n`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * `ledger prepare`: the one step that spends tokens. It prints a brief for an
 * interactive agent session that turns what was recorded into what the
 * client reads — the overview, the "What changed" notes, a sentence per entry
 * for the first page, and how to see each entry — and, in the same session, finds work
 * nobody recorded, asks the developer the reasons nobody gave, and checks
 * what it wrote against the code. `ledger prepare complete` checks what was
 * written and stamps what it was written from.
 *
 * The CLI assembles the deterministic half: each entry as the last edition
 * showed it and as it stands now, the events between, the reasons nobody
 * vouched for, and the code since the last edition as a diffstat. The agent
 * reads the code it needs from there.
 *
 * Once a release has been prepared, the next brief covers only what moved
 * since: those entries in full, the rest one line each, and the code since
 * it was last read. `--full` prepares the whole release again.
 *
 * Nothing runs unless someone asks: printed for pasting by default, and
 * handed to an agent only with `--run`.
 */
export async function cmdPrepare({ flags, positional }) {
  const sub = positional[0] ?? "brief";
  if (sub === "brief") return brief(flags);
  if (sub === "complete") return complete(flags);
  fail("usage: ledger prepare | prepare complete");
}

/* ---- prepare complete -------------------------------------------------- */

/**
 * Refuses what would print wrong whatever the prose says: an updated entry
 * with no note, a note on an entry the client has never seen, an entry with
 * no line on the first page, an id that is no entry in this release, and a
 * line that won't read as a sentence of its own. Then stamps
 * what it was written from, and prints the summary the way the edition will.
 */
function complete(flags) {
  const project = openProject(flags);
  const version = project.workingVersion;
  const composition = project.compositionOf(version) ?? { version, changes: {} };
  const problems = composes(project, version)
    ? accountingProblems(project, version, composition)
    : shapeProblems(composition);
  for (const [text, found] of textProblems(composition)) {
    problems.push(`“${text.length > 60 ? `${text.slice(0, 59)}…` : text}” ${found.join(" and ")}; it prints as a ` +
      "sentence of its own, so reword one that opens on a command or a file name");
  }
  if (problems.length) {
    fail(`v${version} isn't ready to be marked prepared:\n${problems.map((p) => `  ${p}`).join("\n")}\n` +
      "Fix these in .ledger/compositions.json, then run `ledger prepare complete` again.");
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
  // Section 2 of the brief read the code as it stands, so it counts as read.
  stampSweep(project);
  project.saveState();
  const fresh = openProject(flags);

  const notes = Object.keys(next.changes).length;
  out(`prepared v${version} (${next.prepared.date})` + (composes(project, version)
    ? `: ${plural(notes, "\"What changed\" note")}, and a summary of ${plural(releaseEntries(project, version).length, "client-facing entry", "client-facing entries")}.`
    : ", a first edition: it prints as an inventory.") +
    " A change recorded after this shows as news since the last prepare; editing the words by hand doesn't.");
  if (next.overview) { out(""); out(next.overview); }
  const lists = printedLists(next, fresh);
  if (lists) { out(""); out(lists); }

  const unseen = composeTargets(fresh, version).filter((f) => isBlank(f.stateAt(version).how_to_see));
  const unknown = unknownReasons(fresh, version);
  if (unseen.length || unknown.length) out("");
  if (unseen.length) out(`! no "How to see it" yet: ${unseen.map((f) => f.id).join(", ")}`);
  if (unknown.length) out(`! ${plural(unknown.length, "reason")} still not vouched for by a person — \`ledger\` lists them`);
}

/** The lists as the edition prints them, with the ids each item covers in place of its links. */
export function printedLists(composition, project = null) {
  const lines = [];
  if (hasSummary(composition) && project) {
    const targets = releaseEntries(project, composition.version);
    for (const [kind, title] of [["new", "What's new"], ["updated", "What changed"], ["in place", "Already in place"], ["removed", "No longer available"]]) {
      const these = targets.filter((f) => kindAt(f, composition.version) === kind);
      if (!these.length) continue;
      if (lines.length) lines.push("");
      lines.push(`${title} (${these.length})`);
      these.forEach((f, i) => lines.push(`  ${String(i + 1).padStart(2)}. ${composition.summary[f.id] ?? "(none)"}  [${f.id}]`));
    }
    return lines.join("\n");
  }
  for (const [key, title] of LISTS) {
    const items = Array.isArray(composition[key]) ? composition[key] : [];
    if (!items.length) continue;
    if (lines.length) lines.push("");
    lines.push(title);
    items.forEach((item, i) => lines.push(`  ${String(i + 1).padStart(2)}. ${item.text}  [${item.covers.join(", ")}]`));
  }
  if (composition.quiet?.length) {
    if (lines.length) lines.push("");
    lines.push(`Not on the summary page: ${composition.quiet.join(", ")}`);
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
  const P = previous ? `v${previous.version}` : null;
  const root = project.root;

  const entries = releaseEntries(project, version);
  const targets = composeTargets(project, version);
  const removed = entries.filter((f) => f.entryAt(version).removed);
  const notes = project.featureSet.otherChanges({ version, audience: "user" });
  const composition = project.compositionOf(version);
  const report = prepareReport(project, version);
  const moved = new Set(report.never ? [] : [...report.arrived, ...report.moved, ...report.answered]);
  const unknown = unknownReasons(project, version);
  const hasGit = git.available(root);
  const since = previous?.commit && hasGit ? previous.commit : null;
  const stat = since ? git.diffStat(project, since) : null;
  const commits = since ? git.subjects(root, since) : [];
  const dirty = hasGit ? git.uncommitted(root).filter((p) => !git.isLedgerPath(project.config, p)) : [];
  const inventory = !previous;
  // Only what moved since the last prepare, when there is one to build on.
  const delta = !flags.full && !inventory && Boolean(report.prepared) && !report.ok && !report.reshape;
  const fresh = new Set(delta ? [...report.arrived, ...report.moved, ...report.answered] : []);
  const code = delta ? codeSince(project) : null;

  /* ---- the part for the human ---- */
  out(`ledger prepare — ${N}${P ? `, read against the ${P} edition (${longDate(previous.date)})` : ", a first edition"}`);
  out("");
  const kinds = ["new", "updated", "in place", "removed"]
    .map((k) => [k, entries.filter((f) => kindAt(f, version) === k).length]).filter(([, n]) => n)
    .map(([k, n]) => `${n} ${k}`).join(", ");
  out(`${plural(entries.length, "client-facing entry", "client-facing entries")} in ${N}${kinds ? ` (${kinds})` : ""}. ` +
    `${prepareLine(report).replace(/^./, (c) => c.toUpperCase())}.` +
    (unknown.length ? ` ${plural(unknown.length, "reason")} nobody vouched for, which it will ask you about.` : ""));
  if (delta) {
    out(`Only what moved since the last prepare: ${[...fresh].join(", ") || "product-wide notes"}. Every other note stays as it is;`);
    out("`ledger prepare --full` prepares the whole release again.");
    if (code && !code.nothing) {
      out(`${plural(code.lines, "line")} in ${plural(code.files, "file")} since ${code.from.label} (${git.shortSha(code.from.commit)}), which it reads for work nobody recorded.`);
    }
  } else {
    if (report.prepared && report.ok && !inventory) out("Nothing has moved since the last prepare, so this prepares the whole release again.");
    if (stat) out(`${plural(stat.lines, "line")} in ${plural(stat.files, "file")} since ${P}'s commit, which it reads for work nobody recorded.`);
  }
  out("");
  out("Paste the prompt into your agent session, in the project root, and stay with it:");
  out("it asks you what only you know, and where what it wrote and the code disagree");
  out("it tells you, so you can fix either one there and then. It doesn't commit:");
  out("it ends with a list of what it changed, for you to read and commit.");
  out("");
  out(COPY_BLOCK);
  out("");

  /* ---- the part for the agent ---- */
  const lines = [];
  const p = (s = "") => lines.push(s);

  p(`Prepare the ${N} edition of the feature ledger of ${product}: write what the client reads, from what was recorded.`);
  p("");
  p("The ledger is a client-facing record of what this product does, one entry per");
  p("capability, kept in .ledger/. While work happens, facts are recorded: a new");
  p("capability, or what changed in one and why. You turn them into the text the");
  if (inventory) {
    p(`client reads. ${N} is a first edition${version > 1 ? " after a redraft" : ""}: it prints as an inventory of`);
    p("every entry, with nothing marked as new or changed, so there are no notes and no");
    p("summary to write.");
  } else {
    p(`client reads. The client has the ${P} edition (${longDate(previous.date)}) and never saw anything in`);
    p(`between. The ${N} edition's first page is the update: an overview, then one sentence`);
    p("for each new, updated and in-place entry. Most readers stop there. Then the details");
    p("of the same entries, and the removed ones, in full, and last a one-line-each");
    p("catalogue of the whole service.");
  }
  p("");
  p("The developer is here in this session. Ask them what only they know, and nothing");
  p("you can find out yourself. Don't commit anything: they read the diff and commit.");
  p("");
  p("Run `ledger style` once, before you write, for the voice. Read an entry with");
  p("`ledger show <id>`; don't read .ledger/ whole.");
  p("");

  /* 1 */
  p(inventory ? "## 1. The release" : `## 1. What the client last saw, and what is true now`);
  p("");
  if (!entries.length && !notes.length) {
    p(`Nothing client-facing is recorded against ${N} yet. Start with section 2.`);
    p("");
  }
  if (delta) {
    p("Only the entries given in full below moved since the release was last prepared.");
    p("The others are listed one line each: keep their notes and summary sentences as they are.");
    p("");
  }
  for (const f of entries) {
    const kind = kindAt(f, version);
    const s = f.stateAt(version);
    if (delta && !fresh.has(f.id)) {
      p(`  ${kind.padEnd(9)} ${f.id}  —  ${s.removed ? f.currentName : s.name}  (prepared, unchanged)`);
      continue;
    }
    const before = P ? f.stateAt(previous.version) : null;
    const shownBefore = needsNote(f, version) && before && !before.removed;
    const mark = moved.has(f.id) ? "*" : " ";
    p(`${mark} ${kind.padEnd(9)} ${f.id}  —  ${s.removed ? f.currentName : s.name}  (${f.size ?? "unsized"})`);
    if (s.removed) {
      p(`    removed: ${s.reason}`);
    } else {
      if (shownBefore) {
        p(`    in ${P}: ${before.description}`);
        if (before.name !== s.name) p(`    called “${before.name}” in ${P}`);
      }
      p(`    now:${" ".repeat(shownBefore ? P.length : 0)} ${s.description}`);
      p(`    how to see it: ${s.how_to_see ?? "(none yet)"}`);
    }
    const events = f.eventsAt(version);
    if (events.length) {
      p("    recorded:");
      for (const e of events) p(`      - ${eventLine(e)}${e.combined ? "  [combined]" : ""}`);
    }
    p("");
  }
  for (const c of notes) {
    p(`  note      product-wide: ${c.description}`);
    p("");
  }
  if (lines[lines.length - 1] !== "") p("");
  if (composition && !report.never && !inventory) {
    p(`What is written for ${N} so far is below. Entries marked \`*\` above moved since it was`);
    p("written; keep every other entry's note exactly as it is, including any hand-edits,");
    p("and every other entry's summary sentence too.");
    p("");
    p("```json");
    p(JSON.stringify(withoutStamp(composition), null, 2));
    p("```");
    p("");
  }

  /* 2 */
  p("## 2. Work nobody recorded");
  p("");
  if (code?.nothing) {
    p(`No code has changed since ${code.from.label} (${git.shortSha(code.from.commit)}), when it was last read. Skip`);
    p("this section unless the developer points you at something.");
    p("");
  } else if (code) {
    p(`The code since ${code.from.label} (${git.shortSha(code.from.commit)}), when it was last read, working tree included,`);
    p("biggest first. Read what you need of it with `git diff` and the files themselves:");
    p("");
    p("```");
    p(code.stat.text || "  (no changes)");
    p("```");
    p("");
    if (code.commits.length) {
      p("The commits in that range:");
      p("");
      p("```");
      for (const c of code.commits.slice(-60)) p(`  ${c}`);
      if (code.commits.length > 60) p(`  … and ${code.commits.length - 60} earlier`);
      p("```");
      p("");
    }
  } else if (stat) {
    p(`The code since ${P}'s commit (${git.shortSha(since)}), working tree included, biggest first. Read what you`);
    p("need of it with `git diff` and the files themselves:");
    p("");
    p("```");
    p(stat.text || "  (no changes)");
    p("```");
    p("");
    if (commits.length) {
      p("The commits in that range:");
      p("");
      p("```");
      for (const c of commits.slice(-60)) p(`  ${c}`);
      if (commits.length > 60) p(`  … and ${commits.length - 60} earlier`);
      p("```");
      p("");
    }
  } else if (!previous) {
    p("There is no earlier edition to measure from. Read the codebase as far as you need to");
    p("check that every capability someone using the product would name has an entry.");
    p("");
  } else {
    p(hasGit ? `${P} has no commit recorded, so there is no range to read (\`ledger releases amend\`).`
      : "This project has no git repository, so there is no range to read.");
    p("Skip this section unless the developer points you at something.");
    p("");
  }
  if (dirty.length) {
    p(`Uncommitted right now: ${dirty.slice(0, 12).join(", ")}${dirty.length > 12 ? ", …" : ""}.`);
    p("");
  }
  p("Compare it with section 1. A change someone using the product would notice that");
  p("section 1 doesn't account for is unrecorded. Record it:");
  p("");
  recordingRules(p, P);
  /* 3 */
  p("## 3. Reasons nobody recorded");
  p("");
  if (!unknown.length) {
    p("Every recorded reason came from a person. Ask about any you record in section 2");
    p("without one.");
  } else {
    p("First check what the developer has already said in this session: a reason they");
    p("stated or agreed to, including one you proposed that they acted on, answers the");
    p("question, so record it without asking again. Ask about the rest, one at a time:");
    p("");
    for (const { feature, event, index } of unknown) {
      p(`  ${feature.id}, event ${index + 1}: ${event.what}`);
      p(`      ${event.why_from === "unknown" ? "why: not recorded" : `why, read off a commit message: ${event.why ?? "(in the text above)"}`}`);
    }
    p("");
    p("Record each answer in that event, in .ledger/features/<id>.json: \"why\" in their words,");
    p("and \"why_from\": \"person\". For a reason read off a commit that they confirm, set");
    p("\"why_from\" to \"person\" and leave the words. A removal's reason is also the");
    p("\"reason\" on its history entry. Change nothing else in an event. When they don't");
    p("know, leave it as it is: the note then says what changed, and stops.");
  }
  p("");

  /* 4 */
  p("## 4. What to write");
  p("");
  p(`Into the object with \`"version": ${version}\` in the "compositions" list in .ledger/compositions.json`);
  p("(create the file as `{ \"compositions\": [ … ] }` if it isn't there). Leave \"prepared\"");
  p("alone: the CLI writes it.");
  p("");
  p("```json");
  p("{");
  p(`  "version": ${version},`);
  if (!inventory) {
    p("  \"overview\": \"Two or three sentences on what this release is about.\",");
    p("  \"changes\":  { \"entry-id\": [\"One note per change.\"] },");
    p("  \"summary\":  { \"entry-id\": \"One sentence on what it gives the client.\" }");
  }
  p("}");
  p("```");
  p("");
  p("**Who reads it.** Someone who uses the product, has never seen the code, and reads");
  p("the first page and little else. Say what each capability does for them, in their");
  p("words: \"Customers can book a month ahead\", not \"the booking window is configurable");
  p("up to 28 days\". No commands, flags, file names, paths or code terms anywhere the");
  p("client reads; those go in \"dev_notes\". `ledger status` points out what reads like code.");
  p("");
  if (!inventory) {
    p("**The overview (\"overview\").** Two or three sentences that open the edition, under");
    p("the version number: what this release is about, as a whole. Not a list; the summary");
    p("under it is the list.");
    const obsolete = composition ? [...LISTS.map(([k]) => k), "quiet", "matters", "message"].filter((k) => composition[k] !== undefined) : [];
    if (obsolete.length) {
      p("");
      p(`What is written so far has ${obsolete.map((k) => `"${k}"`).join(", ")}, from before the first page had one`);
      p("sentence per entry, and an edition went out with a message. Write \"summary\" (below)");
      p("from them, then remove those keys.");
    }
    p("");
  }
  p("**Descriptions.** One or two present-tense sentences, about 40 words, saying what the");
  p(`capability does for the people who use it. ${inventory ? "Check every entry's" : "Each new or changed entry's"} description says that`);
  p("now. If it no longer does, update it with `ledger change` (a new entry:");
  p("`ledger change <id> --description \"…\"`). Shortening one is wording: a hand-edit of");
  p("the feature file. In the edition, an updated entry prints only its first sentence");
  p("above its note, so that sentence has to say what the capability is.");
  p("");
  if (!inventory) {
    p("**The notes (\"changes\").** One for every entry marked `updated`, and nothing else: a");
    p("new entry has no \"before\" for the client.");
    p("");
    p(`- Each change is one sentence: what it was in ${P}, what it is now, and why.`);
    p("- The reason comes from the recorded events, or from the developer in this");
    p("  session, and from nowhere else. Where nobody knows, say what changed and stop.");
    p("- Events are steps; a note is the result. Several toward one result are one note.");
    p("  An event a later one undid is no note at all.");
    p(`- A change whose "before" is itself new in ${N} has no "before" for the client. Say how`);
    p("  this entry works with the new thing, point to it by name (\"see “Name”\"), and stop.");
    p("- An event marked [combined] is an older note that carries its own reason.");
    p("");
    p("**The summary (\"summary\").** Many readers stop at the first page. It lists every");
    p("entry the details print, in the same groups and order, one line each, linking to it;");
    p("the edition picks the group from the entry. Each line is your sentence for it.");
    p("");
    p("- One sentence for every entry in section 1, removed ones included. Product-wide");
    p("  notes list themselves.");
    p("- Say what the reader gains, the way they would pass it on to a colleague: what");
    p(`  they can do now that they couldn't (new), or what is better than in ${P} (updated),`);
    p("  and, where it helps, what that saves them. Not the entry's name, not a heading, not");
    p("  how it works: \"Customers can book delivery a month ahead, so regular orders no");
    p("  longer need a weekly reminder.\", not \"Extended booking window\".");
    p("- For a removed entry: why it went, and what to use instead, if anything. The");
    p("  name prints with the entry's details; the sentence is what the client reads first.");
    p(`- At most ${ITEM_WORDS} words (never over ${ITEM_LIMIT} characters), starting with a capital, never`);
    p("  with a command or a file name.");
    p("- An entry marked `in place` was always in the product: say what it does, and");
    p("  nothing that says or implies it arrived or changed this cycle.");
    p("- Never a reason the events and the developer didn't give. Not \"we\", nothing");
    p("  promotional.");
    p("");
  }
  const areas = project.featureSet.categories({ audience: "user" });
  const bare = project.featureSet.unstructured ? [] : areas.filter((a) => isBlank(project.config.area_intros?.[a]));
  if (bare.length) {
    p("**Areas (\"area_intros\" in .ledger/config.json).** The catalogue at the end of the");
    p("edition opens each area with one sentence on what that part of the service is for.");
    p(`These have none yet: ${bare.map((a) => `“${a}”`).join(", ")}. Add them as`);
    p("`\"area_intros\": { \"Area name\": \"One sentence.\" }`.");
    p("");
  }
  p("**How to see it (\"how_to_see\" in the feature file).** Every new or updated entry");
  p("gets one: plain instructions a client follows to check the claim themselves. For");
  p("example: \"Open Settings → Delivery and choose Book ahead; dates up to four weeks out");
  p("are selectable.\" Read the routes and the labels in the code. When you can't tell how");
  p("a reader would reach it, ask the developer; if they can't say, leave it empty rather");
  p("than guess. Set it with `ledger change <id> --how-to-see \"…\"`.");
  p("");
  /* 5 */
  p("## 5. Check it against the code");
  p("");
  p(`Read every sentence you wrote${delta ? " this time" : ""}, and every description you touched, against what`);
  p("the code does. Each has to be something a reader could confirm by using the product.");
  p("Where the text and the code disagree, tell the developer: what the text says, what");
  p("the code does, at path:line. This is a good moment to fix the code or the text,");
  p("whichever is wrong, here in the session. Don't decide for them.");
  p("");
  p("## When you're done");
  p("");
  p("1. Run `ledger prepare complete`. It refuses an updated entry with no note, a note on");
  p("   an entry that isn't updated, an entry with no summary sentence, and a sentence that");
  p("   won't read as one on its own. Fix what it reports and run it again.");
  p("2. Run `ledger status` and fix anything it says about what you wrote.");
  p("3. End with a short list for the developer: each file you changed and what changed in");
  p("   it, what you recorded in section 2, the reasons you took from what they said in");
  p("   this session, the reasons still unknown, and anything you found in section 5");
  p("   that is still open. Don't commit.");

  out(lines.join("\n"));
}

/**
 * How to record work nobody recorded: the commands, the entry bar, and where
 * a reason comes from. Shared by the prepare brief and the sweep, so the two
 * hold an agent to the same bar.
 */
export function recordingRules(p, P) {
  p("```");
  p("ledger change <id> <<'JSON'");
  p('{ "what": "What changed, in a sentence.", "why": "Why.", "description": "The whole current state, if it moved." }');
  p("JSON");
  p("ledger add <id>       # a new capability: { audience, size, name, description, how_to_see?, category? }");
  p("ledger remove <id> --why \"…\"");
  p("```");
  p("");
  p("- One entry is one capability someone using the product would name: something they");
  p("  could ask for, or would miss if it went away. A guardrail, a default, plumbing or");
  p("  polish is part of the capability it belongs to, never an entry of its own. A name");
  p("  is a short noun phrase in the users' words: not a caption, not the mechanism.");
  p("- A refactor, a fix nobody would notice, a tidy: record nothing.");
  p("- The reason: never invent one, and don't ask for one you were already given. A");
  p("  reason the developer stated or agreed to in this session, including one you");
  p("  proposed that they then acted on, is theirs: record it with \"why\". Ask only when");
  p("  nothing said explains it. One read off a commit message takes `--why-from commit`;");
  p("  one nobody knows takes `--why-unknown`.");
  if (P) {
    p(`- A capability that was already in the product before ${P} and is only now being`);
    p("  recorded takes `--backfilled`, and prints grey: the product didn't move, the");
    p("  record did. Everything in the range above is this release's work.");
  }
  p("");
}

/** The parts of a composition its writer edits, without the stamp. */
function withoutStamp(composition) {
  const { prepared, date, commit, ...rest } = composition;
  return rest;
}
