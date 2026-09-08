import { escapeHtml as h, longDate } from "../util.mjs";
import { wording } from "../wording.mjs";
import { resolveBrand, mastheadHtml } from "./brand.mjs";
import { fontFaceCss, checkGlyphs } from "./fonts.mjs";

/**
 * The client-facing "feature ledger" for one specific release — an archival
 * snapshot, unlike the living Markdown docs (which always render for the
 * latest release only).
 *
 * New/Changed tags here are computed relative to that release's own
 * predecessor, ALWAYS — even for a release from months ago — because the
 * whole point of the ledger is reproducing what was actually presented at
 * that moment. This is deliberately different from the Markdown renderer,
 * which only shows New/Changed while the target release is still in
 * progress. Version 1 has no predecessor, so a first edition prints as a
 * plain inventory with no flags anywhere on it: exactly what you want when
 * the corpus is a baseline of a codebase that already existed.
 *
 * Rendered as real HTML/CSS and printed with headless Chromium the same way
 * a person would print a styled page — not hand-positioned PDF drawing.
 */
export function renderLedgerHtml({ project, version }) {
  const doc = new LedgerHtml(project, version);
  const html = doc.render();
  checkGlyphs(html);
  return { html, warnings: doc.warnings };
}

const SIZE_LEVELS = { big: 3, medium: 2, small: 1 };

/* Anchors for the three sections that close the document. Named rather than
 * numbered because, unlike the areas, they aren't part of the product's
 * structure — see `categoryId`. */
const CLOSING_IDS = { removed: "closing-removed", goneEarlier: "closing-gone-earlier", other: "closing-other" };

class LedgerHtml {
  constructor(project, version) {
    this.project = project;
    this.config = project.config;
    this.set = project.featureSet;
    this.version = version ?? project.releases.latestVersion;
    this.release = project.releases.at(this.version);
    this.predecessor = project.releases.predecessorOf(this.version);
    this.brand = resolveBrand(project.brand);
    this.words = wording(project.config);
    this.warnings = [];
  }

  /* ---- the data the template walks ------------------------------------ */

  /**
   * [category, flat rows, groups] per category. The flat list is what the
   * front-matter stats and the contents counts are built from — a
   * sub-section is a way of laying a category out, not a thing to count.
   * `groups` is [[sub-or-null, rows]], loose features first, and is what the
   * body actually walks.
   */
  get categoryRows() {
    if (this._categoryRows) return this._categoryRows;

    const out = [];
    for (const category of this.set.categories({ audience: "user" })) {
      const { loose, subs } = this.set.sections({ category, audience: "user" });

      const groups = [[null, this.buildRows(loose)]];
      for (const { sub, members } of subs) {
        const rows = this.buildRows(members);
        if (!rows.length) continue;

        // When the whole sub-section is arriving at once, it's drawn as one
        // green card and its rows stay plain inside it, rather than printing
        // a stack of identical NEW cards. Only the *drawing* moves: `badge`
        // itself is left alone, since the front-matter tallies and the
        // contents dots still have to count eight new features as eight.
        // A sub-section arriving all at once is one card, not a stack of
        // identical chips — and a sub-section the audit found all at once is
        // the same shape of statement, so it collapses the same way. Only
        // "updated" never collapses: a column of reworked entries each has
        // its own reason, which is the part worth reading.
        const uniform = ["new", "backfilled"].find((b) => rows.every((r) => r.badge === b)) ?? null;
        const whole = this.predecessor ? uniform : null;
        if (whole) rows.forEach((r) => { r.showBadge = false; });
        groups.push([{ name: sub.name, intro: sub.intro, badge: whole }, rows]);
      }

      const live = groups.filter(([, rows]) => rows.length);
      const rows = live.flatMap(([, r]) => r);
      if (!rows.length) continue;

      this.markSeams(live, rows);
      out.push([category, rows, live]);
    }
    this._categoryRows = out;
    return out;
  }

  buildRows(feats) {
    const rows = [];
    for (const f of feats) {
      const state = f.stateAt(this.version);
      if (!state || state.removed) continue;
      // Three registers, not two. Green and blue say the product moved at
      // this version; grey says the product did not — the record did, because
      // an audit found this late. `backfilled` therefore wins over both: an
      // entry an audit recorded has a `changes` list like any other, and
      // drawing it blue would tell the client it was reworked this cycle.
      let badge = null;
      if (state.version === this.version) {
        if (state.backfilled) badge = "backfilled";
        else badge = state.changes === null ? "new" : "updated";
      }
      if (!this.predecessor) badge = null; // nothing to diff a first edition against
      rows.push({ feature: f, state, badge, showBadge: true, noLine: false });
    }
    return rows;
  }

  /**
   * Which rows drop their bottom hairline. This can't be left to
   * `.feature:last-child`, because a row's DOM parent isn't the category —
   * the first row of every group is wrapped with its heading to keep the two
   * on one page, which makes it its wrapper's last child and would silently
   * eat the separator under the first feature of every section. So the seam
   * is decided here, over the category's real row order, and travels to the
   * markup as a class.
   */
  markSeams(groups, rows) {
    const groupOf = new Map();
    groups.forEach(([, grows], gi) => grows.forEach((r) => groupOf.set(r, gi)));

    rows.forEach((row, i) => {
      const next = rows[i + 1];
      row.noLine = !next                                  // end of the category
        || groupOf.get(next) !== groupOf.get(row)         // a heading comes next
        || this.displayBadge(next) !== null;              // a coloured card comes next
    });
  }

