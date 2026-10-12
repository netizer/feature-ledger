import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * The little git the audit and the size readout need, and the only place in
 * this package that shells out.
 *
 * The audit exists because the agent stanza only keeps the ledger current for
 * work done through a coding agent, and nothing keeps it current for the rest.
 * The signal it reads is a commit range: what has landed since the last time
 * anyone checked the codebase against the record. Each entry's `paths` (see
 * src/paths.mjs) narrow that range to what matters: code that moved under an
 * entry whose record didn't, and code no entry owns. The range still carries
 * the case that motivates the feature, the developer who never knew the
 * ledger existed, because a file nobody has claimed is always reported.
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

/** Paths under `dir` with uncommitted changes, tracked or not. Empty outside
 *  a repository, where there is nothing to have committed. */
export function uncommitted(root, dir) {
  const out = git(root, ["status", "--porcelain", "--untracked-files=all", "--", dir]);
  return out === null ? [] : out.split("\n").filter(Boolean).map((l) => l.slice(3));
}

/** Every tracked path, for a full sweep. */
export function tracked(root) {
  const out = git(root, ["ls-files"]);
  return out === null ? [] : out.split("\n").filter(Boolean);
}

/** Every file in the working tree git would track: committed or not, so
 *  ownership sees work in progress, and not what .gitignore leaves out. */
export function files(root) {
  const out = git(root, ["ls-files", "--cached", "--others", "--exclude-standard"]);
  if (out === null) return [];
  return [...new Set(out.split("\n").filter(Boolean))].filter((f) => fs.existsSync(path.join(root, f)));
}

/**
 * Paths that say nothing about whether the product moved: the corpus itself,
 * and the documents generated from it. A commit that only writes the ledger is
 * not unaudited product work, and counting it would make the `ledger cut`
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

/**
 * Every commit in the range, oldest first, with the paths it touched. What
 * lets the audit tell code that moved together with its ledger entry from
 * code that moved without it.
 */
export function commitFiles(root, from, to = "HEAD") {
  const out = git(root, ["log", "--no-merges", "--reverse", "--name-only", "--format=%x00%H%x09%h%x09%cs%x09%s", `${from}..${to}`]);
  if (out === null) return [];
  return out.split("\0").filter((b) => b.trim()).map((block) => {
    const [head, ...files] = block.split("\n");
    const [sha, short, date, subject] = head.split("\t");
    return { sha, short, date, subject, files: files.map((f) => f.trim()).filter(Boolean) };
  });
}

/**
 * Lines added and removed per path between `from` and the working tree,
 * uncommitted work included, plus every untracked file counted as added. The
 * size readout measures the release as it stands on disk, which is where work
 * in progress is.
 */
export function churn(root, from) {
  const counts = new Map();
  const out = git(root, ["diff", "--numstat", "-M", from]);
  for (const line of (out ?? "").split("\n").filter(Boolean)) {
    const [add, del, ...rest] = line.split("\t");
    let file = rest.join("\t");
    // A rename prints as `dir/{old => new}/x` or `old => new`.
    const brace = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(file);
    if (brace) file = `${brace[1]}${brace[3]}${brace[4]}`.replace(/\/\//g, "/");
    else if (file.includes(" => ")) file = file.split(" => ")[1];
    counts.set(file, (add === "-" ? 0 : Number(add)) + (del === "-" ? 0 : Number(del)));
  }
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard"]);
  for (const file of (untracked ?? "").split("\n").filter(Boolean)) {
    let n = 0;
    try { n = fs.readFileSync(path.join(root, file), "utf8").split("\n").length; } catch { /* unreadable: count it as touched */ }
    counts.set(file, n);
  }
  return counts;
}

/**
 * The diff of some files over a range, cut to `limit` lines, so an agent sees
 * the change itself rather than its file name. The cut is said in the text,
 * so a reader knows there is more.
 */
export function diffText(root, from, files, { limit = 120, to = "HEAD" } = {}) {
  if (!files.length) return "";
  const out = git(root, ["diff", "-U2", "--no-color", "-M", `${from}..${to}`, "--", ...files]) ?? "";
  const lines = out.split("\n");
  if (lines.length <= limit) return out.trimEnd();
  return `${lines.slice(0, limit).join("\n")}\n… ${lines.length - limit} more lines (\`git diff ${shortSha(from)}..${to === "HEAD" ? "HEAD" : shortSha(to)} -- <file>\`)`;
}
