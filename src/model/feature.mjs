import { fail, isBlank } from "../util.mjs";

/** Where a change's reason came from. `person`: whoever decided it said why.
 *  `commit`: an agent read it off a commit message, and nobody has vouched for
 *  it yet. `unknown`: nobody recorded one. `ledger` lists the last two, and
 *  `ledger prepare` asks the developer about them in its session. */
export const WHY_FROM = ["person", "commit", "unknown"];

/** Fields an earlier version of the tool kept, and where to send someone who
 *  has a file with them in it. */
const OLD_HISTORY_FIELDS = ["changes", "dev_notes", "reason_inferred"];

/**
 * One feature: what it is at every version, and what happened to it.
 *
 * Two lists, kept apart on purpose.
 *
 * `history` is the feature's *state*, and is the core idea of #stateAt: a
 * version only appears in it when something about the feature changed, and
 * absent versions mean "still whatever the last entry said". That is what
 * makes "what did this look like at version N" answerable, and why an old
 * edition reprints exactly as it was.
 *
 * `events` are the *facts* recorded as work landed: what changed and why,
 * with where the reason came from. They are written by whoever did the work,
 * one `ledger change` at a time, and nobody phrases them for the client. The
 * client reads a "What changed" note written for the whole release at once
 * (`ledger prepare`), from the state the last edition showed, the state now,
 * and the events between. Those notes live in compositions.json, and the
 * store hands them to each feature as `bullets`, so every renderer reads them
 * off #stateAt.
 *
 * `how_to_see` lives on the history entry, next to the description: how a
 * reader checks the claim for themselves. It is versioned like the
 * description, so an old edition reprints the instructions it was sent with.
 *
 * `dev_notes` are the team's detail. They describe the feature, not one
 * moment in its history, so they are kept once.
 */
export class Feature {
  constructor(data, { file, bullets = {}, drafts = {} } = {}) {
    this.file = file;
    this.id = data.id;
    this.audience = data.audience;
    this.category = data.category;
    this.subcategory = data.subcategory ?? null;
    this.size = data.size ?? null;
    this.dev_notes = data.dev_notes ?? null;
    this.history = [...(data.history ?? [])].sort((a, b) => a.version - b.version);
    this.events = [...(data.events ?? [])];
    // Prepared "What changed" notes, by version (compositions.json), and for
    // the open release before anything is prepared, the events themselves.
    this.bullets = bullets;
    this.drafts = drafts;
    // Only so validate() can say which tool wrote the file.
    this.legacyPaths = "paths" in data;
    this.validate();
  }

  /** The name it currently goes by, whatever version that was set at. */
  get currentName() {
    const named = this.history.filter((h) => h.name);
    return named.length ? named[named.length - 1].name : this.id;
  }

  get firstVersion() {
    return this.history[0].version;
  }

  get lastVersion() {
    return this.history[this.history.length - 1].version;
  }

  /**
   * `null` if the feature didn't exist yet as of `version`, else its state
   * then — possibly `{ removed: true }`, in which case only version/removed/
   * reason are meaningful.
   */
  stateAt(version) {
    const entries = this.history.filter((h) => h.version <= version);
    if (entries.length === 0) return null;

    const current = entries[entries.length - 1];
    if (current.removed) {
      return {
        version: current.version, removed: true, reason: current.reason,
        backfilled: current.backfilled === true,
      };
    }

    const names = entries.map((h) => h.name).filter(Boolean);
    const renamedFrom = current.name && names.length > 1 ? names[names.length - 2] : null;
    // Carried forward like the name: an update rarely moves where a reader
    // finds the capability, and `ledger prepare` checks it when it does.
    const howToSee = entries.map((h) => h.how_to_see).filter((t) => !isBlank(t)).pop() ?? null;
    const prepared = this.bullets[current.version] ?? null;
    const draft = prepared ? null : (this.drafts[current.version] ?? null);

    return {
      version: current.version,
      name: names[names.length - 1],
      description: current.description,
      how_to_see: howToSee,
      dev_notes: this.dev_notes,
      changes: prepared ?? draft,
      // The events themselves, standing in for a note nobody has prepared
      // yet. Only ever on the open release.
      changes_draft: Boolean(draft),
      removed: false,
      // Set when this entry records something found late: the product did
      // not move at this version, the record did. The renderers draw it in a
      // third, quieter register — see src/render/ledger-html.mjs.
      backfilled: current.backfilled === true,
      renamedFrom,
    };
  }

  /** Introduced or changed exactly at `version` — the mechanical New/Changed tag. */
  touchedAt(version) {
    return this.history.some((h) => h.version === version);
  }

  entryAt(version) {
    return this.history.find((h) => h.version === version) ?? null;
  }

  /** What happened to it at `version`, in the order it was recorded. */
  eventsAt(version) {
    return this.events.filter((e) => e.version === version);
  }