  displayBadge(row) {
    return row.showBadge === false ? null : row.badge;
  }

  get stats() {
    const rows = this.categoryRows.flatMap(([, r]) => r);
    const count = (p) => rows.filter(p).length;
    return {
      features: rows.length,
      areas: this.categoryRows.length,
      big: count((r) => r.feature.size === "Big"),
      medium: count((r) => r.feature.size === "Medium"),
      small: count((r) => r.feature.size === "Small"),
      new: count((r) => r.badge === "new"),
      updated: count((r) => r.badge === "updated"),
      backfilled: count((r) => r.badge === "backfilled"),
      unchanged: count((r) => r.badge === null),
    };
  }

  /** Each size's share of the total, for the width of its slice in the
   *  breakdown bar. Two decimals so the three slices add up to a full bar
   *  rather than leaving a hairline of background at the right end. */
  sizeShare(key) {
    const total = this.stats.features;
    return total === 0 ? 0 : Math.round((this.stats[key] * 10000) / total) / 100;
  }

  /** Withdrawn in the cycle this edition covers — announced as this
   *  edition's news. */
  get removedThisVersion() {
    return this.removals.filter(([, s]) => !s.backfilled);
  }

  /**
   * Withdrawn at some point before the last cutoff, and never recorded until
   * an audit found it. Still reported — a capability that is gone and was
   * never mentioned is precisely what a reader needs to know, and a tool that
   * decided on its own to withhold it would be worth less than one that
   * reports everything. Drawn apart from the news, and worded so it claims no
   * date: the audit deliberately does no archaeology, so the document does
   * not know which release it went in.
   */
  get backfilledRemovals() {
    return this.removals.filter(([, s]) => s.backfilled);
  }

  get removals() {
    if (!this.predecessor) return [];
    return this.set
      .features({ audience: "user" })
      .map((f) => [f, f.stateAt(this.version)])
      .filter(([, s]) => s?.removed && s.version === this.version);
  }

  get otherChanges() {
    return this.set.otherChanges({ version: this.version, audience: "user" });
  }

  /* ---- fragments ------------------------------------------------------ */

  categoryNumber(i) {
    return String(i + 1).padStart(2, "0");
  }

  /** Anchor an area heading answers to, so the Contents entry for it can be
   *  a real link. Chromium carries `<a href="#id">` into the printed PDF as
   *  an internal jump, which is the only reason the contents list is
   *  clickable — index-based, so it can't collide with a category name. */
  categoryId(i) {
    return `area-${i + 1}`;
  }

  catHead(category, index, count, nNew, nUpd, nBack) {
    let meta = `${count} ${count === 1 ? "feature" : "features"}`;
    if (nNew > 0) meta += ` · <em>${nNew} new</em>`;
    if (nUpd > 0) meta += ` · <i>${nUpd} updated</i>`;
    if (nBack > 0) meta += ` · <b>${nBack} already in place</b>`;
    return `<div class="cat-head" id="${this.categoryId(index)}"><span class="num">${this.categoryNumber(index)}</span>` +
      `<h2>${h(category)}</h2><span class="meta">${meta}</span></div>`;
  }

  /** A name a step down from the category head, with the one-line overview
   *  that stands in for the single oversized entry the sub-section grew out
   *  of. It carries no NEW chip of its own — a wholly-new sub-section is
   *  drawn as one green card with this heading inside it, and green already
   *  means exactly that. */
  subHead(sub) {
    return `<div class="sub-head"><div class="sub-name">${h(sub.name)}</div>` +
      `<div class="sub-intro">${h(sub.intro)}</div></div>`;
  }

  /**
   * Big/Medium/Small drawn as three steps of one scale: the same filled chip,
   * three tints deep, with a 3-segment meter showing how many steps up this
   * one sits. The meter is what makes the ranking legible to someone who
   * never read the legend on the front page.
   *
   * All three are capabilities; the scale ranks them within this product, and
   * says nothing about how detailed an entry is allowed to be.
   */
  sizeChip(size) {
    const key = String(size ?? "").toLowerCase();
    const lit = SIZE_LEVELS[key];
    if (!lit) return ""; // unsized entries just get no chip
    const bars = [1, 2, 3].map((i) => `<i class="${i <= lit ? "on" : "off"}"></i>`).join("");
    return `<span class="size size-${key}"><span class="meter">${bars}</span>${h(String(size).toUpperCase())}</span>`;
  }

  /** Only ever rendered on a row flagged new/updated for *this* edition — a
   *  `changes` list left over from an older version describes a diff the
   *  reader already saw in an earlier ledger. */
  changesPanel(state) {
    if (!state.changes?.length) return "";
    const items = state.changes.map((c) => `<li>${h(c)}</li>`).join("");
    return `<div class="changes"><span class="label">What changed</span><ul>${items}</ul></div>`;
  }

  /**
   * The word printed on a row's chip. "new" and "updated" happen to be the
   * label as well as the key; the third register does not, and printing the key
   * would put an internal term in front of a client. It comes from the
   * overridable wording instead, so a project can pick its own phrasing.
   */
  badgeLabel(badge) {
    if (badge === "backfilled") return this.words.tags.backfilled.toUpperCase();
    return badge.toUpperCase();
  }

