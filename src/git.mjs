import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * The little git the ledger needs, and the only place in this package that
 * shells out: the commit each release is cut at, how much code moved since
 * the last one, and the overview `ledger prepare` hands an agent so it can
 * find work nobody recorded.
 *
 * Every call degrades rather than throwing: a project with no repository
 * still records, prepares and cuts, with nothing said about commits.
 */
function git(root, args) {
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (r.error || r.status !== 0) return null;
  return r.stdout;
}

export function available(root) {
  return git(root, ["rev-parse", "--git-dir"]) !== null;
}

/** The commit HEAD is at. */
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

/** Whether `sha` is in HEAD's history — what stops a cut or an amend from
 *  naming a commit this repository has never seen. */
export function isAncestor(root, sha, ref = "HEAD") {
  const r = spawnSync("git", ["-C", root, "merge-base", "--is-ancestor", sha, ref], { encoding: "utf8" });
  return !r.error && r.status === 0;
}

/** Paths under `dir` with uncommitted changes, tracked or not. Empty outside
 *  a repository, where there is nothing to have committed. */
export function uncommitted(root, dir = ".") {
  const out = git(root, ["status", "--porcelain", "--untracked-files=all", "--", dir]);
  return out === null ? [] : out.split("\n").filter(Boolean).map((l) => l.slice(3));
}

/** Subject lines over the range, oldest first: what `prepare` shows beside the diffstat. */
export function subjects(root, from, to = "HEAD") {
  const out = git(root, ["log", "--no-merges", "--reverse", "--format=%h %cs %s", `${from}..${to}`]);
  return out === null ? [] : out.split("\n").filter(Boolean);
}

/**
 * Paths that say nothing about whether the product moved: the corpus itself,
 * and the documents generated from it.
 */
export function isLedgerPath(config, p) {
  const dirs = [".ledger/",
    `${String(config.output.dir).replace(/\/+$/, "")}/`,
    `${String(config.output.client_dir).replace(/\/+$/, "")}/`];
  return dirs.some((d) => p === d.slice(0, -1) || p.startsWith(d));
}

/**
 * Lines added and removed per path between `from` and the working tree,
 * uncommitted work included, plus every untracked file counted as added. The
 * release is measured as it stands on disk, which is where work in progress is.
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
 * The code since `from` as a diffstat, working tree included: one line per
 * file, biggest first, with untracked files marked. An overview for an agent
 * to read the code from, not the code itself, which it reads as it needs.
 */
export function diffStat(project, from, { limit = 120, skip = () => false } = {}) {
  const rows = [...churn(project.root, from)]
    .filter(([file]) => !isLedgerPath(project.config, file) && !skip(file))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const untracked = new Set((git(project.root, ["ls-files", "--others", "--exclude-standard"]) ?? "").split("\n").filter(Boolean));
  const width = Math.min(60, Math.max(0, ...rows.map(([f]) => f.length)));
  const shown = rows.slice(0, limit).map(([file, n]) => `  ${file.padEnd(width)}  ${String(n).padStart(5)}${untracked.has(file) ? "  (new, uncommitted)" : ""}`);
  if (rows.length > limit) shown.push(`  … and ${rows.length - limit} more files`);
  return { files: rows.length, lines: rows.reduce((n, [, k]) => n + k, 0), text: shown.join("\n") };
}

/**
 * The uncommitted work outside the ledger, file by file: each changed or
 * untracked path, with a hash of what is on disk now ("deleted" when it is
 * gone). Recorded when the code is read for unrecorded work, so a file that
 * still holds exactly what was read is known to be nothing new, however
 * often it is looked at again, and a file edited since is.
 */
export function worktreeFiles(project) {
  const files = {};
  for (const line of uncommitted(project.root)) {
    const file = line.split(" -> ").pop().replace(/^"(.*)"$/, "$1");
    if (isLedgerPath(project.config, file)) continue;
    files[file] = contentHash(project.root, file);
  }
  return files;
}

export function contentHash(root, file) {
  try {
    return crypto.createHash("sha1").update(fs.readFileSync(path.join(root, file))).digest("hex");
  } catch {
    return "deleted";
  }
}
