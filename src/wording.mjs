/**
 * Every line of standing prose the generators emit, in one place.
 *
 * All of it is overridable per project from `.ledger/config.json`'s `docs`
 * block. The defaults are written to be true of any product rather than
 * generic-sounding, which is why they lean on `product` and the optional
 * one-line `tagline` instead of saying "this software". They are also written
 * to the same style guide the entries are: see `ledger style`.
 */

// The tagline leads, as its own sentence, so the reader knows what the
// product is before being told what the list is. Joining it to the sentence
// with a dash is exactly the construction the style guides rule out.
const withTagline = (config, sentence) => {
  if (!config.tagline) return sentence;
  const t = config.tagline.trim().replace(/[.\s]+$/, "");
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}. ${sentence}`;
};

export function wording(config) {
  const product = config.product;
  const custom = config.docs ?? {};

  const defaults = {
    features: {
      title: "Features",
      intro: [
        withTagline(config, `A plain-language list of what ${product} does today.`) +
        ` Every entry is one capability someone using ${product} would name: something they can ask for,` +
        " or would miss if it went away. Smaller things — a default, a guardrail, a piece of polish, a" +
        " routine form check — are described inside the capability they belong to rather than listed on" +
        " their own, so this list stays the size of the product rather than the size of the codebase.",
        "",
        "**Big** = a capability the product is chosen for. **Medium** = a capability in its own right," +
        " inside a bigger one. **Small** = a capability narrow enough to describe in a line." +
        " **New** = added this release. **Changed** = meaningfully changed this release." +
        " **Already in place** = part of the product already, listed here for the first time.",
      ].join("\n"),
    },
    extended: {
      title: "Features (extended)",
      intro:
        "The client-facing feature list, with technical implementation notes added under each entry." +
        " Read this to understand both what the product does and how it is built, without opening two documents.",
    },
    dev: {
      title: "Dev Features",
      intro:
        "Implementation notes on parts of the system a client never sees." +
        " For client-facing features and their implementation notes, read the extended feature list.",
    },
    // The two labels for the third register: an entry the audit found late,
    // where the product did not move this cycle — the record did. Green and
    // blue say the software changed; these say the document caught up. They
    // are worded as reassurance rather than confession, because the reader is
    // a client: "already in place" says *you have this*, where "not
    // previously documented" says *we were sloppy*.
    tags: {
      backfilled: "Already in place",
      backfilled_removed: "No longer present",
    },
    // The first edition after a redraft, where the corpus was written again
    // from scratch. The reader already holds editions arranged another way,
    // and a document that silently changed shape would read as though the
    // product had. {editions} is "Editions 1 to 4" or "Edition 1", {those}
    // "those editions" or "that edition", and {last} the last of them. A
    // per-redraft note, from `ledger redraft complete --note`, follows it.
    redraft: {
      title: "This edition is reorganized",
      body:
        "{editions} arranged this ledger differently. This edition arranges it afresh, so its areas, names and" +
        " descriptions don't match {those} line for line. Every capability from version {last} that" +
        ` ${product} still has is described here. Because the structure changed, nothing in this edition is` +
        " marked as new or updated. From the next edition, changes are marked again.",
      // A first edition marked `redraft` in releases.json: the earlier
      // reports were sent some other way, so there is no edition to name and
      // no promise to make that every capability they listed is still here.
      body_earlier:
        `Earlier reports described ${product} in a different arrangement. This edition starts the list afresh,` +
        " so its areas, names and descriptions don't match those reports line for line. Each entry here is one" +
        " capability you could ask for by name, and smaller details are described inside the capability they" +
        " belong to rather than listed on their own. Because the structure changed, nothing in this edition is" +
        " marked as new or updated. From the next edition, changes are marked again.",
    },
    pdf: {
      // The <em> is the one word that takes the accent colour on the cover.
      title_html: "The Feature <em>Ledger</em>",
      intro: withTagline(
        config,
        `Everything ${product} does today, in plain language.`,
      ) + " Each entry is one capability you could ask for by name, sized so the biggest pieces stand out.",
      colophon: `Prepared for ${config.prepared_for}; every entry describes behaviour that is built and running.`,
    },
  };

  const merged = {};
  for (const key of Object.keys(defaults)) merged[key] = { ...defaults[key], ...(custom[key] ?? {}) };
  return merged;
}

/**
 * The standard redraft paragraph, filled in for the editions it follows.
 * `versions` are the editions the redraft replaces — none when it is the
 * first edition, and what it replaces are reports sent outside the ledger.
 */
export function redraftBody(words, versions) {
  if (!versions.length) return words.redraft.body_earlier;
  const first = versions[0];
  const last = versions[versions.length - 1];
  const one = first === last;
  return words.redraft.body
    .replaceAll("{editions}", one ? `Edition ${first}` : `Editions ${first} to ${last}`)
    .replaceAll("{those}", one ? "that edition" : "those editions")
    .replaceAll("{last}", String(last));
}

export const GENERATED_HEADER = (ledgerDirName = ".ledger") => `<!--
  GENERATED FILE: do not hand-edit, and don't commit it.
  The source of truth is ${ledgerDirName}/; run \`ledger build\` to rebuild.
-->

`;
