import { isLedgerPath } from "./git.mjs";

/**
 * Which code each entry lives in, and which code belongs to none.
 *
 * Every user-facing entry carries `paths`: globs over the repository naming
 * the files that make the capability work. It is what turns "what the ledger
 * says" into something that can be checked against the code: an audit can say
 * which entry a changed file belongs to, a preview can say how much code moved
 * under each entry, and a glob that matches nothing any more is a capability
 * whose code is gone.
 *
 * Files that say nothing about what the product does (tests, lockfiles, CI)
 * are listed once, in `ignore` in config.json, so they never read as code that
 * no entry owns.
 *
 * Globs are the small portable subset: `**` for any number of directories, `*`
 * within one path segment, `?` for one character. A pattern with none of them
 * that names a directory covers everything under it, so `src/render` and
 * `src/render/**` mean the same thing.
 */

/** What a fresh ledger ignores: tests, lockfiles, CI and repository plumbing,
 *  and the instruction files coding agents read. */
export const DEFAULT_IGNORE = [
  "test/**", "tests/**", "spec/**", "**/__tests__/**", "**/*.test.*", "**/*.spec.*", "**/*_test.*",
  ".github/**", ".gitignore", ".gitattributes", ".editorconfig", "LICENSE*",
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "Gemfile.lock", "poetry.lock", "Cargo.lock", "go.sum",
  "README*", "CHANGELOG*", "CLAUDE.md", "AGENTS.md", "GEMINI.md", ".cursor/**", ".windsurfrules", ".claude/**",
];

const cache = new Map();

/** A glob as a RegExp over a whole repository-relative path. */
export function globRegExp(glob) {
  if (cache.has(glob)) return cache.get(glob);
  let g = String(glob).trim().replace(/^\.\//, "");
  // A plain path names a file, or a directory and everything under it.
  if (!/[*?]/.test(g)) g = `${g.replace(/\/+$/, "")}{,/**}`;
  else if (g.endsWith("/")) g = `${g}**`;
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*" && g[i + 1] === "*") {
      // `**/` matches no directory at all as well as several.
      if (g[i + 2] === "/") { re += "(?:.*/)?"; i += 2; } else { re += ".*"; i += 1; }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (g.startsWith("{,/**}", i)) { re += "(?:/.*)?"; i += 5; }
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  const compiled = new RegExp(`^${re}$`);
  cache.set(glob, compiled);
  return compiled;
}

export function matches(globs, file) {
  return (globs ?? []).some((g) => globRegExp(g).test(file));
}

/**
 * Everything ownership answers about a set of files, worked out once.
 * `owners(file)` is every entry whose paths cover it (a shared module can
 * belong to several), `ignored(file)` is whether config.json says it isn't
 * product code, and `product(file)` is whether it counts at all: not the
 * ledger's own files, the generated docs, or anything ignored.
 */
export function ownership(project) {
  const features = project.featureSet.features().filter((f) => !f.stateAt(project.releases.latestVersion)?.removed);
  const ignore = project.config.ignore ?? [];
  const owned = features.filter((f) => f.paths.length);
  return {
    features: owned,
    ignored: (file) => matches(ignore, file),
    product: (file) => !isLedgerPath(project.config, file) && !matches(ignore, file),
    owners: (file) => owned.filter((f) => matches(f.paths, file)),
  };
}

/** Each entry's globs that match no tracked file: code that moved or went. */
export function deadGlobs(project, tracked) {
  const out = [];
  for (const f of project.featureSet.features()) {
    if (f.stateAt(project.releases.latestVersion)?.removed) continue;
    const dead = f.paths.filter((g) => !tracked.some((file) => globRegExp(g).test(file)));
    if (dead.length) out.push({ feature: f, globs: dead });
  }
  return out;
}
