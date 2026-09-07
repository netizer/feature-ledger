import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openProject } from "../store.mjs";
import { fail, exists, writeJson } from "../util.mjs";

const PKG_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = (s) => process.stdout.write(`${s}\n`);

/**
 * The whole point of these read commands is that an agent never has to open
 * the corpus. `list` is the index — one short line per feature — and `show`
 * is the single entry it's about to edit. Between them that's a couple of
 * thousand tokens instead of the whole file.
 */
export async function cmdList({ flags }) {
  const project = openProject(flags);
  const target = project.releases.latestVersion;

  let feats = project.featureSet.features({ audience: flags.audience ?? null });
  if (flags.category) feats = feats.filter((f) => f.category.toLowerCase().includes(String(flags.category).toLowerCase()));
  if (flags.size) feats = feats.filter((f) => (f.size ?? "").toLowerCase() === String(flags.size).toLowerCase());
  if (flags.changed) feats = feats.filter((f) => f.touchedAt(target));

  if (flags.json) {
    out(JSON.stringify(
      feats.map((f) => {
        const s = f.stateAt(target);
        return {
          id: f.id, audience: f.audience, category: f.category, subcategory: f.subcategory,
          size: f.size, name: f.currentName, touched_at_target: f.touchedAt(target),
          removed: Boolean(s?.removed),
        };
      }),
      null, 2,
    ));
    return;
  }

  if (!feats.length) {
    out("no features match — `ledger add` puts the first one in");
    return;
  }

  let lastCategory = null;
  for (const category of project.featureSet.categories({ audience: flags.audience ?? null })) {
    const inCat = feats.filter((f) => f.category === category);
    if (!inCat.length) continue;
    if (lastCategory !== null) out("");
    lastCategory = category;
    out(category);
    for (const f of project.featureSet.bySize(inCat)) {
      const state = f.stateAt(target);
      const marks = [];
      if (state?.removed) marks.push("removed");
      else if (f.touchedAt(target)) marks.push(state?.changes === null ? `new v${target}` : `changed v${target}`);
      if (f.audience === "dev") marks.push("dev");
      if (f.subcategory) marks.push(`in ${f.subcategory}`);
      const tail = marks.length ? `  · ${marks.join(", ")}` : "";
      out(`  ${(f.size ?? "—").padEnd(7)} ${f.id.padEnd(34)} ${f.currentName}${tail}`);
    }
  }
  out("");
  out(`${feats.length} feature${feats.length === 1 ? "" : "s"} · release v${target} (${project.releases.current.future ? "in progress" : "shipped"})`);
}

export async function cmdShow({ flags, positional }) {
  const id = positional[0];
  if (!id) fail("usage: ledger show <id> [--history]");
  const project = openProject(flags);
  const f = project.featureSet.find(id);
  const target = project.releases.latestVersion;
  const state = f.stateAt(target);

  if (flags.json) {
    out(JSON.stringify(f.toJSON(), null, 2));
    return;
  }

  out(`${f.id}  ·  ${f.audience}  ·  ${f.category}${f.subcategory ? ` / ${f.subcategory}` : ""}  ·  ${f.size ?? "unsized"}`);
  if (state?.removed) {
    out(`REMOVED at v${state.version}: ${state.reason}`);
  } else if (state) {
    out(`Name: ${state.name}`);
    if (state.renamedFrom) out(`Previously: ${state.renamedFrom}`);
    out(`Description: ${state.description}`);
    if (state.dev_notes) out(`Dev notes: ${state.dev_notes}`);
    if (state.changes?.length) {
      out(`What changed at v${state.version}:`);
      for (const c of state.changes) out(`  - ${c}`);
    }
  }

  const versions = f.history.map((h) => `v${h.version}${h.removed ? " removed" : h.changes ? " changed" : " new"}`);
  out(`History: ${versions.join(", ")}`);

  if (flags.history) {
    for (const h of f.history) {
      out("");
      out(`── v${h.version} ──`);
      if (h.removed) { out(`removed: ${h.reason}`); continue; }
      if (h.name) out(`name: ${h.name}`);
      out(`description: ${h.description}`);
      if (h.dev_notes) out(`dev_notes: ${h.dev_notes}`);
      for (const c of h.changes ?? []) out(`  - ${c}`);
    }
  }
}

/** What the in-progress release has collected so far — the thing to check
 *  before cutting it, and a cheap way for an agent to see whether the work it
 *  just did is already recorded. */
export async function cmdStatus({ flags }) {
  const project = openProject(flags);
  const target = project.releases.latestVersion;
  const rel = project.releases.at(target);

  const touched = project.featureSet.features().filter((f) => f.touchedAt(target));
  const added = touched.filter((f) => f.firstVersion === target);
  const removed = touched.filter((f) => f.entryAt(target)?.removed);
  const changed = touched.filter((f) => !added.includes(f) && !removed.includes(f));
  const other = project.featureSet.otherChanges({ version: target });

  if (flags.json) {
    out(JSON.stringify({
      version: target,
      status: rel.status,
      name: rel.name,
      added: added.map((f) => f.id),
      changed: changed.map((f) => f.id),
      removed: removed.map((f) => f.id),
      other_changes: other.length,
      total_features: project.featureSet.features().length,
    }, null, 2));
    return;
  }

  out(`Release v${target}${rel.name ? ` — ${rel.name}` : ""} (${rel.future ? "in progress, not yet presented" : `shipped ${rel.date}`})`);
  out(`Corpus: ${project.featureSet.features().length} features across ${project.featureSet.categories().length} categories`);
  out("");
  const section = (label, list) => {
    if (!list.length) return;
    out(`${label} (${list.length}):`);
    for (const f of list) out(`  ${f.id.padEnd(34)} ${f.currentName}`);
  };
  section("Added this release", added);
  section("Changed this release", changed);
  section("Removed this release", removed);
  if (other.length) out(`Other changes this release: ${other.length}`);
  if (!added.length && !changed.length && !removed.length && !other.length) {
    out("Nothing recorded against this release yet.");
  }
}

/**
 * The authoring rules. A project copy in .ledger/RULES.md wins, so a team can
 * add house conventions; otherwise the packaged one is printed. Agents are
 * pointed here rather than being given the rules in every prompt.
 */
export async function cmdRules({ flags }) {
  let file = path.join(PKG_ROOT, "assets", "RULES.md");
  try {
    const project = openProject(flags);
    const local = path.join(project.ledgerDir, "RULES.md");
    if (exists(local)) file = local;
  } catch {
    // No project here — the packaged rules are still worth printing.
  }
  process.stdout.write(fs.readFileSync(file, "utf8"));
}

/** The whole corpus as one JSON document — for a backup, a migration, or
 *  handing the data to something that isn't this tool. */
export async function cmdExport({ flags }) {
  const project = openProject(flags);
  const doc = {
    schema_version: 1,
    product: project.config.product,
    releases: project.releases.toJSON(),
    categories: project.config.categories,
    subcategories: project.subcategories,
    other_changes: project.otherChangesList,
    features: project.featureSet.features().map((f) => f.toJSON()),
  };
  if (flags.out) {
    writeJson(path.resolve(flags.out), doc);
    out(`wrote ${flags.out}`);
  } else {
    out(JSON.stringify(doc, null, 2));
  }
}
