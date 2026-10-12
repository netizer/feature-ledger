import { openProject } from "../store.mjs";
import { fail, today, longDate, COPY_BLOCK } from "../util.mjs";
import fs from "node:fs";
import path from "node:path";
import * as git from "../git.mjs";
import { ownership, deadGlobs } from "../paths.mjs";
import { openQuestions, settle } from "../questions.mjs";

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
 * does. What the CLI does first is the cheap deterministic half: resolve the
 * range, set aside everything that was recorded, owned or ignored, and hand
 * the agent the rest with its diffs, so it reads changes rather than a list
 * of file names.
 */
export async function cmdAudit({ flags, positional }) {
  const sub = positional[0] ?? "brief";
  if (sub === "brief") return brief(flags);
  if (sub === "complete") return complete(flags);
  if (sub === "log") return log(flags);
  if (sub === "confirm") return confirm(flags, positional.slice(1));
  fail('usage: ledger audit [--full] [--since <sha>] | audit complete [--commit <sha>] | audit log');
}

/* ---- what is unaudited ------------------------------------------------- */

/**
 * What has landed since the last audit that the ledger may not have heard
 * about. Not every commit: each entry's `paths` say which code is whose, so
 * the residue is only
 *
 *   - code that moved under an entry whose record didn't move with it — not
 *     in the same commit, and not anywhere in the open release (for a file
 *     several entries share, any one of them moving accounts for it);
 *   - changed code that no entry owns; and
 *   - globs that no longer match any file, which is a capability whose code
 *     went or moved.
 *
 * A commit that only writes the ledger, the generated docs, or files the
 * config ignores (tests, lockfiles, CI) leaves no residue. A project whose
 * entries have no paths yet owns nothing, so every changed file is residue:
 * the same as a range with no map at all.
 */
export function residue(project, since) {
  const root = project.root;
  const own = ownership(project);
  const open = project.releases.current.future ? project.releases.current.version : null;
  const featuresDir = `${path.relative(root, project.featuresDir).split(path.sep).join("/")}/`;
  const commits = git.commitFiles(root, since);

  const entries = new Map();
  const unowned = new Map();
  for (const c of commits) {
    const recorded = new Set(c.files.filter((f) => f.startsWith(featuresDir)).map((f) => path.basename(f, ".json")));
    for (const file of c.files) {
      if (!own.product(file)) continue;
      const owners = own.owners(file);
      if (!owners.length) {
        // A file that is gone can't be claimed; a capability that went with
        // it shows as an entry whose paths match nothing.
        if (!fs.existsSync(path.join(root, file))) continue;
        if (!unowned.has(file)) unowned.set(file, []);
        unowned.get(file).push(c);
        continue;
      }
      // A file several entries share is accounted for when any of them moved
      // with it: the change was recorded, under the entry it was about.
      if (owners.some((f) => recorded.has(f.id) || (open !== null && f.touchedAt(open)))) continue;
      for (const f of owners) {
        if (!entries.has(f.id)) entries.set(f.id, { feature: f, files: new Set(), commits: [] });
        entries.get(f.id).files.add(file);
        entries.get(f.id).commits.push(c);
      }
    }
  }
  const dead = commits.length ? deadGlobs(project, git.files(root)) : [];
  return {
    commits,
    entries: [...entries.values()].map((e) => ({ ...e, files: [...e.files].sort() })),
    unowned: [...unowned.entries()].map(([file, cs]) => ({ file, commits: cs })).sort((a, b) => a.file.localeCompare(b.file)),
    dead,
  };
}

/**
 * How much of the repository's recent work has never been checked against
 * the record. `ok` when the residue is empty, however many commits landed.
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

  const r = residue(project, last.commit);
  const n = r.commits.length;
  if (!r.entries.length && !r.unowned.length && !r.dead.length) {
    return { ok: true, reason: `${n} commit${n === 1 ? "" : "s"} since the last audit, all of it recorded, owned or ignored` };
  }
  return { ok: false, since: last.commit, date: last.date, head, commits: n, ...r };
}

/** The sentence the gate and `ledger status` both print, so the two can't
 *  drift apart in how they describe the same gap. */
