import { openProject } from "../store.mjs";
import { fail, today, longDate, COPY_RULE } from "../util.mjs";
import * as git from "../git.mjs";

const out = (s) => process.stdout.write(`${s}\n`);

/**
 * The periodic sweep of the codebase against the record.
 *
 * `ledger status` in a commit hook catches a corpus that has been broken. It
 * cannot catch one that is out of date, and neither can the agent stanza: that
 * only keeps the ledger current for work done through a coding agent that read
 * it. A developer who ships a capability without one leaves no trace in the
 * corpus at all. This is the parallel track that finds them.
 *
 * Like `bootstrap` and `style rewrite`, the command prints a brief rather than
 * doing the work — only something that can read the codebase can say what it
 * does. What the CLI does do first is the cheap deterministic half: resolve the
 * range, cluster the changed paths into batches, and collect the commit
 * subjects, so the agent is handed a worked checklist instead of a diff.
 */
export async function cmdAudit({ flags, positional }) {
  const sub = positional[0] ?? "brief";
  if (sub === "brief") return brief(flags);
  if (sub === "complete") return complete(flags);
  if (sub === "log") return log(flags);
  if (sub === "confirm") return confirm(flags, positional.slice(1));
  fail('usage: ledger audit [--full] [--since <sha>] | audit complete [--commit <sha>] | audit log | audit confirm <id>');
}

/* ---- what is unaudited ------------------------------------------------- */

/**
 * How much of the repository has never been examined against the record.
 *
 * Only paths that could say something about the product count: a commit that
 * writes nothing but `.ledger/` and the generated docs is not unaudited work,
 * and counting it would make the `release cut` gate fire on the audit's own
 * commit every time.
 *
 * With no audit ever recorded there is nothing to measure drift from, so this
 * reports `ok` rather than treating the whole history as a backlog — the audit
 * is opt-in and periodic, and a project that has not adopted it should not be
 * nagged at every cut.
 */
export function unauditedReport(project) {
  const root = project.root;
  if (!git.available(root)) return { ok: true, reason: "no git repository" };

  const last = project.lastAudit;
  if (!last || !last.commit) return { ok: true, reason: "no audit recorded yet" };
  if (!git.isAncestor(root, last.commit)) {
    return { ok: true, reason: `the last audited commit (${git.shortSha(last.commit)}) isn't in this history` };
  }

  const head = git.head(root);
  if (head === last.commit) return { ok: true, reason: "audited up to HEAD" };

  const paths = git.changes(root, last.commit)
    .filter((c) => !git.isLedgerPath(project.config, c.path));
  if (!paths.length) return { ok: true, reason: "nothing but the ledger has changed since" };

  return {
    ok: false,
    since: last.commit,
    date: last.date,
    head,
    commits: git.countCommits(root, last.commit),
    paths: paths.length,
  };
}

/** The sentence the gate and `ledger status` both print, so the two can't
 *  drift apart in how they describe the same gap. */
export function unauditedLine(report) {
  const when = report.date ? `, ${longDate(report.date)}` : "";
  return `${report.commits} commit${report.commits === 1 ? "" : "s"} since the last audit ` +
    `(${git.shortSha(report.since)}${when}), touching ${report.paths} ` +
    `file${report.paths === 1 ? "" : "s"} outside the ledger`;
}

/**
 * Entries whose `changes` reason an audit took from a commit message rather
 * than from the person who made the decision. Kept as corpus state on purpose:
 * a list printed once at the end of an audit dies with the terminal, and the
 * whole point is that someone can still check it tomorrow.
 *
 * Deliberately never exposed through `Feature#stateAt`, so no renderer can put
 * it in front of a client. It is a note to the team, not to the reader.
 */
export function unconfirmedReasons(project) {
  const found = [];
  for (const f of project.featureSet.features()) {
    for (const h of f.history) {
      if (h.reason_inferred) found.push({ id: f.id, version: h.version, name: f.currentName });
    }
  }
  return found;
}

/* ---- audit complete ---------------------------------------------------- */

/**
 * Stamping the audited commit is a command, not something an agent writes into
 * the JSON, because this is the one field that makes a gap permanently
 * invisible if it is set without the work being done. An audit that ran out of
 * context halfway and still stamped HEAD is worse than no audit at all.
 *
 * The brief always carries an explicit --commit: commits can land underneath a
 * long audit, and stamping the later one would silently mark work nobody looked
 * at as examined. Bare `complete` uses HEAD, which is the human's "I just
 * audited and nothing landed" shortcut.
 */
