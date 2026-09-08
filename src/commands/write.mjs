import fs from "node:fs";
import path from "node:path";
import { openProject } from "../store.mjs";
import { Feature } from "../model/feature.mjs";
import { fail, readStdin, asList, isBlank, writeJson, exists } from "../util.mjs";

const out = (s) => process.stdout.write(`${s}\n`);

/**
 * Every mutating command takes its content the same way: a JSON object on
 * stdin (or in --file), with individual flags filling in or overriding
 * fields. Prose belongs on stdin — a `changes` list of three multi-sentence
 * bullets is miserable as shell flags — while the short scalars are easier as
 * flags. Both work; use whichever suits the thing you're writing.
 */
async function payload(flags, { allow }) {
  let data = {};
  if (flags.file) {
    const p = path.resolve(flags.file);
    if (!exists(p)) fail(`no such file: ${flags.file}`);
    data = JSON.parse(fs.readFileSync(p, "utf8"));
  } else {
    const raw = (await readStdin()).trim();
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch (e) {
        fail(`the payload on stdin isn't valid JSON: ${e.message}`);
      }
    }
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) fail("the payload must be a JSON object");

  // Flags win over the payload, so `--size Small` can correct a fragment
  // without rewriting it.
  const fromFlags = {
    audience: flags.audience,
    category: flags.category,
    subcategory: flags.subcategory,
    size: flags.size,
    name: flags.name,
    description: flags.description,
    dev_notes: flags["dev-notes"],
    reason: flags.reason,
    changes: flags.change ? asList(flags.change) : undefined,
    add_changes: flags["add-change"] ? asList(flags["add-change"]) : undefined,
    backfilled: flags.backfilled ? true : undefined,
    reason_inferred: flags["reason-inferred"] ? true : undefined,
  };
  for (const [k, v] of Object.entries(fromFlags)) if (v !== undefined) data[k] = v;

  const unknown = Object.keys(data).filter((k) => !allow.includes(k));
  if (unknown.length) fail(`unexpected field${unknown.length === 1 ? "" : "s"} in the payload: ${unknown.join(", ")} (allowed: ${allow.join(", ")})`);
  return data;
}

function report(project, feature, { dryRun, verb }) {
  if (dryRun) {
    out(JSON.stringify(feature.toJSON(), null, 2));
    out(`(--dry-run: nothing written)`);
    return;
  }
  project.saveFeature(feature);
  out(`${verb} ${feature.id} at v${project.workingVersion} → ${path.relative(process.cwd(), project.featurePath(feature.id))}`);
}

/**
 * Where a feature goes when the payload doesn't say.
 *
 * Areas are a reading aid, not a required taxonomy. A product with four
 * capabilities has no areas — dividing it up would invent a structure the
 * reader has to hold in their head for nothing — so an unfiled feature opens
 * (or joins) the one default area, and the generators print that area without
 * a heading. A product with one area already in use puts it there too: that
 * is the same product, still undivided.
 *
 * Once someone has deliberately named two or more areas, the list *is* the
 * reading order, and guessing a place in it is exactly the mistake that's
 * expensive to find later. So from there on the category is asked for.
 */
function resolveCategory(project, dryRun) {
  const existing = project.config.categories;
  if (existing.length === 1) return existing[0];
  if (existing.length > 1) {
    fail(
      "a new feature needs \"category\" — this ledger has areas, and which one an entry belongs to " +
      `is the reading order of every document:\n${existing.map((c) => `  ${c}`).join("\n")}`,
    );
  }

  const name = project.featureSet.defaultCategory;
  if (!dryRun) {
    project.config.categories = [name];
    project.saveConfig();
  }
  return name;
}