  /** One ledger row. Shared by the "first row, glued to its section heading
   *  so the heading can never be orphaned at the foot of a page" case and by
   *  every row after it, so the two can't drift apart. */
  featureRow(row) {
    const f = row.feature;
    const s = row.state;
    const badge = this.displayBadge(row);
    const classes = ["feature", badge, row.noLine ? "no-line" : null].filter(Boolean).join(" ");
    const was = s.renamedFrom ? `<span class="was">previously &ldquo;${h(s.renamedFrom)}&rdquo;</span>` : "";
    const tag = badge ? `<span class="tag tag-${badge}">${h(this.badgeLabel(badge))}</span>` : "";

    return `<div class="${classes}"><div class="content">` +
      `<div class="badges">${this.sizeChip(f.size)}${tag}</div>` +
      `<div class="body"><div class="name">${h(s.name)}${was}</div>` +
      `<div class="desc">${h(s.description)}</div>` +
      `${badge ? this.changesPanel(s) : ""}</div></div></div>`;
  }

  /* ---- the document --------------------------------------------------- */

  render() {
    const { css: fontCss, embedded } = fontFaceCss(this.brand);
    if (!embedded) {
      this.warnings.push(
        `brand.json asks for fonts this package doesn't bundle (${this.brand.fonts.display} / ${this.brand.fonts.body}). ` +
        "The PDF will print in whatever the machine has installed, and text may not copy cleanly out of it.",
      );
    }

    const rel = this.release;
    const dateLabel = longDate(rel.date);
    const predDateLabel = this.predecessor ? longDate(this.predecessor.date) : null;
    const stats = this.stats;
    const w = this.words.pdf;
    const footerLeft = `${this.brand.name} · The Feature Ledger · Version ${this.version}` +
      (dateLabel ? ` · ${dateLabel}` : "");

    const body = this.categoryRows.map(([category, rows, groups], i) => {
      const nNew = rows.filter((r) => r.badge === "new").length;
      const nUpd = rows.filter((r) => r.badge === "updated").length;
      const nBack = rows.filter((r) => r.badge === "backfilled").length;

      // Every heading is glued to its own first row, so neither a category
      // head nor a sub-section head can be stranded at the foot of a page.
      // The category head rides along with the first LOOSE row; a category
      // made only of sub-sections stands alone and leans on break-after.
      // An undivided ledger prints no area heading at all: one heading above
      // the only list in the document is a structure the reader has to read
      // past to get to the product.
      const head = this.set.unstructured ? "" : this.catHead(category, i, rows.length, nNew, nUpd, nBack);

      const inner = groups.map(([sub, grows], gi) => {
        if (sub === null) {
          return `<div class="cat-open">${head}${this.featureRow(grows[0])}</div>` +
            grows.slice(1).map((r) => this.featureRow(r)).join("");
        }
        const alone = gi === 0 && head ? `<div class="cat-open cat-alone">${head}</div>` : "";
        return `${alone}<div class="subsection${sub.badge ? ` ${sub.badge}` : ""}"><div class="sub-body">` +
          `<div class="sub-open">${this.subHead(sub)}${this.featureRow(grows[0])}</div>` +
          grows.slice(1).map((r) => this.featureRow(r)).join("") +
          "</div></div>";
      }).join("");

      return `<div class="category">${inner}</div>`;
    }).join("");

    // The three closing sections are resolved before the contents list so it
    // can link to whichever of them this edition actually prints.
    const removed = this.removedThisVersion;
    const goneEarlier = this.backfilledRemovals;
    const other = this.otherChanges;
    const closing = [
      [removed.length, CLOSING_IDS.removed, "No longer available as of this edition", removed.length],
      [goneEarlier.length, CLOSING_IDS.goneEarlier, this.words.tags.backfilled_removed, goneEarlier.length],
      [other.length, CLOSING_IDS.other, "Also since last time", other.length],
    ].filter(([present]) => present);

    const contents = this.categoryRows.map(([category, rows], i) => {
      const nNew = rows.filter((r) => r.badge === "new").length;
      const nUpd = rows.filter((r) => r.badge === "updated").length;
      const nBack = rows.filter((r) => r.badge === "backfilled").length;
      const flags = '<i class="dot-new"></i>'.repeat(nNew)
        + '<i class="dot-updated"></i>'.repeat(nUpd)
        + '<i class="dot-backfilled"></i>'.repeat(nBack);
      return `<li><a href="#${this.categoryId(i)}">` +
        `<span class="num">${this.categoryNumber(i)}</span><span class="nm">${h(category)}</span>` +
        `<span class="flags">${flags}</span><span class="ct">${rows.length}</span></a></li>`;
    }).join("");

    // Deliberately not numbered and deliberately quieter: these are closing
    // notes about what left the product, not areas of it, and a reader
    // scanning "01…08" shouldn't have to wonder why the count went up.
    const closingContents = closing.map(([, id, title, count]) =>
      `<li><a href="#${id}"><span class="num">&mdash;</span><span class="nm">${h(title)}</span>` +
      `<span class="ct">${count}</span></a></li>`).join("");

    const sinceBlock = this.predecessor ? `
      <div class="split-label">Since the last edition${predDateLabel ? `, ${predDateLabel}` : ""}</div>
      <div class="since">
        <div class="item is-new"><span class="n">${stats.new}</span><span class="l">New</span></div>
        <div class="item is-updated"><span class="n">${stats.updated}</span><span class="l">Updated</span></div>
        ${stats.backfilled > 0
          ? `<div class="item is-backfilled"><span class="n">${stats.backfilled}</span><span class="l">Already in place</span></div>`
          : ""}
        <div class="item is-same"><span class="n">${stats.unchanged}</span><span class="l">Unchanged</span></div>
      </div>` : "";

    const callout = this.predecessor ? `
      <div class="callout"><div class="callout-content">
        <b>What's changed since the last edition${predDateLabel ? ` (${predDateLabel})` : ""}:</b>
        every entry below is highlighted to show what's different. A green stripe marks a brand-new feature;
        a blue stripe marks an existing feature that was materially reworked, with its own
        <b>What changed</b> note.${stats.backfilled > 0 ? ` A grey stripe marks a capability that was already
        part of ${h(this.brand.name)} and is listed here for the first time, rather than something built this
        time.` : ""} Anything without a stripe hasn't changed.
        <div class="legend">
          <span><i class="dot-new"></i> New feature</span>
          <span><i class="dot-updated"></i> Updated feature</span>
          ${stats.backfilled > 0 ? `<span><i class="dot-backfilled"></i> ${h(this.words.tags.backfilled)}</span>` : ""}
        </div>
      </div></div>` : "";

    const removedBox = ([f, s], cls = "") =>
      `<div class="removed-box${cls}"><div class="removed-box-content">` +
      `<span class="name">${h(f.currentName)}</span> &mdash; ${h(s.reason)}</div></div>`;

    const removedBlock = removed.length ? `
      <div class="category">
        <div class="cat-head" id="${CLOSING_IDS.removed}"><span class="num">&mdash;</span><h2>No longer available as of this edition</h2></div>
        ${removed.map((r) => removedBox(r)).join("")}
      </div>` : "";

    // Deliberately its own block, and deliberately vague about timing: these
    // went before the last cutoff, and since the audit does no archaeology the
    // document cannot honestly name the release they went in.
    const goneEarlierBlock = goneEarlier.length ? `
      <div class="category">
        <div class="cat-head" id="${CLOSING_IDS.goneEarlier}"><span class="num">&mdash;</span><h2>${h(this.words.tags.backfilled_removed)}</h2>
          <span class="meta">recorded here for the first time</span></div>
        ${goneEarlier.map((r) => removedBox(r, " backfilled")).join("")}
      </div>` : "";

    const otherBlock = other.length ? `
      <div class="other-changes" id="${CLOSING_IDS.other}">
        <h2>Also since last time</h2>
        <p class="sub">Changes that run across the whole product rather than belonging to any one feature above.</p>
        <ul>${other.map((c) => `<li>${h(c.description)}</li>`).join("")}</ul>
      </div>` : "";

    const sizeBar = [["big", "Big"], ["medium", "Medium"], ["small", "Small"]]
      .filter(([key]) => stats[key] > 0)
      .map(([key, label]) => `<div class="seg seg-${key}" style="width:${this.sizeShare(key)}%"><b>${stats[key]}</b> ${label}</div>`)
      .join("");

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${h(this.brand.name)} Feature Ledger — Version ${this.version}</title>
<!-- The PDF driver reads this to build the printed running footer, which
     lives in the paper margin and so can't be styled from this page. -->
<meta name="pdf-footer-left" content="${h(footerLeft)}">
<style>
${fontCss}
${this.paletteCss()}
${STYLES}
${this.project.themeCss()}
</style>
</head>
<body>
  <header class="front">
    <div class="masthead">
      ${mastheadHtml(this.brand, this.project.root)}
      <div class="imprint">Feature Ledger<br>Version ${this.version}${dateLabel ? ` · ${dateLabel}` : ""}</div>
    </div>

    <h1 class="title">${w.title_html}</h1>
    <div class="edition ${rel.future ? "is-draft" : "is-final"}">
      Version ${this.version}${rel.name ? ` · ${h(rel.name)}` : ""}${rel.future ? " · draft, not yet presented" : ""}
    </div>
    <p class="intro">${h(w.intro)}</p>
    ${callout}

    <div class="panel">
      <div class="kicker">The ledger at a glance</div>
      <div class="headline">${stats.areas > 1
        ? `<b>${stats.features}</b> features <span>across</span> <b>${stats.areas}</b> areas`
        : `<b>${stats.features}</b> feature${stats.features === 1 ? "" : "s"}`}</div>

      <div class="split-label">Every one of those ${stats.features}, by size</div>
      <div class="bar">${sizeBar}</div>
      <div class="bar-key">
        <div class="row">${this.sizeChip("Big")} A capability the product is chosen for</div>
        <div class="row">${this.sizeChip("Medium")} A capability in its own right, inside a bigger one</div>
        <div class="row">${this.sizeChip("Small")} A capability narrow enough to describe in a line</div>
      </div>
      ${sinceBlock}
    </div>
  </header>

  ${this.set.unstructured ? "" : `<div class="contents">
    <div class="kicker">Contents</div>
    <ol>${contents}</ol>
    ${closingContents ? `<ul class="closing">${closingContents}</ul>` : ""}
  </div>`}

  ${body}
  ${removedBlock}
  ${goneEarlierBlock}
  ${otherBlock}

  <div class="colophon">
    ${h(this.brand.name)} · The Feature Ledger · Version ${this.version}${dateLabel ? ` · ${dateLabel}` : ""}.
    ${h(w.colophon)}
  </div>
</body>
</html>
`;
  }

  paletteCss() {
    const b = this.brand;
    return `  :root {
    --ink: #151a23; --ink-soft: #4e5766; --ink-faint: #8d95a4; --ink-ghost: #c2c8d2;
    --paper: #ffffff; --line: #e6e9ef; --line-soft: #eef0f5;

    --accent: ${b.accent}; --accent-deep: ${b.accent_deep}; --accent-quiet: ${b.accent_quiet};
    --accent-mid: ${b.accent_mid}; --accent-pale: ${b.accent_pale};

    --green: #12744a; --green-deep: #0b5233; --green-soft: #e7f4ed; --green-line: #cfe6d9;
    --blue: #2a51c8; --blue-deep: #1c3c99; --blue-soft: #eaf0fd;

    /* The third register. Deliberately not a fourth hue: green and blue are
       already spoken for, and brand.json forbids an accent in the green/blue
       band precisely so those two keep their meaning — a fifth hue would
       squeeze every brand into reds, oranges, purples and browns. It is also
       not the same KIND of fact. Green and blue say the software moved; this
       says the document caught up. Neutral grey is the one family a brand
       accent never occupies, so it is safe against every palette, and it
       recedes, which is the point. */
    --slate: #6b7280; --slate-deep: #414753; --slate-soft: #edeff2; --slate-line: #dfe2e7;

    --font-display: '${b.fonts.display}', Georgia, 'Times New Roman', serif;
    --font-body: '${b.fonts.body}', 'Helvetica Neue', Arial, sans-serif;

    /* One shared text measure — roughly 70 characters at body size, the
       comfortable-reading width. Descriptions and change notes both honour
       it, so every block of prose starts and ends on the same two invisible
       vertical lines instead of running the full width of the page. */
    --measure: 500px;
  }`;
  }
}

/*
 * The stylesheet. Every tint is a real flat colour rather than an alpha
 * blend, so what a CMYK press or an office laser prints is what's specified.
 *
 * A note on tracked caps and copy-paste: PDF text extractors read a wide
 * enough gap between two letters as a word break, so the display kickers on
 * the cover copy out spelled apart ("T H E L E D G E R"). That's the cost of
 * the look and it's paid by six decorative labels — every line of actual
 * content copies verbatim. The one place it was worth trading a hair of
 * tracking for is .changes .label, which sits INSIDE a feature's prose rather
 * than over it.
 */
const STYLES = `
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: var(--font-body); color: var(--ink);
    font-size: 10.5pt; line-height: 1.55; -webkit-font-smoothing: antialiased;
  }
  h1, h2, h3 { margin: 0; line-height: 1.15; }

