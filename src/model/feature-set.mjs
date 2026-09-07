import { fail, isBlank } from "../util.mjs";

/**
 * Reading order inside every section and sub-section: the standalone
 * capabilities first, then the meaningful pieces, then the specific touches.
 * A reader skimming for what the product *does* gets it before the detail,
 * and a section can't bury a Big behind six Smalls just because that's the
 * order things happened to get written down in. Anything unsized sorts last.
 */
const SIZE_ORDER = { Big: 0, Medium: 1, Small: 2 };

/**
 * The whole corpus: every Feature, the optional sub-sections some of them
 * group under, and the `other_changes` entries — a global tweak (a colour
 * change, a wording pass) that belongs to no single feature and shouldn't
 * force an edit to a dozen unrelated descriptions.
 *
 * The category taxonomy lives in the project's config, not here: it's the
 * one part of this that's genuinely per-product.
 */
export class FeatureSet {
  constructor({ features, subcategories, otherChanges, order, config, releaseSet }) {
    this.config = config;
    this.releaseSet = releaseSet;
    this.categoryOrder = config.categories;
    this.minSubcategoryFeatures = config.min_subcategory_features ?? 4;
    this.subcategories = subcategories ?? [];
    this.otherChangesList = otherChanges ?? [];
    this.order = order ?? [];

    // Corpus order: the deliberate one from the index, then anything the
    // index hasn't caught up with (a hand-added file), alphabetically, so a
    // stale index degrades into "sorts last" rather than an error.
    const rank = new Map(this.order.map((id, i) => [id, i]));
    this.featureList = [...features].sort((a, b) => {
      const ra = rank.has(a.id) ? rank.get(a.id) : Number.MAX_SAFE_INTEGER;
      const rb = rank.has(b.id) ? rank.get(b.id) : Number.MAX_SAFE_INTEGER;
      return ra - rb || a.id.localeCompare(b.id);
    });

    this.validate();
  }

  features({ audience = null } = {}) {
    return audience ? this.featureList.filter((f) => f.audience === audience) : this.featureList;
  }

  find(id) {
    const f = this.featureList.find((x) => x.id === id);
    if (!f) fail(`no feature "${id}" in the corpus — \`ledger list\` shows what's there`);
    return f;
  }

  has(id) {
    return this.featureList.some((x) => x.id === id);
  }

  /** Categories in canonical order, limited to ones actually present for this
   *  audience — so an empty category never renders a bare header. */
  categories({ audience = null } = {}) {
    const present = new Set(this.features({ audience }).map((f) => f.category));
    return this.categoryOrder.filter((c) => present.has(c));
  }

  /**
   * A category's features, split into the loose ones — rendered first, in
   * corpus order — and the sub-sections that follow, each with its own
   * features. Every renderer goes through this, so the Markdown docs and the
   * PDF can't drift on how a category is laid out.
   *
   * Returns { loose, subs: [{ sub, members }] }. A sub-section with nothing
   * to show for this audience is dropped, same as an empty category is.
   */
  sections({ category, audience = null }) {
    const feats = this.features({ audience }).filter((f) => f.category === category);
    const loose = this.bySize(feats.filter((f) => !f.subcategory));
    const subs = [];
    for (const sub of this.subcategories.filter((s) => s.category === category)) {
      const members = this.bySize(feats.filter((f) => f.subcategory === sub.id));
      if (members.length) subs.push({ sub, members });
    }
    return { loose, subs };
  }

  /** Big → Medium → Small, ties broken by corpus order. */
  bySize(feats) {
    return feats
      .map((f, i) => [f, i])
      .sort((a, b) => {
        const sa = SIZE_ORDER[a[0].size] ?? 3;
        const sb = SIZE_ORDER[b[0].size] ?? 3;
        return sa - sb || a[1] - b[1];
      })
      .map(([f]) => f);
  }

  otherChanges({ version, audience = null }) {
    const list = this.otherChangesList.filter((c) => c.version === version);
    return audience ? list.filter((c) => c.audience === audience) : list;
  }

