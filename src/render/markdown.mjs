import { wording, redraftBody, GENERATED_HEADER } from "../wording.mjs";

/**
 * The three living Markdown docs, always rendered for the *latest* release in
 * releases.json (today: the in-progress "future" one).
 *
 * New/Changed tagging is the mechanical replacement for a hand-applied "New"
 * tag: a feature gets tagged when its latest history entry lands exactly on
 * the target version *and* that release is still "future". Once a release
 * actually ships, every tag from the cycle before it goes quiet on its own —
 * there is nothing to strip by hand. The archival PDF computes this
 * differently on purpose; see src/render/ledger-html.mjs.
 */
export class MarkdownRenderer {
  constructor(project) {
    this.project = project;
    this.set = project.featureSet;
    this.words = wording(project.config);
    this.target = project.releases.latestVersion;
    this.inProgress = project.releases.at(this.target).future;
    // Nothing to tag against in a first edition, or in the first one after a
    // redraft: every entry would read "New", which says nothing. The PDF
    // prints those editions without flags for the same reason.
    this.tagging = this.inProgress && Boolean(project.releases.predecessorOf(this.target));
    this.redraftReplaces = project.releases.redraftReplaces(this.target);
  }

  /** The "reorganized" paragraph, for the first edition after a redraft. */
  redraftNotice() {
    if (!this.redraftReplaces) return "";
    const versions = this.redraftReplaces.map((v) => this.project.releases.labelOf(v));
    const note = this.project.redraftOpening(this.target)?.note;
    return `> **${this.words.redraft.title}.** ${redraftBody(this.words, versions)}${note ? `\n>\n> ${note}` : ""}\n\n`;
  }

  all() {
    return {
      features: this.featureDoc({ ...this.words.features, audience: "user", extended: false }),
      extended: this.featureDoc({ ...this.words.extended, audience: "user", extended: true }),
      dev: this.featureDoc({ ...this.words.dev, audience: "dev", extended: false }),
    };
  }

  featureDoc({ title, intro, audience, extended }) {
    const categories = this.set.categories({ audience });
    // A product whose whole ledger sits in the one default area has no areas,
    // so it gets no area heading: "## 1. Features" above the only list in a
    // document called Features is a structure the reader has to read past.
    const numbered = !this.set.unstructured;
    const body = categories
      .map((category, i) => this.category(category, { audience, extended, number: numbered ? i + 1 : null }))
      .join("\n");

    // Changes that run across the whole product close the document, once —
    // they belong to no category, and repeating them under each one would
    // read as though every area had made the same change independently.
    // Same placement the PDF edition gives them.
    const other = this.set.otherChanges({ version: this.target, audience });
    const trailer = this.inProgress && other.length
      ? `\n## Also since last time\n\nChanges that run across the whole product rather than belonging to any one feature above.\n\n${
        other.map((c) => `- ${c.description}`).join("\n")}\n`
      : "";

    return `${GENERATED_HEADER()}# ${title}\n\n${intro}\n\n${this.redraftNotice()}---\n\n${body}${trailer}`;
  }

  category(category, { audience, extended, number }) {
    const { loose, subs } = this.set.sections({ category, audience });
    const lines = number === null ? [] : [`## ${number}. ${category}`, ""];
    const removedThisCycle = [];

    this.renderFeatures(loose, lines, removedThisCycle, { extended });

    subs.forEach(({ sub, members }, i) => {
      // When a whole sub-section arrives at once, the heading carries the tag
      // and its features stay quiet — a column of identical "New"s says
      // nothing the heading hasn't already said, and it would drown out the
      // one genuinely changed entry the release after.
      const whole = this.tagging ? this.uniformTag(members) : null;
      const label = number === null ? `${i + 1}.` : `${number}.${i + 1}`;
      lines.push("", `### ${label} ${sub.name}${whole ? ` **[${whole}]**` : ""}`, "", `*${sub.intro}*`, "");
      this.renderFeatures(members, lines, removedThisCycle, { extended, tag: !whole });
    });

    // This closes out the whole category, so once sub-sections exist it has to
    // sit at the sub-sections' own heading level — left as a bold line it'd
    // read as a footnote to whichever sub-section happened to come last.
    // Categories without sub-sections keep the lighter form.
    const trailer = (text) => (subs.length ? `### ${text}` : `**${text}:**`);

    const gone = removedThisCycle.filter(([, s]) => !s.backfilled);
    const goneEarlier = removedThisCycle.filter(([, s]) => s.backfilled);

    if (gone.length) {
      lines.push("", trailer("No longer available as of this release"), "");
      for (const [f, state] of gone) lines.push(`- **${f.currentName}**: ${state.reason}`);
    }
    // Withdrawn before the last cutoff and only now recorded. Kept apart from
    // this release's news, and worded so it claims no date — the audit does no
    // archaeology, so the release it went in is not known.
    if (goneEarlier.length) {
      lines.push("", trailer(`${this.words.tags.backfilled_removed}, recorded here for the first time`), "");
      for (const [f, state] of goneEarlier) lines.push(`- **${f.currentName}**: ${state.reason}`);
    }

    return `${lines.join("\n")}\n`;
  }

  /**
   * The one tag the whole list shares, or null — the condition for the
   * sub-section heading, rather than each bullet, carrying it.
   *
   * Two cases qualify: every feature arriving for the first time this cycle,
   * and every feature being one an audit found late. Both are a single
   * statement about the section, so the heading can make it once. A list of
   * merely-changed entries never collapses: each one carries its own reason,
   * which is the part worth reading.
   */
  uniformTag(feats) {
    const states = feats.map((f) => f.stateAt(this.target)).filter(Boolean);
    if (!states.length) return null;
    if (!states.every((s) => !s.removed && s.version === this.target)) return null;
    if (states.every((s) => s.backfilled)) return this.words.tags.backfilled;
    if (states.every((s) => !s.backfilled) && feats.every((f) => f.firstVersion === this.target)) return "New";
    return null;
  }

  renderFeatures(feats, lines, removedThisCycle, { extended, tag = true }) {
    for (const f of feats) {
      const state = f.stateAt(this.target);
      if (!state) continue;
      if (state.removed) {
        if (this.tagging && state.version === this.target) removedThisCycle.push([f, state]);
        continue;
      }
      lines.push(this.bullet(f, state, { extended, tag }));
    }
  }

  bullet(f, state, { extended, tag }) {
    const tags = [f.size].filter(Boolean);
    const touched = tag && this.tagging && state.version === this.target;
    // Backfilled wins over both: the entry has a `changes` list like any
    // other, and tagging it "Changed" would say the product moved this cycle.
    if (touched) {
      tags.push(state.backfilled
        ? this.words.tags.backfilled
        : (f.firstVersion === this.target ? "New" : "Changed"));
    }

    const name = state.renamedFrom ? `${state.name} (previously “${state.renamedFrom}”)` : state.name;
    // A colon, not a dash: the style guides rule the dash out, and the whole
    // document is meant to read as though written to one.
    let line = `- **[${tags.join(", ")}]** ${name}: ${state.description}`;
    if (touched && f.firstVersion !== this.target && state.changes?.length) {
      line += "\n\n  **What changed:**\n";
      line += state.changes.map((c) => `  - ${c}`).join("\n");
    }
    if (extended && state.dev_notes) line += `\n\n  *Dev notes:* ${state.dev_notes}`;
    return line;
  }
}
