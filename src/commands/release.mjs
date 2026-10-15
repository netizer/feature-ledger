import fs from "node:fs";
import path from "node:path";
import { openProject, pdfsAreCommitted } from "../store.mjs";
import { fail, usage, isBlank, today, longDate, EXIT, UserError } from "../util.mjs";
import { color, mark } from "../ui.mjs";
import { prepareReport, prepareLine, unpreparedNotes, unknownReasons, frozenForCut, messageFor } from "../compose.mjs";
import { redraftReport, redraftSteps } from "./redraft.mjs";
import { editionFile, printEdition } from "./build.mjs";
import * as git from "../git.mjs";

const out = (s) => process.stdout.write(`${s}\n`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (ids) => ids.slice(0, 5).join(", ") + (ids.length > 5 ? `, and ${ids.length - 5} more` : "");

/** `ledger releases`: the timeline, and filling in a commit after the fact. */
export async function cmdReleases({ flags, positional }) {
  const sub = positional[0] ?? "list";
  if (sub === "list") return listReleases(flags);
  if (sub === "amend") return amend(flags, positional.slice(1));
  fail("usage: ledger releases [amend <version> --commit <sha>]");
}

function listReleases(flags) {
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
    out(`v${String(r.version).padStart(2)}  ${(when ?? "").padEnd(20)}${at.padEnd(10)} ${r.name ?? "(unnamed)"}  · ` +
      `${plural(touched, "entry", "entries")}${r.layout === "full" ? " · printed in full" : ""}${printed}`);
  }
}

/**
 * Filling in the commit on a release that was cut before commits were
 * recorded. Without this the field could only ever be set going forward, and
 * a timeline would stay half blank for the life of the project.
 *
 * The in-progress release is refused on purpose: it has no commit because it
 * has not happened yet, and `ledger cut` is what gives it one.
 */
function amend(flags, rest) {
  const project = openProject(flags);
  const version = Number(String(rest[0] ?? "").replace(/^v/, ""));
  if (!Number.isInteger(version)) fail("usage: ledger releases amend <version> --commit <sha>");

  const release = project.releases.at(version);
  if (release.archived) {
    fail(`v${version} belongs to the archived ledger in .ledger/${release.archive}/, which is read-only — ` +
      "its commit is part of the record the client's edition was printed from");
  }
  if (release.future) {
    fail(`v${version} is the release in progress, so it has no commit yet — it gets one when ` +
      "`ledger cut` turns it into a real moment.");
  }
  if (isBlank(flags.commit) || flags.commit === true) fail(`amending a release needs --commit <sha> — the commit v${version} was cut at`);
  if (!git.available(project.root)) fail("--commit needs a git repository; this project has none");

  const sha = git.resolve(project.root, String(flags.commit));
  if (!sha) fail(`no commit ${flags.commit} in this repository`);
  if (!git.isAncestor(project.root, sha)) fail(`${git.shortSha(sha)} isn't an ancestor of HEAD, so v${version} can't have been cut at it`);

  const had = release.commit;
  release.commit = sha;
  if (flags["dry-run"]) {
    out(JSON.stringify(project.releases.toJSON(), null, 2));
    out("(--dry-run: nothing written)");
    return;
  }
  project.releases.validate();
  project.saveReleases();
  out(`v${version} — ${release.name} (${release.date}) was cut at ${git.shortSha(sha)}${had ? `, was ${git.shortSha(had)}` : ""}`);
}

/**
 * The commit this edition stands for. The date is too coarse to name a
 * moment — two demos in one day are ordinary — so the commit is what says
 * which state of the product an edition was printed from. Null outside a
 * repository, which is a real project shape, not an error.
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
  if (!git.isAncestor(root, sha)) fail(`${git.shortSha(sha)} isn't an ancestor of HEAD, so this release can't have been cut at it`);
  return sha;
}

/* ---- what a cut says before it cuts ------------------------------------ */

/**
 * What stands between the open release and its edition, in two kinds.
 *
 * A refusal is only what would print a *wrong* edition: a redrafted corpus
 * not yet checked against the one it replaced (it may have lost what the
 * client was told), and a release with nothing recorded (its edition would
 * repeat the last one). A corpus that doesn't load is refused before any of
 * this runs.
 *
 * Everything else is a warning, said plainly before the cut asks to go
 * ahead: what isn't done yet is the developer's call, not the tool's.
 *
 * `ledger`, `ledger status` and `ledger cut` all show this, so "is it ready?"
 * can be asked without trying to cut.
 */
