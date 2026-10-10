import fs from "node:fs";
import path from "node:path";
import { openProject, pdfsAreCommitted } from "../store.mjs";
import { fail, usage, nearest, isBlank, today, longDate, EXIT, UserError } from "../util.mjs";
import { color, mark } from "../ui.mjs";
import { unauditedReport, unauditedLine, unconfirmedReasons } from "./audit.mjs";
import { unreviewedReport, unreviewedLine } from "./review.mjs";
import { redraftReport, redraftSteps } from "./redraft.mjs";
import { editionFile, printEdition } from "./build.mjs";
import { runTask } from "../prompt.mjs";
import * as git from "../git.mjs";

const out = (s) => process.stdout.write(`${s}\n`);

/** `ledger releases`: the timeline, and filling in a commit after the fact. */
export async function cmdReleases({ flags, positional }) {
  const sub = positional[0] ?? "list";
  if (sub === "list") return list(flags);
  if (sub === "amend") return amend(flags, positional.slice(1));
  fail("usage: ledger releases [amend <version> --commit <sha>]");
}

function list(flags) {
  const project = openProject(flags);
  for (const r of project.releases.releases) {
    // Only when it differs: a ledger that never set `display_version` lists as before.
    const label = project.releases.printedAs(r.version);
    const printed = label !== String(r.version) ? `  · printed as ${label}` : "";
    const touched = project.featureSet.features().filter((f) => f.touchedAt(r.version)).length;
    if (r.archived) {
      // Counted in its own corpus: nothing in this one is recorded against it.
      out(`v${String(r.version).padStart(2)}  ${(longDate(r.date) ?? "").padEnd(20)}${(r.commit ? `  ${git.shortSha(r.commit)}` : "").padEnd(10)} ` +
        `${r.name}  · archived in .ledger/${r.archive}/${printed}`);
      continue;
    }
    const when = r.future ? "in progress" : longDate(r.date);
    // The commit is what tells two editions cut on one day apart, so it goes
    // in the listing rather than only in the file.
    const at = r.commit ? `  ${git.shortSha(r.commit)}` : "";
    out(`v${String(r.version).padStart(2)}  ${(when ?? "").padEnd(20)}${at.padEnd(10)} ${r.name ?? "(unnamed)"}  · ${touched} entr${touched === 1 ? "y" : "ies"}${printed}`);
  }
}

/**
 * Filling in the commit on a release that was cut before commits were
 * recorded — which is every release in every ledger that predates them, this
 * one included. Without this the field could only ever be set going forward,
 * and a timeline would stay half blank for the life of the project.
 *
 * The in-progress release is refused on purpose: it has no commit because it
 * has not happened yet, and `ledger cut` is what gives it one.
 */
function amend(flags, rest) {
  const project = openProject(flags);
  const version = Number(rest[0]);
  if (!Number.isInteger(version)) fail('usage: ledger releases amend <version> --commit <sha>');

  const release = project.releases.at(version);
  if (release.archived) {
    fail(`v${version} belongs to the archived ledger in .ledger/${release.archive}/, which is read-only — ` +
      "its commit is part of the record the client's edition was printed from");
  }
  if (release.future) {
    fail(
      `v${version} is the release in progress, so it has no commit yet — it gets one when ` +
      "`ledger cut` turns it into a real moment.",
    );
  }
  if (isBlank(flags.commit) || flags.commit === true) {
    fail(`amending a release needs --commit <sha> — the commit v${version} was cut at`);
  }
  if (!git.available(project.root)) fail("--commit needs a git repository; this project has none");

  const sha = git.resolve(project.root, String(flags.commit));
  if (!sha) fail(`no commit ${flags.commit} in this repository`);
  if (!git.isAncestor(project.root, sha)) {
    fail(`${git.shortSha(sha)} isn't an ancestor of HEAD, so v${version} can't have been cut at it`);
  }

  // The same thing `cut` refuses: two editions standing for one moment.
  const clash = project.releases.releases.find(
    (r) => r.version !== version && r.released && r.date === release.date && r.commit === sha,
  );
  if (clash && !flags.force) {
    fail(
      `v${clash.version} (${clash.name}) already stands for ${release.date} at ${git.shortSha(sha)}, so the two ` +
      "editions would be indistinguishable. Pass --force if that is really what happened.",
    );
  }

  const had = release.commit;
  release.commit = sha;

  if (flags["dry-run"]) {
    out(JSON.stringify(project.releases.toJSON(), null, 2));
    out("(--dry-run: nothing written)");
    return;
  }
  project.releases.validate();
  project.saveReleases();
  out(`v${version} — ${release.name} (${release.date}) was cut at ${git.shortSha(sha)}` +
    (had ? `, was ${git.shortSha(had)}` : ""));
}

