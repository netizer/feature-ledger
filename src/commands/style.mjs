import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openProject } from "../store.mjs";
import {
  STYLES, STYLE_FILENAME, DEFAULT_STYLE_ID, CUSTOM_STYLE_ID,
  resolveStyle, styleSection, styleTitle,
} from "../style.mjs";
import { fail, readJson, writeJson, exists, COPY_RULE } from "../util.mjs";
import { refreshAgents } from "./init.mjs";

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
  if (sub === "rewrite") return rewrite(flags);
  if (sub !== "show") fail(`unknown subcommand "${sub}" — usage: ledger style [show | list | set <id> | rewrite]`);

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
 */
function rewrite(flags) {
  const project = openProject(flags);
  const style = resolve(project);
  const categories = project.config.categories;

  process.stdout.write(
    fs.readFileSync(path.join(PKG_ROOT, "assets", "RESTYLE.md"), "utf8")
      .replaceAll("{product}", project.config.product)
      .replaceAll("{style}", styleSection(style, { withFooter: false }))
      .replaceAll("{count}", String(project.featureSet.features().length))
      .replaceAll("{categories}", categories.length ? categories.map((c) => `  - ${c}`).join("\n") : "  (none yet)")
      .replaceAll("{copy_rule}", COPY_RULE),
  );
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