function complete(flags) {
  const project = openProject(flags);
  const root = project.root;
  const hasGit = git.available(root);

  let commit = null;
  if (hasGit) {
    const asked = flags.commit && flags.commit !== true ? String(flags.commit) : null;
    if (asked) {
      commit = git.resolve(root, asked);
      if (!commit) fail(`no commit ${asked} in this repository`);
      if (!git.isAncestor(root, commit)) {
        fail(
          `${git.shortSha(commit)} isn't an ancestor of HEAD, so it can't be what this audit covered. ` +
          "Pass the commit the brief named, or leave --commit off to stamp HEAD.",
        );
      }
    } else {
      commit = git.head(root);
    }
  } else if (flags.commit && flags.commit !== true) {
    fail("--commit needs a git repository; this project has none, so an audit is recorded without one");
  }

  const version = project.workingVersion;
  const counts = backfilledCounts(project, version);
  const unconfirmed = unconfirmedReasons(project).length;

  const entry = {
    commit,
    date: today(),
    mode: flags.full ? "full" : "incremental",
    since: flags.since && flags.since !== true ? String(flags.since) : (project.lastAudit?.commit ?? null),
    version,
    backfilled: counts,
    unconfirmed_reasons: unconfirmed,
  };
  if (entry.mode === "full") entry.since = null;

  if (flags["dry-run"]) {
    out(JSON.stringify(entry, null, 2));
    out("(--dry-run: nothing written)");
    return;
  }

  project.recordAudit(entry);

  const total = counts.added + counts.changed + counts.removed;
  out(`recorded a ${entry.mode} audit${commit ? ` at ${git.shortSha(commit)}` : ""} (${entry.date})`);
  out(total
    ? `  ${counts.added} added, ${counts.changed} changed, ${counts.removed} removed as already in place`
    : "  nothing was found that the ledger didn't already have");
  if (unconfirmed) {
    out(`  ${unconfirmed} inferred reason${unconfirmed === 1 ? "" : "s"} still to confirm — \`ledger status\` lists them`);
  }
}

/**
 * Only backfilled entries are counted, and deliberately so. An audit's
 * current-cycle findings are indistinguishable from what an agent would have
 * recorded anyway — they land on the open release next to ordinary work — so
 * attributing them would mean either snapshotting the corpus or trusting a
 * number the agent asserts. A backfilled entry can only have come from an
 * audit, so these three are computed from the corpus and claim nothing that
 * cannot be verified.
 */
function backfilledCounts(project, version) {
  let added = 0; let changed = 0; let removed = 0;
  for (const f of project.featureSet.features()) {
    const h = f.entryAt(version);
    if (!h?.backfilled) continue;
    if (h.removed) removed++;
    else if (f.firstVersion === version) added++;
    else changed++;
  }
  return { added, changed, removed };
}

/* ---- audit log --------------------------------------------------------- */

function log(flags) {
  const project = openProject(flags);
  if (flags.json) {
    out(JSON.stringify({ audits: project.audits }, null, 2));
    return;
  }
  if (!project.audits.length) {
    out("no audits recorded — `ledger audit` prints the brief for the first one");
    return;
  }
  for (const a of project.audits) {
    const b = a.backfilled ?? { added: 0, changed: 0, removed: 0 };
    const found = b.added + b.changed + b.removed;
    out(`${(a.date ?? "?").padEnd(12)} ${a.mode.padEnd(11)} ${git.shortSha(a.commit).padEnd(8)} ` +
      `v${String(a.version ?? "?").padEnd(3)} ${found} already in place` +
      (a.unconfirmed_reasons ? ` · ${a.unconfirmed_reasons} reason(s) to confirm` : ""));
  }
}

/* ---- audit confirm ----------------------------------------------------- */

/** Confirming an inferred reason: the sentence stands, and someone has now
 *  vouched for it. Rewriting the bullet by hand is the stronger form of the
 *  same act, and clears the flag the same way — delete the `reason_inferred`
 *  line while you're in the file. */
function confirm(flags, rest) {
  const project = openProject(flags);
  const id = rest[0];
  if (!id) fail('usage: ledger audit confirm <id> [--version N]   (`ledger status` lists what is waiting)');

  const feature = project.featureSet.find(id);
  const asked = flags.version !== undefined && flags.version !== true ? Number(flags.version) : null;
  const pending = feature.history.filter((h) => h.reason_inferred);
  if (!pending.length) fail(`${id} has no inferred reason waiting to be confirmed`);

  const targets = asked === null ? pending : pending.filter((h) => h.version === asked);
  if (!targets.length) {
    fail(`${id} has no inferred reason at v${asked} — it has ${pending.map((h) => `v${h.version}`).join(", ")}`);
  }
  for (const h of targets) delete h.reason_inferred;

  if (flags["dry-run"]) {
    out(JSON.stringify(feature.toJSON(), null, 2));
    out("(--dry-run: nothing written)");
    return;
  }
  project.saveFeature(feature);
  out(`confirmed ${id} at ${targets.map((h) => `v${h.version}`).join(", ")}`);
}