/**
 * The commit this edition stands for.
 *
 * An edition is a snapshot of the product at a moment, and the date is too
 * coarse to name that moment: two demos in one day are ordinary, and a
 * document cut this morning and one cut this afternoon are two different
 * products. The commit is what says which. `--commit` cuts a release
 * retrospectively at a known point, verified the same way `ledger audit
 * complete` verifies its own — a sha this history has never seen is a typo,
 * not a release.
 *
 * Null outside a repository. That is a real project shape, not an error, and
 * everything downstream treats a missing commit as "not recorded".
 */
function resolveCutCommit(project, flags) {
  const root = project.root;
  const asked = flags.commit && flags.commit !== true ? String(flags.commit) : null;
  if (!git.available(root)) {
    if (asked) fail("--commit needs a git repository; this project has none");
    return null;
  }
  if (!asked) return git.head(root);

  const sha = git.resolve(root, asked);
  if (!sha) fail(`no commit ${asked} in this repository`);
  if (!git.isAncestor(root, sha)) {
    fail(`${git.shortSha(sha)} isn't an ancestor of HEAD, so this release can't have been cut at it`);
  }
  return sha;
}

/* ---- the checks a cut runs ---------------------------------------------- */

/**
 * Everything that has to be true before a release is cut, each with what to
 * run when it isn't. All of them are worked out every time, and a refusal
 * shows the whole list: fixing the audit only to be told about the review on
 * the next attempt is how a gate teaches people to reach for --force.
 *
 * `ledger status` and bare `ledger` show the same list, so "is it ready?" can
 * be asked without trying to cut.
 *
 * In the order they matter. Until a redrafted corpus has been checked against
 * the one it replaced, anything the others ask is asked of a corpus that may
 * still be missing what the client was told. Unaudited work comes before the
 * empty-release check because when both fire they have one cause — work
 * landed and the ledger never heard about it — and the audit is what fixes
 * it. The review comes after both, because each of them can send someone off
 * to record more, and whatever is recorded is what a review has to read.
 */
export const CHECK_IDS = ["redraft", "audit", "content", "review", "moment"];

export function cutChecks(project, { date = today(), commit = undefined } = {}) {
  const current = project.releases.current;
  const version = current.version;
  if (commit === undefined) commit = git.available(project.root) ? git.head(project.root) : null;

  const redraft = redraftReport(project);
  const unaudited = unauditedReport(project);
  const touched = project.featureSet.features().filter((f) => f.touchedAt(version)).length;
  const other = project.featureSet.otherChanges({ version }).length;
  const unreviewed = unreviewedReport(project);
  const previous = project.releases.predecessorOf(version);
  // Only once there is something to cut: straight after a cut, HEAD is the
  // commit it was cut at, and saying so as a second ✗ under "nothing recorded"
  // would only make an ordinary state look like a problem.
  const recorded = touched > 0 || other > 0;
  const sameMoment = recorded && previous && previous.date === date && previous.commit && previous.commit === commit;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  return [
    {
      id: "redraft",
      ok: redraft.ok,
      line: redraft.ok ? "no redraft waiting to be checked" : redraft.line,
      fix: redraft.ok ? null : redraftSteps(redraft, ""),
    },
    {
      id: "audit",
      ok: unaudited.ok,
      line: unaudited.ok ? unaudited.reason : `${unauditedLine(unaudited)}, so this edition may be missing capabilities the client already has`,
      fix: "ledger audit        (or `ledger audit --run <agent>` to hand it to one)",
    },
    {
      id: "content",
      ok: recorded,
      line: recorded
        ? [touched ? plural(touched, "entry", "entries") : null, other ? plural(other, "product-wide note", "product-wide notes") : null]
          .filter(Boolean).join(" and ") + ` recorded against v${version}`
        : `nothing recorded against v${version}, so its edition would be ${version > 1 ? `identical to v${version - 1}` : "empty"}`,
      fix: "record the release's work with `ledger add` / `ledger update` — or `ledger audit`, if it landed without the ledger",
    },
    {
      id: "review",
      ok: unreviewed.ok,
      line: unreviewed.ok ? (unreviewed.reason ?? `reviewed on ${longDate(unreviewed.last?.date)}`) : unreviewedLine(unreviewed),
      fix: "ledger review       (or `ledger review complete`, if you have read them yourself)",
    },
    {
      id: "moment",
      ok: !sameMoment,
      line: sameMoment
        ? `v${previous.version} (${previous.name}) was also cut on ${date} at ${git.shortSha(commit)} — the two editions would stand for the same moment`
        : commit ? `cutting at ${git.shortSha(commit)} on ${date}` : `cutting on ${date} (no git repository, so no commit is recorded)`,
      fix: "cut at a later commit (--commit), or `--skip moment` if you really are re-issuing it",
    },
  ].map((ch) => (ch.ok ? { ...ch, fix: null } : ch));
}

