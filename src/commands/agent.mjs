import readline from "node:readline/promises";
import { openProject } from "../store.mjs";
import { EXIT, UserError, longDate, usage } from "../util.mjs";
import { color } from "../ui.mjs";
import * as git from "../git.mjs";
import { Feature } from "../model/feature.mjs";
import { prepareReport, unknownReasons } from "../compose.mjs";
import { restyleDue, bootstrapState, codeSince, SWEEP_MIN_LINES } from "../state.mjs";
import { resolveStyle, styleTitle } from "../style.mjs";
import { TASKS, deliver, deliveryMode, runTask } from "../prompt.mjs";

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (ids) => ids.slice(0, 6).join(", ") + (ids.length > 6 ? `, and ${ids.length - 6} more` : "");

/**
 * `ledger agent`: the one command for agent work. It reads `.ledger/` and
 * git — no agent, no tokens — to work out which task is due, and how much of
 * it, then delivers that one task the way every task is delivered.
 *
 * In order, the first that applies:
 *
 *   the corpus is empty                  bootstrap
 *   entries, but no finished survey      stop: a person says which it is
 *   a redraft not yet checked            redraft check
 *   entries in a tone the project left   style rewrite, of those entries only
 *   changes prepare hasn't read          prepare, of what moved since the last one
 *   enough code nobody has read          sweep, of the code since it was last read
 *   none of these                        nothing; no agent starts
 *
 * Every one of these is decided from a record the CLI wrote when a task
 * finished, never from the text, so a task that is done is never sent round
 * again. What it can't decide that way it stops on, and says so, rather than
 * spending tokens on an agent to work it out. One task per run: each has its
 * own check, and the next run picks up the next.
 *
 * Typing it is asking for agent work, so with an agent configured
 * ($LEDGER_AGENT, or "agent" in config.json) it runs it; with none, it prints
 * the prompt to paste, as every task does.
 */
export async function cmdAgent({ flags, positional }) {
  if (positional.length) usage("`ledger agent` takes no arguments: it works out what is due. `--plan` shows it without running it.");
  const mode = deliveryMode(flags);
  // With --print the prompt is the output, so everything else goes to stderr.
  const stream = mode === "print" ? process.stderr : process.stdout;
  const say = (s = "") => stream.write(`${s}\n`);
  const c = color(stream);

  let project;
  try {
    project = openProject(flags);
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    say(/no \.ledger\/ found/.test(e.message)
      ? "There is no .ledger/ here, so there is nothing for an agent to work on. `ledger init` sets one up;\n" +
        "it asks things only you can answer, so no agent runs it."
      : e.message);
    process.exitCode = EXIT.refused;
    return;
  }

  // The questions only a person can answer, asked here for nothing, before
  // anything is spent on an agent that would only ask them again.
  if (!flags.plan && mode !== "print" && mode !== "copy" && process.stdin.isTTY && process.stdout.isTTY) {
    if (await askReasons(project, say)) project = openProject(flags);
  }

  const plan = agentPlan(project, { force: Boolean(flags.force) });
  if (plan.stop) {
    say(plan.stop.join("\n"));
    process.exitCode = EXIT.refused;
    return;
  }
  if (!plan.queue.length) {
    say("Nothing for an agent to do.");
    for (const n of plan.notes) say(`  ${n}`);
    const { cutReport, nextStep } = await import("./release.mjs");
    if (project.releases.current.future) { say(""); say(`Next: ${nextStep(project, cutReport(project))}`); }
    return;
  }

  const [first, ...then] = plan.queue;
  say(`${c.bold("ledger agent")} — ${first.title}`);
  for (const line of first.scope) say(`  ${line}`);
  for (const n of plan.notes) say(c.dim(`  ${n}`));
  if (then.length) say(`  then, on the next run: ${then.map((t) => t.task).join(", then ")}`);
  say("");
  if (flags.plan) {
    say(c.dim("--plan: nothing was run. `ledger agent` runs it."));
    return;
  }

  const configured = process.env.LEDGER_AGENT || project.config.agent;
  if (mode) process.exitCode = await deliver(mode, first.task, flags, { openProject });
  else if (configured) process.exitCode = await runTask(first.task, { ...flags, run: true }, { openProject });
  else await TASKS[first.task].brief(flags);
}

/**
 * What is due, in the order it should be done: `queue` of { task, title,
 * scope }, `notes` on what was looked at and left, or `stop` when the
 * records can't settle it and a person has to.
 */