  /* Serif for anything that names something (the title, section names,
     feature names, figures); sans for anything that explains it. The two
     jobs never share a face, which is what lets a reader skim names and read
     prose without the page having to shout. */
  .serif { font-family: var(--font-display); }

  /* ======================= FRONT MATTER ======================= */
  /* Kept to its own page so the ledger proper always opens clean at the top
     of page 2, whatever length the intro runs to. */
  .front { break-after: page; }

  .masthead {
    display: flex; align-items: flex-end; justify-content: space-between;
    padding-bottom: 14px; border-bottom: 1px solid var(--line);
  }
  .masthead img { display: block; }
  /* The stand-in when a project hasn't got a logo file yet: the product name
     set in the display face, which reads as a considered masthead rather
     than as a missing image. */
  .masthead .wordmark {
    font-family: var(--font-display); font-size: 17pt; font-weight: 700;
    letter-spacing: -.015em; color: var(--accent-deep);
  }
  .masthead .imprint {
    font-size: 7.5pt; font-weight: 700; letter-spacing: .14em; text-transform: uppercase;
    color: var(--ink-faint); text-align: right;
  }

  h1.title {
    font-family: var(--font-display); font-size: 52pt; font-weight: 900; letter-spacing: -.025em;
    margin-top: 42px; line-height: 1.02;
  }
  h1.title em { font-style: normal; color: var(--accent); }

