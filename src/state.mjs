import * as git from "./git.mjs";
import { today } from "./util.mjs";

/**
 * `.ledger/state.json`: how far the agent tasks have got, so that the next
 * one starts where the last stopped and `ledger agent` can tell, without
 * reading a word of the corpus, whether there is anything to do.
 *
 *   styles.entries   per entry, the tone it was last written in, when that
 *                    isn't the project's tone. An entry with no record is in
 *                    the project's tone.
 *   styles.other     the same for the text that belongs to no entry: area
 *                    overviews, sub-sections, product-wide notes, the tagline
 *   sweep            the code last read for work nobody recorded: a commit,
 *                    and each uncommitted file beside it, as it was read
 *   bootstrap        the survey that wrote the corpus, once it finished
 *
 * Every value here is written by the CLI as a task completes, never inferred
 * from the text: a tone guessed off the wording would send the same entries
 * back to be rewritten into the tone they are already in.
 */

/* ---- the tone each entry was written in --------------------------------- */

const styles = (project) => project.state.styles ?? {};

export function entryStyle(project, id) {
  return styles(project).entries?.[id] ?? project.config.style;
}

/** The entries, and whether the rest of the text, are in a tone the project has left. */
export function restyleDue(project) {
  const want = project.config.style;
  const entries = project.featureSet.features().filter((f) => entryStyle(project, f.id) !== want);
  const other = (styles(project).other ?? want) !== want;
  return { style: want, entries, other, due: entries.length > 0 || other };
}

/**
 * Records entries as written in the project's tone now: a new entry, a new
 * description, or a rewrite that finished. Returns whether anything changed,
 * so a project with no record never has one written for it.
 */
export function markStyled(project, ids, { other = false } = {}) {
  const s = project.state.styles;
  if (!s) return false;
  let changed = false;
  for (const id of ids) {
    if (s.entries && id in s.entries) { delete s.entries[id]; changed = true; }
  }
  if (other && "other" in s) { delete s.other; changed = true; }
  prune(project);
  return changed;
}

/**
 * Before the tone changes from `from`: every entry with no record was in
 * `from`, and now says so, as does the rest of the text. Entries recorded in
 * the new tone already need nothing.
 */
export function seedStyles(project, from, to) {
  if (from === to) return;
  const s = project.state.styles ?? { entries: {} };
  s.entries ??= {};
  for (const f of project.featureSet.features()) s.entries[f.id] ??= from;
  s.other ??= from;
  for (const [id, style] of Object.entries(s.entries)) if (style === to) delete s.entries[id];
  if (s.other === to) delete s.other;
  project.state.styles = s;
  prune(project);
}

function prune(project) {
  const s = project.state.styles;
  if (!s) return;
  if (s.entries && !Object.keys(s.entries).length) delete s.entries;
  if (!Object.keys(s).length) delete project.state.styles;
}

/* ---- the survey ------------------------------------------------------------ */

/**
 * Whether the survey that wrote this corpus finished: stamped by
 * `ledger bootstrap complete`. A ledger that has printed an edition since its
 * last fresh start was finished by definition, stamp or not.
 */
export function bootstrapState(project) {
  const pending = project.pendingRedraft;
  const stamp = project.state.bootstrap ?? null;
  const empty = project.featureSet.features().length === 0;
  if (pending) return { empty, done: !empty && stamp?.version === pending.opens, stamp };
  const printed = project.releases.releases.some((r) => r.released);
  return { empty, done: !empty && (printed || Boolean(stamp)), stamp };
}

export function stampBootstrap(project) {
  project.state.bootstrap = { date: today(), commit: headOf(project), version: project.workingVersion };
  stampSweep(project);
}

/* ---- the code read for unrecorded work ------------------------------------ */

/** Code changed by fewer lines than this, outside tests and docs, isn't worth a sweep on its own. */
export const SWEEP_MIN_LINES = 20;

/**
 * Paths whose changes rarely move what someone using the product sees: tests,
 * docs, lockfiles and CI. They still show in the diffstat an agent reads;
 * they just don't count towards whether one is started.
 */
const NOT_PRODUCT = [
  /(^|\/)(test|tests|__tests__|spec|specs|e2e|fixtures?)\//i,
  /\.(test|spec)\.[^/]+$/i,
  /(^|\/)docs?\//i,
  /\.(md|mdx|txt|rst|adoc)$/i,
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|Gemfile\.lock|poetry\.lock|Cargo\.lock|go\.sum|composer\.lock)$/,
  /(^|\/)\.(github|gitlab|circleci)\//,
  /(^|\/)(CHANGELOG|LICENSE)[^/]*$/i,
];

export const isProductPath = (file) => !NOT_PRODUCT.some((re) => re.test(file));

const headOf = (project) => (git.available(project.root) ? git.head(project.root) : null);

/** Records that the code as it stands now has been read: HEAD, and the uncommitted work beside it. */
export function stampSweep(project) {
  if (!git.available(project.root)) return;
  const files = git.worktreeFiles(project);
  project.state.sweep = { date: today(), commit: git.head(project.root), ...(Object.keys(files).length ? { files } : {}) };
}

/**
 * The code nobody has read for unrecorded work yet: everything since the
 * latest of the last sweep, the last prepare, the survey and the last
 * edition's commit, uncommitted work included. Null outside a repository, or
 * when none of those points is in HEAD's history.
 *
 * `significant` counts the lines outside tests, docs and lockfiles, which is
 * what decides whether a sweep is worth starting.
 */
export function codeSince(project) {
  const root = project.root;
  if (!git.available(root)) return null;
  const version = project.releases.current.version;
  const previous = project.releases.predecessorOf(version);
  const prepared = project.compositionOf(version)?.prepared;
  const candidates = [
    project.state.sweep && { ...project.state.sweep, label: "the last sweep" },
    prepared?.commit && { commit: prepared.commit, date: prepared.date, label: "the last prepare" },
    project.state.bootstrap?.commit && { ...project.state.bootstrap, label: "the survey" },
    previous?.commit && { commit: previous.commit, date: previous.date, label: `v${previous.version}'s commit` },
  ].filter((c) => c && git.isAncestor(root, c.commit));
  if (!candidates.length) return null;

  // The latest point: the one every other is an ancestor of. On a tie, the
  // sweep, which knows what the uncommitted work was when it was read.
  const latest = candidates.filter((c) => candidates.every((o) => o.commit === c.commit || git.isAncestor(root, o.commit, c.commit)));
  const from = latest.find((c) => c.files) ?? latest[0] ?? candidates[candidates.length - 1];

  // A file that holds exactly what it held when it was read is nothing new.
  const read = from.files ?? {};
  const skip = (file) => file in read && git.contentHash(root, file) === read[file];
  const rows = [...git.churn(root, from.commit)].filter(([file]) => !git.isLedgerPath(project.config, file) && !skip(file));
  if (!rows.length) return { from, commits: [], files: 0, lines: 0, significant: 0, stat: null, nothing: true };
  const significant = rows.filter(([file]) => isProductPath(file)).reduce((n, [, k]) => n + k, 0);
  const stat = git.diffStat(project, from.commit, { skip });
  return { from, commits: git.subjects(root, from.commit), files: stat.files, lines: stat.lines, significant, stat, nothing: false };
}
