import { openProject } from "../store.mjs";
import { fail, longDate, COPY_BLOCK } from "../util.mjs";
import * as git from "../git.mjs";
import { releaseEntries, kindAt } from "../compose.mjs";
import { eventLine } from "../diff.mjs";
import { codeSince, stampSweep } from "../state.mjs";
import { recordingRules } from "./prepare.mjs";

const out = (s) => process.stdout.write(`${s}\n`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * `ledger sweep`: the code nobody has read since the last sweep, prepare or
 * edition, handed to an agent to record any work in it that nobody recorded.
 * It writes no client text — that is `ledger prepare`, once per release — so
 * it is the small, frequent task: a diff and the release's one-line record,
 * nothing more. `ledger sweep complete` stamps the code as read.
 *
 * Nothing to read prints no prompt, so nothing is handed to an agent.
 */
export async function cmdSweep({ flags, positional }) {
  const sub = positional[0] ?? "brief";
  if (sub === "brief") return brief(flags);
  if (sub === "complete") return complete(flags);
  fail("usage: ledger sweep | sweep complete");
}

function complete(flags) {
  const project = openProject(flags);
  project.assertWritable();
  if (!git.available(project.root)) fail("this project has no git repository, so there is no code to mark as read");
  stampSweep(project);
  if (flags["dry-run"]) {
    out(JSON.stringify(project.state.sweep, null, 2));
    out("(--dry-run: nothing written)");
    return;
  }
  project.saveState();
  out(`recorded the code as read up to ${git.shortSha(project.state.sweep.commit)}` +
    (project.state.sweep.files ? ", uncommitted work included" : "") +
    ". The next sweep starts from there.");
}

function brief(flags) {
  const project = openProject(flags);
  const version = project.workingVersion;
  const previous = project.releases.predecessorOf(version);
  const P = previous ? `v${previous.version}` : null;
  const N = `v${version}`;
  const code = codeSince(project);
  if (!code) {
    out(git.available(project.root)
      ? "There is no commit to read from: the last edition has none recorded (`ledger releases amend`), and nothing has been swept or prepared."
      : "This project has no git repository, so there is no code to sweep.");
    return;
  }
  if (code.nothing) {
    out(`Nothing to sweep: no code has changed since ${code.from.label} (${git.shortSha(code.from.commit)}).`);
    return;
  }

  out(`ledger sweep — the code since ${code.from.label} (${git.shortSha(code.from.commit)}${code.from.date ? `, ${longDate(code.from.date)}` : ""})`);
  out("");
  out(`${plural(code.lines, "line")} in ${plural(code.files, "file")}, read for work someone using the product would notice and`);
  out("nobody recorded. It records what it finds and writes none of the client's text: that is");
  out("`ledger prepare`. It doesn't commit.");
  out("");
  out(COPY_BLOCK);
  out("");

  const lines = [];
  const p = (s = "") => lines.push(s);
  p(`Read the code that changed in ${project.config.product} since ${git.shortSha(code.from.commit)}, and record in the feature`);
  p("ledger any change someone using the product would notice that nobody recorded.");
  p("");
  p("The ledger is a client-facing record of what this product does, one entry per");
  p("capability, kept in .ledger/. You record facts only: what moved, and why. Don't");
  p("write any of the client's text (no notes, no summary, nothing in compositions.json),");
  p("and don't commit.");
  p("");
  p("Run `ledger style` once, before you write, for the voice. Read an entry with");
  p("`ledger show <id>` and the corpus with `ledger list`; don't read .ledger/ whole.");
  p("");
  p(`## 1. What ${N} has recorded so far`);
  p("");
  const entries = releaseEntries(project, version);
  if (!entries.length) p("Nothing yet.");
  for (const f of entries) {
    const s = f.stateAt(version);
    p(`  ${kindAt(f, version).padEnd(9)} ${f.id}  —  ${s.removed ? f.currentName : s.name}`);
    for (const e of f.eventsAt(version)) p(`      - ${eventLine(e)}`);
  }
  for (const c of project.featureSet.otherChanges({ version, audience: "user" })) p(`  note      product-wide: ${c.description}`);
  p("");
  p(`## 2. The code since ${code.from.label}`);
  p("");
  p("Working tree included, biggest first. Read what you need of it with `git diff");
  p(`${git.shortSha(code.from.commit)}` + "` and the files themselves:");
  p("");
  p("```");
  p(code.stat.text);
  p("```");
  p("");
  if (code.commits.length) {
    p("```");
    for (const c of code.commits.slice(-60)) p(`  ${c}`);
    if (code.commits.length > 60) p(`  … and ${code.commits.length - 60} earlier`);
    p("```");
    p("");
  }
  p("## 3. Record what nobody recorded");
  p("");
  p("Compare section 2 with section 1, and with `ledger list` for entries that didn't move");
  p("in this release. A change someone using the product would notice that nothing accounts");
  p("for is unrecorded. Record it:");
  p("");
  recordingRules(p, P);
  p("If nobody is in this session to ask, record the reason you read off a commit with");
  p("`--why-from commit`, or `--why-unknown`: `ledger prepare` asks a person later.");
  p("");
  p("## When you're done");
  p("");
  p("1. Run `ledger status` and fix anything it says about what you recorded.");
  p("2. Run `ledger sweep complete`. It marks this code as read, so the next sweep starts after it.");
  p("3. End with a short list: what you recorded, and the reasons nobody could give. Don't commit.");
  out(lines.join("\n"));
}
