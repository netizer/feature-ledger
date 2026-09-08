import { openProject } from "../store.mjs";
import { fail, isBlank, today, longDate } from "../util.mjs";
import { unauditedReport, unauditedLine, unconfirmedReasons } from "./audit.mjs";
import * as git from "../git.mjs";

const out = (s) => process.stdout.write(`${s}\n`);

export async function cmdRelease({ flags, positional }) {
  const sub = positional[0] ?? "list";
  if (sub === "list") return list(flags);
  if (sub === "cut") return cut(flags);
  if (sub === "amend") return amend(flags, positional.slice(1));
  fail('usage: ledger release [list | cut --name "…" [--date YYYY-MM-DD] | amend <version> --commit <sha>]');
}

function list(flags) {
  const project = openProject(flags);
  for (const r of project.releases.releases) {
    const touched = project.featureSet.features().filter((f) => f.touchedAt(r.version)).length;
    const when = r.future ? "in progress" : longDate(r.date);
    // The commit is what tells two editions cut on one day apart, so it goes
    // in the listing rather than only in the file.
    const at = r.commit ? `  ${git.shortSha(r.commit)}` : "";
    out(`v${String(r.version).padStart(2)}  ${(when ?? "").padEnd(20)}${at.padEnd(10)} ${r.name ?? "(unnamed)"}  · ${touched} entr${touched === 1 ? "y" : "ies"}`);
  }
}

/**
 * Filling in the commit on a release that was cut before commits were
 * recorded — which is every release in every ledger that predates them, this
 * one included. Without this the field could only ever be set going forward,
 * and a timeline would stay half blank for the life of the project.
 *
 * The in-progress release is refused on purpose: it has no commit because it
 * has not happened yet, and `ledger release cut` is what gives it one.
 */
function amend(flags, rest) {
  const project = openProject(flags);
  const version = Number(rest[0]);
  if (!Number.isInteger(version)) fail('usage: ledger release amend <version> --commit <sha>');

  const release = project.releases.at(version);
  if (release.future) {
    fail(
      `v${version} is the release in progress, so it has no commit yet — it gets one when ` +
      "`ledger release cut` turns it into a real moment.",
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

/**
 * Cutting a release is the one moment the timeline moves: the in-progress
 * release gets its real name and date, and a fresh in-progress one opens
 * behind it. Everything else follows mechanically — every New/Changed tag
 * from the cycle just shipped goes quiet in the living docs on its own, and
 * the release that just shipped gets a PDF edition that will never change
 * again. Which is why this is also the moment to regenerate.
 */
function cut(flags) {
  const project = openProject(flags);
  const current = project.releases.current;
  if (!current.future) {
    fail(`v${current.version} is already shipped — there's nothing in progress to cut`);
  }
  if (isBlank(flags.name)) {
    fail('cutting a release needs --name "…" — the moment it stands for ("Client demo", "Sprint 4 handover")');
  }

  const date = flags.date === true || isBlank(flags.date) ? today() : String(flags.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(`--date must be YYYY-MM-DD (got ${date})`);

  const commit = resolveCutCommit(project, flags);

  // Two releases on one day are ordinary — a morning demo and an afternoon one
  // are two real moments — so the date alone was never the thing that
  // identified an edition. What can't happen is a release that is
  // indistinguishable from the one before it: same day, same code. That is a
  // re-issue of an edition already printed, and --force is how you say you
  // meant it.
  const previous = project.releases.predecessorOf(current.version);
  if (previous && !flags.force && previous.date === date && previous.commit && previous.commit === commit) {
    fail(
      `v${previous.version} (${previous.name}) was also cut on ${date} at ${git.shortSha(commit)}, so this ` +
      "release would stand for the same day and the same code — there is nothing to tell the two editions " +
      "apart. Cut it at a later commit, or pass --force if you really are re-issuing the same moment.",
    );
  }

  // Cutting is the moment a client document gets minted, so it is the moment to
  // say how much of the repository has never been checked against the record.
  // It refuses rather than warns — the same shape as the empty-release guard
  // below — but only when there is something real to report: a gate that fires
  // on every cut, because the last commit is always the one you just made, is a
  // gate people learn to --force past without reading.
  //
  // Ahead of the empty-release guard on purpose. When both are true they have
  // one cause — work landed and the ledger never heard about it — and this is
  // the message that names it and says which command fixes it.
  const unaudited = unauditedReport(project);
  if (!unaudited.ok && !flags.force) {
    fail(
      `${unauditedLine(unaudited)}, so this edition may be missing capabilities the client has already been ` +
      "given. Run `ledger audit` to sweep them, or pass --force to cut anyway.",
    );
  }

  const touched = project.featureSet.features().filter((f) => f.touchedAt(current.version)).length;
  const other = project.featureSet.otherChanges({ version: current.version }).length;

  // A release with nothing recorded against it produces an edition identical
  // to the one before, which is nearly always a sign the work went in without
  // the ledger following it — not a deliberate re-issue. --force covers the
  // case where it genuinely is one.
  if (touched === 0 && other === 0 && !flags.force) {
    fail(
      `nothing has been recorded against v${current.version}, so cutting it would produce an edition identical to ` +
      `v${current.version - 1}. Record the release's work first (\`ledger status\` shows what's there), or pass --force ` +
      "if you really are re-issuing an unchanged edition.",
    );
  }

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

  if (flags["dry-run"]) {
    out(JSON.stringify(project.releases.toJSON(), null, 2));
    out("(--dry-run: nothing written)");
    return;
  }

  project.releases.validate();
  project.saveReleases();
  out(`cut v${current.version} — ${current.name} (${date}${commit ? `, ${git.shortSha(commit)}` : ""}), covering ` +
    `${touched} feature entr${touched === 1 ? "y" : "ies"}${other ? ` and ${other} other change${other === 1 ? "" : "s"}` : ""}`);
  out(`v${current.version + 1} is now the in-progress release; new work records against it.`);
  const pending = unconfirmedReasons(project);
  if (pending.length) {
    out(`! ${pending.length} reason${pending.length === 1 ? "" : "s"} in this edition came from an audit reading a ` +
      "commit message and nobody has confirmed them yet: " +
      `${pending.map((x) => x.id).join(", ")}. \`ledger audit confirm <id>\` vouches for one.`);
  }
  out(`Next: \`ledger build\` — this is the moment the client gets a PDF edition for v${current.version}.`);
}
