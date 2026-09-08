/**
 * The tone the ledger is written in.
 *
 * A ledger is read by a client, often in a second language. Left to itself a
 * coding agent writes in its own register: contrastive framings ("X rather
 * than Y"), abstract nouns, and sentences that end on a flourish. Telling it
 * to "write plainly" does not move that, because the agent already believes
 * it is writing plainly. Naming a public style guide does not move it either:
 * those guides are long documents about headings, capitalization and code
 * samples, and they say almost nothing about the register of a three-sentence
 * feature description. The agent takes the name, finds no constraint in it
 * for this shape of text, and fills the gap with its default voice.
 *
 * So each tone here carries a SAMPLE and three EXAMPLES, and the instruction
 * is to match them. The sample is a paragraph of product prose in that
 * register. The examples are feature descriptions, which is the genre the
 * agent actually has to produce. Both are written for this package, in the
 * register of the guide they name, so nothing here has to be licensed from
 * anyone; the guide's URL stays as the reference it was drawn from.
 *
 * All four describe the same fictional product — the grocery wholesaler in
 * examples/northwind — so the only difference between them is the tone.
 *
 * A project that wants its own voice writes it as prose in `.ledger/STYLE.md`
 * and supplies its own sample and examples the same way.
 */

import fs from "node:fs";
import path from "node:path";

export const STYLE_FILENAME = "STYLE.md";

export const STYLES = {
  google: {
    name: "Google developer documentation style guide",
    url: "https://developers.google.com/style",
    summary: "Neutral and precise. The technical-writing standard most coding agents know best.",
    voice:
      "Write as the sample does: address the reader as \"you\", stay in the present tense, and keep " +
      "one idea to a sentence. Explain a term the first time the product uses it. Every sentence " +
      "states something a reader could confirm by using the product.",
    sample:
      "Northwind Portal is an ordering site for a grocery wholesaler, with a picking console for the " +
      "warehouse that packs the orders. Customers build a basket, choose a delivery window, and " +
      "confirm the order without creating an account first. Each confirmed order becomes a run: the " +
      "list one picker works through in the warehouse, sorted in aisle order and sent to a handheld " +
      "scanner. If an item is out of stock, the picker offers a substitute, and the customer approves " +
      "or declines it from a link in their confirmation email. You can see the state of every run on " +
      "the console, including the time left before its van leaves. A run that cannot be picked in time " +
      "moves to a queue that a supervisor works from.",
    examples: [
      "Guided checkout: A customer moves through basket, delivery window, address, and review in four " +
      "numbered steps. The running total shows on every step. An account is only needed on the final screen.",

      "Approved substitutions: When an item is out of stock, the picker offers the closest match in the " +
      "same pack size. The customer approves or declines it from a link in the confirmation email, up to " +
      "an hour before the van leaves.",

      "Exception queue: A run that cannot be picked in time moves to a queue that a supervisor works from. " +
      "Each entry shows why the run stopped, who was picking it, and which van it was due on.",
    ],
  },

  govuk: {
    name: "GOV.UK content style guide",
    url: "https://www.gov.uk/guidance/style-guide",
    summary: "The plainest English of the four. Written to be understood by everyone.",
    voice:
      "Write as the sample does: short sentences, everyday words, and one fact in each sentence. Say " +
      "\"you\" and say what happens. Give the number, the time or the limit where there is one. Every " +
      "sentence states something a reader could confirm by using the product.",
    sample:
      "Northwind Portal is an ordering site for a grocery wholesaler. It also has a picking console for " +
      "the warehouse. Customers add items to a basket and choose a delivery window. They do not need an " +
      "account until they confirm the order. Each confirmed order becomes a run. A run is the list one " +
      "picker works through in the warehouse. The list is in aisle order and shows on a handheld scanner. " +
      "If an item is out of stock, the picker offers a substitute. The customer says yes or no by email. " +
      "The console shows every run and the time left before its van leaves. A run that will miss its van " +
      "goes to a supervisor.",
    examples: [
      "Guided checkout: A customer orders in four steps: basket, delivery window, address and review. The " +
      "total shows on every step. They only need an account at the last step.",

      "Approved substitutions: If an item is out of stock, the picker offers the closest match in the same " +
      "pack size. The customer says yes or no by email. They can do this until 1 hour before the van leaves.",

      "Exception queue: A run that cannot be picked in time goes to a supervisor's queue. Each one shows why " +
      "it stopped, who was picking it and which van it was for.",
    ],
  },

  "plain-language": {
    name: "Federal Plain Language Guidelines",
    url: "https://www.plainlanguage.gov/guidelines/",
    summary: "The US plain-writing standard. Close to GOV.UK, with more attention to structure.",
    voice:
      "Write as the sample does: put what the reader needs first, use the active voice, and keep each " +
      "sentence to one idea. Explain a term where it first appears. Say who does the thing. Every " +
      "sentence states something a reader could confirm by using the product.",
    sample:
      "Northwind Portal has two parts. Customers use the ordering site. Warehouse staff use the picking " +
      "console. On the ordering site, a customer adds items to a basket, picks a delivery window, and " +
      "confirms the order. The customer does not need an account until the last step. Each confirmed order " +
      "becomes a run, which is the list of items one picker collects in the warehouse. The console sorts " +
      "each run in aisle order and sends it to a handheld scanner. When an item is out of stock, the picker " +
      "offers a substitute, and the customer approves or declines it. Supervisors see any run that will miss " +
      "its van, so they can reassign it before the van leaves.",
    examples: [
      "Guided checkout: A customer completes four steps to order: basket, delivery window, address, and " +
      "review. The running total appears on each step. The customer creates an account at the final step.",

      "Approved substitutions: When an item is out of stock, the picker offers the closest match in the same " +
      "pack size. The customer approves or declines the substitute by email, up to one hour before the van leaves.",

      "Exception queue: The console moves a run that cannot be picked in time to a supervisor's queue. Each " +
      "entry names the reason, the picker, and the van.",
    ],
  },

  ste: {
    name: "ASD-STE100 Simplified Technical English",
    url: "https://www.asd-ste100.org/",
    summary: "The aviation standard. Maximum clarity, deliberately clipped.",
    // Reads as a proper noun, so it takes no article in a sentence.
    article: "",
    voice:
      "Write as the sample does: short sentences, one meaning for each word, and the same word for the " +
      "same thing every time. Name the subject of each sentence. Use the present tense and the active " +
      "voice. Every sentence states something a reader could confirm by using the product.",
    sample:
      "Northwind Portal has two parts: an ordering site and a picking console. On the ordering site, the " +
      "customer puts items in a basket. The customer then selects a delivery window and confirms the order. " +
      "The customer does not need an account before this step. The system makes a run from each confirmed " +
      "order. A run is a list of items for one picker. The console puts the items of a run in aisle sequence. " +
      "The console sends the run to a handheld scanner. If an item is not in stock, the picker offers a " +
      "substitute item. The customer accepts or refuses the substitute item by email. If a run will be late, " +
      "the console sends the run to a supervisor.",
    examples: [
      "Guided checkout: The customer does four steps: basket, delivery window, address, and review. The total " +
      "is on each step. The customer makes an account at the last step.",

      "Approved substitutions: If an item is not in stock, the picker offers a substitute item of the same pack " +
      "size. The customer accepts or refuses the substitute item by email. The customer can do this until one " +
      "hour before the van departs.",

      "Exception queue: If a run will be late, the console sends the run to a supervisor queue. Each run in the " +
      "queue shows the cause, the picker, and the van.",
    ],
  },
};

