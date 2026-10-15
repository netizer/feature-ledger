import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openProject } from "../store.mjs";
import {
  STYLES, STYLE_FILENAME, DEFAULT_STYLE_ID, CUSTOM_STYLE_ID,
  resolveStyle, styleSection, styleTitle,
} from "../style.mjs";
import { fail, readJson, writeJson, exists, COPY_BLOCK } from "../util.mjs";
import { refreshAgents } from "./init.mjs";
import { restyleDue, markStyled, seedStyles } from "../state.mjs";

const PKG_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = (s) => process.stdout.write(`${s}\n`);

/**
 * `ledger style` is how an agent finds out how to write, without the answer
 * having to be repeated in every prompt. It prints the same block that sits
 * inside `ledger rules`, so there is one source of truth for the tone.
 */
export async function cmdStyle({ flags, positional }) {
  const sub = positional[0] ?? "show";
  if (sub === "list") return listStyles(flags);
  if (sub === "set") return setStyle(flags, positional.slice(1));
  if (sub === "rewrite") return positional[1] === "complete" ? rewriteComplete(flags, positional.slice(2)) : rewrite(flags);
  if (sub !== "show") fail(`unknown subcommand "${sub}" — usage: ledger style [show | list | set <id> | rewrite [complete]]`);

  const project = openProject(flags);
  const style = resolve(project);
  if (flags.json) {
    out(JSON.stringify(style, null, 2));
    return;
  }
  out(styleSection(style));
}

function listStyles(flags) {
  let current = DEFAULT_STYLE_ID;
  try {
    current = resolve(openProject(flags)).id;
  } catch {
    // Listing the tones is useful before there is a project to set one on.
  }
  if (flags.json) {
    out(JSON.stringify({ current, styles: STYLES }, null, 2));
    return;
  }
  for (const [id, s] of Object.entries(STYLES)) {
    out(`${id === current ? "*" : " "} ${id.padEnd(15)} ${s.name}`);
    out(`  ${"".padEnd(15)} ${s.summary}`);
    out(`  ${"".padEnd(15)} ${s.url}`);
    out("");
  }
  out(`${current === CUSTOM_STYLE_ID ? "*" : " "} ${CUSTOM_STYLE_ID.padEnd(15)} this project's own tone`);
  out(`  ${"".padEnd(15)} written as prose in .ledger/${STYLE_FILENAME}`);
}

function setStyle(flags, args) {
  const id = args[0];
  if (!id) fail(`usage: ledger style set <id>  (${Object.keys(STYLES).join(", ")}, ${CUSTOM_STYLE_ID})`);
  if (id !== CUSTOM_STYLE_ID && !STYLES[id]) {
    fail(`unknown style "${id}" — run \`ledger style list\` to see the options`);
  }

  const project = openProject(flags);
  project.assertWritable();

  // A custom tone is a document, not a setting, so setting one starts the
  // document rather than leaving the project pointed at nothing.
  let started = false;
  if (id === CUSTOM_STYLE_ID) {
    const file = path.join(project.ledgerDir, STYLE_FILENAME);
    if (!exists(file)) {
      fs.writeFileSync(file, fs.readFileSync(path.join(PKG_ROOT, "assets", "STYLE-template.md"), "utf8"));
      started = true;
    }
  }

  // What every entry was written in until now, recorded before the tone
  // moves, so a rewrite knows exactly what is left and never redoes one.
  seedStyles(project, project.config.style, id);
  project.saveState();

  // Written straight to the file rather than through the merged config, so
  // the defaults this project never touched stay absent from its config.
  const raw = readJson(project.configPath);
  raw.style = id;
  writeJson(project.configPath, raw);

  const config = { ...project.config, style: id };
  const style = resolve({ config, ledgerDir: project.ledgerDir });
  out(`style set to ${styleTitle(style)}`);
  if (style.url) out(style.url);
  if (started) out(`started .ledger/${STYLE_FILENAME} — write the tone there, as prose`);

  // The stanza in CLAUDE.md / AGENTS.md names the tone, so it has to move
  // with this setting or an agent will read a guide the project has left.
  const { updated, stale } = refreshAgents(project.root, config, project.ledgerDir);
  for (const f of updated) out(`updated ${f}`);
  for (const f of stale) {
    out(`! ${f} has an older ledger stanza with no end marker; replace it by hand, or delete it and run \`ledger init\``);
  }

  out("");
  out("Existing entries keep the words they have. `ledger style rewrite` prints the procedure for bringing them over.");
}

