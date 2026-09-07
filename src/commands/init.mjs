import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeJson, exists, fail, isBlank } from "../util.mjs";
import { LEDGER_DIRNAME, DEFAULT_CONFIG, DEFAULT_BRAND } from "../store.mjs";

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

export async function cmdInit({ flags }) {
  const root = path.resolve(flags.root ?? process.cwd());
  const ledgerDir = path.join(root, flags.dir ?? LEDGER_DIRNAME);

  if (exists(path.join(ledgerDir, "config.json")) && !flags.force) {
    fail(`${path.relative(root, ledgerDir)}/config.json already exists — pass --force to overwrite the config`);
  }

  const product = !isBlank(flags.product) && flags.product !== true
    ? String(flags.product)
    : path.basename(root);

  const config = {
    ...DEFAULT_CONFIG,
    product,
    tagline: flags.tagline && flags.tagline !== true ? String(flags.tagline) : "",
    prepared_for: flags["prepared-for"] && flags["prepared-for"] !== true ? String(flags["prepared-for"]) : "the client",
    // Deliberately empty. A default taxonomy would be wrong for every
    // product and would quietly become the one nobody revisits; the first
    // survey of the codebase is what decides the areas.
    categories: [],
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
  fs.writeFileSync(path.join(ledgerDir, "README.md"), asset("ledger-dir-README.md"));

  out(`created ${path.relative(root, ledgerDir) || ledgerDir}/`);

  const written = wireAgents(root, flags.agents ?? "auto");
  for (const f of written) out(`pointed ${f} at the ledger`);

  if (flags.gitignore !== false) {
    const added = addGitignore(root, config.output.dir);
    if (added) out(`added ${config.output.dir}/ to .gitignore (generated docs are build output — the corpus is what's committed)`);
  }

  out("");
  out("Next:");
  out(`  1. npx ledger bootstrap        # prints a survey prompt to hand to your coding agent`);
  out(`  2. …the agent defines the categories and adds a feature per capability, at v1`);
  out(`  3. npx ledger check`);
  out(`  4. npx ledger release cut --name "Baseline" --date ${flags["baseline-date"] && flags["baseline-date"] !== true ? flags["baseline-date"] : "YYYY-MM-DD"}`);
  out(`  5. npx ledger build            # the v1 edition: an inventory, nothing flagged as new`);
  out("");
  out("From then on the agent records each change against the open release, and `ledger release cut` mints the next edition.");
}

/** The one-command install into whichever agent files a project already has.
 *  Nothing is overwritten: the stanza is appended once, marked, and skipped
 *  on any later run. */
function wireAgents(root, spec) {
  if (spec === "none" || spec === false) return [];
  const stanza = asset("agent-pointer.md");

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
  try {
    const { openProject } = await import("../store.mjs");
    product = openProject(flags).config.product;
  } catch {
    // Printing the prompt before `ledger init` is still useful.
  }
  process.stdout.write(asset("BOOTSTRAP.md").replaceAll("{product}", product));
}