export const DEFAULT_STYLE_ID = "google";
export const CUSTOM_STYLE_ID = "custom";

/** The guide's name as it reads mid-sentence: "written to <this>". */
export const styleTitle = (style) => `${style.article ?? "the "}${style.name}`;

/**
 * The project's tone. `config.style` is one id and nothing else: there are no
 * per-rule overrides, because a tone that can be tuned clause by clause stops
 * being a tone. A project that needs its own writes the whole thing.
 */
export function resolveStyle(config, ledgerDir = null) {
  const id = typeof config?.style === "string" ? config.style : DEFAULT_STYLE_ID;

  if (id === CUSTOM_STYLE_ID) {
    const file = ledgerDir ? path.join(ledgerDir, STYLE_FILENAME) : null;
    if (!file || !fs.existsSync(file)) {
      throw new Error(
        `the style is "custom" but there is no ${STYLE_FILENAME} in the ledger directory — ` +
        "write the tone there as prose, or run `ledger style set custom` to start one",
      );
    }
    return { id, name: "this project's own tone", url: null, article: "", custom: fs.readFileSync(file, "utf8").trim() };
  }

  const preset = STYLES[id];
  if (!preset) {
    throw new Error(`unknown style "${id}" — known: ${Object.keys(STYLES).join(", ")}, ${CUSTOM_STYLE_ID}`);
  }
  return { id, ...preset };
}

/**
 * One line naming the tone, for the places that only have room for that: the
 * standing instruction in an agent file, and the survey prompt. It sends the
 * reader to the sample, because the name of a guide is not the tone.
 */
export function styleLine(style) {
  const named = style.custom
    ? "**the tone described in `.ledger/" + STYLE_FILENAME + "`**."
    : `**${styleTitle(style)}**.`;
  return `${named}\nRun \`ledger style\`: it prints a sample of that tone and three feature\ndescriptions written in it. Match them, sentence for sentence.`;
}

/**
 * The tone, as the block that `ledger style` and `ledger rules` both print.
 *
 * `withFooter: false` for the places that are already the thing the footer
 * points at.
 */
export function styleSection(style, { withFooter = true } = {}) {
  const tail = withFooter ? `\n\n${FOOTER}` : "";

  if (style.custom) {
    // The file usually opens with its own title. Under a heading here, that
    // reads as two headings for one thing.
    const body = style.custom.replace(/^#\s+.*\n+/, "");
    return `## The tone to write in\n\n${body}${tail}`;
  }

  const examples = style.examples.map((e) => `- ${e}`).join("\n\n");

  return [
    "## The tone to write in",
    "",
    `This ledger is written to ${styleTitle(style)}.`,
    `Reference: ${style.url}`,
    "",
    "Write from the sample below, not from the name of that guide. The sample is",
    "how this ledger sounds. Match it.",
    "",
    "### A product described in this tone",
    "",
    style.sample,
    "",
    "### Three feature descriptions in this tone",
    "",
    examples,
    "",
    "### What to match",
    "",
    style.voice,
    "",
    "Write every description the way those three are written. Say what the product",
    "does today, in the present tense. Give the number, the limit or the step count",
    "where there is one. Keep a description to two or three sentences.",
  ].join("\n") + tail;
}

const FOOTER =
  "`ledger style` prints this on its own, and `ledger style list` shows the other tones.\n" +
  "`ledger style rewrite` prints the procedure for bringing an existing ledger over to it.";
