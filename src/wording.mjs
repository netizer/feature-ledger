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

export const GENERATED_HEADER = (ledgerDirName = ".ledger") => `<!--
  GENERATED FILE: do not hand-edit, and don't commit it.
  The source of truth is ${ledgerDirName}/; run \`ledger build\` to rebuild.
-->

`;