/* ---- the brief --------------------------------------------------------- */

function brief(flags) {
  const project = openProject(flags);
  const root = project.root;
  const hasGit = git.available(root);
  const full = Boolean(flags.full);

  const last = project.lastAudit;
  const asked = flags.since && flags.since !== true ? String(flags.since) : null;

  // Three ways to end up sweeping everything: asked for it, never audited
  // before, or git can't give a usable range. Only a full sweep can find a
  // capability the baseline survey missed — an incremental range moves past it
  // permanently — so this is the mode that corrects the beginning.
  let since = null;
  let reason = null;
  if (!hasGit) reason = "this project has no git repository, so there is no range to read";
  else if (git.shallow(root)) reason = "this is a shallow clone, so a range could reach past the graft point";
  else if (asked) {
    since = git.resolve(root, asked);
    if (!since) fail(`no commit ${asked} in this repository`);
  } else if (last?.commit && git.isAncestor(root, last.commit)) since = last.commit;
  else if (last?.commit) reason = `the last audited commit (${git.shortSha(last.commit)}) isn't in this history`;
  else reason = "no audit has been recorded yet, so there is no point to measure from";

  const sweep = full || since === null;
  const head = hasGit ? git.head(root) : null;

  const version = project.workingVersion;
  const previous = project.releases.predecessorOf(version);

  const changed = since ? git.changes(root, since).filter((c) => !git.isLedgerPath(project.config, c.path)) : [];
  const paths = sweep
    ? git.tracked(root).filter((p) => !git.isLedgerPath(project.config, p))
    : changed.map((c) => c.path);
  const batches = git.cluster(paths);
  const subjects = since ? git.commits(root, since) : [];
  const renamed = changed.filter((c) => c.status === "renamed");
  const deleted = changed.filter((c) => c.status === "deleted");

  /* ---- the part for the human ---- */
  out(`ledger audit — ${sweep ? "full sweep" : "incremental"}`);
  out("");
  if (sweep) {
    out(`Every tracked file in ${project.root}${reason && !full ? `, because ${reason}` : ""}.`);
    out("A full sweep is the only mode that can find a capability the baseline survey missed,");
    out("so it is worth running at a major release even once incrementals are routine.");
  } else {
    out(`Everything that has landed since ${git.shortSha(since)}${last?.date ? ` (${longDate(last.date)})` : ""}: ` +
      `${subjects.length} commit${subjects.length === 1 ? "" : "s"}, ${paths.length} file${paths.length === 1 ? "" : "s"}.`);
  }
  out(`${batches.length} batch${batches.length === 1 ? "" : "es"} for the agent to work through.`);
  out("");
  out("The prompt itself is everything under the rule below. Copy it whole, from");
  out("there to the end of this output, into a fresh agent session in the project");
  out("root. It runs start to finish without asking you anything, records what it");
  out("finds, stamps the audited commit, and ends by listing the reasons it had to");
  out("take from commit messages for you to confirm.");
  out("");
  out(COPY_RULE);
  out("");

  /* ---- the part for the agent ---- */
  const lines = [];
  const p = (s = "") => lines.push(s);

  p(`Audit the feature ledger of ${project.config.product} against its own codebase.`);
  p("");
  p("The ledger is a client-facing record of what this product does. It stays current");
  p("only for work done through a coding agent that read the project's agent");
  p("instructions — so anything shipped without one is missing from it entirely. That");
  p("is what you are looking for.");
  p("");
  p(sweep
    ? `Mode: FULL SWEEP. Every tracked file in the project (${paths.length}).`
    : `Mode: INCREMENTAL. Everything between ${git.shortSha(since)} and ${git.shortSha(head)} ` +
      `(${subjects.length} commits, ${paths.length} files).`);
  p("");
  p("Before your first write, run `ledger rules` and `ledger style`. Every entry you");
  p("write has to clear the same bar and be in the same voice as the ones already");
  p("there: one entry is one capability someone using the product would name.");
  p("Guardrails, defaults, plumbing and polish go inside the capability they belong");
  p("to, or in as `dev`, or as `ledger other-change` — never as an entry of their own.");
  p("Never read or edit the JSON under .ledger/; use `ledger list` and `ledger show`.");
  p("");
  p("Give the same care to the names. Most readers go down the contents list and");
  p("stop there, so a name has to state the capability on its own — a short noun");
  p("phrase, or the action someone takes, in the words the people who use the");
  p("product use for their own work. Not a caption, not a comment on the thing, not");
  p("the mechanism. `ledger rules` has the test and the worked examples.");
  p("");
  p("## The one judgement specific to an audit");
  p("");
  p(previous
    ? `For each finding, decide one thing: did it happen during the open release (v${version}), ` +
      `or before the last cutoff (v${previous.version}, ${longDate(previous.date)})?`
    : `This ledger has no cut release yet, so everything belongs to v${version} as ordinary work ` +
      "and nothing needs --backfilled.");
  p("");
  if (previous) {
    p(`  During v${version}          → record it as you normally would:`);
    p("                        `ledger add` / `update` / `remove`.");
    p("");
    p("  Before the cutoff   → the same command, plus `--backfilled`.");
    p("");
    p("`--backfilled` hides nothing and does not change which release the entry lands");
    p("on — new in a client edition means new to the reader, and this is the first");
    p("document to mention it. What it changes is how the edition draws it: green means");
    p("built this cycle, blue means reworked this cycle, and grey means this was already");
    p("in the product and is only now on the record. A capability that has been there");
    p("for two years must not print as this release's news.");
    p("");
    p("Never guess which release something shipped in. The question is only");
    p("before-or-after the last cutoff, and the commit dates answer it.");
    p("");
  }
  p("## Reasons");
  p("");
  p("`ledger update` refuses a change with no `changes` bullet, and that rule holds");
  p("here. Take the reason from the commit message or pull-request title that made the");
  p("change, and pass `--reason-inferred` with it, so the ledger knows the reason came");
  p("from you reading a commit rather than from the person who decided it.");
  p("");
  p("Never write a plausible-sounding reason you found no evidence for. Where a commit");
  p("message says nothing usable, still record the change, still pass");
  p("`--reason-inferred`, and say in the bullet that the reason is not recorded. An");
  p("honest gap is worth more than a confident invention.");
  p("");
  p("## Findings that are not entries");
  p("");
  p("A capability that was added AND removed since the last audit was in no edition");
  p("and belongs in none: write nothing at all for it. A capability the ledger has but");
  p("the code no longer does is a `ledger remove --reason \"…\"` — the client should");
  p("learn that something is gone, even if it went a while ago (add `--backfilled`).");
  p("");
  p("## Batches");
  p("");
  p("Work these in order, one at a time, and do not stop between them.");
  p("");
  batches.forEach((b, i) => {
    p(`${String(i + 1).padStart(3)}. ${b.name}  (${b.files.length} file${b.files.length === 1 ? "" : "s"})`);
    for (const f of b.files.slice(0, 12)) p(`       ${f}`);
    if (b.files.length > 12) p(`       … and ${b.files.length - 12} more`);
  });
  p("");
  if (subjects.length) {
    p("## Commit subjects in the range");
    p("");
    p("Written by the people who made the changes: your best evidence both for whether");
    p("something was a capability and for why it moved.");
    p("");
    for (const c of subjects) p(`  ${c.sha}  ${c.subject}`);
    p("");
  }
  if (renamed.length || deleted.length) {
    p("## Renames and deletions");
    p("");
    p("A capability that was renamed or withdrawn, not one that changed. A rename is");
    p("`ledger update <id> --name \"New name\"` with a bullet saying what it was called and");
    p("why; a withdrawal is `ledger remove <id> --reason \"…\"`.");
    p("");
    for (const c of renamed) p(`  renamed  ${c.from} → ${c.path}`);
    for (const c of deleted) p(`  deleted  ${c.path}`);
    p("");
  }
  p("## When every batch is done");
  p("");
  p("1. Run `ledger status` and check the release reads the way you expect.");
  p(`2. Run \`ledger audit complete${hasGit ? ` --commit ${head}` : ""}${sweep ? " --full" : ""}\``);
  p("   — exactly that commit, not HEAD, and not a newer one. Do this before you ask");
  p("   the human anything, so the audit is recorded even if nobody is at the terminal.");
  p("3. Then print a numbered list of ONLY the findings whose reason you inferred, each");
  p("   as: the feature name, the bullet you wrote, and the commit you took it from.");
  p("   Leave out everything you did not have to infer — the list is for someone to");
  p("   check quickly, so anything already certain is noise in it.");
  p("4. Ask them to confirm or correct each one, and tell them that");
  p("   `ledger audit confirm <id>` accepts a reason as it stands, and that rewriting");
  p("   the bullet by hand in .ledger/features/<id>.json does the same thing — delete");
  p("   the entry's \"reason_inferred\" line once the sentence is theirs. Until then");
  p("   `ledger status` and `ledger release cut` both keep reporting them as unconfirmed.");

  out(lines.join("\n"));
}
