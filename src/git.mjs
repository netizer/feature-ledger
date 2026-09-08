import { spawnSync } from "node:child_process";

/**
 * The little git the audit needs, and the only place in this package that
 * shells out.
 *
 * The audit exists because the agent stanza only keeps the ledger current for
 * work done through a coding agent, and nothing keeps it current for the rest.
 * The signal it reads is a commit range: what has landed since the last time
 * anyone checked the codebase against the record. That is deliberately not a
 * per-feature map of source paths — a map like that is a second thing to keep
 * true, and a rotted one makes an audit lie more convincingly than no audit at
 * all. A range needs nothing maintained, and it catches the case that actually
 * motivates the feature: the developer who never knew the ledger existed.
 *
 * Every call degrades rather than throwing: a project with no repository, or a
 * shallow clone, still gets a full audit. See `available` and `shallow`.
 */
function git(root, args) {
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (r.error || r.status !== 0) return null;
  return r.stdout;
}

export function available(root) {
  return git(root, ["rev-parse", "--git-dir"]) !== null;
}

/** True for a clone whose history is cut off, where a range can reach past the
 *  graft point and silently audit only part of what it names. */
export function shallow(root) {
  return (git(root, ["rev-parse", "--is-shallow-repository"]) ?? "").trim() === "true";
}

/** The commit an audit run is stamped against. */
export function head(root) {
  const out = git(root, ["rev-parse", "HEAD"]);
  return out ? out.trim() : null;
}

/** A full sha for any revision, or null if git doesn't know it. */
export function resolve(root, rev) {
  const out = git(root, ["rev-parse", "--verify", `${rev}^{commit}`]);
  return out ? out.trim() : null;
}

export function shortSha(sha) {
  return String(sha ?? "").slice(0, 7);
}

/** Whether `sha` is in HEAD's history — what stops `audit complete` from
 *  stamping a commit this repository has never seen. */
export function isAncestor(root, sha, ref = "HEAD") {
  const r = spawnSync("git", ["-C", root, "merge-base", "--is-ancestor", sha, ref], { encoding: "utf8" });
  return !r.error && r.status === 0;
}

export function commitDate(root, sha) {
  const out = git(root, ["show", "-s", "--format=%cs", sha]);
  return out ? out.trim() : null;
}

/** Subject lines over the range, newest first. Human-written intent, which is
 *  the best signal for both "was this a capability?" and the reason behind a
 *  change — and it costs nothing to collect. */
export function commits(root, from, to = "HEAD") {
  const out = git(root, ["log", "--no-merges", "--format=%h%x09%s", `${from}..${to}`]);
  if (out === null) return [];
  return out.split("\n").filter(Boolean).map((line) => {
    const tab = line.indexOf("\t");
    return { sha: line.slice(0, tab), subject: line.slice(tab + 1) };
  });
}

export function countCommits(root, from, to = "HEAD") {
  const out = git(root, ["rev-list", "--count", `${from}..${to}`]);
  return out === null ? 0 : Number(out.trim()) || 0;
}

/**
 * Changed paths over the range, with renames and deletes kept apart — a
 * renamed or deleted path is a capability that was renamed or withdrawn rather
 * than one that changed, and an agent handed a flat list of paths would have
 * to infer that from the diff.
 */
export function changes(root, from, to = "HEAD") {
  const out = git(root, ["diff", "--name-status", "-M", `${from}..${to}`]);
  if (out === null) return [];
  return out.split("\n").filter(Boolean).map((line) => {
    const parts = line.split("\t");
    const code = parts[0][0];
    if (code === "R") return { status: "renamed", path: parts[2], from: parts[1] };
    if (code === "D") return { status: "deleted", path: parts[1] };
    if (code === "A") return { status: "added", path: parts[1] };
    return { status: "modified", path: parts[1] };
  });
}

/** Every tracked path, for a full sweep. */
export function tracked(root) {
  const out = git(root, ["ls-files"]);
  return out === null ? [] : out.split("\n").filter(Boolean);
}

/**
 * Paths that say nothing about whether the product moved: the corpus itself,
 * and the documents generated from it. A commit that only writes the ledger is
 * not unaudited product work, and counting it would make the `release cut`
 * gate fire on the audit's own commit.
 */
export function isLedgerPath(config, p) {
  const dirs = [".ledger/",
    `${String(config.output.dir).replace(/\/+$/, "")}/`,
    `${String(config.output.client_dir).replace(/\/+$/, "")}/`];
  return dirs.some((d) => p === d.slice(0, -1) || p.startsWith(d));
}

/**
 * Changed paths grouped into batches an agent can work one at a time. The whole
 * diff between two audits can be tens of thousands of lines — the same context
 * blowout the corpus has, which `ledger bootstrap` already answers by batching.
 * Two path segments is the unit that lands closest to "one subsystem" across the
 * languages this tool has to work in.
 */
export function cluster(paths, depth = 2) {
  const groups = new Map();
  for (const p of paths) {
    const segs = p.split("/");
    const key = segs.length <= 1 ? "(top level)" : segs.slice(0, Math.min(depth, segs.length - 1)).join("/");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  return [...groups.entries()]
    .map(([name, files]) => ({ name, files: files.sort() }))
    .sort((a, b) => b.files.length - a.files.length || a.name.localeCompare(b.name));
}