export function cutReport(project, { date = today(), commit = undefined } = {}) {
  const current = project.releases.current;
  const version = current.version;
  const root = project.root;
  const hasGit = git.available(root);
  if (commit === undefined) commit = hasGit ? git.head(root) : null;
  const refusals = [];
  const warnings = [];

  const redraft = redraftReport(project);
  if (!redraft.ok) refusals.push({ line: redraft.line, fix: redraftSteps(redraft, "") });

  const touched = project.featureSet.features().filter((f) => f.touchedAt(version)).length;
  const other = project.featureSet.otherChanges({ version }).length;
  const recorded = touched > 0 || other > 0;
  if (!recorded) {
    refusals.push({
      line: `nothing is recorded against v${version}, so its edition would be ${version > 1 ? `the same as v${version - 1}'s` : "empty"}`,
      fix: "record the release's work: `ledger add` / `ledger change` (an agent that read the stanza does this itself)",
    });
  }
  if (!recorded) return { version, refusals, warnings, recorded };

  const prepared = prepareReport(project, version);
  if (!prepared.ok && !prepared.nothing) {
    warnings.push({ id: "prepare", line: prepareLine(prepared), fix: "ledger prepare" });
  }
  const unprepared = unpreparedNotes(project, version);
  if (unprepared.length) {
    warnings.push({ id: "notes", line: `${plural(unprepared.length, "updated entry", "updated entries")} with no prepared note, ` +
      `so ${unprepared.length === 1 ? "it prints its" : "they print their"} changes as recorded (${list(unprepared.map((f) => f.id))})`,
    fix: "ledger prepare" });
  }
  const unknown = unknownReasons(project, version);
  if (unknown.length) {
    const nobody = unknown.filter((u) => u.event.why_from === "unknown").length;
    warnings.push({ id: "reasons", line: `${plural(unknown.length, "reason")} nobody has vouched for` +
      ` (${[nobody ? `${nobody} unknown` : null, unknown.length - nobody ? `${unknown.length - nobody} read off a commit message` : null].filter(Boolean).join(", ")}: ` +
      `${list([...new Set(unknown.map((u) => u.feature.id))])})`,
    fix: "ledger prepare asks you about them" });
  }
  if (hasGit) {
    const ledgerRel = path.relative(root, project.ledgerDir).split(path.sep).join("/") || ".ledger";
    const dirty = git.uncommitted(root);
    const inLedger = dirty.filter((p) => p === ledgerRel || p.startsWith(`${ledgerRel}/`));
    const code = dirty.filter((p) => !git.isLedgerPath(project.config, p));
    if (inLedger.length) {
      warnings.push({ id: "uncommitted", line: `${ledgerRel}/ has uncommitted changes (${list(inLedger)}), so the edition can't be traced to a commit`,
        fix: `commit ${ledgerRel}/ first` });
    }
    if (code.length) {
      warnings.push({ id: "uncommitted", line: `${plural(code.length, "file")} outside the ledger ${code.length === 1 ? "is" : "are"} uncommitted ` +
        `(${list(code)}), so the commit this release records doesn't include ${code.length === 1 ? "it" : "them"}, and the next prepare ` +
        "will read that work as new", fix: "commit the work the edition describes first" });
    }
  }
  const previous = project.releases.predecessorOf(version) ?? (version > 1 ? project.releases.at(version - 1) : null);
  if (previous && !previous.archived && previous.date === date && previous.commit && previous.commit === commit) {
    warnings.push({ id: "moment", line: `v${previous.version} (${previous.name}) was also cut on ${date} at ${git.shortSha(commit)}, ` +
      "so the two editions stand for the same moment", fix: "cut at a later commit (--commit), unless you are re-issuing it" });
  }
  return { version, refusals, warnings, recorded };
}

/** A cut report as the terminal shows it: one line each, and what to run under it. */
export function renderReport(report, { indent = "  ", stream = process.stdout } = {}) {
  const c = color(stream);
  const lines = [];
  const item = (m, it) => {
    lines.push(`${indent}${m} ${it.line}`);
    if (it.fix) for (const [i, f] of it.fix.split("\n").entries()) lines.push(`${indent}  ${c.dim(i === 0 ? "→" : " ")} ${f}`);
  };
  for (const r of report.refusals) item(mark(false, stream), r);
  for (const w of report.warnings) item(c.yellow("!"), w);
  return lines.join("\n");
}