/** The checklist as the terminal shows it: one line per check, and under each
 *  one that's open, what to run. */
export function renderChecks(checks, { indent = "  ", stream = process.stdout, skipped = [] } = {}) {
  const lines = [];
  for (const ch of checks) {
    const skip = !ch.ok && skipped.includes(ch.id);
    const m = skip ? color(stream).yellow("–") : mark(ch.ok, stream);
    lines.push(`${indent}${m} ${ch.id.padEnd(8)} ${ch.line}${skip ? "  (skipped)" : ""}`);
    if (!ch.ok && !skip && ch.fix) {
      for (const [i, f] of ch.fix.split("\n").entries()) {
        lines.push(`${indent}  ${" ".repeat(8)} ${color(stream).dim(i === 0 ? "→" : " ")} ${f}`);
      }
    }
  }
  return lines.join("\n");
}

/** What `--skip` named, checked against the real ids, with `--force` as
 *  "every one of them". */
function skippedChecks(flags) {
  if (flags.force) return [...CHECK_IDS];
  const asked = [].concat(flags.skip ?? []).filter((v) => v !== true).flatMap((v) => String(v).split(","))
    .map((s) => s.trim()).filter(Boolean);
  if ([].concat(flags.skip ?? []).includes(true)) usage(`--skip needs the checks to skip: ${CHECK_IDS.join(", ")}`);
  for (const id of asked) {
    if (!CHECK_IDS.includes(id)) {
      const near = nearest(id, CHECK_IDS);
      usage(`there is no check called "${id}"${near ? ` — did you mean ${near}?` : ""} (the checks: ${CHECK_IDS.join(", ")})`);
    }
  }
  return asked;
}

/* ---- ledger cut -------------------------------------------------------- */

async function confirm(question) {
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}

/**
 * Cutting a release is the one moment the timeline moves: the open release
 * gets its real name and date, its edition is printed into the client
 * directory, and a fresh open release starts behind it. Every New/Changed tag
 * from the cycle just shipped goes quiet in the living docs on its own.
 *
 * The edition is printed before anything is written, so a machine with no
 * browser can't leave a release cut with no document: if the print fails,
 * nothing was cut. `--no-pdf` cuts without printing, for a CI job or a
 * container, and `ledger build vN` prints it later.
 *
 * `--run <agent>` hands whatever of the audit and the review is still open to
 * that agent, one after the other, checks what each left behind, and then
 * asks before it cuts (`--yes` doesn't ask). Only with the flag: nothing is
 * ever handed to an agent unasked.
 */