export function unauditedLine(report) {
  const when = report.date ? `, ${longDate(report.date)}` : "";
  const parts = [];
  const n = report.entries.length;
  if (n) {
    const files = report.entries.reduce((k, e) => k + e.files.length, 0);
    parts.push(`${files} file${files === 1 ? "" : "s"} under ${n} entr${n === 1 ? "y" : "ies"} changed without the ` +
      `entr${n === 1 ? "y" : "ies"} moving (${report.entries.slice(0, 4).map((e) => e.feature.id).join(", ")}${n > 4 ? ", …" : ""})`);
  }
  const u = report.unowned.length;
  if (u) parts.push(`${u} changed file${u === 1 ? "" : "s"} no entry owns`);
  const d = report.dead.length;
  if (d) parts.push(`${d} entr${d === 1 ? "y's" : "ies'"} paths match no file`);
  return `since the last audit (${git.shortSha(report.since)}${when}): ${parts.join("; ")}`;
}

/** The same gap as a state rather than a problem, for `ledger status`. Work
 *  landing between audits is the normal condition: the audit is periodic, and
 *  only `ledger cut` needs it done. */
export function unauditedSince(report) {
  const n = report.entries.length + report.unowned.length + report.dead.length;
  return `${report.commits} commit${report.commits === 1 ? "" : "s"} since, ${n} thing${n === 1 ? "" : "s"} for the next sweep to look at`;
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
  const unconfirmed = openQuestions(project).filter((q) => q.kind === "why").length;

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
  out(`recorded ${entry.mode === "incremental" ? "an" : "a"} ${entry.mode} audit${commit ? ` at ${git.shortSha(commit)}` : ""} (${entry.date})`);
  out(total
    ? `  ${counts.added} added, ${counts.changed} changed, ${counts.removed} removed as already in place`
    : "  nothing turned up from before the last cut (anything newer is recorded as this release's work)");
  if (unconfirmed) {
    out(`  ${unconfirmed} inferred reason${unconfirmed === 1 ? "" : "s"} still to confirm — \`ledger questions\` lists them`);
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

/** The old way to vouch for an inferred reason, kept working: it accepts the
 *  open `why` questions on one entry. `ledger questions` is the new home. */
function confirm(flags, rest) {
  const project = openProject(flags);
  const id = rest[0];
  if (!id) fail("usage: ledger audit confirm <id>   (now `ledger questions accept <n>` — `ledger questions` lists them)");
  project.featureSet.find(id);
  const asked = flags.version !== undefined && flags.version !== true ? Number(flags.version) : null;
  const pending = openQuestions(project).filter((q) => q.kind === "why" && q.feature === id && (asked === null || q.version === asked));
  if (!pending.length) fail(`${id} has no reason waiting to be confirmed — \`ledger questions\` lists what's open`);
  if (flags["dry-run"]) {
    out(JSON.stringify(pending, null, 2));
    out("(--dry-run: nothing written)");
    return;
  }
  const touched = new Map();
  for (const q of pending) {
    const f = settle(project, q.id, "accept");
    if (f) touched.set(f.id, f);
  }
  for (const f of touched.values()) project.saveFeature(f);
  project.saveQuestions();
  process.stderr.write("note: `ledger audit confirm` is now `ledger questions accept <n>`; the old form still works.\n");
  out(`confirmed ${pending.length} reason${pending.length === 1 ? "" : "s"} on ${id}`);
}

/* ---- the brief --------------------------------------------------------- */

/** How much diff a brief carries: enough to see each change, not the whole range. */
const DIFF_PER_GROUP = 80;
const DIFF_TOTAL = 1200;

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

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
  const own = ownership(project);

  const r = sweep ? null : residue(project, since);
  const changed = since ? git.changes(root, since).filter((c) => own.product(c.path)) : [];
  const renamed = changed.filter((c) => c.status === "renamed");
  const deleted = changed.filter((c) => c.status === "deleted");
  const sweepFiles = sweep && hasGit ? git.files(root).filter((f) => own.product(f)) : [];
  const residueCount = r ? r.entries.length + r.unowned.length + r.dead.length : 0;

  /* ---- the part for the human ---- */
  out(`ledger audit — ${sweep ? "full sweep" : "incremental"}`);
  out("");
  if (sweep) {
    out(`Every tracked file in ${project.root}${reason && !full ? `, because ${reason}` : ""}.`);
    out("A full sweep is the only mode that can find a capability the baseline survey missed,");
    out("so it is worth running at a major release even once incrementals are routine.");
  } else {
    out(`Everything that has landed since ${git.shortSha(since)}${last?.date ? ` (${longDate(last.date)})` : ""}: ` +
      `${plural(r.commits.length, "commit")}. What the ledger may not have heard about:`);
    out(`  ${plural(r.entries.length, "entry", "entries")} whose code moved without the record, ` +
      `${plural(r.unowned.length, "changed file")} no entry owns, ${plural(r.dead.length, "entry", "entries")} whose paths match nothing.`);
  }
  out("");
  out("The prompt itself is everything under the rule below. Copy it whole, from");
  out("there to the end of this output, into a fresh agent session in the project");
  out("root. It runs start to finish without asking you anything, records what it");
  out("finds, stamps the audited commit, and leaves every reason it had to read off a");
  out("commit as a question for you (`ledger questions`).");
  out("");
  out(COPY_BLOCK);
  out("");

  /* ---- the part for the agent ---- */
  const lines = [];
  const p = (s = "") => lines.push(s);

  p(`Audit the feature ledger of ${project.config.product} against its own codebase.`);
  p("");
  p("The ledger is a client-facing record of what this product does, one entry per");
  p("capability, each with the globs its code lives in (`paths`). It stays current only");
  p("for work done through a coding agent that read the project's instructions, so");
  p("anything shipped without one is missing from it. That is what you are looking for.");
  p("");
  p(sweep
    ? `Mode: FULL SWEEP. Every tracked product file (${sweepFiles.length}).`
    : `Mode: INCREMENTAL. ${git.shortSha(since)}..${git.shortSha(head)}, ${plural(r.commits.length, "commit")}. The CLI has ` +
      "already set aside everything that was recorded, owned or ignored; what follows is only the rest.");
  p("");
  p("Before your first write, run `ledger style` once for the voice.");
  p("");
  p("## The bar");
  p("");
  p("One entry is one capability someone using the product would name: something they");
  p("could ask for, or would miss if it went away. Could you demo it, and would the demo");
  p("look different from the entry next to it? Guardrails, defaults, plumbing and polish");
  p("go inside the capability they belong to, or in as `dev`, or as `ledger note`, never");
  p("as an entry of their own. A name is a short noun phrase or the action someone takes,");
  p("in the users' own words: not a caption, not a comment, not the mechanism.");
  p("");
  p("Read entries with `ledger show <id>`. Never read or edit the JSON under .ledger/.");
  p("");
  p("## Recording what you find");
  p("");
  p("```");
  p("ledger change <id> --why-from commit <<'JSON'");
  p('{ "what": "What changed, in a sentence.", "why": "Why, from the commit.", "description": "The whole current state, if it moved." }');
  p("JSON");
  p("```");
  p("");
  p("- A reason read off a commit message takes `--why-from commit`. Where the commit");
  p("  says nothing usable, `--why-unknown`. Either leaves a question for the human.");
  p("  Never write a plausible-sounding reason you found no evidence for.");
  p("- A new capability: `ledger add <id>` with `paths`. A capability the code no longer");
  p("  has: `ledger remove <id> --why \"…\"`; the client should learn it went.");
  p("- Code that belongs to an entry: `ledger own <id> '<glob>'`. Code that isn't product");
  p("  at all (tests, fixtures, tooling): `ledger own --ignore '<glob>'`.");
  p("- Not every change is news. A refactor, a fix nobody would notice, a tidy: record");
  p("  nothing, and claim the files if no entry owns them.");
  p("");
  if (previous) {
    p(`## Before or after v${previous.version}?`);
    p("");
    p(`Work that landed during the open release (v${version}) is recorded as usual. Work from`);
    p(`before the last cut (v${previous.version}, ${longDate(previous.date)}) takes \`--backfilled\` on the same`);
    p("command, so the edition draws it grey: already in the product, only now on the");
    p("record. The commit dates answer the question; never guess which release it was.");
    p("");
  } else {
    p(`This ledger has no cut release yet, so everything belongs to v${version} as ordinary work.`);
    p("");
  }
  p("A capability that was added AND removed since the last audit was in no edition:");
  p("write nothing for it.");
  p("");

  let budget = DIFF_TOTAL;
  const withDiff = (files) => {
    if (!since || budget <= 0) return [];
    const text = git.diffText(root, since, files, { limit: Math.min(DIFF_PER_GROUP, budget) });
    if (!text) return [];
    budget -= text.split("\n").length;
    return ["```diff", text, "```"];
  };
  const commitList = (commits) => [...new Map(commits.map((c) => [c.sha, c])).values()]
    .map((c) => `  ${c.short}  ${c.date}  ${c.subject}`);

  if (!sweep) {
    if (r.entries.length) {
      p("## Code that moved while its entry didn't");
      p("");
      p("Each of these entries owns files that changed in commits that didn't touch the");
      p("entry. Read the diff: if someone using the product would notice the difference,");
      p("record it with `ledger change`. If not, there is nothing to do.");
      p("");
      for (const e of r.entries) {
        const s = e.feature.stateAt(version);
        p(`### ${e.feature.id} — ${e.feature.currentName}`);
        p("");
        p(`Now: ${s && !s.removed ? s.description : "(removed)"}`);
        p("");
        for (const l of commitList(e.commits)) p(l);
        for (const f of e.files) p(`  ${f}`);
        for (const l of withDiff(e.files)) p(l);
        p("");
      }
    }
    if (r.unowned.length) {
      p("## Changed files no entry owns");
      p("");
      p("For each group: claim it for the entry it belongs to (`ledger own`), record it as");
      p("a capability the ledger is missing (`ledger add` with `paths`), or mark it as not");
      p("product code (`ledger own --ignore`). Every file ends up one of the three.");
      p("");
      for (const b of git.cluster(r.unowned.map((u) => u.file))) {
        const commits = r.unowned.filter((u) => b.files.includes(u.file)).flatMap((u) => u.commits);
        p(`### ${b.name}  (${plural(b.files.length, "file")})`);
        p("");
        for (const l of commitList(commits)) p(l);
        for (const f of b.files.slice(0, 20)) p(`  ${f}`);
        if (b.files.length > 20) p(`  … and ${b.files.length - 20} more`);
        for (const l of withDiff(b.files)) p(l);
        p("");
      }
    }
    if (r.dead.length) {
      p("## Entries whose paths match no file");
      p("");
      p("The code went, or moved. If the capability is gone: `ledger remove <id> --why \"…\"`.");
      p("If it moved: `ledger own <id> '<new glob>'`, then `ledger own <id> '<old glob>' --remove`.");
      p("");
      for (const d of r.dead) p(`  ${d.feature.id.padEnd(32)} ${d.globs.join(", ")}`);
      p("");
    }
    if (renamed.length || deleted.length) {
      p("## Renames and deletions in the range");
      p("");
      for (const c of renamed) p(`  renamed  ${c.from} → ${c.path}`);
      for (const c of deleted) p(`  deleted  ${c.path}`);
      p("");
    }
    if (budget <= 0) {
      p(`(The diffs above stop at ${DIFF_TOTAL} lines; \`git diff ${git.shortSha(since)}..HEAD -- <file>\` reads the rest.)`);
      p("");
    }
    if (!residueCount) {
      p("## Nothing to look at");
      p("");
      p("Everything in the range was recorded, owned or ignored. Stamp the audit.");
      p("");
    }
  } else {
    p("## The sweep");
    p("");
    p("Work these batches in order, one at a time, without stopping between them. For");
    p("each, read the code, check every capability in it has an entry, and make sure each");
    p("file is owned (`ledger own`) or ignored (`ledger own --ignore`). `ledger paths`");
    p("shows who owns what.");
    p("");
    for (const [i, b] of git.cluster(sweepFiles).entries()) {
      const owners = [...new Set(b.files.flatMap((f) => own.owners(f).map((o) => o.id)))];
      const unownedHere = b.files.filter((f) => !own.owners(f).length).length;
      p(`${String(i + 1).padStart(3)}. ${b.name}  (${plural(b.files.length, "file")}${unownedHere ? `, ${unownedHere} unowned` : ""})` +
        (owners.length ? `  owned by ${owners.slice(0, 6).join(", ")}${owners.length > 6 ? ", …" : ""}` : ""));
      for (const f of b.files.slice(0, 12)) p(`       ${f}`);
      if (b.files.length > 12) p(`       … and ${b.files.length - 12} more`);
    }
    p("");
  }
  p("## When you're done");
  p("");
  p("1. Run `ledger status` and fix what it reports.");
  p(`2. Run \`ledger audit complete${hasGit ? ` --commit ${head}` : ""}${sweep ? " --full" : ""}\``);
  p("   — exactly that commit, not HEAD, and not a newer one.");
  p("3. Then say, in a few lines, what you recorded, and what you claimed or ignored.");
  p("   The reasons you read off commits are already questions in `ledger questions`;");
  p("   don't repeat them.");

  out(lines.join("\n"));
}
