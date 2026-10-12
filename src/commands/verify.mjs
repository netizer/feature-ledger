import { openProject } from "../store.mjs";
import { fail, today, longDate, COPY_BLOCK } from "../util.mjs";
import * as git from "../git.mjs";
import { composeTargets, composeReportFor, composeLine, needsNote, summaryItems, verifyFingerprint, ordered, verifyOn } from "../compose.mjs";
import { ownership } from "../paths.mjs";
import { openQuestions } from "../questions.mjs";

const out = (s) => process.stdout.write(`${s}\n`);

/**
 * `ledger verify`: a brief for an agent to check what the release says
 * against the code, sentence by sentence, before it goes to the client.
 *
 * It edits nothing. Composing reads only the ledger, which is what makes it
 * cheap; this is the step that reads the code, and it reports, rather than
 * fixes, so whatever it doubts goes to a person: each finding is a question
 * in questions.json, and `ledger cut` asks them. `verify complete` stamps a
 * fingerprint of the text it read, so the cut knows when that text moved.
 *
 * Opt-in: `"checks": { "verify": true }` in config.json makes the cut ask for
 * it. Without that it is there to run when a release deserves it.
 */
export async function cmdVerify({ flags, positional }) {
  const sub = positional[0] ?? "brief";
  if (sub === "brief") return brief(flags);
  if (sub === "complete") return complete(flags);
  fail("usage: ledger verify | verify complete");
}

function ready(project, version) {
  const report = composeReportFor(project, version);
  if (!report.ok) fail(`${composeLine(report)}. Compose it first (\`ledger compose\`): verify reads the composed text`);
  if (!composeTargets(project, version).length) fail(`nothing client-facing is recorded against v${version}, so there is nothing to verify`);
}

function complete(flags) {
  const project = openProject(flags);
  const version = project.workingVersion;
  ready(project, version);
  const composition = project.compositionOf(version);
  const verified = {
    date: today(),
    commit: git.available(project.root) ? git.head(project.root) : null,
    fingerprint: verifyFingerprint(project, version),
  };
  if (flags["dry-run"]) {
    out(JSON.stringify(verified, null, 2));
    out("(--dry-run: nothing written)");
    return;
  }
  project.saveComposition(ordered(project, { ...composition, verified }));
  const open = openQuestions(project, { version }).filter((q) => q.kind === "finding").length;
  out(`recorded v${version} as verified (${verified.date})` +
    (open ? `, with ${open} finding${open === 1 ? "" : "s"} open — \`ledger questions\` lists them` : ""));
}

function brief(flags) {
  const project = openProject(flags);
  const version = project.workingVersion;
  ready(project, version);
  const previous = project.releases.predecessorOf(version);
  const composition = project.compositionOf(version);
  const targets = composeTargets(project, version);
  const N = `v${version}`;
  const root = project.root;

  const own = ownership(project);
  const moved = previous?.commit && git.available(root)
    ? [...git.churn(root, previous.commit).keys()].filter((f) => own.product(f)) : [];

  /* ---- the part for the human ---- */
  out(`ledger verify — the ${N} edition's text, checked against the code`);
  out("");
  out(`${targets.length} client-facing entr${targets.length === 1 ? "y" : "ies"}, ${Object.keys(composition.changes ?? {}).length} "What changed" ` +
    `note${Object.keys(composition.changes ?? {}).length === 1 ? "" : "s"}, ${summaryItems(composition).length} summary items.` +
    (verifyOn(project) ? "" : " (The cut doesn't ask for this; `\"checks\": { \"verify\": true }` in config.json makes it.)"));
  out("");
  out("The prompt reads every sentence the edition will print about this release, checks");
  out("it against the code, and files what it can't confirm as a question for you. It");
  out("edits nothing. `ledger cut` asks the questions before it prints.");
  out("");
  out(COPY_BLOCK);
  out("");

  /* ---- the part for the agent ---- */
  const lines = [];
  const p = (s = "") => lines.push(s);

  p(`Check what the ${N} edition of the feature ledger of ${project.config.product} says against the code, before it goes to the client.`);
  p("");
  p("The ledger is a client-facing record of what this product does. Every sentence in");
  p("it must be something a reader could confirm by using the product. Below is every");
  p("sentence this edition prints about the release: each entry's description, its");
  p("\"What changed\" note, and the summary. Read the code each one is about, and");
  p("check it.");
  p("");
  p("You change nothing, in .ledger/ or anywhere else. For each sentence that is wrong,");
  p("that overstates, or that you can't confirm, file one finding:");
  p("");
  p("```");
  p("ledger questions add <id> \"What the text says. What the code does, at path:line.\"");
  p("```");
  p("");
  p("Use `-` for the id when the finding is about the summary as a whole. Also file a");
  p("fact that two entries state differently: a number, a limit, who can do what.");
  p("A sentence that is true but could be better worded is not a finding.");
  p("");
  p("## The release");
  p("");
  for (const f of targets) {
    const s = f.stateAt(version);
    p(`${f.id}  —  ${s.name}`);
    p(`  lives in: ${f.paths.length ? f.paths.join(", ") : "(no paths recorded; find it)"}`);
    const mine = moved.filter((file) => own.owners(file).some((o) => o.id === f.id));
    if (mine.length) p(`  changed since v${previous.version}: ${mine.slice(0, 8).join(", ")}${mine.length > 8 ? ", …" : ""}`);
    p(`  description: ${s.description}`);
    if (needsNote(f, version)) for (const b of composition.changes?.[f.id] ?? []) p(`  - ${b}`);
    p("");
  }
  p("## The summary");
  p("");
  for (const item of summaryItems(composition)) p(`  [${item.list}] ${item.text}  (${item.covers.join(", ")})`);
  p("");
  p("## When you're done");
  p("");
  p("1. Run `ledger verify complete`.");
  p("2. Then one line: how many sentences you checked, and how many findings you filed.");
  if (previous?.date) p(`   The client's last edition is ${longDate(previous.date)}; nothing before it matters here.`);

  out(lines.join("\n"));
}
