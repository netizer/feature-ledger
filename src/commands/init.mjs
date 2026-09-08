import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeJson, exists, fail, isBlank } from "../util.mjs";
import { LEDGER_DIRNAME, DEFAULT_CONFIG, DEFAULT_BRAND, COMMITTED_CLIENT_DIR, pdfsAreCommitted } from "../store.mjs";
import { resolveStyle, styleTitle, styleLine, STYLES, CUSTOM_STYLE_ID } from "../style.mjs";

const PKG_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const asset = (name) => fs.readFileSync(path.join(PKG_ROOT, "assets", name), "utf8");
const out = (s) => process.stdout.write(`${s}\n`);

/**
 * Where a pointer to the authoring rules goes, per agent. These are the files
 * each tool loads on its own; the ledger writes a short stanza into whichever
 * ones a project already has, rather than copying the rules themselves —
 * one source of truth, reachable from every agent, and cheap in context
 * because the full text is only pulled when an edit is actually happening.
 */
const AGENT_FILES = {
  claude: "CLAUDE.md",
  agents: "AGENTS.md",
  gemini: "GEMINI.md",
  cursor: ".cursor/rules/feature-ledger.mdc",
  copilot: ".github/copilot-instructions.md",
  windsurf: ".windsurfrules",
};

const MARKER = "<!-- feature-ledger -->";
const END_MARKER = "<!-- /feature-ledger -->";

/** The stanza with this project's style guide named in it. An agent doing a
 *  small edit often reads only this file, so the guide is stated here rather
 *  than left one command away. */
function stanzaFor(config, ledgerDir) {
  const style = resolveStyle(config, ledgerDir);
  return asset("agent-pointer.md")
    .replaceAll("{style_line}", styleLine(style))
    .replaceAll("{build_line}", buildLine(config));
}

function buildLine(config) {
  const lead = "Do not run `ledger build` as part of an ordinary change.";
  if (!pdfsAreCommitted(config)) {
    return `${lead} The generated docs are\nbuild output and are gitignored.`;
  }
  const dir = String(config.output.client_dir).replace(/\/+$/, "");
  return `${lead} The Markdown docs are\n` +
    `gitignored build output; the client PDFs in \`${dir}/\` are committed, and\n` +
    "are minted when a release is cut.";
}

/** Replace the marked block in every agent file that has one. Used when the
 *  style guide changes, so the pointer never names a guide the project has
 *  moved off. */
export function refreshAgents(root, config, ledgerDir) {
  const stanza = stanzaFor(config, ledgerDir);
  const updated = [];
  const stale = [];
  for (const rel of Object.values(AGENT_FILES)) {
    const file = path.join(root, rel);
    if (!exists(file)) continue;
    const existing = fs.readFileSync(file, "utf8");
    const start = existing.indexOf(MARKER);
    if (start === -1) continue;
    const end = existing.indexOf(END_MARKER, start);
    if (end === -1) { stale.push(rel); continue; }
    const next = existing.slice(0, start) + stanza.trim() + existing.slice(end + END_MARKER.length);
    if (next !== existing) { fs.writeFileSync(file, next); updated.push(rel); }
  }
  return { updated, stale };
}

/** The one line in `.ledger/README.md` that depends on where the editions go. */
function ledgerReadmeOutputLine(config) {
  const dir = String(config.output.dir).replace(/\/+$/, "");
  const clientDir = String(config.output.client_dir).replace(/\/+$/, "");
  if (!pdfsAreCommitted(config)) {
    return `The documents it generates (\`${dir}/\`) are build output and are not\ncommitted.`;
  }
  return `The Markdown documents it generates (\`${dir}/\`) are build output and\n` +
    `are not committed; the client editions in \`${clientDir}/\` are, so every\n` +
    "document handed over stays in the repo.";
}

function styleFlag(flags) {
  const id = flags.style && flags.style !== true ? String(flags.style) : DEFAULT_CONFIG.style;
  if (id !== CUSTOM_STYLE_ID && !STYLES[id]) {
    fail(`unknown style "${id}" — known: ${Object.keys(STYLES).join(", ")}, ${CUSTOM_STYLE_ID}`);
  }
  return id;
}

