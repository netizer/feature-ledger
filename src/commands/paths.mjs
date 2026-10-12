import { openProject } from "../store.mjs";
import { fail, COPY_BLOCK } from "../util.mjs";
import { ownership, deadGlobs, globRegExp } from "../paths.mjs";
import * as git from "../git.mjs";

const out = (s) => process.stdout.write(`${s}\n`);

/**
 * `ledger paths`: which code each entry lives in, and which code belongs to
 * none. `ledger paths brief` prints a prompt for an agent to settle it: every
 * product file owned by the entry it belongs to, or ignored as not product at
 * all. `ledger migrate --run` hands it over straight after a migration.
 */
export async function cmdPaths({ flags, positional }) {
  const sub = positional[0] ?? "list";
  if (sub === "list") return list(flags);
  if (sub === "brief") return brief(flags);
  fail("usage: ledger paths [--unowned] [--json] | paths brief");
}

/** Every tracked product file, split into owned and not, for the report and the task check. */
export function coverage(project) {
  if (!git.available(project.root)) return null;
  const own = ownership(project);
  const tracked = git.files(project.root);
  const product = tracked.filter((f) => own.product(f));
  const unowned = product.filter((f) => !own.owners(f).length);
  return { own, tracked, product, unowned, ignored: tracked.filter((f) => own.ignored(f)).length, dead: deadGlobs(project, tracked) };
}

function list(flags) {
  const project = openProject(flags);
  const cov = coverage(project);
  if (!cov) fail("ownership is worked out against the files git tracks, and this project has no git repository");
  const user = project.featureSet.features().filter((f) => !f.stateAt(project.releases.latestVersion)?.removed);
  const count = (g) => cov.tracked.filter((f) => globRegExp(g).test(f)).length;

  if (flags.json) {
    out(JSON.stringify({
      entries: Object.fromEntries(user.map((f) => [f.id, f.paths.map((g) => ({ glob: g, files: count(g) }))])),
      unowned: cov.unowned,
      ignore: project.config.ignore,
    }, null, 2));
    return;
  }
  if (flags.unowned) {
    for (const f of cov.unowned) out(f);
    return;
  }
  for (const f of user) {
    const globs = f.paths.length ? f.paths.map((g) => `${g} (${count(g)})`).join(", ") : "—";
    out(`  ${f.id.padEnd(32)} ${globs}`);
  }
  out("");
  out(`${cov.product.length} product files: ${cov.product.length - cov.unowned.length} owned, ${cov.unowned.length} owned by no entry` +
    ` · ${cov.ignored} ignored (\`ignore\` in config.json)`);
  if (cov.unowned.length) {
    for (const b of git.cluster(cov.unowned).slice(0, 8)) out(`  unowned  ${b.name}  (${b.files.length})`);
    out("`ledger paths --unowned` lists them; `ledger own <id> '<glob>'` or `ledger own --ignore '<glob>'` settles one.");
  }
  for (const d of cov.dead) out(`! ${d.feature.id}: ${d.globs.join(", ")} match${d.globs.length === 1 ? "es" : ""} no file`);
}

function brief(flags) {
  const project = openProject(flags);
  const cov = coverage(project);
  if (!cov) fail("ownership is worked out against the files git tracks, and this project has no git repository");
  const version = project.releases.latestVersion;
  const entries = project.featureSet.features().filter((f) => !f.stateAt(version)?.removed);
  const count = (g) => cov.tracked.filter((f) => globRegExp(g).test(f)).length;

  out(`ledger paths brief — which code each of ${entries.length} entries lives in`);
  out("");
  out(`${cov.product.length} product files, ${cov.unowned.length} owned by no entry.`);
  out("The prompt reads the code and gives every entry the globs its capability lives in,");
  out("and marks what isn't product code as ignored. It records nothing against the");
  out("release: where code lives isn't news.");
  out("");
  out(COPY_BLOCK);
  out("");

  const lines = [];
  const p = (s = "") => lines.push(s);
  p(`Say which code each entry in the feature ledger of ${project.config.product} lives in.`);
  p("");
  p("The ledger is a client-facing record of what this product does, one entry per");
  p("capability. Each entry carries `paths`: globs over the repository naming the files");
  p("that make it work. An audit uses them to tell code that moved without its record,");
  p("and a preview to say how much code moved under each entry, so they should be right");
  p("and complete, not exhaustive lists of files.");
  p("");
  p("- `ledger own <id> '<glob>'` adds a glob to an entry; `--remove` takes one off.");
  p("  Prefer a directory or a pattern (`src/billing/**`) to a list of files.");
  p("- A module several capabilities share can belong to several entries.");
  p("- `ledger own --ignore '<glob>'` marks files that say nothing about what the");
  p("  product does: tests, fixtures, build and release tooling, internal docs.");
  p("- Every product file ends up owned or ignored. A file that does something no entry");
  p("  describes is a capability the ledger is missing: say so in your report, don't add it.");
  p("- Don't change any entry's words, and don't record anything with `ledger change`.");
  p("");
  p("## The entries");
  p("");
  for (const f of entries) {
    const s = f.stateAt(version);
    p(`${f.id}  —  ${s.name}  (${f.audience})`);
    p(`  ${s.description.split(/(?<=[.!?])\s+/)[0]}`);
    p(`  paths: ${f.paths.length ? f.paths.map((g) => `${g} (${count(g)} files)`).join(", ") : "none yet"}`);
    p("");
  }
  if (cov.unowned.length) {
    p("## Owned by no entry");
    p("");
    for (const b of git.cluster(cov.unowned)) {
      p(`${b.name}  (${b.files.length})`);
      for (const f of b.files.slice(0, 15)) p(`  ${f}`);
      if (b.files.length > 15) p(`  … and ${b.files.length - 15} more`);
    }
    p("");
  }
  if (cov.dead.length) {
    p("## Globs that match no file");
    p("");
    for (const d of cov.dead) p(`  ${d.feature.id}: ${d.globs.join(", ")}`);
    p("");
  }
  p(`Ignored now: ${(project.config.ignore ?? []).join(", ") || "nothing"}`);
  p("");
  p("## When you're done");
  p("");
  p("1. Run `ledger paths`. It should show no file owned by no entry, and no glob that");
  p("   matches nothing.");
  p("2. Then a short report: any capability you found no entry for, and any entry whose");
  p("   code you couldn't find.");
  out(lines.join("\n"));
}
