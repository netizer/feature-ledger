import { openProject } from "../store.mjs";
import { usage, isBlank } from "../util.mjs";
import { openQuestions, settle, addFinding } from "../questions.mjs";

const out = (s) => process.stdout.write(`${s}\n`);

/**
 * `ledger questions`: what only a person can settle. See src/questions.mjs.
 *
 *   ledger questions                      the open ones
 *   ledger questions answer <n> "…"       the reason, or how a finding was settled
 *   ledger questions accept <n>           the reason stands as it is
 *   ledger questions dismiss <n>          nothing to do
 *   ledger questions add <id> "…"         a finding, for a check or an agent to file
 */
export async function cmdQuestions({ flags, positional }) {
  const sub = positional[0] ?? "list";
  if (sub === "list") return list(flags);
  if (["answer", "accept", "dismiss"].includes(sub)) return act(flags, sub, positional.slice(1));
  if (sub === "add") return add(flags, positional.slice(1));
  usage('usage: ledger questions [list [--all] | answer <n> "…" | accept <n> | dismiss <n> | add <id> "…"]');
}

export function describe(q) {
  const where = q.feature ? `${q.feature}, v${q.version}` : `v${q.version}`;
  return `#${q.id}  ${q.kind === "why" ? "reason " : "finding"}  ${where}\n     ${q.text}`;
}

function list(flags) {
  const project = openProject(flags);
  const shown = flags.all ? project.questions : openQuestions(project);
  if (flags.json) {
    out(JSON.stringify({ questions: shown }, null, 2));
    return;
  }
  if (!shown.length) {
    out(flags.all ? "no questions have been asked" : "nothing open — every reason is vouched for, and no check has doubts");
    return;
  }
  for (const q of shown) {
    out(describe(q));
    if (q.status !== "open") out(`     ${q.status}${q.answer ? `: ${q.answer}` : ""}`);
  }
  if (!flags.all) {
    out("");
    out('`ledger questions answer <n> "…"` gives the reason in your words · `accept <n>` keeps it as it is · `dismiss <n>`');
  }
}

function act(flags, action, rest) {
  const project = openProject(flags);
  const [id, ...words] = rest;
  if (!id) usage(`usage: ledger questions ${action} <n>${action === "answer" ? ' "…"' : ""}`);
  const answer = words.join(" ").trim() || null;
  if (action === "answer" && isBlank(answer)) usage('usage: ledger questions answer <n> "the reason, in a sentence"');
  const feature = settle(project, id, action, answer);
  if (flags["dry-run"]) {
    out(JSON.stringify(project.questions.find((q) => q.id === Number(id)), null, 2));
    out("(--dry-run: nothing written)");
    return;
  }
  if (feature) project.saveFeature(feature);
  project.saveQuestions();
  const q = project.questions.find((x) => x.id === Number(id));
  out(`#${q.id} ${q.status}${feature ? ` — ${feature.id}'s change now says why${action === "answer" ? ", in your words" : ""}` : ""}`);
}

function add(flags, rest) {
  const project = openProject(flags);
  const version = project.workingVersion;
  const [id, ...words] = rest;
  if (!id) usage('usage: ledger questions add <id> "…"   (- for the release as a whole)');
  const q = addFinding(project, id === "-" ? null : id, words.join(" "), version);
  if (flags["dry-run"]) {
    out(JSON.stringify(q, null, 2));
    out("(--dry-run: nothing written)");
    return;
  }
  project.saveQuestions();
  out(`question #${q.id} opened`);
}

/**
 * The open questions on one release, asked one at a time at a terminal —
 * what `ledger cut` does before it prints. Enter accepts, a sentence answers,
 * `s` leaves it open, `d` dismisses it. Returns how many are still open.
 */
export async function askInline(project, version) {
  const pending = openQuestions(project, { version });
  if (!pending.length) return 0;
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let left = 0;
  try {
    out(`${pending.length} question${pending.length === 1 ? "" : "s"} on v${version}. Enter accepts, a sentence answers, s skips, d dismisses.`);
    for (const q of pending) {
      out("");
      out(describe(q));
      const reply = (await rl.question("  > ")).trim();
      if (reply.toLowerCase() === "s") { left++; continue; }
      const action = reply === "" ? "accept" : reply.toLowerCase() === "d" ? "dismiss" : "answer";
      const feature = settle(project, q.id, action, action === "answer" ? reply : null);
      if (feature) project.saveFeature(feature);
      project.saveQuestions();
    }
  } finally {
    rl.close();
  }
  return left;
}

/** The open questions' numbers, for shell completion. */
export function questionIds(project) {
  return openQuestions(project).map((q) => String(q.id));
}
