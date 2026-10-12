import fs from "node:fs";
import path from "node:path";
import { openProject } from "../store.mjs";
import { Feature, WHY_FROM } from "../model/feature.mjs";
import { fail, readStdin, asList, isBlank, exists, today } from "../util.mjs";

const out = (s) => process.stdout.write(`${s}\n`);

/**
 * Every mutating command takes its content the same way: a JSON object on
 * stdin (or in --file), with individual flags filling in or overriding
 * fields. Prose belongs on stdin, while the short scalars are easier as
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
    how_to_see: flags["how-to-see"],
    what: flags.what,
    why: flags.why,
    why_from: flags["why-from"],
    reason: flags.reason,
    changes: flags.change ? asList(flags.change) : undefined,
    add_changes: flags["add-change"] ? asList(flags["add-change"]) : undefined,
    backfilled: flags.backfilled ? true : undefined,
    reason_inferred: flags["reason-inferred"] ? true : undefined,
  };
  for (const [k, v] of Object.entries(fromFlags)) if (v !== undefined) data[k] = v;

  // A stanza or a script written for the version that mapped code to entries
  // still sends this. The map is gone, so it is dropped rather than refused.
  if ("paths" in data) {
    delete data.paths;
    process.stderr.write("note: \"paths\" is no longer recorded; the ledger doesn't map code to entries any more.\n");
  }
  const unknown = Object.keys(data).filter((k) => !allow.includes(k));
  if (unknown.length) fail(`unexpected field${unknown.length === 1 ? "" : "s"} in the payload: ${unknown.join(", ")} (allowed: ${allow.join(", ")})`);
  for (const k of ["how_to_see", "description", "name", "what", "why"]) {
    if (data[k] === true) fail(`--${k.replaceAll("_", "-")} needs its text`);
  }
  return data;
}

function report(project, feature, { dryRun, verb }) {
  if (dryRun) {
    out(JSON.stringify(feature.toJSON(), null, 2));
    out(`(--dry-run: nothing written)`);
    return false;
  }
  project.saveFeature(feature);
  out(`${verb} ${feature.id} at v${project.workingVersion} → ${path.relative(process.cwd(), project.featurePath(feature.id))}`);
  return true;
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

/** Where a filed entry lives: the parts of a feature that describe it rather
 *  than one moment in its history, and so record nothing against a release. */
function applyFiling(project, feature, data) {
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
  if (data.dev_notes !== undefined) feature.dev_notes = isBlank(data.dev_notes) ? null : data.dev_notes;
}

export async function cmdAdd({ flags, positional }) {
  const project = openProject(flags);
  const version = project.workingVersion;
  const data = await payload(flags, {
    allow: ["id", "audience", "category", "subcategory", "size", "name", "description", "how_to_see", "dev_notes", "backfilled"],
  });

  const id = positional[0] ?? data.id;
  if (!id) fail("usage: ledger add <id>  (with the rest as JSON on stdin)");
  if (project.featureSet.has(id)) {
    fail(`feature "${id}" already exists — use \`ledger change ${id}\` to record a change to it`);
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
    if (!sub) fail(`unknown sub-section ${JSON.stringify(data.subcategory)} — declare it with \`ledger subcategories add\``);
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
    dev_notes: isBlank(data.dev_notes) ? null : data.dev_notes,
    history: [{
      version,
      name: data.name,
      description: data.description,
      ...(isBlank(data.how_to_see) ? {} : { how_to_see: data.how_to_see }),
      // --backfilled: the capability was already in the product, and this is
      // simply the first edition to list it. It still lands on the open
      // release — "new" in a client edition means new to the reader — but it
      // prints in the third register rather than as this cycle's work.
      ...(data.backfilled ? { backfilled: true } : {}),
    }],
  });

  report(project, feature, { dryRun: flags["dry-run"], verb: "added" });
}

/**
 * The reason a change carries, and where it came from, from the payload and
 * the flags. Every change says why it happened, or says plainly that nobody
 * knows: the ledger never invents one, and never forgets one is missing.
 */
