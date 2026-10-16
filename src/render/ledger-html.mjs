import { escapeHtml as h, longDate } from "../util.mjs";
import { wording, redraftBody } from "../wording.mjs";
import { resolveBrand, mastheadHtml } from "./brand.mjs";
import { fontFaceCss, SYMBOL_FACE } from "./fonts.mjs";
import { prepareReport, prepareLine, hasLists, hasSummary } from "../compose.mjs";

/**
 * The client-facing "feature ledger" for one specific release — an archival
 * snapshot, unlike the living Markdown docs (which always render for the
 * latest release only).
 *
 * New/Changed tags here are computed relative to that release's own
 * predecessor, ALWAYS — even for a release from months ago — because the
 * whole point of the ledger is reproducing what was actually presented at
 * that moment. Version 1 has no predecessor, so a first edition prints as a
 * plain inventory with no flags anywhere on it: exactly what you want when
 * the corpus is a baseline of a codebase that already existed.
 *
 * Every later edition is short without dropping work: a first page that is
 * the update (the counts, a list of the three parts, and one line for each
 * entry that moved), then every new, updated, backfilled and removed entry in full — its
 * description, its "What changed" note and how to see it — and then one line
 * for every capability, the catalogue. Reprinting every unchanged entry in
 * full every time was most of an edition's length. `full` prints them all in
 * full instead, the way an inventory does.
 *
 * One number per feature ("2.4", its area and its place in it) ties the three
 * together: the summary cites it, the details print it in the margin, the
 * catalogue lists by it. A status is always a word as well as a colour.
 *
 * Rendered as real HTML/CSS and printed with headless Chromium the same way
 * a person would print a styled page — not hand-positioned PDF drawing.
 */
export function renderLedgerHtml({ project, version, label, full = false }) {
  const doc = new LedgerHtml(project, version, label, { full });
  const html = doc.render();
  return { html, warnings: doc.warnings, fontsEmbedded: doc.fontsEmbedded };
}

const SIZE_LEVELS = { big: 3, medium: 2, small: 1 };

/** Up to the first full stop that ends a sentence, not one inside "e.g." or
 *  a file name: it has to be followed by a space and a capital. */