export async function cmdAdd({ flags, positional }) {
  const project = openProject(flags);
  const version = project.workingVersion;
  const data = await payload(flags, {
    allow: ["id", "audience", "category", "subcategory", "size", "name", "description", "dev_notes", "backfilled"],
  });

  const id = positional[0] ?? data.id;
  if (!id) fail("usage: ledger add <id>  (with the rest as JSON on stdin)");
  if (project.featureSet.has(id)) {
    fail(`feature "${id}" already exists — use \`ledger update ${id}\` to record a change to it`);
  }

  // A category is only required once the product has more than one, so a
  // small product never has to invent a taxonomy before it can record its
  // first capability. See resolveCategory.
  if (isBlank(data.category)) data.category = resolveCategory(project, flags["dry-run"]);

  for (const field of ["audience", "category", "size", "name", "description"]) {
    if (isBlank(data[field])) fail(`a new feature needs "${field}" — see \`ledger rules\` for what each one means`);
  }

  // Both of these are checked here rather than left to `ledger status`, so a
  // typo'd category is caught while the agent still has the context to fix
  // it, not three features later.
  if (!project.config.categories.includes(data.category)) {
    fail(
      `unknown category ${JSON.stringify(data.category)} — the categories are:\n` +
      project.config.categories.map((c) => `  ${c}`).join("\n") +
      "\nIf this really is a new area, `ledger categories add` places it first.",
    );
  }
  if (data.subcategory) {
    const sub = project.subcategories.find((s) => s.id === data.subcategory);
    if (!sub) fail(`unknown sub-section ${JSON.stringify(data.subcategory)} — declare it with \`ledger subcategory add\``);
    if (sub.category !== data.category) {
      fail(`sub-section ${sub.id} lives under ${JSON.stringify(sub.category)}, not ${JSON.stringify(data.category)}`);
    }
  }

  const feature = new Feature({
    id,
    audience: data.audience,
    category: data.category,
    subcategory: data.subcategory ?? null,
    size: data.size,
    history: [{
      version,
      name: data.name,
      description: data.description,
      changes: null,
      ...(data.dev_notes ? { dev_notes: data.dev_notes } : {}),
      // --backfilled: the capability was already in the product, and this is
      // simply the first edition to list it. It still lands on the open
      // release — "new" in a client edition means new to the reader — but it
      // prints in the third register rather than as this cycle's work.
      ...(data.backfilled ? { backfilled: true } : {}),
    }],
  });

  report(project, feature, { dryRun: flags["dry-run"], verb: "added" });
}

export async function cmdUpdate({ flags, positional }) {
  const project = openProject(flags);
  const version = project.workingVersion;
  const id = positional[0];
  if (!id) fail("usage: ledger update <id>  (with the change as JSON on stdin)");
  const feature = project.featureSet.find(id);

  const data = await payload(flags, {
    allow: ["description", "changes", "add_changes", "name", "size", "category", "subcategory", "dev_notes", "backfilled", "reason_inferred"],
  });

  if (feature.entryAt(version)?.removed) {
    fail(`${id} is marked removed at v${version} — delete that entry by hand if it was a mistake`);
  }

  // Field moves (a re-filing, a resize) apply to the feature itself, not to
  // one moment in its history: they describe where the entry lives, not what
  // the product did.
  if (data.category) {
    if (!project.config.categories.includes(data.category)) {
      fail(
        `unknown area ${JSON.stringify(data.category)} — the areas are:\n` +
        project.config.categories.map((c) => `  ${c}`).join("\n") +
        "\nIf this really is a new one, `ledger categories add` places it first.",
      );
    }
    feature.category = data.category;
  }
  if ("subcategory" in data) feature.subcategory = data.subcategory || null;
  if (data.size) feature.size = data.size;

  const existedBefore = feature.firstVersion < version;
  const prev = feature.history.filter((h) => h.version < version).pop();
  let entry = feature.entryAt(version);

  if (!entry) {
    if (isBlank(data.description)) {
      fail(
        `recording a change needs the full updated "description" — the current-state text, not a diff ` +
        `(\`ledger show ${id}\` prints what's there now)`,
      );
    }
    entry = { version, description: data.description, changes: null };
    // dev_notes belong to the feature, not to one release: an entry that
    // doesn't restate them would silently drop the notes from every doc.
    if (prev?.dev_notes) entry.dev_notes = prev.dev_notes;
    feature.history.push(entry);
    feature.history.sort((a, b) => a.version - b.version);
  } else if (!isBlank(data.description)) {
    entry.description = data.description;
  }

  // A rename the client is told about: `name` on this release's entry, with a
  // `changes` bullet like any other change. The generators footnote the
  // previous name on their own, from the named entries in the history.
  //
  // A name that was simply *chosen badly* is not this. That is wording, and
  // wording is a hand-edit: change `name` on the entry where it was set, in
  // .ledger/features/<id>.json, and nothing lands on the release. There used
  // to be a `ledger rename` covering both, which is why it kept getting used
  // for the first when the second was meant.
  if (data.name) entry.name = data.name;
  if (data.dev_notes !== undefined) {
    if (isBlank(data.dev_notes)) delete entry.dev_notes;
    else entry.dev_notes = data.dev_notes;
  }

  if (data.changes !== undefined) entry.changes = data.changes;
  if (data.add_changes !== undefined) entry.changes = [...(entry.changes ?? []), ...asList(data.add_changes)];
  // A change an audit found late still has to say what moved and why — the
  // rule below is not relaxed for it. All --backfilled changes is the
  // register it prints in: the product moved before the last cutoff, so the
  // client should not read this as work from the cycle just shipped.
  if (data.backfilled) entry.backfilled = true;
  // Set when an audit took the reason from a commit message rather than from
  // whoever made the decision. It stays on the entry until someone vouches for
  // the sentence, so the question outlives the terminal the audit ran in.
  if (data.reason_inferred) entry.reason_inferred = true;

  // The rule that makes the ledger worth reading rather than a diff: a
  // feature that already existed can't quietly acquire a new description.
  // Something has to say what moved and why.
  if (existedBefore && !entry.changes?.length) {
    fail(
      `${id} existed before v${version}, so this needs "changes": a list of standalone bullets, each saying what it ` +
      "was before AND why it moved. The client can see what it is now from the description; the reason is the part " +
      "only you know. If you don't know why it changed, ask — don't write a plausible-sounding one.",
    );
  }

  const rebuilt = new Feature(feature.toJSON());
  report(project, rebuilt, { dryRun: flags["dry-run"], verb: "updated" });
}

