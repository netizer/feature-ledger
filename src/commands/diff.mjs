import { openProject } from "../store.mjs";
import { fail, usage } from "../util.mjs";
import { releaseDiff, sizeReadout, sinceLastLook, fullText, diffJson } from "../diff.mjs";

const out = (s) => process.stdout.write(`${s}\n`);

/**
 * `ledger diff`: the open release against an earlier edition, worked out
 * from the corpus and git alone. Bare, the size readout: what the release
 * holds, weighed by how much of the product each entry is, and how much code
 * moved under it. `--full` prints every entry's two states and its events;
 * `--json` is the same for a script. `--since vN` measures against an older
 * edition, and `--since last` says what moved since the last `ledger preview`.
 */
export async function cmdDiff({ flags }) {
  const project = openProject(flags);
  if (!project.releases.current.future) fail(`v${project.releases.current.version} is cut, and nothing is open to measure`);
  const since = flags.since === undefined || flags.since === true ? null : String(flags.since);

  if (since === "last") {
    out(sinceLastLook(project) ?? "No earlier look to measure from: `ledger preview` remembers each one.");
    return;
  }
  let base;
  if (since !== null) {
    const m = /^v?(\d+)$/.exec(since);
    if (!m) usage(`usage: ledger diff [--since vN | last]  — "${since}" isn't a version`);
    const version = Number(m[1]);
    if (version >= project.releases.current.version) fail(`--since names an earlier edition; v${version} isn't one`);
    base = project.releases.at(version);
    if (base.archived) fail(`v${version} belongs to an archived ledger; this corpus starts after it`);
  }
  const diff = releaseDiff(project, { base });
  if (flags.json) {
    out(JSON.stringify(diffJson(diff), null, 2));
    return;
  }
  out(sizeReadout(project, diff));
  if (flags.full) {
    out("");
    out(fullText(diff));
  }
}