const firstSentence = (text) => text.trim().split(/(?<=[.!?])\s+(?=[A-Z“"(])/)[0];

/* Anchors for the three sections that close the document. Named rather than
 * numbered because, unlike the areas, they aren't part of the product's
 * structure — see `categoryId`. */
const CLOSING_IDS = { removed: "closing-removed", goneEarlier: "closing-gone-earlier", other: "closing-other" };

/** Anchors for the two halves of a short edition. */
const SECTION_IDS = { summary: "whats-different", changed: "whats-changed", rest: "everything-else" };

class LedgerHtml {
  constructor(project, version, label, { full = false } = {}) {
    this.project = project;
    this.config = project.config;
    this.set = project.featureSet;
    this.version = version ?? project.releases.latestVersion;
    // The version printed on the page, which is not always `version`: see
    // `display_version` and `redraft` in ReleaseSet. An archived edition is
    // handed its label by the caller, because the live timeline says it.
    this.label = label ?? project.releases.printedAs(this.version);
    this.release = project.releases.at(this.version);
    this.predecessor = project.releases.predecessorOf(this.version);
    // Set on the first edition after a redraft: there is an earlier edition,
    // but one arranged differently, so this one can't be diffed against it
    // and says so instead.
    this.redraftReplaces = project.releases.redraftReplaces(this.version);
    // An inventory has nothing to set apart, so it is always in full.
    this.short = Boolean(this.predecessor) && !full;
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

        // When the whole sub-section is arriving at once, its heading says so
        // once and its rows don't repeat it eight times. Only the *drawing*
        // moves: `badge` itself is left alone, since the tallies still have
        // to count eight new features as eight. A sub-section the audit found
        // all at once is the same shape of statement, so it collapses the
        // same way. Only "updated" never collapses: a column of reworked
        // entries each has its own reason, which is the part worth reading.
        const uniform = ["new", "backfilled"].find((b) => rows.every((r) => r.badge === b)) ?? null;
        const whole = this.predecessor ? uniform : null;
        if (whole) rows.forEach((r) => { r.showBadge = false; });
        groups.push([{ name: sub.name, intro: sub.intro, badge: whole }, rows]);
      }

      const live = groups.filter(([, rows]) => rows.length);
      const rows = live.flatMap(([, r]) => r);
      if (!rows.length) continue;

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
        // New is decided by when the feature first appeared, not by whether it
        // has a `changes` list: a note left on something the client has never
        // seen describes a draft, and must not turn it blue.
        else badge = f.firstVersion === this.version ? "new" : "updated";
      }
      if (!this.predecessor) badge = null; // nothing to diff a first edition against
      rows.push({ feature: f, state, badge, showBadge: true });
    }
    return rows;
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

  /* ---- numbering and labels ------------------------------------------- */

  /**
   * Every capability's number: its area and its place in it ("2.4"), or just
   * its place in an undivided ledger. It is the document's one way of
   * pointing at an entry — the summary cites it, the details print it in the
   * margin, the catalogue lists by it — so a reader holding paper can follow
   * any reference by number, the way they would in a contract or a manual.
   * It is this edition's numbering, not a permanent ID: a feature added to an
   * area moves the ones after it along.
   */
  get numbers() {
    if (this._numbers) return this._numbers;
    const m = new Map();
    this.categoryRows.forEach(([, rows], i) => rows.forEach((r, j) => {
      m.set(r.feature.id, this.set.unstructured ? `${j + 1}` : `${i + 1}.${j + 1}`);
    }));
    this._numbers = m;
    return m;
  }

  /** Anchor an entry answers to, so its line in the summary can link to it. */
  featureId(id) {
    return `f-${id}`;
  }

  /** Anchor an area heading answers to. Chromium carries `<a href="#id">`
   *  into the printed PDF as an internal jump, which is what makes the
   *  contents and every cross-reference clickable on screen. */
  categoryId(i) {
    return `area-${i + 1}`;
  }

  /**
   * The word a status prints as. Colour is a second signal, never the only
   * one: an edition is often printed on an office laser in black and white,
   * and read by people who can't tell green from blue.
   */
  statusLabel(badge) {
    if (badge === "backfilled") return this.words.tags.backfilled;
    return { new: "New", updated: "Changed" }[badge] ?? "";
  }

  statusMark(badge) {
    return badge ? `<span class="status is-${badge}">${h(this.statusLabel(badge))}</span>` : "";
  }

  /** "7 features · 2 new · 1 changed": an area's size and what moved in it. */
  areaMeta(rows) {
    const n = (b) => rows.filter((r) => r.badge === b).length;
    const parts = [`${rows.length} ${rows.length === 1 ? "feature" : "features"}`];
    for (const b of ["new", "updated", "backfilled"]) {
      if (n(b)) parts.push(`<span class="is-${b}">${n(b)} ${h(this.statusLabel(b).toLowerCase())}</span>`);
    }
    return parts.join(" · ");
  }

  /** The one-sentence overview of an area, from `area_intros` in config.json, or null. */
  areaIntro(category) {
    const text = this.config.area_intros?.[category];
    return typeof text === "string" && text.trim() ? text.trim() : null;
  }

  /** An area's heading, with its number, its size and its overview. */
  areaHead(category, i, rows, level) {
    const intro = this.areaIntro(category);
    return `<div class="area-head" id="${this.categoryId(i)}"><span class="num">${i + 1}</span>` +
      `<h${level}>${h(category)}</h${level}><span class="meta">${this.areaMeta(rows)}</span></div>` +
      (intro ? `<p class="area-intro">${h(intro)}</p>` : "");
  }

  /** A name a step down from the area head, with its one-line overview. A
   *  sub-section that arrived whole carries the status once, here, rather
   *  than on every entry inside it. */
  subHead(sub, level) {
    return `<div class="sub-head"><h${level} class="sub-name">${h(sub.name)}${this.statusMark(sub.badge)}</h${level}>` +
      `<p class="sub-intro">${h(sub.intro)}</p></div>`;
  }

  /**
   * Big/Medium/Small as three steps of one scale: a three-bar meter with
   * one, two or three bars lit, and the word beside it. The meter is what
   * makes the ranking legible to someone who never read the key.
   */
  sizeMark(size, { word = true } = {}) {
    const key = String(size ?? "").toLowerCase();
    const lit = SIZE_LEVELS[key];
    if (!lit) return "";
    const bars = [1, 2, 3].map((i) => `<i class="${i <= lit ? "on" : "off"}"></i>`).join("");
    return `<span class="size size-${key}" title="${h(String(size))}"><span class="meter">${bars}</span>` +
      `${word ? `<span class="word">${h(String(size))}</span>` : ""}</span>`;
  }

  /* ---- an entry --------------------------------------------------------- */

  /** Only ever rendered on a row flagged new/updated for *this* edition — a
   *  `changes` list left over from an older version describes a diff the
   *  reader already saw in an earlier ledger. */
  changesPanel(state) {
    if (!state.changes?.length) return "";
    const items = state.changes.map((c) => `<li>${h(c)}</li>`).join("");
    // On a preview, before anything is prepared: the changes as they were
    // recorded, said to be that, so nobody reads them as the finished note.
    // A cut edition prints the same lines as its note, unlabelled.
    const draft = state.changes_draft && this.release.future;
    const label = draft ? "What changed · as recorded, not yet prepared" : "What changed";
    return `<div class="changes${draft ? " is-draft" : ""}"><span class="label">${label}</span><ul>${items}</ul></div>`;
  }

  /** How a reader checks the entry for themselves. */
  howPanel(state) {
    if (!state.how_to_see) return "";
    return `<div class="how"><span class="label">How to see it</span><p>${h(state.how_to_see)}</p></div>`;
  }

  /**
   * One entry, on a two-column grid: a narrow margin with its number, its
   * status and its size, and the text beside it. The margin is what a reader
   * scans; the text is what they read once they've found it.
   *
   * In a short edition an updated entry leads with its first sentence, to say
   * what the entry is, and then what changed, which is the news; the full
   * description stays in the catalogue. Shared by every layout, so an entry
   * reads the same wherever it prints.
   */
  featureRow(row, level = 3) {
    const f = row.feature;
    const s = row.state;
    const badge = this.displayBadge(row);
    const was = s.renamedFrom ? `<span class="was">Previously &ldquo;${h(s.renamedFrom)}&rdquo;</span>` : "";
    const updated = Boolean(row.badge) && f.firstVersion !== this.version;
    const brief = this.short && updated;
    const desc = brief ? firstSentence(s.description) : s.description;

    return `<article class="feature${badge ? ` is-${badge}` : ""}" id="${h(this.featureId(f.id))}">` +
      `<div class="rail"><span class="no">${h(this.numbers.get(f.id) ?? "")}</span>` +
      `${this.statusMark(badge)}${this.sizeMark(f.size)}</div>` +
      `<div class="body"><h${level} class="name">${h(s.name)}</h${level}>${was}` +
      `<p class="desc${brief ? " is-brief" : ""}">${h(desc)}</p>` +
      `${updated ? this.changesPanel(s) : ""}` +
      `${row.badge || !this.short ? this.howPanel(s) : ""}</div></article>`;
  }

  /** A capability that went, on the same grid as one that's here. */
  removedRow([f, s], backfilled = false) {
    const label = backfilled ? this.words.tags.backfilled_removed : "Removed";
    return `<article class="feature is-removed${backfilled ? " is-gone" : ""}" id="gone-${h(f.id)}">` +
      `<div class="rail"><span class="status is-${backfilled ? "gone" : "removed"}">${h(label)}</span></div>` +
      `<div class="body"><h4 class="name">${h(f.currentName)}</h4><p class="desc">${h(s.reason)}</p></div></article>`;
  }

  /** One capability in the catalogue: its number, size, name and first
   *  sentence, and — when it moved — its status, linking to its details. */
  catalogueLine(row) {
    const s = row.state;
    const id = this.featureId(row.feature.id);
    const mark = row.badge
      ? `<a class="moved is-${row.badge}" href="#${h(id)}">${h(this.statusLabel(row.badge))}</a>`
      : "";
    return `<li${row.badge ? "" : ` id="${h(id)}"`}><span class="no">${h(this.numbers.get(row.feature.id))}</span>` +
      `<span class="sz">${this.sizeMark(row.feature.size, { word: false })}</span>` +
      `<span class="nm">${h(s.name)}</span><span class="first">${h(firstSentence(s.description))}</span>` +
      `<span class="mv">${mark}</span></li>`;
  }

  /* ---- the first page --------------------------------------------------- */

  /**
   * What this edition prints as news, as short lists under plain headings
   * ("What's new", "What changed"), so a reader can see what differs from the
   * last edition without turning a page.
   *
   * The lists are the details read at one sentence each: the same groups,
   * the same entries in the same order, so their counts are the counts at
   * the top of the page. Each line is the release's sentence for that entry
   * (`summary` in src/compose.mjs), on what it gives the reader, and links
   * to the entry; the number after it is the one the entry prints in the
   * margin of the details and in the catalogue, so it can be followed on
   * paper as well as clicked.
   *
   * An edition prepared before that wrote items that each summed up several
   * entries, followed by all their numbers, and reprints that way.
   *
   * Removals and product-wide notes list themselves. A removal's item is the
   * name of what went; the reason is one link away. A note's is its first
   * sentence, which is where the style guides put the point.
   *
   * An edition with no summary (one cut with the check skipped, or a draft)
   * lists each entry by its name instead: it says less, but leaving them out
   * would say nothing had changed. A draft also says, on the page, when its
   * summary is missing or out of date, so a preview passed around can't be
   * mistaken for one whose summary has caught up.
   */
  summaryHtml({ removed, goneEarlier, other }) {
    if (!this.predecessor) return "";
    const w = this.words.pdf;
    const rows = this.categoryRows.flatMap(([, r]) => r);
    const printed = new Set(rows.map((r) => r.feature.id));
    const ref = (id) => `<a class="ref" href="#${h(this.featureId(id))}">${h(this.numbers.get(id))}</a>`;
    const line = (text, refs) => `<li><span class="text">${text}</span>` +
      `${refs ? ` <span class="refs">${refs}</span>` : ""}</li>`;
    const byName = (badge) => rows.filter((r) => r.badge === badge)
      .map((r) => line(`<a href="#${h(this.featureId(r.feature.id))}">${h(r.state.name)}</a>`, ref(r.feature.id)));
    // A composition that only carries notes (an edition cut before summaries
    // existed, or one nobody prepared) has no lists, and prints its entries
    // by name.
    const composed = this.project.compositionOf(this.version);
    const written = hasLists(composed) ? composed : null;
    // In number order, not the order the summary names them in, so a reader
    // turning pages meets them in the order they're cited.
    const byNumber = (a, b) => {
      const [x, y] = [a, b].map((id) => this.numbers.get(id).split(".").map(Number));
      return x[0] - y[0] || (x[1] ?? 0) - (y[1] ?? 0);
    };
    const curated = (key) => (written?.[key] ?? []).map((it) =>
      line(h(it.text), (it.covers ?? []).filter((id) => printed.has(id)).sort(byNumber).map(ref).join("")));
    // One line per entry, in the order the details print them. An entry with
    // no sentence yet (a draft) is listed by its name.
    const perEntry = (badge) => rows.filter((r) => r.badge === badge).map((r) => {
      const text = written.summary[r.feature.id];
      return line(`<a href="#${h(this.featureId(r.feature.id))}">${h(text ?? r.state.name)}</a>`, ref(r.feature.id));
    });
    const badgeOf = { new: "new", changed: "updated", in_place: "backfilled" };
    const entries = !written ? (key) => byName(badgeOf[key])
      : hasSummary(written) ? (key) => perEntry(badgeOf[key]) : curated;
    const plain = (href, text) => line(`<a href="#${h(href)}">${h(text)}</a>`, "");
    // A removal's line is its sentence, on why it went and what to use
    // instead, where the release has one; its name otherwise.
    const goneLine = ([f]) => plain(`gone-${f.id}`, (written && hasSummary(written) && written.summary[f.id]) || f.currentName);

    const groups = [
      ["new", w.summary_new, entries("new")],
      ["updated", w.summary_updated, entries("changed")],
      ["backfilled", this.words.tags.backfilled, entries("in_place")],
      ["removed", "No longer available", removed.map(goneLine)],
      ["gone", this.words.tags.backfilled_removed, goneEarlier.map(goneLine)],
      ["other", OTHER_TITLE, other.map((c) => plain(CLOSING_IDS.other, firstSentence(c.description)))],
    ].filter(([, , items]) => items.length);
    if (!groups.length) return "";

    // Only on a preview: a cut edition is what it is.
    const report = this.release.future ? prepareReport(this.project, this.version) : null;
    const draftNote = report && !report.ok && !report.nothing
      ? `<p class="draft-note"><b>Draft.</b> ${h(report.never
        ? "Nothing has been prepared for this edition yet, so its entries are listed by name and their changes print as recorded."
        : `${prepareLine(report).replace(/^./, (c) => c.toUpperCase())}, so this summary may not cover them.`)}</p>`
      : "";
    // {date} in a project's own intro: " (March 4, 2026)", the last edition's date.
    const predDate = longDate(this.predecessor.date);
    const intro = w.summary_intro.replaceAll("{date}", predDate ? ` (${predDate})` : "");
    // A count beside each heading when every line is one entry, as the
    // details print it; an older edition's items don't add up to its entries.
    const counted = !written || hasSummary(written);
    return `<section class="summary" id="${SECTION_IDS.summary}">
    <h2>${h(w.summary_title)}</h2>
    <p class="sub">${h(written && !hasSummary(written) ? w.summary_intro_grouped : intro)}</p>${draftNote}
    ${groups.map(([key, label, items]) => `<div class="sum-group is-${key}">` +
      `<h3>${h(label)}${counted && key !== "other" ? `<span class="count">${items.length}</span>` : ""}</h3>` +
      `<ol>${items.join("")}</ol></div>`).join("\n    ")}
  </section>`;
  }

  /**
   * A short edition's map of itself, on its first page: its three parts, each
   * a link, with a line on what each one is for, so a reader knows what the
   * document holds before deciding how far to read.
   */
  partsHtml() {
    if (!this.short) return "";
    const w = this.words.pdf;
    const parts = [
      [SECTION_IDS.summary, w.summary_title, w.summary_role],
      [SECTION_IDS.changed, w.changed_title, w.changed_role],
      [SECTION_IDS.rest, w.rest_title, w.rest_role],
    ].map(([id, title, role], i) => `<li><a href="#${id}"><span class="num">${i + 1}</span>` +
      `<span class="nm">${h(title)}</span><span class="role">${h(role)}</span></a></li>`).join("");
    return `<nav class="contents parts"><h2 class="kicker">In this edition</h2><ol>${parts}</ol></nav>`;
  }

  /**
   * The headline figures, as a row of numbers with their labels under them.
   * Against the last edition, from the second on; the size of the product,
   * on an inventory. Each count wears the colour its entries wear inside.
   */
  tallyHtml(removedCount) {
    const stats = this.stats;
    const cell = (n, label, cls) => `<div class="stat ${cls}"><b>${n}</b><span>${h(label)}</span></div>`;
    if (!this.predecessor) {
      const cells = [cell(stats.features, stats.features === 1 ? "feature" : "features", "is-total")];
      if (stats.areas > 1) cells.push(cell(stats.areas, "areas", "is-plain"));
      for (const [n, label] of [[stats.big, "big"], [stats.medium, "medium"], [stats.small, "small"]]) {
        if (n) cells.push(cell(n, label, "is-plain"));
      }
      return `<div class="tally">${cells.join("")}</div>`;
    }
    const cells = [
      [stats.new, "new", "is-new", true],
      [stats.updated, "changed", "is-updated", true],
      [stats.backfilled, this.words.tags.backfilled.toLowerCase(), "is-backfilled", false],
      [removedCount, "removed", "is-removed", false],
      [stats.unchanged, "unchanged", "is-same", true],
    ].filter(([n, , , always]) => always || n > 0).map(([n, label, cls]) => cell(n, label, cls));
    cells.push(cell(stats.features, "features in all", "is-total"));
    return `<div class="tally">${cells.join("")}</div>`;
  }

  /**
   * Where everything is, on an inventory or an edition printed in full: every
   * area, with its count, and whatever closes the document. A short edition
   * has none: its first page is its contents for the news, every item linking
   * to its details, and the PDF's bookmarks carry the rest.
   */
  contentsHtml(closing) {
    if (this.short || this.set.unstructured) return "";
    const areas = this.categoryRows.map(([category, rows], i) => `<li><a href="#${this.categoryId(i)}">` +
      `<span class="num">${i + 1}</span><span class="nm">${h(category)}</span>` +
      `<span class="ct">${rows.length}</span></a></li>`).join("");
    const closingItems = closing.map(([id, title, count]) =>
      `<li class="closing"><a href="#${id}"><span class="num">&ndash;</span><span class="nm">${h(title)}</span>` +
      `<span class="ct">${count}</span></a></li>`).join("");
    return `<nav class="contents"><h2 class="kicker">Contents</h2><ol>${areas}${closingItems}</ol></nav>`;
  }

  /* ---- a short edition's two parts ------------------------------------ */

  /** Every row this edition marks: new, updated or already in place. */
  get changedRows() {
    return this.categoryRows.flatMap(([, rows]) => rows).filter((r) => r.badge);
  }

  /**
   * Every entry that moved, in full, grouped the way the first page groups
   * them — new, then changed, then already in place, then what went — so
   * the summary and the details are one structure read at two depths.
   * Within a group, entries keep their catalogue order, so their numbers
   * rise down the page and any one can be found by thumbing. The summary
   * picks highlights; this never leaves recorded work out.
   */
  changedSection({ removed, goneEarlier, other }) {
    const w = this.words.pdf;
    const rows = this.changedRows;
    const areaOf = new Map(this.categoryRows.flatMap(([category, rs]) => rs.map((r) => [r, category])));
    const group = (badge, title, intro) => {
      const these = rows.filter((r) => r.badge === badge);
      if (!these.length) return "";
      // An area label wherever the area changes, so an entry is never read
      // out of the context of the part of the product it belongs to.
      let last = null;
      const items = these.map((r) => {
        const area = areaOf.get(r);
        const label = !this.set.unstructured && area !== last ? `<div class="area-label">${h(area)}</div>` : "";
        last = area;
        return `${label}${this.featureRow({ ...r, showBadge: true }, 4)}`;
      });
      return this.statusGroup(badge, title, these.length, intro, items);
    };
    const parts = [
      group("new", w.summary_new),
      group("updated", w.summary_updated),
      group("backfilled", this.words.tags.backfilled, "Part of the product already, and listed here for the first time."),
      removed.length ? this.statusGroup("removed", "No longer available", removed.length, null,
        removed.map((r) => this.removedRow(r)), CLOSING_IDS.removed) : "",
      // Deliberately vague about timing: these went before the last cutoff,
      // and nothing records which release they went in.
      goneEarlier.length ? this.statusGroup("gone", this.words.tags.backfilled_removed, goneEarlier.length,
        "Gone before the last edition, and recorded here for the first time.",
        goneEarlier.map((r) => this.removedRow(r, true)), CLOSING_IDS.goneEarlier) : "",
      this.otherHtml(other),
    ].join("");
    if (!parts) return "";
    return `<section class="part" id="${SECTION_IDS.changed}" data-page-start><div class="part-head"><h2>${h(w.changed_title)}</h2>` +
      `<p class="sub">${h(w.changed_intro)}</p></div>${parts}</section>`;
  }

  /** One group of the details, its heading glued to its first entry. */
  statusGroup(key, title, count, intro, items, id = null) {
    return `<div class="status-group is-${key}"${id ? ` id="${id}"` : ""}><div class="keep">` +
      `<div class="group-head"><h3>${h(title)}<span class="count">${count}</span></h3>` +
      `${intro ? `<p class="sub">${h(intro)}</p>` : ""}</div>${items[0]}</div>${items.slice(1).join("")}</div>`;
  }

  /** Changes that belong to no one feature. */
  otherHtml(other) {
    if (!other.length) return "";
    return `<div class="status-group is-other" id="${CLOSING_IDS.other}"><div class="keep"><div class="group-head">` +
      `<h3>${OTHER_TITLE}<span class="count">${other.length}</span></h3>` +
      `<p class="sub">Changes that run across the whole product rather than belonging to any one feature.</p></div>` +
      `<ul class="other-list">${other.map((c) => `<li>${h(c.description)}</li>`).join("")}</ul></div></div>`;
  }

  /**
   * What the service provides: every capability, area by area, one line
   * each — its number, size, name and first sentence — under the area's own
   * one-sentence overview. What moved carries its status, linking to its
   * details. The whole service in a page or two, and the index the numbers
   * everywhere else point into.
   */
  catalogueSection() {
    if (!this.categoryRows.length) return "";
    const w = this.words.pdf;
    const inner = this.categoryRows.map(([category, rows, groups], i) => {
      const head = this.set.unstructured ? "" : this.areaHead(category, i, rows, 3);
      const lists = groups.map(([sub, grows]) => `${sub ? `<div class="rest-sub">${h(sub.name)}</div>` : ""}` +
        `<ul class="rest-list">${grows.map((r) => this.catalogueLine(r)).join("")}</ul>`).join("");
      return `<div class="rest-area">${head}${lists}</div>`;
    }).join("");
    return `<section class="part rest" id="${SECTION_IDS.rest}" data-page-start><div class="part-head"><h2>${h(w.rest_title)}</h2>` +
      `<p class="sub">${h(w.rest_intro)}</p></div>${this.areaIndex()}${this.sizeKey()}${inner}</section>`;
  }

  /**
   * The catalogue's own contents: every area, its size, and how much of it
   * moved. The catalogue is the part a client comes back to to look
   * something up, so it opens on a map of itself, and a reader can see at a
   * glance which areas this edition touched.
   */
  areaIndex() {
    if (this.set.unstructured || this.categoryRows.length < 2) return "";
    const items = this.categoryRows.map(([category, rows], i) => {
      const moved = ["new", "updated", "backfilled"].map((b) => [b, rows.filter((r) => r.badge === b).length])
        .filter(([, n]) => n).map(([b, n]) => `<span class="is-${b}">${n} ${h(this.statusLabel(b).toLowerCase())}</span>`)
        .join(" · ");
      return `<li><a href="#${this.categoryId(i)}"><span class="num">${i + 1}</span><span class="nm">${h(category)}</span>` +
        `${moved ? `<span class="mvd">${moved}</span>` : ""}<span class="ct">${rows.length}</span></a></li>`;
    }).join("");
    return `<nav class="contents is-index"><h3 class="kicker">Areas</h3><ol>${items}</ol></nav>`;
  }

  /** What the size meter means, said once, where sizes are compared. */
  sizeKey() {
    return `<p class="size-key">${["Big", "Medium", "Small"].map((s) => this.sizeMark(s)).join("")}` +
      `<span>${h(this.words.pdf.key_sizes)}</span></p>`;
  }

  /* ---- the document --------------------------------------------------- */

  render() {
    const { css: fontCss, embedded } = fontFaceCss(this.brand);
    this.fontsEmbedded = embedded;
    if (!embedded) {
      this.warnings.push(
        `brand.json asks for fonts this package doesn't bundle (${this.brand.fonts.display} / ${this.brand.fonts.body}). ` +
        "The PDF will print in whatever the machine has installed, and text may not copy cleanly out of it.",
      );
    }

    const rel = this.release;
    const dateLabel = longDate(rel.date);
    const predDateLabel = this.predecessor ? longDate(this.predecessor.date) : null;
    const w = this.words.pdf;
    const footerLeft = `${this.brand.name} · Feature Ledger · Version ${this.label}` +
      (dateLabel ? ` · ${dateLabel}` : "") + (rel.future ? " · Draft, not yet presented" : "");

    const removed = this.removedThisVersion;
    const goneEarlier = this.backfilledRemovals;
    const other = this.otherChanges;

    // An inventory, or an edition printed in full: every area, every entry,
    // each in the same two-column form the details use.
    const body = this.short ? "" : this.categoryRows.map(([category, rows, groups], i) => {
      // Every heading is glued to its own first entry, so neither an area
      // head nor a sub-section head can be stranded at the foot of a page.
      // An undivided ledger prints no area heading at all: one heading above
      // the only list in the document is a structure the reader has to read
      // past to get to the product.
      const head = this.set.unstructured ? "" : this.areaHead(category, i, rows, 2);
      const inner = groups.map(([sub, grows], gi) => {
        const level = sub ? 4 : 3;
        const entries = grows.map((r) => this.featureRow(r, level));
        if (sub === null) return `<div class="keep">${head}${entries[0]}</div>${entries.slice(1).join("")}`;
        const alone = gi === 0 && head ? `<div class="keep cat-alone">${head}</div>` : "";
        return `${alone}<div class="subsection"><div class="keep">${this.subHead(sub, 3)}${entries[0]}</div>` +
          `${entries.slice(1).join("")}</div>`;
      }).join("");
      return `<section class="category">${inner}</section>`;
    }).join("");

    const fullClosing = this.short ? "" : [
      removed.length ? this.statusGroup("removed", "No longer available as of this edition", removed.length, null,
        removed.map((r) => this.removedRow(r)), CLOSING_IDS.removed) : "",
      goneEarlier.length ? this.statusGroup("gone", this.words.tags.backfilled_removed, goneEarlier.length,
        "Gone before the last edition, and recorded here for the first time.",
        goneEarlier.map((r) => this.removedRow(r, true)), CLOSING_IDS.goneEarlier) : "",
      this.otherHtml(other),
    ].join("");
    const closing = [
      [removed.length, CLOSING_IDS.removed, "No longer available"],
      [goneEarlier.length, CLOSING_IDS.goneEarlier, this.words.tags.backfilled_removed],
      [other.length, CLOSING_IDS.other, OTHER_TITLE],
    ].filter(([n]) => n).map(([n, id, title]) => [id, title, n]);

    const summary = this.summaryHtml({ removed, goneEarlier, other });
    const overview = this.predecessor ? this.project.compositionOf(this.version)?.overview : null;

    // Where the summary would go, had there been something to diff against.
    // Slate, like the third register, because it is the same kind of fact:
    // the document moved, the product didn't.
    const redraftBlock = this.redraftReplaces ? (() => {
      const versions = this.redraftReplaces.map((v) => this.project.releases.labelOf(v));
      const note = this.project.redraftOpening(this.version)?.note;
      return `
      <div class="callout redraft">
        <b>${h(this.words.redraft.title)}.</b> ${h(redraftBody(this.words, versions))}
        ${note ? `<p class="redraft-note">${h(note)}</p>` : ""}
      </div>`;
    })() : "";

    const pages = this.short
      ? `${this.changedSection({ removed, goneEarlier, other })}${this.catalogueSection()}`
      : `<div class="ledger" data-page-start>${body}${fullClosing}</div>`;
    const since = this.predecessor
      ? `Changes since version ${h(this.project.releases.labelOf(this.predecessor.version))}` +
        (predDateLabel ? `, ${h(predDateLabel)}` : "")
      : "";
    const meta = [dateLabel ? h(dateLabel) : "", since].filter(Boolean).join('<span class="sep">·</span>') +
      (rel.future ? '<span class="edition is-draft">Draft, not yet presented</span>' : "");

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${h(this.brand.name)} Feature Ledger — Version ${this.label}</title>
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
  <header class="front${this.short ? " is-short" : ""}">
    <div class="masthead">
      ${mastheadHtml(this.brand, this.project.root)}
      <div class="imprint">${w.title_html}</div>
    </div>

    <h1 class="release-title">Version ${this.label}${rel.name ? `<span class="release-name">${h(rel.name)}</span>` : ""}</h1>
    <div class="release-meta">${meta}</div>
    ${overview ? `<p class="overview">${h(overview)}</p>` : this.predecessor ? "" : `<p class="intro">${h(w.intro)}</p>`}
    ${redraftBlock}
    ${this.tallyHtml(removed.length)}
    ${this.partsHtml()}
    ${summary}
    ${this.contentsHtml(closing)}
    ${this.short ? "" : this.sizeKey()}
  </header>

  ${pages}

  <div class="colophon">
    ${h(this.brand.name)} · Feature Ledger · Version ${this.label}${dateLabel ? ` · ${dateLabel}` : ""}.
    ${h(w.colophon)}
  </div>
</body>
</html>
`;
  }

  paletteCss() {
    const b = this.brand;
    return `  :root {
    --ink: #161b24; --ink-soft: #485160; --ink-faint: #848c9a; --ink-ghost: #c3c8d0;
    --paper: #ffffff; --line: #dfe3ea; --line-soft: #eceef3; --wash: #f6f7f9;

    --accent: ${b.accent}; --accent-deep: ${b.accent_deep}; --accent-quiet: ${b.accent_quiet};
    --accent-mid: ${b.accent_mid}; --accent-pale: ${b.accent_pale};

    --green: #12744a; --green-deep: #0b5233; --green-soft: #e7f4ed;
    --blue: #2a51c8; --blue-deep: #1c3c99; --blue-soft: #eaf0fd;

    /* The third register. Deliberately not a fourth hue: green and blue are
       already spoken for, and brand.json forbids an accent in the green/blue
       band precisely so those two keep their meaning. It is also not the same
       KIND of fact. Green and blue say the software moved; this says the
       document caught up. Neutral grey is the one family a brand accent never
       occupies, so it is safe against every palette, and it recedes, which is
       the point. */
    --slate: #6b7280; --slate-deep: #414753; --slate-soft: #edeff2;

    --font-display: '${b.fonts.display}', '${SYMBOL_FACE[0]}', Georgia, 'Times New Roman', serif;
    --font-body: '${b.fonts.body}', '${SYMBOL_FACE[0]}', 'Helvetica Neue', Arial, sans-serif;

    /* The grid every entry sits on: a margin for what a reader scans (number,
       status, size) and a column for what they read, held to about 75
       characters a line. Headings, lists and notes all hang off the same two
       vertical lines, so the eye never has to find a new left edge. */
    --rail: 92px; --gutter: 22px; --measure: 470px;
  }`;
  }
}

/** The heading over product-wide notes, here and on the first page. */
const OTHER_TITLE = "Across the product";

/*
 * The stylesheet. Every tint is a real flat colour rather than an alpha
 * blend, so what a CMYK press or an office laser prints is what's specified.
 *
 * Two faces, two jobs: the serif names things (the title, sections, entries,
 * figures) and the sans explains them. Colour is never the only carrier of a
 * meaning — every status is also a word — so the document survives a
 * black-and-white printer intact.
 *
 * A note on tracked caps and copy-paste: PDF text extractors read a wide
 * enough gap between two letters as a word break, so the small tracked labels
 * copy out spaced. Every line of actual content copies verbatim.
 */
const STYLES = `
  @page { size: letter; }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: var(--font-body); color: var(--ink); background: var(--paper);
    font-size: 9.75pt; line-height: 1.5; -webkit-font-smoothing: antialiased;
    font-feature-settings: "kern", "liga"; orphans: 2; widows: 2;
  }
  h1, h2, h3, h4 { margin: 0; line-height: 1.2; font-weight: inherit; font-size: inherit; }
  p { margin: 0; }
  a { color: inherit; text-decoration: none; }

  /* Small tracked capitals: the labels over a note and the margin statuses. */
  .kicker, .label, .status, .area-label, .size .word {
    font-family: var(--font-body); font-size: 6.8pt; font-weight: 700;
    letter-spacing: .09em; text-transform: uppercase;
  }

  /* ======================= THE FIRST PAGE ======================= */
  /* The first page is the update: which edition this is, what it is about,
     how much moved, and what, in a list. Most readers stop there, so
     nothing on it is decoration. */

  .masthead {
    display: flex; align-items: center; justify-content: space-between;
    padding-bottom: 12px; border-bottom: 1px solid var(--line);
  }
  .masthead img { display: block; }
  /* The stand-in when a project hasn't got a logo file yet: the product name
     set in the display face, which reads as a considered masthead rather
     than as a missing image. */
  .masthead .wordmark {
    font-family: var(--font-display); font-size: 15pt; font-weight: 700;
    letter-spacing: -.01em; color: var(--accent-deep);
  }
  .masthead .imprint {
    font-family: var(--font-body); font-size: 7.5pt; font-weight: 700; letter-spacing: .12em;
    text-transform: uppercase; color: var(--ink-faint); text-align: right;
  }
  .masthead .imprint em { font-style: normal; color: var(--ink-faint); }

  h1.release-title {
    font-family: var(--font-display); font-size: 32pt; font-weight: 900; letter-spacing: -.02em;
    margin-top: 34px; line-height: 1.05; display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 16px;
  }
  h1.release-title .release-name { font-weight: 400; font-style: italic; color: var(--accent-deep); letter-spacing: -.01em; }
  .release-meta {
    margin-top: 10px; font-size: 9.5pt; color: var(--ink-soft);
    display: flex; flex-wrap: wrap; align-items: center; gap: 4px 0;
  }
  .release-meta .sep { color: var(--ink-ghost); margin: 0 9px; }
  .edition {
    display: inline-flex; align-items: center; gap: 6px; margin-left: 14px;
    font-weight: 700; font-size: 6.8pt; letter-spacing: .1em; text-transform: uppercase;
    border: 1px dashed var(--accent); color: var(--accent-deep); border-radius: 3px; padding: 3px 8px;
  }
  .overview, .intro {
    margin-top: 18px; font-family: var(--font-display); font-size: 12.5pt; line-height: 1.5;
    color: var(--ink); max-width: 560px;
  }

  /* ---- The tally ----
     The edition in figures, before any of its sentences: a row of numbers,
     each over its label, each in the colour its entries wear inside. */
  .tally {
    display: flex; margin-top: 22px; border-top: 1px solid var(--ink); border-bottom: 1px solid var(--line);
  }
  .stat { flex: 1; padding: 10px 0 10px 14px; border-left: 1px solid var(--line); }
  .stat:first-child { border-left: none; padding-left: 0; }
  .stat b {
    display: block; font-family: var(--font-display); font-size: 22pt; font-weight: 700;
    line-height: 1; font-variant-numeric: lining-nums tabular-nums; color: var(--ink);
  }
  .stat span { display: block; margin-top: 4px; font-size: 8pt; color: var(--ink-soft); }
  .stat.is-new b { color: var(--green); }
  .stat.is-updated b { color: var(--blue); }
  .stat.is-backfilled b { color: var(--slate); }
  .stat.is-removed b { color: var(--accent-deep); }
  .stat.is-same b, .stat.is-plain b { color: var(--ink-faint); }
  .stat.is-total { flex: 1.3; }

  /* ---- What's different ----
     Read, not scanned: plain headings and sentences at body size. Each
     sentence ends with the numbers of the entries it covers, set in the
     accent so they read as references rather than as part of the text. */
  .summary { margin-top: 26px; }
  .summary > h2 { font-family: var(--font-display); font-size: 16pt; font-weight: 700; letter-spacing: -.01em; }
  .summary > p.sub { margin-top: 3px; font-size: 8.5pt; color: var(--ink-faint); }
  .summary p.draft-note {
    margin-top: 10px; padding: 7px 11px; font-size: 8.5pt; color: var(--accent-deep);
    border: 1px dashed var(--accent); border-radius: 3px; max-width: 560px;
  }
  .sum-group { margin-top: 16px; break-inside: avoid; }
  .sum-group h3, .group-head h3 {
    display: flex; align-items: baseline; gap: 8px; break-after: avoid;
    font-family: var(--font-display); font-size: 12pt; font-weight: 700;
  }
  .sum-group h3::before, .group-head h3::before {
    content: ""; width: 8px; height: 8px; border-radius: 2px; flex: 0 0 auto;
    background: var(--ink-faint); transform: translateY(-1px);
  }
  .count {
    font-family: var(--font-body); font-size: 8pt; font-weight: 600; color: var(--ink-faint);
    font-variant-numeric: tabular-nums;
  }
  .is-new > h3, .is-new .group-head h3 { color: var(--green-deep); }
  .is-new > h3::before, .is-new .group-head h3::before { background: var(--green); }
  .is-updated > h3, .is-updated .group-head h3 { color: var(--blue-deep); }
  .is-updated > h3::before, .is-updated .group-head h3::before { background: var(--blue); }
  .is-backfilled > h3, .is-gone > h3, .is-backfilled .group-head h3, .is-gone .group-head h3 { color: var(--slate-deep); }
  .is-backfilled > h3::before, .is-gone > h3::before,
  .is-backfilled .group-head h3::before, .is-gone .group-head h3::before { background: var(--slate); }
  .is-removed > h3, .is-other > h3, .is-removed .group-head h3, .is-other .group-head h3 { color: var(--accent-deep); }
  .is-removed > h3::before, .is-other > h3::before,
  .is-removed .group-head h3::before, .is-other .group-head h3::before { background: var(--accent); }

  .summary ol { margin: 5px 0 0; padding: 0; list-style: none; }
  .summary li {
    break-inside: avoid; display: flex; gap: 16px; align-items: baseline;
    padding: 4px 0 4px 16px; border-bottom: 1px solid var(--line-soft);
  }
  .summary li:last-child { border-bottom: none; }
  .summary li .text { flex: 1; max-width: var(--measure); }
  .summary .refs {
    margin-left: auto; flex: 0 0 auto; display: flex; gap: 7px; justify-content: flex-end;
    font-size: 8.5pt; font-weight: 600; font-variant-numeric: tabular-nums;
  }
  .summary a.ref { color: var(--accent-deep); }

  /* ---- Contents ---- */
  .contents { margin-top: 28px; padding-top: 10px; border-top: 1px solid var(--ink); break-inside: avoid; }
  .kicker { color: var(--ink-faint); margin-bottom: 6px; }
  .contents ol { columns: 2; column-gap: 32px; margin: 4px 0 0; padding: 0; list-style: none; }
  .contents li { break-inside: avoid; border-bottom: 1px solid var(--line-soft); }
  .contents li a { display: flex; align-items: baseline; gap: 9px; padding: 4px 0; font-size: 9pt; }
  .contents .num {
    flex: 0 0 14px; font-family: var(--font-display); font-weight: 700; color: var(--accent);
    font-variant-numeric: lining-nums tabular-nums;
  }
  .contents .nm { flex: 1; min-width: 0; font-family: var(--font-display); font-weight: 600; }
  .contents .ct { flex: 0 0 auto; color: var(--ink-faint); font-size: 8pt; font-variant-numeric: tabular-nums; }
  .contents li.closing .num { color: var(--ink-ghost); }
  .contents li.closing .nm { font-weight: 400; color: var(--ink-soft); }
  /* The parts of a short edition: one column, each with what it is for. */
  .contents.parts { margin-top: 22px; }
  .contents.parts ol { columns: 1; }
  .contents.parts li a { flex-wrap: wrap; row-gap: 1px; }
  .contents.parts .role { flex: 0 0 100%; padding-left: 23px; font-size: 8.5pt; color: var(--ink-soft); }
  /* The catalogue's map of itself: quieter than a front-page contents, since
     it sits under a part heading rather than opening the document. */
  .contents.is-index { margin-top: 16px; padding-top: 8px; border-top-color: var(--line); }
  .contents .mvd { flex: 0 0 auto; font-size: 7.5pt; font-weight: 600; }
  .contents .mvd .is-new { color: var(--green-deep); }
  .contents .mvd .is-updated { color: var(--blue-deep); }
  .contents .mvd .is-backfilled { color: var(--slate-deep); }

  /* ---- The size key ---- */
  .size-key {
    display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px;
    margin-top: 14px; font-size: 8pt; color: var(--ink-faint); max-width: 600px;
  }
  .size-key > span:last-child { flex-basis: 100%; }

  .callout.redraft {
    margin-top: 24px; padding: 13px 16px; font-size: 9pt; max-width: 600px;
    background: var(--slate-soft); border-left: 3px solid var(--slate);
  }
  .callout.redraft b { color: var(--slate-deep); }
  .callout .redraft-note { margin-top: 8px; }

  /* ======================= THE PARTS ======================= */
  /* Each part opens a page, under a heading the size of a chapter, so a
     reader always knows which of the two they are in. */
  [data-page-start] { break-before: page; }
  .part-head { padding-top: 12px; border-top: 2px solid var(--accent); margin-bottom: 4px; break-after: avoid; }
  .part-head h2 { font-family: var(--font-display); font-size: 20pt; font-weight: 700; letter-spacing: -.015em; }
  .part-head p.sub { margin-top: 4px; font-size: 9pt; color: var(--ink-soft); max-width: 560px; }

  .status-group { margin-top: 26px; }
  .group-head { padding-bottom: 6px; border-bottom: 1px solid var(--ink); break-after: avoid; }
  .group-head p.sub { margin: 2px 0 0 16px; font-size: 8.5pt; color: var(--ink-faint); }
  .area-label {
    margin: 14px 0 0 calc(var(--rail) + var(--gutter)); color: var(--ink-faint); break-after: avoid;
  }

  /* Heading and first entry are glued together so a heading can never be
     stranded at the foot of a page. When the first entry alone is taller
     than a page, src/render/pdf.mjs lifts the glue, and these keep the
     heading on the entry's opening lines even then. */
  .keep { break-inside: avoid; }
  .cat-alone { break-after: avoid; }
  .area-head, .sub-head, .group-head, .area-label, .feature .name { break-after: avoid; }

  /* ======================= AN ENTRY ======================= */
  .feature {
    display: grid; grid-template-columns: var(--rail) 1fr; column-gap: var(--gutter);
    padding: 12px 0 13px; border-bottom: 1px solid var(--line); break-inside: avoid;
  }
  .area-label + .feature { padding-top: 5px; }

  .rail { display: flex; flex-direction: column; align-items: flex-start; gap: 5px; padding-top: 1px; }
  .rail .no {
    font-family: var(--font-display); font-size: 12pt; font-weight: 700; line-height: 1.1;
    color: var(--accent-deep); font-variant-numeric: lining-nums tabular-nums;
  }

  /* The status in the margin: a word, with a short bar of its colour beside
     it. The word carries the meaning; the colour lets a reader find every
     New on a page at a glance. */
  .status { display: inline-flex; align-items: center; gap: 5px; color: var(--ink-soft); }
  .status::before { content: ""; width: 3px; height: 10px; border-radius: 1px; background: currentColor; }
  .status.is-new { color: var(--green-deep); }
  .status.is-updated { color: var(--blue-deep); }
  .status.is-backfilled, .status.is-gone { color: var(--slate-deep); }
  .status.is-removed { color: var(--accent-deep); }
  .rail .status { white-space: normal; line-height: 1.25; }

  .feature .body { min-width: 0; max-width: var(--measure); }
  .feature .name { font-family: var(--font-display); font-weight: 700; font-size: 12pt; letter-spacing: -.005em; }
  .feature .was { display: block; margin-top: 1px; font-size: 8pt; color: var(--ink-faint); }
  .feature .desc { margin-top: 3px; color: var(--ink); }
  /* An updated entry's first sentence is a reminder of what it is, not the
     news: it steps back, and what changed below it carries the ink. */
  .feature .desc.is-brief { color: var(--ink-soft); }

  .changes, .how { margin-top: 9px; }
  .label { display: block; color: var(--ink-faint); margin-bottom: 2px; }
  .changes .label { color: var(--blue-deep); }
  .changes.is-draft .label { font-style: italic; }
  .changes ul { margin: 0; padding: 0; list-style: none; }
  .changes li { position: relative; padding-left: 13px; margin-top: 3px; color: var(--ink); }
  .changes li::before {
    content: ""; position: absolute; left: 1px; top: .58em; width: 5px; height: 5px;
    border-radius: 1px; background: var(--blue);
  }
  /* On an entry recorded late the list isn't news, so it takes the entry's
     own grey rather than the blue of this cycle's changes. */
  .feature.is-backfilled .changes .label { color: var(--slate-deep); }
  .feature.is-backfilled .changes li::before { background: var(--slate); }

  /* How to see it: an instruction the reader can act on, set apart on a
     quiet wash so it can be found again when they sit down to check. */
  .how { padding: 6px 10px 7px; background: var(--wash); border-left: 2px solid var(--ink-ghost); }
  .how p { color: var(--ink-soft); }

  /* ---- The size scale ----
     Three steps of one idea, drawn as three steps of one thing: a meter with
     one, two or three bars lit, in the accent. */
  .size { display: inline-flex; align-items: center; gap: 5px; color: var(--ink-faint); white-space: nowrap; }
  .meter { display: inline-flex; align-items: flex-end; gap: 1.5px; height: 9px; }
  .meter i { width: 3px; border-radius: .5px; display: block; background: var(--accent); }
  .meter i.off { background: var(--accent-mid); }
  .meter i:nth-child(1) { height: 4px; } .meter i:nth-child(2) { height: 6.5px; } .meter i:nth-child(3) { height: 9px; }

  /* ---- Areas and sub-sections ---- */
  .category + .category { margin-top: 30px; }
  .area-head {
    display: flex; align-items: baseline; gap: 10px; padding-top: 10px;
    border-top: 2px solid var(--accent);
  }
  .area-head .num {
    flex: 0 0 auto; font-family: var(--font-display); font-size: 16pt; font-weight: 700; color: var(--accent);
    font-variant-numeric: lining-nums;
  }
  .area-head h2, .area-head h3 { flex: 1; font-family: var(--font-display); font-size: 16pt; font-weight: 700; letter-spacing: -.01em; }
  .area-head .meta { font-size: 8pt; color: var(--ink-faint); white-space: nowrap; }
  .area-head .meta .is-new { color: var(--green-deep); font-weight: 600; }
  .area-head .meta .is-updated { color: var(--blue-deep); font-weight: 600; }
  .area-head .meta .is-backfilled { color: var(--slate-deep); font-weight: 600; }
  .area-intro { margin-top: 3px; padding-bottom: 6px; font-size: 9pt; color: var(--ink-soft); max-width: 560px; break-after: avoid; }

  .subsection { margin-top: 16px; }
  .sub-head { margin-left: calc(var(--rail) + var(--gutter)); padding-bottom: 2px; }
  .sub-name {
    display: flex; align-items: baseline; gap: 10px;
    font-family: var(--font-display); font-size: 12.5pt; font-weight: 700; color: var(--accent-deep);
  }
  .sub-intro { margin-top: 2px; font-size: 9pt; color: var(--ink-soft); max-width: var(--measure); }

  /* ---- Across the product ---- */
  .other-list { margin: 10px 0 0 calc(var(--rail) + var(--gutter)); padding: 0; list-style: none; max-width: var(--measure); }
  .other-list li { position: relative; padding-left: 13px; margin-bottom: 6px; }
  .other-list li::before {
    content: ""; position: absolute; left: 1px; top: .58em; width: 5px; height: 5px;
    border-radius: 1px; background: var(--accent);
  }

  /* ======================= THE CATALOGUE ======================= */
  /* The whole product, one line a feature, numbered: the index every other
     number in the document points into. */
  .rest .size-key { margin-top: 10px; }
  .rest-area { margin-top: 22px; }
  .rest .area-head { border-top-width: 1px; border-top-color: var(--ink); }
  .rest .area-head .num, .rest .area-head h3 { font-size: 13pt; }
  .rest-sub {
    margin: 10px 0 0 64px; font-family: var(--font-display); font-weight: 700; font-size: 10pt;
    color: var(--accent-deep); break-after: avoid;
  }
  .rest-list { margin: 2px 0 0; padding: 0; list-style: none; }
  .rest-list li {
    break-inside: avoid; display: grid; grid-template-columns: 34px 22px 27% 1fr 64px; column-gap: 8px;
    align-items: baseline; padding: 5px 0; border-bottom: 1px solid var(--line-soft);
  }
  .rest-list .no {
    font-family: var(--font-display); font-weight: 700; font-size: 9pt; color: var(--accent-deep);
    font-variant-numeric: lining-nums tabular-nums;
  }
  .rest-list .sz .size { transform: translateY(1px); }
  .rest-list .nm { font-family: var(--font-display); font-weight: 700; font-size: 10pt; line-height: 1.3; }
  .rest-list .first { color: var(--ink-soft); font-size: 8.75pt; }
  .rest-list .mv { text-align: right; }
  .rest-list .moved { white-space: nowrap; }
  .rest-list .moved::after {
    content: ""; display: inline-block; width: 6px; height: 6px; margin-left: 5px; border-radius: 1px;
    background: currentColor; transform: translateY(-1px);
  }
  .rest-list .moved {
    font-size: 6.8pt; font-weight: 700; letter-spacing: .09em; text-transform: uppercase;
  }
  .rest-list .moved.is-new { color: var(--green-deep); }
  .rest-list .moved.is-updated { color: var(--blue-deep); }
  .rest-list .moved.is-backfilled { color: var(--slate-deep); }

  .colophon {
    margin-top: 36px; padding-top: 10px; border-top: 1px solid var(--line);
    font-size: 7.5pt; color: var(--ink-faint); break-inside: avoid;
  }
`;

export { LedgerHtml };