export async function cmdRemove({ flags, positional }) {
  const project = openProject(flags);
  const version = project.workingVersion;
  const id = positional[0];
  if (!id) fail('usage: ledger remove <id> --reason "…"');
  if (isBlank(flags.reason)) fail("a removal needs --reason \"…\" — the ledger says what went away and why");

  const feature = project.featureSet.find(id);
  if (feature.firstVersion === version) {
    fail(
      `${id} was only added in v${version}, so removing it isn't a change the client should read about — ` +
      `delete .ledger/features/${id}.json instead`,
    );
  }

  feature.history = feature.history.filter((h) => h.version !== version);
  feature.history.push({
    version, removed: true, reason: flags.reason,
    // A withdrawal an audit found late. It is still reported to the client —
    // a capability that is gone and was never mentioned is exactly what a
    // reader needs to know — but not as something taken away this cycle.
    ...(flags.backfilled ? { backfilled: true } : {}),
    ...(flags["reason-inferred"] ? { reason_inferred: true } : {}),
  });
  feature.history.sort((a, b) => a.version - b.version);

  report(project, new Feature(feature.toJSON()), { dryRun: flags["dry-run"], verb: "removed" });
}

/**
 * A global tweak — a colour-semantics change, a wording pass across many
 * screens — that belongs to no single feature and shouldn't force an edit to
 * a dozen unrelated descriptions.
 */
export async function cmdOtherChange({ flags }) {
  const project = openProject(flags);
  const version = project.workingVersion;
  const data = await payload(flags, { allow: ["audience", "description"] });

  if (!["user", "dev"].includes(data.audience)) fail('--audience must be "user" or "dev"');
  if (isBlank(data.description)) fail("--description is required");

  const entry = { version, audience: data.audience, description: data.description };
  if (flags["dry-run"]) {
    out(JSON.stringify(entry, null, 2));
    out("(--dry-run: nothing written)");
    return;
  }
  project.otherChangesList.push(entry);
  project.saveOtherChanges();
  out(`recorded an other-change at v${version}`);
}

export async function cmdCategories({ flags, positional }) {
  const project = openProject(flags);
  const [sub, name] = positional;

  if (!sub || sub === "list") {
    if (!project.config.categories.length) {
      out(`no areas yet — an unfiled feature opens one called “${project.featureSet.defaultCategory}”`);
      return;
    }
    for (const c of project.config.categories) {
      const n = project.featureSet.features().filter((f) => f.category === c).length;
      out(`${String(n).padStart(3)}  ${c}`);
    }
    return;
  }
  if (sub === "rename") return renameCategory(project, flags, positional.slice(1));
  if (sub === "remove") return removeCategory(project, flags, positional.slice(1));
  if (sub !== "add") fail('usage: ledger categories [list | add "Name" [--after "Other"] | rename "Old" "New" | remove "Name"]');
  if (isBlank(name)) fail('usage: ledger categories add "Name" [--after "Other"]');
  if (project.config.categories.includes(name)) fail(`category ${JSON.stringify(name)} already exists`);

  // Position matters: this list is the reading order of every generated
  // document, so a new area has to be placed, not appended by accident.
  const list = [...project.config.categories];
  if (flags.after) {
    const i = list.indexOf(flags.after);
    if (i === -1) fail(`no category ${JSON.stringify(flags.after)} to place this after`);
    list.splice(i + 1, 0, name);
  } else if (flags.before) {
    const i = list.indexOf(flags.before);
    if (i === -1) fail(`no category ${JSON.stringify(flags.before)} to place this before`);
    list.splice(i, 0, name);
  } else {
    list.push(name);
  }

  if (flags["dry-run"]) {
    out(JSON.stringify(list, null, 2));
    return;
  }
  project.config.categories = list;
  project.saveConfig();
  out(`added category ${JSON.stringify(name)} (position ${list.indexOf(name) + 1} of ${list.length})`);
}