export async function cmdInit({ flags }) {
  const root = path.resolve(flags.root ?? process.cwd());
  const ledgerDir = path.join(root, flags.dir ?? LEDGER_DIRNAME);

  if (exists(path.join(ledgerDir, "config.json")) && !flags.force) {
    fail(`${path.relative(root, ledgerDir)}/config.json already exists — pass --force to overwrite the config`);
  }

  const product = !isBlank(flags.product) && flags.product !== true
    ? String(flags.product)
    : path.basename(root);

  // Two shapes, one choice: the client editions are either build output
  // alongside the Markdown docs (the default — regenerate them from the
  // corpus whenever they're wanted), or a committed record of every document
  // that has actually been handed over, which is what a project wants when
  // "what did we show them in March" has to be answerable from the repo.
  const commitPdfs = flags["commit-pdfs"] === true;

  const config = {
    ...DEFAULT_CONFIG,
    product,
    tagline: flags.tagline && flags.tagline !== true ? String(flags.tagline) : "",
    prepared_for: flags["prepared-for"] && flags["prepared-for"] !== true ? String(flags["prepared-for"]) : "the client",
    // Deliberately empty. A default taxonomy would be wrong for every
    // product and would quietly become the one nobody revisits; the first
    // survey of the codebase is what decides the areas.
    categories: [],
    style: styleFlag(flags),
    output: {
      ...DEFAULT_CONFIG.output,
      client_dir: commitPdfs ? COMMITTED_CLIENT_DIR : DEFAULT_CONFIG.output.client_dir,
    },
  };

  const brand = {
    ...DEFAULT_BRAND,
    name: product,
    logo: flags.logo && flags.logo !== true ? String(flags.logo) : null,
  };
  if (flags.accent && flags.accent !== true) brand.accent = String(flags.accent);

  // v1 opens as the in-progress release, so the baseline survey lands *on*
  // it. Cutting it afterwards (with the date work actually started) is what
  // turns it into the first edition — an inventory of what already existed,
  // which is why nothing in a v1 ledger is flagged as new.
  const releases = [{ version: 1, name: null, date: null, status: "future" }];

  fs.mkdirSync(path.join(ledgerDir, "features"), { recursive: true });
  writeJson(path.join(ledgerDir, "config.json"), config);
  if (!exists(path.join(ledgerDir, "brand.json")) || flags.force) writeJson(path.join(ledgerDir, "brand.json"), brand);
  if (!exists(path.join(ledgerDir, "releases.json"))) writeJson(path.join(ledgerDir, "releases.json"), releases);
  if (!exists(path.join(ledgerDir, "subcategories.json"))) writeJson(path.join(ledgerDir, "subcategories.json"), []);
  if (!exists(path.join(ledgerDir, "other-changes.json"))) writeJson(path.join(ledgerDir, "other-changes.json"), []);
  if (!exists(path.join(ledgerDir, "index.json"))) writeJson(path.join(ledgerDir, "index.json"), { order: [] });
  fs.writeFileSync(
    path.join(ledgerDir, "README.md"),
    asset("ledger-dir-README.md").replaceAll("{output_line}", ledgerReadmeOutputLine(config)),
  );

  out(`created ${path.relative(root, ledgerDir) || ledgerDir}/`);
  out(commitPdfs
    ? `client editions: ${config.output.client_dir}/ — committed, so every document handed over stays in the repo`
    : `client editions: ${config.output.client_dir}/ — build output, regenerated from the corpus (\`ledger init --commit-pdfs\` keeps them in the repo instead)`);

  const written = wireAgents(root, flags.agents ?? "auto", config, ledgerDir);
  for (const f of written) out(`pointed ${f} at the ledger`);
  out(`tone: ${styleTitle(resolveStyle(config, ledgerDir))} (\`ledger style\` to read it, \`ledger style set\` to change it)`);

  if (flags.gitignore !== false) {
    const added = addGitignore(root, config.output.dir);
    if (added) out(`added ${config.output.dir}/ to .gitignore (generated docs are build output — the corpus is what's committed)`);
  }

  out("");
  out("Next:");
  out(`  1. npx ledger bootstrap        # prints a survey prompt to hand to your coding agent`);
  out(`  2. …the agent runs it to the end on its own: one entry per capability at v1 (areas`);
  out(`      only if the product needs them), then it cuts the baseline and builds the edition`);
  out(`  3. read the result and edit it — \`ledger reword\`, \`ledger update\`, \`ledger remove\`, then \`ledger build\``);
  out("");
  out("From then on the agent records each change against the open release, and `ledger release cut` mints the next edition.");
}

/** The one-command install into whichever agent files a project already has.
 *  Nothing is overwritten: the stanza is appended once, marked, and skipped
 *  on any later run. */
function wireAgents(root, spec, config, ledgerDir) {
  if (spec === "none" || spec === false) return [];
  const stanza = stanzaFor(config, ledgerDir);

  let targets;
  if (spec === "auto" || spec === true) {
    targets = Object.values(AGENT_FILES).filter((f) => exists(path.join(root, f)));
    // A project with no agent file yet gets AGENTS.md — the convention the
    // most tools now read, and the least surprising thing to create.
    if (!targets.length) targets = ["AGENTS.md"];
  } else {
    targets = String(spec).split(",").map((k) => {
      const f = AGENT_FILES[k.trim()];
      if (!f) fail(`unknown agent ${JSON.stringify(k)} — known: ${Object.keys(AGENT_FILES).join(", ")}`);
      return f;
    });
  }

  const written = [];
  for (const rel of targets) {
    const file = path.join(root, rel);
    const existing = exists(file) ? fs.readFileSync(file, "utf8") : "";
    if (existing.includes(MARKER)) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const sep = existing && !existing.endsWith("\n\n") ? (existing.endsWith("\n") ? "\n" : "\n\n") : "";
    fs.writeFileSync(file, `${existing}${sep}${stanza}`);
    written.push(rel);
  }
  return written;
}

function addGitignore(root, dir) {
  const file = path.join(root, ".gitignore");
  const line = `${dir.replace(/\/+$/, "")}/`;
  const existing = exists(file) ? fs.readFileSync(file, "utf8") : "";
  if (existing.split("\n").some((l) => l.trim() === line)) return false;
  fs.writeFileSync(file, `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${line}\n`);
  return true;
}

/**
 * The baseline survey is agent work, not CLI work — only something that can
 * read the codebase can say what it does. So this prints the procedure, and
 * whichever agent you use runs it.
 */
export async function cmdBootstrap({ flags }) {
  let product = "the product";
  let config = DEFAULT_CONFIG;
  let ledgerDir = null;
  try {
    const { openProject } = await import("../store.mjs");
    const project = openProject(flags);
    product = project.config.product;
    config = project.config;
    ledgerDir = project.ledgerDir;
  } catch {
    // Printing the prompt before `ledger init` is still useful.
  }
  const style = resolveStyle(config, ledgerDir);
  process.stdout.write(
    asset("BOOTSTRAP.md")
      .replaceAll("{product}", product)
      .replaceAll("{style_line}", styleLine(style)),
  );
}