function whyOf(flags, data, id) {
  if (flags["why-unknown"]) {
    if (!isBlank(data.why)) fail("--why-unknown says nobody knows why, so it can't come with a --why");
    return { why: null, why_from: "unknown" };
  }
  if (isBlank(data.why)) {
    fail(`${id} existed before this release, so the change needs "why": the reason it moved. The client can see ` +
      "what it does now from the description; the reason is the part only the person who decided it knows. If you " +
      "don't know, ask. If nobody can say, pass --why-unknown, which records the gap for `ledger prepare` to ask " +
      "about rather than a plausible-sounding guess. A reason read off a commit message takes --why-from commit.");
  }
  const from = data.why_from ?? "person";
  if (!WHY_FROM.includes(from) || from === "unknown") fail("--why-from is person (the default) or commit; for no reason at all, --why-unknown");
  return { why: String(data.why).trim(), why_from: from };
}

/**
 * `ledger change <id>`: something about a capability moved, and this is what
 * and why. Appended to the feature's events; nothing here is phrased for the
 * client. The "What changed" note the edition prints is written for the
 * whole release at once (`ledger prepare`), from the state the last edition
 * showed, the state now and these events, so a second change in one cycle is
 * just a second event: there is nothing earlier to revise.
 *
 * What moves the product: `what` (with its `why`), a new `description` of
 * the whole current state, a `name` the product now uses. What doesn't: the
 * area, the size and the team's notes, which are filed without recording
 * anything. `how_to_see` goes with the entry's state at this release: set
 * alongside a change, or on its own once the entry is in the release.
 */