  .edition {
    display: inline-flex; align-items: center; gap: 7px; margin-top: 18px; font-weight: 700; font-size: 8pt;
    letter-spacing: .1em; text-transform: uppercase; border-radius: 3px; padding: 5px 11px 5px 9px;
  }
  .edition::before { content: ""; width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
  .edition.is-draft { background: var(--accent-pale); color: var(--accent-deep); }
  .edition.is-draft::before { background: var(--accent); }
  /* Deliberately neutral, not green: green is spoken for — it means "new
     since last time" and nothing else anywhere in this document. */
  .edition.is-final { background: #eef0f5; color: var(--ink-soft); }
  .edition.is-final::before { background: var(--ink-faint); }

  .intro { margin-top: 22px; color: var(--ink-soft); max-width: var(--measure); }

  /* The accent strip is a flat-coloured gap between two flat rectangles —
     the dark backdrop (.callout) and the lighter inset on top of it
     (.callout-content, offset right by margin) — clipped together by one
     border-radius + overflow: hidden on the shared outer shape. That's what
     makes the strip's rounded cap and the card's own corner the same curve
     instead of two separately-drawn arcs that have to be nudged into lining
     up. Same trick powers .feature and .removed-box below. */
  .callout { margin-top: 32px; background: var(--blue); border-radius: 8px; overflow: hidden; }
  .callout-content { background: var(--blue-soft); margin-left: 5px; padding: 16px 20px; font-size: 9.5pt; }
  .callout b { color: var(--blue-deep); }
  .callout .legend { margin-top: 12px; display: flex; gap: 20px; flex-wrap: wrap; }
  .callout .legend span { display: inline-flex; align-items: center; gap: 7px; font-size: 8.5pt; color: var(--ink-soft); font-weight: 600; }
  .callout .legend i { width: 4px; height: 13px; border-radius: 2px; display: inline-block; }
  .dot-new { background: var(--green); }
  .dot-updated { background: var(--blue); }
  .dot-backfilled { background: var(--slate); }

  /* ---- At a glance ----
     The total reads as a sentence, and the size split is drawn as one bar cut
     into three pieces, so it's self-evidently a breakdown *of* that total and
     not five more facts sitting in a row inviting comparison. */
  .kicker {
    font-size: 7.5pt; font-weight: 800; letter-spacing: .14em; text-transform: uppercase;
    color: var(--accent); margin-bottom: 12px;
  }
  .panel { margin-top: 36px; }
  .headline { font-family: var(--font-display); font-size: 15pt; color: var(--ink-soft); font-weight: 400; }
  .headline b { font-weight: 700; font-size: 27pt; color: var(--ink); letter-spacing: -.01em; }

  .split-label {
    margin-top: 26px; font-size: 7.5pt; font-weight: 800; letter-spacing: .12em;
    text-transform: uppercase; color: var(--ink-faint); margin-bottom: 7px;
  }
  .bar { display: flex; border-radius: 5px; overflow: hidden; }
  .bar .seg {
    padding: 11px 13px; font-size: 8pt; font-weight: 700; letter-spacing: .06em;
    text-transform: uppercase; white-space: nowrap; overflow: hidden;
  }
  .bar .seg b { font-family: var(--font-display); font-size: 12.5pt; font-weight: 700; letter-spacing: 0; margin-right: 4px; }
  .bar .seg-big { background: var(--accent); color: #fff; }
  .bar .seg-medium { background: var(--accent-mid); color: var(--accent-deep); }
  .bar .seg-small { background: var(--accent-pale); color: var(--accent-quiet); }
  /* The key shows the real chip, not a description of it — so the three
     slices of the bar above and the three marks stamped on every row of the
     ledger are visibly the same three things, and "how big is this one" is
     answered once, on page one, for the whole document. */
  .bar-key { margin-top: 13px; display: flex; flex-direction: column; gap: 7px; }
  .bar-key .row { display: flex; align-items: center; gap: 12px; font-size: 9pt; color: var(--ink-soft); }
  .bar-key .row .size { flex: 0 0 90px; }

  .since { display: flex; gap: 34px; margin-top: 24px; flex-wrap: wrap; }
  .since .item { display: flex; align-items: baseline; gap: 8px; }
  .since .n { font-family: var(--font-display); font-size: 21pt; font-weight: 700; line-height: 1; }
  .since .l { font-size: 8pt; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; }
  .since .is-new .n { color: var(--green-deep); } .since .is-new .l { color: var(--green-deep); }
  .since .is-updated .n { color: var(--blue-deep); } .since .is-updated .l { color: var(--blue-deep); }
  .since .is-backfilled .n { color: var(--slate-deep); } .since .is-backfilled .l { color: var(--slate-deep); }
  .since .is-same .n { color: var(--ink-ghost); } .since .is-same .l { color: var(--ink-faint); }

  /* ---- Contents ---- */
  .contents { padding-top: 14px; border-top: 2px solid var(--accent); margin-bottom: 34px; break-inside: avoid; }
  .contents ol { columns: 2; column-gap: 34px; margin: 14px 0 0; padding: 0; list-style: none; }
  .contents li { break-inside: avoid; border-bottom: 1px solid var(--line-soft); }
  .contents a {
    display: flex; align-items: baseline; gap: 8px;
    padding: 5px 0; font-size: 9.5pt;
    color: inherit; text-decoration: none;
  }
  .contents .num { font-family: var(--font-display); font-weight: 700; color: var(--accent); font-size: 9.5pt; flex: 0 0 auto; }
  .contents .nm { font-family: var(--font-display); font-weight: 600; flex: 1; min-width: 0; }
  .contents .flags { display: flex; gap: 3px; flex: 0 0 auto; }
  .contents .flags i { width: 4px; height: 11px; border-radius: 1px; display: inline-block; }
  .contents .ct { flex: 0 0 auto; color: var(--ink-faint); font-size: 8.5pt; font-weight: 600; font-variant-numeric: tabular-nums; }

  /* The closing sections: same grid, dashed instead of numbered and a shade
     quieter, so they read as notes after the areas rather than as areas. */
  .contents .closing { columns: 2; column-gap: 34px; margin: 6px 0 0; padding: 0; list-style: none; }
  .contents .closing li { break-inside: avoid; border-bottom: 1px solid var(--line-soft); }
  .contents .closing .num { color: var(--ink-ghost); font-weight: 400; }
  .contents .closing .nm { font-weight: 500; color: var(--ink-soft); }

  /* ======================= THE LEDGER ======================= */
  .category { margin-top: 30px; }
  .front + .category, .category:first-of-type { margin-top: 0; }

  /* Header and first row are glued together so a section name can never be
     stranded alone at the foot of a page. */
  .cat-open { break-inside: avoid; }
  .cat-alone { break-after: avoid; }
  .cat-head {
    display: flex; align-items: baseline; gap: 11px; padding-top: 14px;
    border-top: 2px solid var(--accent); margin-bottom: 6px;
  }
  .cat-head .num { font-family: var(--font-display); font-size: 15pt; font-weight: 700; color: var(--accent); }
  .cat-head h2 { font-family: var(--font-display); font-size: 15pt; font-weight: 700; flex: 1; letter-spacing: -.005em; }
  .cat-head .meta { font-size: 8pt; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--ink-faint); white-space: nowrap; }
  .cat-head .meta em { font-style: normal; color: var(--green-deep); }
  .cat-head .meta i { font-style: normal; color: var(--blue-deep); }
  .cat-head .meta b { font-weight: 700; color: var(--slate-deep); }

  /* ---- Sub-sections ----
     One area inside a category that got big enough to swamp its neighbours.
     It has to read as a clear step DOWN from a category head and a clear
     step UP from a feature name, and those two neighbours are both set in
     the display face at 15pt and 12pt. So the separation is carried by
     weight and colour rather than by squeezing a third size in between: a
     hairline accent rule above (against the category's full 2pt one), the
     name in accent ink, and the overview set in the body face so it can't be
     mistaken for another feature's description. */
  .subsection { margin-top: 20px; }
  .sub-open { break-inside: avoid; }
  .sub-head { padding-top: 11px; border-top: 1px solid var(--accent-mid); margin-bottom: 4px; }
  .sub-name {
    font-family: var(--font-display); font-size: 13pt; font-weight: 700;
    color: var(--accent-deep); letter-spacing: -.005em;
  }
  /* Reads as an overview, not a caption: this line stands in for the single
     oversized entry the sub-section replaced, so it gets the same ink as the
     descriptions below it rather than being greyed back into a subtitle
     nobody reads. */
  .sub-intro { margin-top: 3px; font-size: 9.5pt; color: var(--ink-soft); max-width: var(--measure); }

  /* ---- A wholly-new sub-section ----
     Green already means "new since last time" everywhere else in this
     document, so a sub-section that arrives complete is drawn as ONE green
     card — heading, overview and every feature inside it — rather than as a
     heading with a NEW chip over a stack of separately-green rows.
     Deliberately NOT break-inside: avoid — eight entries can't be asked to
     fit on one page — so it fragments across pages the way a long tinted
     block should. Inside it the rows drop their own 5px strip gutter and
     take the card's, which keeps every badge and feature name on the same
     two vertical lines as the ungrouped rows above and below. */
  .subsection.new { background: var(--green); border-radius: 7px; overflow: hidden; margin: 16px 0 6px; }
  .subsection.new > .sub-body { background: var(--green-soft); margin-left: 5px; }
  .subsection.new .sub-head { border-top: none; padding: 15px 15px 0; margin-bottom: 0; }
  .subsection.new .sub-name { color: var(--green-deep); }
  .subsection.new .sub-intro { color: var(--ink); }
  .subsection.new .feature .content { margin-left: 0; }
  /* --line is a cool grey; against green-soft it reads as a smudge rather
     than a rule, so separators inside the card are a green of their own. */
  .subsection.new .feature { border-bottom-color: var(--green-line); }

  /* Same card, quieter register — a sub-section the audit found all at once. */
  .subsection.backfilled { background: var(--slate); border-radius: 7px; overflow: hidden; margin: 16px 0 6px; }
  .subsection.backfilled > .sub-body { background: var(--slate-soft); margin-left: 5px; }
  .subsection.backfilled .sub-head { border-top: none; padding: 15px 15px 0; margin-bottom: 0; }
  .subsection.backfilled .sub-name { color: var(--slate-deep); }
  .subsection.backfilled .sub-intro { color: var(--ink); }
  .subsection.backfilled .feature .content { margin-left: 0; }
  .subsection.backfilled .feature { border-bottom-color: var(--slate-line); }

  /* The coloured accent strip on a flagged row is not a separately-rounded
     bar sitting next to a separately-rounded box — two independent curves
     never line up exactly, they only get close. Instead: .feature itself
     (dark) and .content (light, inset by margin) are both plain flat-edged
     rectangles; .feature's own border-radius + overflow: hidden clip the pair
     of them together as one shape. The strip's rounded cap and the card's
     outer corner are then literally the same curve, and the accent's right
     edge — where dark meets light — stays a perfectly straight line, since
     nothing about that edge is rounded at all. .content carries the padding
     (not .feature), and as the only flex child it stretches to .feature's
     full height automatically — so the strip reaches top and bottom exactly.
     It's rendered for every row, flagged or not, so the gutter it occupies
     never shifts content out of alignment between plain and highlighted
     rows. */
  .feature { border-bottom: 1px solid var(--line); display: flex; break-inside: avoid; }
  .feature .content { flex: 1; display: flex; gap: 16px; padding: 13px 5px 13px 15px; margin-left: 5px; min-width: 0; }

  /* A plain row's border-bottom is a straight, unrounded edge — fine between
     two plain rows, but if the row it's touching is a rounded coloured box,
     that straight line just cuts across the box's curve instead of framing
     it. The coloured box's own edge already reads as a clear boundary, so
     the line is redundant there anyway. Same at the end of a category and
     just above a sub-section heading. Which rows those are is decided in
     markSeams(), not by :last-child, which can only see a row's wrapper. */
  .feature.no-line { border-bottom: none; }

  .feature.new, .feature.updated, .feature.backfilled { border-radius: 7px; overflow: hidden; margin: 3px 0; }
  .feature.new { background: var(--green); }
  .feature.new .content { background: var(--green-soft); padding-top: 15px; padding-bottom: 15px; }
  .feature.updated { background: var(--blue); }
  .feature.updated .content { background: var(--blue-soft); padding-top: 15px; padding-bottom: 15px; }
  .feature.backfilled { background: var(--slate); }
  .feature.backfilled .content { background: var(--slate-soft); padding-top: 15px; padding-bottom: 15px; }

  .badges { flex: 0 0 98px; display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }

  /* ---- The size scale ----
     Big / Medium / Small are three steps of ONE idea, so they're drawn as
     three steps of one thing: the same filled chip in the same hue, three
     tints deep, each carrying a three-segment meter with 3, 2 or 1 bars lit.
     Nothing switches from filled to outlined, nothing drops out of the accent
     hue into grey, and the meter states the ranking outright for a reader who
     never reads the legend on page one. */
  .size {
    display: inline-flex; align-items: center; gap: 6px; border-radius: 4px;
    font-weight: 700; font-size: 7.2pt; letter-spacing: .09em; padding: 4px 9px; white-space: nowrap;
  }
  .meter { display: inline-flex; align-items: flex-end; gap: 1.5px; height: 9px; }
  .meter i { width: 2.5px; border-radius: .5px; display: block; }
  .meter i:nth-child(1) { height: 4px; } .meter i:nth-child(2) { height: 6.5px; } .meter i:nth-child(3) { height: 9px; }
  /* An unlit slot is always paper white — the same "nothing here" on every
     chip — so all three read as the same three-slot gauge at different
     settings rather than three differently-drawn badges. That's also why the
     two lighter chips are tinted deeply enough for white to show against
     them at 2.5px wide. */
  .size .meter i { background: var(--accent); }
  .size .meter i.off { background: var(--paper); }
  .size-big { background: var(--accent); color: #fff; }
  .size-big .meter i { background: #fff; }
  .size-medium { background: var(--accent-mid); color: var(--accent-deep); }
  .size-small { background: var(--accent-pale); color: var(--accent-quiet); }

  .tag {
    display: inline-block; border-radius: 4px; font-weight: 800; font-size: 7.2pt;
    letter-spacing: .1em; padding: 4px 9px; white-space: nowrap; color: #fff;
  }
  .tag-new { background: var(--green); }
  .tag-updated { background: var(--blue); }
  .tag-backfilled {
    background: var(--slate);
    white-space: normal; max-width: 98px; line-height: 1.3;
  }

  .feature .body { flex: 1; min-width: 0; }
  .feature .name { font-family: var(--font-display); font-weight: 700; font-size: 12pt; letter-spacing: -.005em; }
  /* Its own line under the name: set inline it wraps into the title and turns
     a two-word rename note into visual noise. */
  .feature .name .was {
    display: block; font-family: var(--font-body); font-weight: 500;
    color: var(--ink-faint); font-size: 8.5pt; line-height: 1.4; margin-top: 2px;
  }
  .feature .desc { margin-top: 4px; color: var(--ink-soft); max-width: var(--measure); }

  /* ---- What changed ----
     Reads as a continuation of the description, not as a louder rival to it.
     The tinted card has already told the reader this entry is one of the few
     that moved — spending a white panel, a rule and heavier ink on saying so
     again just outranks the description, which is the thing that explains
     what the feature actually IS. So: no panel, no border, same size and same
     ink as the description above it, and only the small uppercase label to
     name the list. The blue is left on the label and the bullet marks, where
     it identifies the list without weighting it. */
  .changes { margin-top: 10px; max-width: var(--measure); }
  .changes .label {
    display: block; font-weight: 800; font-size: 7.2pt; letter-spacing: .1em;
    text-transform: uppercase; color: var(--blue-deep); margin-bottom: 5px;
  }
  .changes ul { margin: 0; padding: 0; list-style: none; }
  .changes li { position: relative; padding-left: 16px; margin-bottom: 4px; color: var(--ink-soft); }
  .changes li:last-child { margin-bottom: 0; }
  .changes li::before {
    content: ""; position: absolute; left: 0; top: .55em; width: 6px; height: 6px;
    border-radius: 1.5px; background: var(--blue);
  }
  /* The blue on the label and the bullets identifies the list as this cycle's
     news. On a backfilled row it isn't news, so it takes the row's own hue —
     otherwise the one blue thing on a grey card reads as a stray highlight. */
  .feature.backfilled .changes .label { color: var(--slate-deep); }
  .feature.backfilled .changes li::before { background: var(--slate); }

  .removed-box { margin-top: 12px; background: var(--accent-deep); border-radius: 7px; overflow: hidden; break-inside: avoid; }
  .removed-box-content { background: var(--accent-pale); margin-left: 5px; padding: 13px 16px; font-size: 9.5pt; }
  .removed-box .name { font-family: var(--font-display); font-weight: 700; font-size: 11pt; color: var(--accent-deep); }
  .removed-box.backfilled { background: var(--slate); }
  .removed-box.backfilled .removed-box-content { background: var(--slate-soft); }
  .removed-box.backfilled .name { color: var(--slate-deep); }

  .other-changes { margin-top: 30px; padding-top: 14px; border-top: 2px solid var(--accent); break-inside: avoid; }
  .other-changes h2 { font-family: var(--font-display); font-size: 15pt; font-weight: 700; }
  .other-changes p.sub { margin: 3px 0 0; font-size: 9pt; color: var(--ink-faint); }
  .other-changes ul { margin: 12px 0 0; padding: 0; list-style: none; max-width: var(--measure); }
  .other-changes li { position: relative; padding-left: 16px; margin-bottom: 7px; color: var(--ink-soft); }
  .other-changes li::before {
    content: ""; position: absolute; left: 0; top: .55em; width: 6px; height: 6px;
    border-radius: 1.5px; background: var(--accent);
  }

  .colophon { margin-top: 34px; padding-top: 12px; border-top: 1px solid var(--line); font-size: 8pt; color: var(--ink-faint); break-inside: avoid; }
`;

export { LedgerHtml };
