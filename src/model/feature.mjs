import { fail, isBlank } from "../util.mjs";

/**
 * One feature's full version history.
 *
 * The core idea is in #stateAt: a version only appears in `history` when
 * something about the feature actually changed. Absent versions just mean
 * "still whatever the last entry said" — so the corpus stays a list of
 * moments that mattered rather than a full snapshot per release, and
 * "what did this look like as of version N" is always answerable.
 */
export class Feature {
  constructor(data, { file } = {}) {
    this.file = file;
    this.id = data.id;
    this.audience = data.audience;
    this.category = data.category;
    this.subcategory = data.subcategory ?? null;
    this.size = data.size ?? null;
    this.history = [...(data.history ?? [])].sort((a, b) => a.version - b.version);
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

    return {
      version: current.version,
      name: names[names.length - 1],
      description: current.description,
      dev_notes: current.dev_notes ?? null,
      changes: current.changes ?? null,
      removed: false,
      // Set when this entry records something the audit found late: the
      // product did not move at this version, the record did. The renderers
      // draw it in a third, quieter register — see src/render/ledger-html.mjs.
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
    out.history = this.history.map((h) => {
      if (h.removed) {
        const r = { version: h.version, removed: true, reason: h.reason };
        if (h.backfilled) r.backfilled = true;
        if (h.reason_inferred) r.reason_inferred = true;
        return r;
      }
      const e = { version: h.version };
      if (h.name) e.name = h.name;
      e.description = h.description;
      e.changes = h.changes ?? null;
      if (h.dev_notes) e.dev_notes = h.dev_notes;
      if (h.backfilled) e.backfilled = true;
      if (h.reason_inferred) e.reason_inferred = true;
      return e;
    });
    return out;
  }

  validate() {
    const where = this.file ? ` (${this.file})` : "";
    if (isBlank(this.id)) fail(`a feature is missing its "id"${where}`);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(this.id)) {
      fail(`feature ${this.id}: id must be lower-case kebab-case (letters, digits, hyphens)${where}`);
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
    if (this.history.length === 0) fail(`feature ${this.id}: history is empty`);

    const versions = this.history.map((h) => h.version);
    if (new Set(versions).size !== versions.length) {
      fail(`feature ${this.id}: history has two entries at the same version (${versions.join(", ")})`);
    }
    if (this.history[0].removed) fail(`feature ${this.id}: history's very first entry can't be a removal`);

    for (const h of this.history) {
      if (!Number.isInteger(h.version)) fail(`feature ${this.id}: every history entry needs an integer "version"`);
      // Written only by an audit, and only ever true — an explicit `false`
      // would be a third state to reason about in every renderer.
      if ("backfilled" in h && h.backfilled !== true) {
        fail(
          `feature ${this.id} v${h.version}: "backfilled" is either absent or true (got ${JSON.stringify(h.backfilled)}). ` +
          "It marks an entry an audit recorded after the fact; leave it out for ordinary work.",
        );
      }
      // Deliberately absent from #stateAt, so no renderer can put it in front
      // of a client: it says the reason came from an audit reading a commit
      // message rather than from whoever made the decision, which is a note to
      // the team. `ledger status` lists them; `ledger audit confirm` clears one.
      if ("reason_inferred" in h && h.reason_inferred !== true) {
        fail(
          `feature ${this.id} v${h.version}: "reason_inferred" is either absent or true ` +
          `(got ${JSON.stringify(h.reason_inferred)}).`,
        );
      }
      if (h.removed) {
        if (isBlank(h.reason)) fail(`feature ${this.id} v${h.version}: a removal needs a "reason"`);
        continue;
      }
      if (isBlank(h.description)) fail(`feature ${this.id} v${h.version}: needs a description`);
      const changes = h.changes ?? null;
      if (changes === null) continue;
      const ok = Array.isArray(changes) && changes.every((c) => typeof c === "string" && c.trim() !== "");
      if (!ok) {
        fail(
          `feature ${this.id} v${h.version}: "changes" must be a list of strings (one standalone bullet each), ` +
          `not ${Array.isArray(changes) ? "a list containing something else" : typeof changes}`,
        );
      }
    }

    // The first entry is what introduces the feature, so it can't be a bare
    // rename with nothing to rename from.
    if (!this.history[0].name) fail(`feature ${this.id}: the first history entry must carry the feature's name`);
  }
}