/** The one command to run next, from the same report. */
export function nextStep(project, report) {
  if (report.refusals.length) {
    const redraft = redraftReport(project);
    return redraft.ok ? report.refusals[0].fix : redraft.steps[0];
  }
  if (report.warnings.some((w) => w.id === "prepare")) return "ledger agent          (it prepares the edition; spends tokens)";
  return 'ledger cut --name "…"   (prints the edition; `ledger preview` shows it first, for free)';
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

/** The file the message goes in: next to the edition, named after it. */
export function messageFile(editionPath) {
  return editionPath.replace(/\.(pdf|html)$/i, "") + "-message.txt";
}

/**
 * Cutting a release is the one moment the timeline moves: the open release
 * gets its name, date and commit, its edition is printed into the client
 * directory with the message to send beside it, and a fresh open release
 * starts behind it.
 *
 * It refuses only what would print a wrong edition (see cutReport). Anything
 * else is shown, and the cut asks before it goes ahead: at a terminal, a
 * prompt; anywhere else, `--yes`.
 *
 * The edition is printed before anything is written, so a machine with no
 * browser can't leave a release cut with no document: if the print fails,
 * nothing was cut. `--no-pdf` cuts without printing; `ledger build vN` prints
 * it later.
 */
export async function cmdCut({ flags }) {
  const project = openProject(flags);
  if (!project.releases.current.future) {
    fail(`v${project.releases.current.version} is already shipped — there's nothing in progress to cut`);
  }
  if (isBlank(flags.name) || flags.name === true) {
    usage('usage: ledger cut --name "…"  — the moment the release stands for ("Client demo", "Sprint 4 handover")');
  }
  const date = flags.date === true || isBlank(flags.date) ? today() : String(flags.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) usage(`--date must be YYYY-MM-DD (got ${date})`);

  const current = project.releases.current;
  const version = current.version;
  const commit = resolveCutCommit(project, flags);
  const report = cutReport(project, { date, commit });
  const err = process.stderr;

  if (report.refusals.length) {
    throw new UserError([
      `${mark(false, err)} v${version} was NOT cut: its edition would be wrong.`,
      "",
      renderReport(report, { stream: err }),
      "",
      "Nothing was written.",
    ].join("\n"), EXIT.refused, { raw: true });
  }

  if (report.warnings.length) {
    out(`Before v${version} is cut:`);
    out(renderReport(report));
    out("");
    if (!flags.yes && !flags["dry-run"]) {
      const go = process.stdin.isTTY ? await confirm(`Cut v${version} and print its edition anyway? [y/N] `) : false;
      if (!go) {
        throw new UserError(`${mark(false, err)} v${version} was NOT cut. Nothing was written.` +
          (process.stdin.isTTY ? "" : " Pass --yes to cut with the above when nobody is at a terminal."),
        EXIT.refused, { raw: true });
      }
    }
  }

  const draftFile = flags.out ? null : editionFile(project, version, flags).target;
  const touched = project.featureSet.features().filter((f) => f.touchedAt(version)).length;
  const other = project.featureSet.otherChanges({ version }).length;
  // What the edition prints for an updated entry nobody prepared a note
  // for, frozen with it, so it reprints exactly whatever happens afterwards.
  const frozen = frozenForCut(project, version);
  if (frozen) project.compositions = [...project.compositions.filter((x) => x.version !== version), frozen];

  current.name = flags.name;
  current.date = date;
  current.commit = commit;
  current.status = "released";
  current.future = false;
  current.released = true;
  if (flags.full) current.layout = "full";
  project.releases.releases.push({
    version: version + 1, name: null, date: null, commit: null,
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
      printed = (await printEdition(project, version, flags)).target;
    } catch (e) {
      throw new UserError(`${mark(false, err)} v${version} was NOT cut: its edition couldn't be printed.\n` +
        `  ${String(e.message).split("\n").join("\n  ")}\n` +
        `Fix that and cut again, or cut with --no-pdf and print it later with \`ledger build v${version}\`.`,
      EXIT.error, { raw: true });
    }
  }
  const message = messageFile(printed ?? editionFile(project, version, flags).target);
  fs.mkdirSync(path.dirname(message), { recursive: true });
  fs.writeFileSync(message, messageFor(project, version));
  if (frozen) project.saveComposition(frozen);
  project.saveReleases();
  if (draftFile && fs.existsSync(draftFile)) fs.unlinkSync(draftFile);

  const rel = (p) => path.relative(process.cwd(), p) || p;
  out(`${mark(true)} cut v${version} — ${current.name} (${date}${commit ? `, ${git.shortSha(commit)}` : ""}), covering ` +
    `${plural(touched, "entry", "entries")}${other ? ` and ${plural(other, "product-wide note")}` : ""}` +
    (report.warnings.length ? `, with ${plural(report.warnings.length, "warning")}` : ""));
  out(printed ? `  wrote ${rel(printed)}` : `  no edition printed (--no-pdf) — \`ledger build v${version}\` prints it`);
  out(`  wrote ${rel(message)}, the message to send with it`);
  out(`  v${version + 1} is now open; new work records against it.`);
  const ledgerRel = path.relative(project.root, project.ledgerDir) || ".ledger";
  out(`Next: commit ${ledgerRel}/` +
    (pdfsAreCommitted(project.config) ? ` and ${String(project.config.output.client_dir).replace(/\/+$/, "")}/` : "") + ".");
}