  validate() {
    const ids = this.featureList.map((f) => f.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length) fail(`duplicate feature ids: ${[...new Set(dupes)].join(", ")}`);

    const unknown = [...new Set(this.featureList.map((f) => f.category))].filter(
      (c) => !this.categoryOrder.includes(c),
    );
    if (unknown.length) {
      fail(
        `unknown categor${unknown.length === 1 ? "y" : "ies"}: ${unknown.map((c) => JSON.stringify(c)).join(", ")} — ` +
        "add to \"categories\" in .ledger/config.json (`ledger categories add \"…\"`), which also fixes their position",
      );
    }

    this.validateSubcategories();

    const known = new Set(this.releaseSet.versions);
    for (const f of this.featureList) {
      for (const h of f.history) {
        if (!known.has(h.version)) fail(`feature ${f.id}: version ${h.version} isn't in releases.json`);
      }
    }
    for (const c of this.otherChangesList) {
      if (!known.has(c.version)) fail(`other_changes entry for version ${c.version} isn't in releases.json`);
      if (!["user", "dev"].includes(c.audience)) fail("every other_changes entry needs an audience (user/dev)");
      if (isBlank(c.description)) fail(`other_changes entry at v${c.version} needs a description`);
    }
  }

  validateSubcategories() {
    const ids = this.subcategories.map((s) => s.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length) fail(`duplicate subcategory ids: ${[...new Set(dupes)].join(", ")}`);

    for (const s of this.subcategories) {
      if (isBlank(s.name)) fail(`subcategory ${JSON.stringify(s.id)}: needs a name`);
      if (isBlank(s.intro)) {
        fail(`subcategory ${JSON.stringify(s.id)}: needs an intro — the one-or-two-sentence overview that says what the whole area is`);
      }
      if (!this.categoryOrder.includes(s.category)) {
        fail(`subcategory ${JSON.stringify(s.id)}: unknown category ${JSON.stringify(s.category)}`);
      }
    }

    const byId = new Map(this.subcategories.map((s) => [s.id, s]));
    for (const f of this.featureList) {
      if (!f.subcategory) continue;
      const sub = byId.get(f.subcategory);
      if (!sub) {
        fail(`feature ${f.id}: unknown subcategory ${JSON.stringify(f.subcategory)} — declare it in .ledger/subcategories.json`);
      }
      if (sub.category !== f.category) {
        fail(
          `feature ${f.id}: subcategory ${JSON.stringify(sub.id)} lives under ${JSON.stringify(sub.category)}, ` +
          `but the feature is filed under ${JSON.stringify(f.category)}`,
        );
      }
    }

  }

  /**
   * The two rules that keep sub-sections load-bearing rather than a third
   * tier of taxonomy to maintain over a hundred features.
   *
   * Deliberately NOT part of validate(): declaring a sub-section and then
   * filing four features into it is a sequence, and a corpus that refused to
   * load in the middle of it would make the level unusable. So these are
   * reported by `ledger check` and enforced by `ledger build` — the two
   * moments where the shape of the corpus is what's actually being judged.
   *
   * @returns {string[]} problems, empty when the corpus is well-shaped.
   */
  shapeProblems() {
    const problems = [];

    for (const s of this.subcategories) {
      // Counted across both audiences: the bar is about how big the *area*
      // is, not how much of it happens to be client-facing.
      const n = this.featureList.filter((f) => f.subcategory === s.id).length;
      if (n < this.minSubcategoryFeatures) {
        problems.push(
          `subcategory ${JSON.stringify(s.id)} has ${n} feature${n === 1 ? "" : "s"} — a sub-section needs at least ` +
          `${this.minSubcategoryFeatures}, or its features belong loose in ${JSON.stringify(s.category)}`,
        );
      }

      // The heading and its intro *are* the overview, so a lead Big entry
      // alongside them just rebuilds the wall the sub-section was there to
      // break up.
      const big = this.featureList.filter((f) => f.subcategory === s.id && f.size === "Big");
      if (big.length) {
        problems.push(
          `subcategory ${JSON.stringify(s.id)} contains a Big feature (${big.map((f) => f.id).join(", ")}) — ` +
          "a sub-section's heading and intro are its overview, so its features are Medium and Small",
        );
      }
    }

    return problems;
  }
}
