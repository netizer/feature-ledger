/**
 * Every line of standing prose the generators emit, in one place.
 *
 * All of it is overridable per project from `.ledger/config.json`'s `docs`
 * block — the defaults are written to be true of any product rather than
 * generic-sounding, which is why they lean on `product` and the optional
 * one-line `tagline` instead of saying "this software".
 */

const withTagline = (config, sentence) =>
  config.tagline ? `${sentence.replace(/\.$/, "")} — ${config.tagline}.` : sentence;

export function wording(config) {
  const product = config.product;
  const custom = config.docs ?? {};

  const defaults = {
    features: {
      title: "Features",
      intro: [
        withTagline(config, `A plain-language list of what's built into ${product} today.`) +
        " Grouped by area, with each feature tagged by size so it's easy to see the big pieces at a glance" +
        " without losing the smaller touches that make the whole thing feel thought-through. Purely mechanical" +
        " form checks (required fields, valid email format, and the like) aren't listed — this is about what the" +
        " system actually *does*, not basic input policing.",
        "",
        "**Big** = a major capability on its own. **Medium** = a meaningful feature within a bigger area." +
        " **Small** = a specific, deliberate touch or guardrail. **New** = added this release." +
        " **Changed** = meaningfully changed this release.",
      ].join("\n"),
    },
    extended: {
      title: "Features (extended)",
      intro:
        "The same feature list as the client-facing one — what actually ships and what the client sees — with" +
        " technical implementation notes folded in under each entry, for anyone working in this codebase. This is" +
        " the doc to read to understand the product **and** how it's built, without needing the two side by side.",
    },
    dev: {
      title: "Dev Features",
      intro:
        "Implementation-level notes on things a client never sees or cares about — no client-facing angle at all." +
        " Paired with the extended feature list (client-facing features with dev notes attached).",
    },
    pdf: {
      // The <em> is the one word that takes the accent colour on the cover.
      title_html: "The Feature <em>Ledger</em>",
      intro: withTagline(
        config,
        `Everything currently built into ${product}, in plain language, grouped by area.`,
      ) + " Sized so the big pieces stand out without losing the small touches that make the whole thing hold together.",
      colophon: `Prepared for ${config.prepared_for}; every entry describes behaviour that is built and running.`,
    },
  };

  const merged = {};
  for (const key of Object.keys(defaults)) merged[key] = { ...defaults[key], ...(custom[key] ?? {}) };
  return merged;
}

export const GENERATED_HEADER = (ledgerDirName = ".ledger") => `<!--
  GENERATED FILE — do not hand-edit, and don't commit it.
  The source of truth is ${ledgerDirName}/; run \`ledger build\` to rebuild.
-->

`;