export async function cmdChange({ flags, positional }, { legacy = false } = {}) {
  const project = openProject(flags);
  const version = project.workingVersion;
  const id = positional[0];
  if (!id) fail(`usage: ledger ${legacy ? "update" : "change"} <id>  (what and why as JSON on stdin, or --what/--why)`);
  const feature = project.featureSet.find(id);

  const base = ["what", "why", "why_from", "description", "name", "how_to_see", "size", "category", "subcategory", "dev_notes", "backfilled"];
  const data = await payload(flags, { allow: legacy ? [...base, "changes", "add_changes", "reason_inferred"] : base });

  if (feature.entryAt(version)?.removed) {
    fail(`${id} is marked removed at v${version} — delete that entry by hand if it was a mistake`);
  }
  applyFiling(project, feature, data);

  // `ledger update` wrote client-facing bullets, each carrying both what and
  // why. Kept working: each bullet becomes one event that says both.
  const legacyBullets = legacy ? [...asList(data.changes), ...asList(data.add_changes)].filter((b) => !isBlank(b)) : [];

  const moves = !isBlank(data.what) || !isBlank(data.description) || !isBlank(data.name) || data.backfilled || legacyBullets.length;
  const filing = ["category", "subcategory", "size", "dev_notes"].some((k) => data[k] !== undefined);
  const howToSee = !isBlank(data.how_to_see);
  if (!moves) {
    if (!filing && !howToSee) fail(`nothing to record — \`ledger change ${id}\` takes "what" and "why", and "description" for the new state`);
    if (howToSee) {
      // How to see an entry the release already moved: part of this
      // release's state, and nothing new about the product.
      const here = feature.entryAt(version);
      if (!here) {
        fail(`${id} hasn't moved in v${version}, so how to see it is wording: edit "how_to_see" on its latest entry in ` +
          `.ledger/features/${id}.json. Recording a change with --what and --why takes --how-to-see too.`);
      }
      here.how_to_see = String(data.how_to_see).trim();
    }
    const rebuilt = new Feature(feature.toJSON());
    if (flags["dry-run"]) { out(JSON.stringify(rebuilt.toJSON(), null, 2)); out("(--dry-run: nothing written)"); return; }
    project.saveFeature(rebuilt);
    out(howToSee
      ? `set how to see ${id} at v${version} — nothing about the product moved, so nothing is recorded`
      : `filed ${id} — where an entry lives isn't news, so nothing is recorded against v${version}`);
    return;
  }

  const existedBefore = feature.firstVersion < version;
  const prev = feature.history.filter((h) => h.version < version).pop();
  const recorded = feature.events.length;
  let entry = feature.entryAt(version);
  const notes = [];

  // A feature the client has never seen has no "before": however often it
  // moved while it was being built, the new state is its description, and
  // the edition prints no "What changed" note for it.
  if (!existedBefore) {
    if (!isBlank(data.description)) entry.description = data.description;
    if (!isBlank(data.name)) entry.name = data.name;
    if (howToSee) entry.how_to_see = String(data.how_to_see).trim();
    if (!isBlank(data.what) || legacyBullets.length) {
      if (legacy) {
        fail(`${id} is new in v${version} — the client has never seen an earlier version of it, so there is nothing to ` +
          "tell them changed. Pass the full updated \"description\" and no \"changes\".");
      }
      notes.push(`${id} is new in v${version}, so its description is the whole story: no change was recorded, ` +
        "and the edition prints no \"What changed\" note for it.");
    }
  } else {
    const events = [];
    if (legacyBullets.length) {
      for (const b of legacyBullets) {
        events.push({ version, kind: "change", what: b, why: null, why_from: data.reason_inferred ? "commit" : "person", combined: true });
      }
    } else if (!isBlank(data.what)) {
      events.push({ version, kind: "change", what: String(data.what).trim(), ...whyOf(flags, data, id) });
    } else {
      // Refining the current-state text of an entry that already changed
      // this cycle is wording of that change, not another one. Anything
      // else — a new name, a description on an entry that hasn't moved —
      // is news, and news says what and why.
      const refining = entry && !entry.removed && !isBlank(data.description) && isBlank(data.name) && !data.backfilled;
      if (!refining) {
        fail(legacy
          ? `${id} existed before v${version}, so this needs "changes": a list of standalone bullets, each saying what ` +
            "it was before AND why it moved. If you don't know why it changed, ask — don't write a plausible-sounding one."
          : `${id} existed before v${version}, so this needs "what" (what changed) and "why" (the reason). ` +
            "The description alone would change what the client reads without telling them anything moved.");
      }
    }

    if (!entry) {
      // The state at this release. A change the description doesn't need to
      // mention still marks the entry as moved, with the words it had.
      entry = { version, description: isBlank(data.description) ? prev.description : data.description };
      feature.history.push(entry);
      feature.history.sort((a, b) => a.version - b.version);
    } else if (!isBlank(data.description)) {
      entry.description = data.description;
    }
    // A rename the client is told about: `name` on this release's entry. The
    // generators footnote the previous name on their own. A name that was
    // simply chosen badly is wording, and a hand-edit.
    if (!isBlank(data.name)) entry.name = data.name;
    if (howToSee) entry.how_to_see = String(data.how_to_see).trim();
    if (data.backfilled) entry.backfilled = true;

    for (const e of events) {
      if (data.backfilled) e.backfilled = true;
      e.date = today();
      feature.events.push(e);
    }
  }

  const rebuilt = new Feature(feature.toJSON());
  if (!report(project, rebuilt, { dryRun: flags["dry-run"], verb: legacy ? "updated" : "changed" })) return;
  for (const n of notes) out(`note: ${n}`);
  unvouched(rebuilt.events.slice(recorded));
}

/** Says, once, that a reason nobody vouched for is kept as a question. */
function unvouched(events) {
  const open = events.filter((e) => e.why_from !== "person");
  if (!open.length) return;
  out(`  the reason ${open.some((e) => e.why_from === "unknown") ? "isn't known" : "came from a commit message"}, so it stays ` +
    "a question for a person: `ledger` lists it, and `ledger prepare` asks it.");
}

