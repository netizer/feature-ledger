import { openProject } from "../store.mjs";
import { fail, isBlank, today, longDate } from "../util.mjs";

const out = (s) => process.stdout.write(`${s}\n`);

export async function cmdRelease({ flags, positional }) {
  const sub = positional[0] ?? "list";
  if (sub === "list") return list(flags);
  if (sub === "cut") return cut(flags);
  fail("usage: ledger release [list | cut --name \"…\" [--date YYYY-MM-DD]]");
}

function list(flags) {
  const project = openProject(flags);
  for (const r of project.releases.releases) {
    const touched = project.featureSet.features().filter((f) => f.touchedAt(r.version)).length;
    const when = r.future ? "in progress" : longDate(r.date);
    out(`v${String(r.version).padStart(2)}  ${(when ?? "").padEnd(20)} ${r.name ?? "(unnamed)"}  · ${touched} entr${touched === 1 ? "y" : "ies"}`);
  }
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
  current.status = "released";
  current.future = false;
  current.released = true;
  project.releases.releases.push({
    version: current.version + 1, name: null, date: null, status: "future", future: true, released: false,
  });

  if (flags["dry-run"]) {
    out(JSON.stringify(project.releases.toJSON(), null, 2));
    out("(--dry-run: nothing written)");
    return;
  }

  project.releases.validate();
  project.saveReleases();
  out(`cut v${current.version} — ${current.name} (${date}), covering ${touched} feature entr${touched === 1 ? "y" : "ies"}${other ? ` and ${other} other change${other === 1 ? "" : "s"}` : ""}`);
  out(`v${current.version + 1} is now the in-progress release; new work records against it.`);
  out(`Next: \`ledger build\` — this is the moment the client gets a PDF edition for v${current.version}.`);
}
