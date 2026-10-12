import { longDate } from "./util.mjs";
import { prepareReport } from "./compose.mjs";
import * as git from "./git.mjs";

/**
 * What the open release holds, worked out from the corpus and git alone: no
 * agent, nothing to pay for. `ledger preview` opens with it.
 *
 * Deliberately small: what the client will read as new, updated and removed,
 * how many changes were recorded and how many of them `ledger prepare` hasn't
 * read yet, and how much code moved since the last edition's commit. Nothing
 * ties the code to entries — commits run across features, and a map from one
 * to the other is a second record to keep true.
 */

/** How the release draws an entry: "new", "updated", "in place", "removed" or "gone". */
export function kindOf(feature, version) {
  const h = feature.entryAt(version);
  if (!h) return null;
  if (h.removed) return h.backfilled ? "gone" : "removed";
  if (h.backfilled) return "in place";
  return feature.firstVersion === version ? "new" : "updated";
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const thousands = (n) => n.toLocaleString("en-US");

function bySize(list) {
  const counts = ["Big", "Medium", "Small"].map((s) => [s, list.filter((f) => f.size === s).length]).filter(([, n]) => n);
  return counts.map(([s, n]) => (list.length === 1 ? s : `${n} ${s}`)).join(" · ");
}

/** Lines changed since `from`, working tree included, leaving out the ledger and the documents it prints. */
export function linesSince(project, from) {
  if (!from || !git.available(project.root)) return null;
  let total = 0;
  for (const [file, lines] of git.churn(project.root, from)) {
    if (!git.isLedgerPath(project.config, file)) total += lines;
  }
  return total;
}

/** The size of the open release, in a few lines a person can take in at a glance. */
export function readout(project) {
  const version = project.releases.current.version;
  const previous = project.releases.predecessorOf(version);
  const lines = [];
  lines.push(previous
    ? `v${version} so far, against v${previous.version}${previous.date ? ` (${longDate(previous.date)})` : ""}:`
    : `v${version} so far, a first edition:`);

  const user = project.featureSet.features({ audience: "user" }).filter((f) => f.entryAt(version));
  const of = (...kinds) => user.filter((f) => kinds.includes(kindOf(f, version)));
  const report = prepareReport(project, version);
  const tail = report.nothing ? "" : report.never
    ? `${plural(report.recorded, "change")} recorded, none prepared yet`
    : `${plural(report.recorded, "change")} recorded, ${report.since} since the last prepare`;

  const rows = [["new", of("new")], ["updated", of("updated")], ["in place", of("in place")], ["removed", of("removed", "gone")]]
    .filter(([, list]) => list.length);
  const notes = project.featureSet.otherChanges({ version, audience: "user" }).length;
  if (notes) rows.push(["notes", { length: notes }]);
  // The count of changes sits beside the updated entries, where most of them are.
  const at = Math.max(0, rows.findIndex(([label]) => label === "updated"));
  rows.forEach(([label, list], i) => {
    const left = `  ${label.padEnd(9)} ${String(list.length).padStart(3)}   ${label === "notes" ? "product-wide" : bySize(list)}`;
    lines.push(i === at && tail ? `${left.padEnd(46)}${tail}` : left);
  });
  if (!rows.length) lines.push("  nothing client-facing recorded yet");
  const team = project.featureSet.features({ audience: "dev" }).filter((f) => f.entryAt(version)).length;
  if (team) lines.push(`  ${"team".padEnd(9)} ${String(team).padStart(3)}   team-only, not in the client edition`);

  if (previous) {
    const moved = linesSince(project, previous.commit);
    lines.push(`  ${"code".padEnd(9)}       ${moved !== null
      ? `${thousands(moved)} line${moved === 1 ? "" : "s"} changed since v${previous.version}'s commit, working tree included`
      : previous.commit ? "no git repository" : `v${previous.version} has no commit recorded (\`ledger releases amend\`)`}`);
  }
  return lines.join("\n");
}

/** One event as a line: what, then why and where the why came from. */
export function eventLine(e) {
  if (e.combined) return `${e.what}${e.why_from === "commit" ? "  [reason from a commit message]" : ""}`;
  const why = e.why_from === "unknown" ? "why: not recorded" : `why: ${e.why}${e.why_from === "commit" ? "  [from a commit message]" : ""}`;
  return `${e.what}  — ${why}`;
}