/**
 * Rewriting an existing ledger into a new tone is agent work: only something
 * that can read a description can say the same thing differently. So this
 * prints the procedure, and whichever agent you use runs it.
 *
 * It covers what is still in another tone, by area (`--category` narrows it
 * to one), and each area is marked done with `ledger style rewrite complete`
 * as it is finished, so a rewrite that stops halfway carries on from there.
 * With nothing left in another tone, it covers every entry: asked for
 * anyway, it is a second pass in the same tone.
 */
function rewrite(flags) {
  const project = openProject(flags);
  const style = resolve(project);
  const due = restyleDue(project);
  const whole = !due.due;
  let entries = whole ? project.featureSet.features() : due.entries;
  const area = typeof flags.category === "string" ? flags.category : null;
  if (area) {
    if (!project.config.categories.includes(area)) fail(`unknown area ${JSON.stringify(area)} — \`ledger categories\` lists them`);
    entries = entries.filter((f) => f.category === area);
  }
  const byArea = new Map();
  for (const c of project.config.categories) byArea.set(c, []);
  for (const f of entries) {
    if (!byArea.has(f.category)) byArea.set(f.category, []);
    byArea.get(f.category).push(f.id);
  }
  const areas = [...byArea].filter(([, ids]) => ids.length);
  const total = project.featureSet.features().length;
  const countLine = whole
    ? `There are ${total} entries, all of them already recorded in this tone: this is a second pass.`
    : `${entries.length} of the ${total} entries are still in an earlier tone, and they are the ones to rewrite. ` +
      "The others are already in this tone: leave them alone.";
  const rest = !area && (whole || due.other);

  process.stdout.write(
    fs.readFileSync(path.join(PKG_ROOT, "assets", "RESTYLE.md"), "utf8")
      .replaceAll("{product}", project.config.product)
      .replaceAll("{style}", styleSection(style, { withFooter: false }))
      .replaceAll("{count_line}", countLine)
      .replaceAll("{categories}", areas.length
        ? areas.map(([c, ids]) => `  - ${c}: ${ids.join(", ")}`).join("\n")
        : "  (no entries left: only the text below)")
      .replaceAll("{rest}", rest
        ? "**Then the parts that are not features.** Sub-section headings and overviews\n" +
          "(`ledger subcategories list`, edited in `.ledger/subcategories.json`), any\n" +
          "product-wide notes in `.ledger/other-changes.json`, and the product's one-line\n" +
          "description in `.ledger/config.json`, if it has one. When they are done, run\n" +
          "`ledger style rewrite complete`, which records the rest of the text, and any\n" +
          "entry still left, as rewritten."
        : "The text that belongs to no entry is already in this tone, so leave it alone.")
      .replaceAll("{copy_rule}", COPY_BLOCK),
  );
}

/**
 * `ledger style rewrite complete [--category "Area" | <id>…]`: records the
 * entries named, or with neither every entry and the rest of the text, as
 * written in the project's tone. The rewrite reads this back, so it is what
 * stops one being sent through twice.
 */
function rewriteComplete(flags, ids) {
  const project = openProject(flags);
  project.assertWritable();
  const due = restyleDue(project);
  const area = typeof flags.category === "string" ? flags.category : null;
  if (area && !project.config.categories.includes(area)) fail(`unknown area ${JSON.stringify(area)} — \`ledger categories\` lists them`);
  for (const id of ids) project.featureSet.find(id);
  const all = !area && !ids.length;
  const done = due.entries.filter((f) => all || (area ? f.category === area : ids.includes(f.id)));
  const other = all && due.other;

  if (flags["dry-run"]) {
    out(`would record ${done.length} entr${done.length === 1 ? "y" : "ies"}${other ? ", and the rest of the text," : ""} as written in ${due.style}`);
    out("(--dry-run: nothing written)");
    return;
  }
  if (markStyled(project, done.map((f) => f.id), { other })) project.saveState();
  const left = restyleDue(project);
  out(done.length || other
    ? `recorded ${done.length} entr${done.length === 1 ? "y" : "ies"}${other ? " and the rest of the text" : ""} as written in ${due.style}`
    : `nothing to record: ${all ? "everything is" : "those are"} already in ${due.style}`);
  out(left.due
    ? `still in an earlier tone: ${left.entries.length} entr${left.entries.length === 1 ? "y" : "ies"}${left.other ? ", and the text that belongs to no entry" : ""}`
    : "the whole ledger is in this tone now. Read the diff before you commit it.");
}

/** resolveStyle throws a plain Error for a bad config; turn it into the
 *  message a person running the command should see. */
function resolve(project) {
  try {
    return resolveStyle(project.config, project.ledgerDir);
  } catch (e) {
    return fail(`${e.message}\n(the "style" key in .ledger/config.json)`);
  }
}