/** The old name. Kept so stanzas and scripts written against it still work. */
export async function cmdUpdate(args) {
  process.stderr.write("note: `ledger update` is now `ledger change`, which takes \"what\" and \"why\" as separate fields — " +
    "the old \"changes\" bullets still work.\n");
  return cmdChange(args, { legacy: true });
}

export async function cmdRemove({ flags, positional }) {
  const project = openProject(flags);
  const version = project.workingVersion;
  const id = positional[0];
  if (!id) fail('usage: ledger remove <id> --why "…"');
  const data = await payload(flags, { allow: ["why", "why_from", "reason", "backfilled", "reason_inferred"] });
  const why = !isBlank(data.why) ? data.why : data.reason;
  if (isBlank(why) || why === true) {
    fail("a removal needs --why \"…\": the edition says what went away and why, so this is the one reason that can't be " +
      "left unknown. If it was read off a commit message, add --why-from commit.");
  }
  const from = data.reason_inferred ? "commit" : (data.why_from ?? "person");
  if (!["person", "commit"].includes(from)) fail("--why-from is person (the default) or commit");

  const feature = project.featureSet.find(id);
  if (feature.firstVersion === version) {
    fail(
      `${id} was only added in v${version}, so removing it isn't a change the client should read about — ` +
      `delete .ledger/features/${id}.json instead`,
    );
  }

  feature.history = feature.history.filter((h) => h.version !== version);
  feature.history.push({
    version, removed: true, reason: String(why).trim(),
    // A withdrawal found late. It is still reported to the client —
    // a capability that is gone and was never mentioned is exactly what a
    // reader needs to know — but not as something taken away this cycle.
    ...(data.backfilled ? { backfilled: true } : {}),
  });
  feature.history.sort((a, b) => a.version - b.version);
  feature.events.push({ version, kind: "remove", what: `${feature.currentName} is no longer part of the product.`,
    why: String(why).trim(), why_from: from, ...(data.backfilled ? { backfilled: true } : {}), date: today() });

  const rebuilt = new Feature(feature.toJSON());
  if (!report(project, rebuilt, { dryRun: flags["dry-run"], verb: "removed" })) return;
  unvouched(rebuilt.events.slice(-1));
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
  out(`recorded a product-wide note at v${version}`);
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
  if (sub !== "add") fail('usage: ledger categories [list | add "Name" [--after "Other"] [--intro "…"] | rename "Old" "New" | remove "Name"]');
  if (isBlank(name)) fail('usage: ledger categories add "Name" [--after "Other"] [--intro "One sentence on what the area is for."]');
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
  // The one sentence the edition's catalogue opens the area with.
  if (!isBlank(flags.intro) && flags.intro !== true) project.config.area_intros = { ...project.config.area_intros, [name]: String(flags.intro) };
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
  // The area's overview is about the area, whatever it is called.
  if (project.config.area_intros?.[from] !== undefined) {
    project.config.area_intros[to] = project.config.area_intros[from];
    delete project.config.area_intros[from];
  }
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
      "Re-file them first (`ledger change <id> --category \"…\"`) — dropping the area would leave them pointing at nothing.",
    );
  }
  if (flags["dry-run"]) {
    out(`would remove empty area ${JSON.stringify(name)}`);
    return;
  }
  project.config.categories = project.config.categories.filter((c) => c !== name);
  if (project.config.area_intros) delete project.config.area_intros[name];
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
      "`ledger subcategories reword` is now a hand-edit: change \"name\" or \"intro\" in " +
      ".ledger/subcategories.json. A heading and its overview are client-facing prose like any entry, " +
      "and rewording them records nothing against the release either way. `ledger status` checks the file.",
    );
  }
  if (sub !== "add") fail("usage: ledger subcategories [list | add]  (add takes JSON on stdin; the wording of an existing one is edited in .ledger/subcategories.json)");

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
  project.saveSubcategories();
  out(`added sub-section ${data.id} under ${data.category} — assign features to it with \`ledger change <id> --subcategory ${data.id}\``);
}