/**
 * The two moves a ledger makes as the product outgrows its structure, so
 * neither one means opening config.json by hand.
 *
 * A product that started undivided and grew areas renames the default one
 * into the first real area (its features come along, since they name it) or,
 * once they've been re-filed elsewhere, drops it. An area name is a heading a
 * client reads, so renaming it is a wording fix like any other: nothing about
 * the product moved, and nothing is recorded against the release.
 */
function renameCategory(project, flags, args) {
  const [from, to] = args;
  if (!from || !to) fail('usage: ledger categories rename "Old name" "New name"');
  const i = project.config.categories.indexOf(from);
  if (i === -1) fail(`no area ${JSON.stringify(from)} — ${project.config.categories.map((c) => JSON.stringify(c)).join(", ") || "there are none yet"}`);
  if (project.config.categories.includes(to)) fail(`area ${JSON.stringify(to)} already exists`);

  const moving = project.featureSet.features().filter((f) => f.category === from);
  const subs = project.subcategories.filter((s) => s.category === from);
  if (flags["dry-run"]) {
    out(`would rename ${JSON.stringify(from)} → ${JSON.stringify(to)}, carrying ${moving.length} feature(s) and ${subs.length} sub-section(s)`);
    return;
  }

  project.config.categories[i] = to;
  project.saveConfig();
  for (const f of moving) {
    f.category = to;
    project.saveFeature(new Feature(f.toJSON()));
  }
  for (const s of subs) s.category = to;
  if (subs.length) project.saveSubcategories();
  out(`renamed area ${JSON.stringify(from)} → ${JSON.stringify(to)} (${moving.length} feature(s) moved with it)`);
}

function removeCategory(project, flags, args) {
  const name = args[0];
  if (!name) fail('usage: ledger categories remove "Name"');
  if (!project.config.categories.includes(name)) fail(`no area ${JSON.stringify(name)}`);

  const held = project.featureSet.features().filter((f) => f.category === name);
  if (held.length) {
    fail(
      `${JSON.stringify(name)} still holds ${held.length} feature(s): ${held.map((f) => f.id).join(", ")}. ` +
      "Re-file them first (`ledger update <id> --category \"…\"`) — dropping the area would leave them pointing at nothing.",
    );
  }
  if (flags["dry-run"]) {
    out(`would remove empty area ${JSON.stringify(name)}`);
    return;
  }
  project.config.categories = project.config.categories.filter((c) => c !== name);
  project.subcategories = project.subcategories.filter((s) => s.category !== name);
  project.saveConfig();
  project.saveSubcategories();
  out(`removed empty area ${JSON.stringify(name)}`);
}

/**
 * A sub-section is the level between a category and a feature, for when one
 * area has grown big enough that its features would otherwise read as a wall.
 * The two rules that keep it load-bearing rather than a third tier of
 * taxonomy — at least N features, and no Big among them — are enforced by
 * `ledger status`, not here, because they're about the shape of the corpus
 * once the features have been filed.
 */
export async function cmdSubcategory({ flags, positional }) {
  const project = openProject(flags);
  const sub = positional[0];

  if (!sub || sub === "list") {
    for (const s of project.subcategories) {
      const n = project.featureSet.features().filter((f) => f.subcategory === s.id).length;
      out(`${String(n).padStart(3)}  ${s.id.padEnd(24)} ${s.category} — ${s.name}`);
    }
    return;
  }
  if (sub === "reword") {
    fail(
      "`ledger subcategory reword` is now a hand-edit: change \"name\" or \"intro\" in " +
      ".ledger/subcategories.json. A heading and its overview are client-facing prose like any entry, " +
      "and rewording them records nothing against the release either way. `ledger status` checks the file.",
    );
  }
  if (sub !== "add") fail("usage: ledger subcategory [list | add]  (add takes JSON on stdin; the wording of an existing one is edited in .ledger/subcategories.json)");

  const data = await payload(flags, { allow: ["id", "category", "name", "intro"] });
  if (flags.id) data.id = flags.id;
  if (flags.intro) data.intro = flags.intro;
  for (const field of ["id", "category", "name", "intro"]) {
    if (isBlank(data[field])) fail(`a sub-section needs "${field}" (intro = the one-or-two sentences saying what the whole area is)`);
  }
  if (project.subcategories.some((s) => s.id === data.id)) fail(`subcategory ${JSON.stringify(data.id)} already exists`);
  if (!project.config.categories.includes(data.category)) {
    fail(`unknown category ${JSON.stringify(data.category)} — \`ledger categories add\` first`);
  }

  const entry = { id: data.id, category: data.category, name: data.name, intro: data.intro };
  if (flags["dry-run"]) {
    out(JSON.stringify(entry, null, 2));
    return;
  }
  project.subcategories.push(entry);
  writeJson(project.subcategoriesPath, project.subcategories);
  out(`added sub-section ${data.id} under ${data.category} — assign features to it with \`ledger update <id> --subcategory ${data.id}\``);
}