export function agentPlan(project, { force = false } = {}) {
  const plan = { stop: null, queue: [], notes: [] };
  const due = (task, title, scope = []) => plan.queue.push({ task, title, scope });
  const pending = project.pendingRedraft;
  const boot = bootstrapState(project);

  if (boot.empty) {
    due("bootstrap", pending
      ? `bootstrap: survey the product from scratch for the redraft, at v${pending.opens}`
      : "bootstrap: survey the codebase and write the baseline");
    return plan;
  }
  if (!boot.done) {
    const n = project.featureSet.features().length;
    plan.stop = [
      `${plural(n, "entry", "entries")} recorded, but nothing says the survey that wrote them finished, and ` +
        `${pending ? "the redraft hasn't been checked" : "no edition has been cut"} yet. Only you can say which it is:`,
      "",
      "  it stopped partway          ledger bootstrap            carries the survey on from the entries already there",
      "  the baseline is complete    ledger bootstrap complete   records it, then `ledger agent` goes on from there",
    ];
    return plan;
  }
  if (pending) due("redraft check", `redraft check: read the new corpus against the one archived in .ledger/${pending.archive}/`);

  const style = restyleDue(project);
  if (style.due) {
    const areas = new Map();
    for (const f of style.entries) areas.set(f.category, (areas.get(f.category) ?? 0) + 1);
    let title = style.style;
    try { title = styleTitle(resolveStyle(project.config, project.ledgerDir)); } catch { /* the id will do */ }
    due("style rewrite", `style rewrite: ${plural(style.entries.length, "entry", "entries")}${style.other ? " and the text that belongs to no entry" : ""}, into ${title}`,
      areas.size ? [[...areas].map(([a, n]) => `${a} ${n}`).join(" · ")] : []);
  }

  const current = project.releases.current;
  if (!current.future) {
    plan.notes.push(`v${current.version} is cut and nothing is open, so there is nothing to prepare or sweep.`);
    return plan;
  }
  const report = prepareReport(project);
  const code = codeSince(project);
  const codeLine = code && !code.nothing
    ? `${plural(code.lines, "line")} in ${plural(code.files, "file")} since ${code.from.label} (${git.shortSha(code.from.commit)})`
    : null;
  // A first edition prints as an inventory: no notes, no summary, nothing a
  // prepare has to write before the cut. The survey already did the work.
  const inventory = !project.releases.predecessorOf(current.version);
  if (inventory && !report.ok) {
    plan.notes.push(`v${current.version} is a first edition, so \`ledger prepare\` is optional: read it with \`ledger preview\`, then cut it.`);
  } else if (!report.ok && !report.nothing) {
    if (report.never || !report.prepared || report.reshape) {
      due("prepare", `prepare: write the client's text for v${report.version}`,
        [report.reshape ? "prepared with a first page that sums up several entries per line; it now has one per entry"
          : `${plural(report.recorded, "change")} recorded, not yet prepared`, ...(codeLine ? [codeLine] : [])]);
    } else {
      const moved = [...report.arrived, ...report.moved];
      const scope = [];
      if (moved.length) scope.push(`moved: ${list(moved)}`);
      if (report.notesSince) scope.push(plural(report.notesSince, "new product-wide note"));
      if (report.answered.length) scope.push(`a reason given for ${list(report.answered)}`);
      if (codeLine) scope.push(codeLine);
      due("prepare", `prepare: only what moved since the last prepare${report.prepared.date ? ` (${longDate(report.prepared.date)})` : ""}`, scope);
    }
  } else if (code && !code.nothing) {
    // Prepare reads the code too, so a sweep is only for when it isn't due.
    if (code.significant >= SWEEP_MIN_LINES || (force && code.lines > 0)) {
      due("sweep", "sweep: read the code nobody has read yet, for work nobody recorded",
        [codeLine, ...(code.commits.length ? [plural(code.commits.length, "commit")] : [])]);
    } else {
      plan.notes.push(`${codeLine}, ${code.significant} of them outside tests, docs and lockfiles: under the ${SWEEP_MIN_LINES}-line ` +
        "threshold for a sweep. `ledger agent --force` sweeps it anyway.");
    }
  }
  const open = unknownReasons(project, current.version).length;
  if (open) plan.notes.push(`${plural(open, "reason")} nobody has given — \`ledger agent\` at a terminal asks them, for nothing`);
  return plan;
}

/**
 * Asks, at the terminal, each reason nobody has given. An answer is the
 * person's, so it is recorded as theirs; a reason read off a commit can be
 * confirmed as it stands. Returns whether anything was recorded.
 */
async function askReasons(project, say) {
  const version = project.releases.current.version;
  if (!project.releases.current.future) return false;
  const open = unknownReasons(project, version);
  if (!open.length) return false;
  say(`${plural(open.length, "reason")} nobody has given yet. Answering here costs nothing.`);
  say("Enter skips one, q skips the rest.");
  say("");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answered = new Map();
  try {
    for (const { feature, event, index } of open) {
      say(`  ${feature.id}: ${event.what ?? (event.kind === "remove" ? "removed" : "")}`);
      const fromCommit = event.why_from === "commit" && event.why;
      if (fromCommit) say(`    read off a commit: ${event.why}`);
      const answer = (await rl.question(fromCommit ? "    why? (y keeps the commit's reason) " : "    why? ")).trim();
      if (answer === "q") break;
      if (!answer) continue;
      const why = fromCommit && /^y(es)?$/i.test(answer) ? event.why : answer;
      if (!answered.has(feature.id)) answered.set(feature.id, []);
      answered.get(feature.id).push({ index, why });
    }
  } finally {
    rl.close();
  }
  for (const [id, answers] of answered) {
    const feature = project.featureSet.find(id);
    for (const { index, why } of answers) {
      const event = feature.events[index];
      event.why = why;
      event.why_from = "person";
      // A removal's reason is also what its entry prints.
      if (event.kind === "remove") {
        const entry = feature.entryAt(event.version);
        if (entry?.removed) entry.reason = why;
      }
    }
    project.saveFeature(new Feature(feature.toJSON()));
  }
  const n = [...answered.values()].reduce((k, a) => k + a.length, 0);
  if (n) say(`recorded ${plural(n, "reason")}, as given by you`);
  say("");
  return n > 0;
}
