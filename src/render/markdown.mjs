import { wording, GENERATED_HEADER } from "../wording.mjs";

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

    return `${GENERATED_HEADER()}# ${title}\n\n${intro}\n\n---\n\n${body}${trailer}`;
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
      const wholeThingNew = this.inProgress && this.allNew(members);
      const label = number === null ? `${i + 1}.` : `${number}.${i + 1}`;
      lines.push("", `### ${label} ${sub.name}${wholeThingNew ? " **[New]**" : ""}`, "", `*${sub.intro}*`, "");
      this.renderFeatures(members, lines, removedThisCycle, { extended, tag: !wholeThingNew });
    });

    // This closes out the whole category, so once sub-sections exist it has to
    // sit at the sub-sections' own heading level — left as a bold line it'd
    // read as a footnote to whichever sub-section happened to come last.
    // Categories without sub-sections keep the lighter form.
    const trailer = (text) => (subs.length ? `### ${text}` : `**${text}:**`);

    if (removedThisCycle.length) {
      lines.push("", trailer("No longer available as of this release"), "");
      for (const [f, state] of removedThisCycle) lines.push(`- **${f.currentName}**: ${state.reason}`);
    }

    return `${lines.join("\n")}\n`;
  }

  /** Every feature in the list is arriving for the first time this cycle (as
   *  opposed to some of them merely changing) — the condition for the
   *  sub-section heading, rather than each bullet, carrying the tag. */
  allNew(feats) {
    const states = feats.map((f) => f.stateAt(this.target)).filter(Boolean);
    return states.length > 0 && states.every((s) => !s.removed && s.version === this.target && s.changes === null);
  }

  renderFeatures(feats, lines, removedThisCycle, { extended, tag = true }) {
    for (const f of feats) {
      const state = f.stateAt(this.target);
      if (!state) continue;
      if (state.removed) {
        if (this.inProgress && state.version === this.target) removedThisCycle.push([f, state]);
        continue;
      }
      lines.push(this.bullet(f, state, { extended, tag }));
    }
  }

  bullet(f, state, { extended, tag }) {
    const tags = [f.size].filter(Boolean);
    const touched = tag && this.inProgress && state.version === this.target;
    if (touched) tags.push(state.changes === null ? "New" : "Changed");

    const name = state.renamedFrom ? `${state.name} (previously “${state.renamedFrom}”)` : state.name;
    // A colon, not a dash: the style guides rule the dash out, and the whole
    // document is meant to read as though written to one.
    let line = `- **[${tags.join(", ")}]** ${name}: ${state.description}`;
    if (touched && state.changes?.length) {
      line += "\n\n  **What changed:**\n";
      line += state.changes.map((c) => `  - ${c}`).join("\n");
    }
    if (extended && state.dev_notes) line += `\n\n  *Dev notes:* ${state.dev_notes}`;
    return line;
  }
}