  toJSON() {
    // One canonical key order, so a file rewritten by the CLI diffs against
    // the previous one in a line or two rather than reshuffling wholesale.
    const out = {
      id: this.id,
      audience: this.audience,
      category: this.category,
    };
    if (this.subcategory) out.subcategory = this.subcategory;
    out.size = this.size;
    if (this.dev_notes) out.dev_notes = this.dev_notes;
    out.history = this.history.map((h) => {
      if (h.removed) {
        const r = { version: h.version, removed: true, reason: h.reason };
        if (h.backfilled) r.backfilled = true;
        return r;
      }
      const e = { version: h.version };
      if (h.name) e.name = h.name;
      e.description = h.description;
      if (!isBlank(h.how_to_see)) e.how_to_see = h.how_to_see;
      if (h.backfilled) e.backfilled = true;
      return e;
    });
    if (this.events.length) {
      out.events = this.events.map((e) => {
        const o = { version: e.version, kind: e.kind ?? "change", what: e.what, why: e.why ?? null, why_from: e.why_from };
        if (e.combined) o.combined = true;
        if (e.backfilled) o.backfilled = true;
        if (e.commit) o.commit = e.commit;
        if (e.date) o.date = e.date;
        return o;
      });
    }
    return out;
  }

  validate() {
    const where = this.file ? ` (${this.file})` : "";
    if (isBlank(this.id)) fail(`a feature is missing its "id"${where}`);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(this.id)) {
      fail(`feature ${this.id}: id must be lower-case kebab-case (letters, digits, hyphens)${where}`);
    }
    // A file in a shape this version no longer reads: an entry recorded on a
    // branch with an older CLI and merged after `ledger migrate`. Refused
    // rather than read, because writing it back would drop what it carries.
    if (this.legacyPaths) {
      fail(`feature ${this.id}: "paths" is no longer part of an entry${where}. ` +
        "The file was written by an earlier version of feature-ledger: run `ledger migrate`, which converts it.");
    }
    if (!["user", "dev"].includes(this.audience)) fail(`feature ${this.id}: audience must be "user" or "dev"`);
    if (isBlank(this.category)) fail(`feature ${this.id}: category is blank`);
    if (this.size !== null && !["Big", "Medium", "Small"].includes(this.size)) {
      fail(
        `feature ${this.id}: size must be "Big", "Medium" or "Small" (got ${JSON.stringify(this.size)}). ` +
        "The scale ranks capabilities within this product; it is not a licence to record something smaller " +
        "than a capability — see `ledger rules`.",
      );
    }
    if (this.dev_notes !== null && typeof this.dev_notes !== "string") fail(`feature ${this.id}: "dev_notes" is text`);
    if (this.history.length === 0) fail(`feature ${this.id}: history is empty`);

    const versions = this.history.map((h) => h.version);
    if (new Set(versions).size !== versions.length) {
      fail(`feature ${this.id}: history has two entries at the same version (${versions.join(", ")})`);
    }
    if (this.history[0].removed) fail(`feature ${this.id}: history's very first entry can't be a removal`);

    for (const h of this.history) {
      if (!Number.isInteger(h.version)) fail(`feature ${this.id}: every history entry needs an integer "version"`);
      for (const old of OLD_HISTORY_FIELDS) {
        if (old in h) {
          fail(`feature ${this.id} v${h.version}: "${old}" no longer lives in "history"${where}. ` +
            "The file was written by an earlier version of feature-ledger: run `ledger migrate`, which converts it.");
        }
      }
      // Only ever true — an explicit `false` would be a third state to
      // reason about in every renderer.
      if ("backfilled" in h && h.backfilled !== true) {
        fail(
          `feature ${this.id} v${h.version}: "backfilled" is either absent or true (got ${JSON.stringify(h.backfilled)}). ` +
          "It marks an entry recorded after the fact; leave it out for ordinary work.",
        );
      }
      if (h.removed) {
        if (isBlank(h.reason)) fail(`feature ${this.id} v${h.version}: a removal needs a "reason"`);
        continue;
      }
      if (isBlank(h.description)) fail(`feature ${this.id} v${h.version}: needs a description`);
      if (h.how_to_see != null && typeof h.how_to_see !== "string") {
        fail(`feature ${this.id} v${h.version}: "how_to_see" is text: how a reader checks the claim for themselves`);
      }
    }

    for (const e of this.events) {
      const at = `feature ${this.id}: an event${Number.isInteger(e.version) ? ` at v${e.version}` : ""}`;
      if (!Number.isInteger(e.version)) fail(`${at} needs an integer "version"`);
      if (!["change", "remove"].includes(e.kind ?? "change")) fail(`${at} has kind ${JSON.stringify(e.kind)}; it is "change" or "remove"`);
      if (isBlank(e.what)) fail(`${at} needs "what": what changed, in a sentence`);
      if (e.why !== null && e.why !== undefined && typeof e.why !== "string") fail(`${at}: "why" is text, or null`);
      if (!WHY_FROM.includes(e.why_from)) fail(`${at}: "why_from" is one of ${WHY_FROM.join(", ")}`);
      if (e.why_from === "unknown" && !isBlank(e.why)) {
        fail(`${at} says its reason is unknown, and gives one. An answered reason is "why_from": "person"`);
      }
      if (e.why_from !== "unknown" && isBlank(e.why) && !e.combined) {
        fail(`${at} has no "why". Record one, or say it isn't known (\`--why-unknown\`)`);
      }
    }

    // The first entry is what introduces the feature, so it can't be a bare
    // rename with nothing to rename from.
    if (!this.history[0].name) fail(`feature ${this.id}: the first history entry must carry the feature's name`);
  }
}