export async function cmdCut({ flags }) {
  let project = openProject(flags);
  if (!project.releases.current.future) {
    fail(`v${project.releases.current.version} is already shipped — there's nothing in progress to cut`);
  }
  if (isBlank(flags.name) || flags.name === true) {
    usage('usage: ledger cut --name "…"  — the moment the release stands for ("Client demo", "Sprint 4 handover")');
  }
  const date = flags.date === true || isBlank(flags.date) ? today() : String(flags.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) usage(`--date must be YYYY-MM-DD (got ${date})`);
  const skipped = skippedChecks(flags);

  let handedOver = false;
  if (flags.run !== undefined && flags.run !== false) {
    for (const id of ["audit", "review"]) {
      const check = cutChecks(project, { date }).find((ch) => ch.id === id);
      if (check.ok || skipped.includes(id)) continue;
      out(`${mark(false)} ${id}: ${check.line}`);
      out("");
      const code = await runTask(id, flags, { openProject });
      out("");
      if (code) {
        throw new UserError(`${mark(false, process.stderr)} v${project.releases.current.version} was NOT cut: the ${id} didn't ` +
          "finish (see above). Resume the agent's session to finish it, then cut again.", EXIT.refused, { raw: true });
      }
      project = openProject(flags);
      handedOver = true;
    }
  }

  const current = project.releases.current;
  const commit = resolveCutCommit(project, flags);
  const checks = cutChecks(project, { date, commit });
  const open = checks.filter((ch) => !ch.ok && !skipped.includes(ch.id));
  if (open.length) {
    const err = process.stderr;
    throw new UserError([
      `${mark(false, err)} v${current.version} was NOT cut — ${open.length} check${open.length === 1 ? " is" : "s are"} open:`,
      "",
      renderChecks(checks, { stream: err, skipped }),
      "",
      "Nothing was written. Fix the above and cut again, or skip a check on purpose: " +
        `--skip ${open.map((ch) => ch.id).join(",")}`,
    ].join("\n"), EXIT.refused, { raw: true });
  }

  // An agent's last message is often a question only the person can answer
  // ("this entry claims something nobody can use yet"), and the edition is
  // what the client gets. So after handing work over, the cut waits to be told
  // to go ahead — a prompt in a terminal, `--yes` anywhere else.
  if (handedOver && !flags.yes && !flags["dry-run"]) {
    const go = process.stdin.isTTY
      ? await confirm(`Read the agent's notes above. Cut v${current.version} and print its edition now? [y/N] `)
      : false;
    if (!go) {
      throw new UserError(`${mark(false, process.stderr)} v${current.version} was NOT cut: the checks pass now, and it is waiting ` +
        `for you. Cut it with \`ledger cut --name ${JSON.stringify(flags.name)}\`` +
        (process.stdin.isTTY ? "." : ", or pass --yes to cut straight after the agents when nobody is at a terminal."),
      EXIT.refused, { raw: true });
    }
  }

  const draftFile = flags.out ? null : editionFile(project, current.version, flags).target;
  const touched = project.featureSet.features().filter((f) => f.touchedAt(current.version)).length;
  const other = project.featureSet.otherChanges({ version: current.version }).length;

  current.name = flags.name;
  current.date = date;
  current.commit = commit;
  current.status = "released";
  current.future = false;
  current.released = true;
  project.releases.releases.push({
    version: current.version + 1, name: null, date: null, commit: null,
    status: "future", future: true, released: false,
  });
  project.releases.validate();

  if (flags["dry-run"]) {
    out(JSON.stringify(project.releases.toJSON(), null, 2));
    out("(--dry-run: nothing written)");
    return;
  }

  let printed = null;
  if (flags.pdf !== false) {
    try {
      printed = (await printEdition(project, current.version, flags)).target;
    } catch (e) {
      throw new UserError(`${mark(false, process.stderr)} v${current.version} was NOT cut: its edition couldn't be printed.\n` +
        `  ${String(e.message).split("\n").join("\n  ")}\n` +
        `Fix that and cut again, or cut with --no-pdf and print it later with \`ledger build v${current.version}\`.`,
      EXIT.error, { raw: true });
    }
  }
  project.saveReleases();
  if (draftFile && fs.existsSync(draftFile)) fs.unlinkSync(draftFile);

  const skippedOpen = checks.filter((ch) => !ch.ok).map((ch) => ch.id);
  out(`${mark(true)} cut v${current.version} — ${current.name} (${date}${commit ? `, ${git.shortSha(commit)}` : ""}), covering ` +
    `${touched} feature entr${touched === 1 ? "y" : "ies"}${other ? ` and ${other} other change${other === 1 ? "" : "s"}` : ""}` +
    (skippedOpen.length ? `, skipping ${skippedOpen.join(", ")}` : ""));
  out(printed
    ? `  wrote ${path.relative(process.cwd(), printed) || printed}`
    : `  no edition printed (--no-pdf) — \`ledger build v${current.version}\` prints it`);
  out(`  v${current.version + 1} is now open; new work records against it.`);
  const pending = unconfirmedReasons(project);
  if (pending.length) {
    out(`! ${pending.length} reason${pending.length === 1 ? "" : "s"} in this edition came from an audit reading a ` +
      "commit message and nobody has confirmed them yet: " +
      `${pending.map((x) => x.id).join(", ")}. \`ledger audit confirm <id>\` vouches for one.`);
  }
  const ledgerRel = path.relative(project.root, project.ledgerDir) || ".ledger";
  out(`Next: commit ${ledgerRel}/` +
    (pdfsAreCommitted(project.config) ? ` and ${String(project.config.output.client_dir).replace(/\/+$/, "")}/` : "") + ".");
}
