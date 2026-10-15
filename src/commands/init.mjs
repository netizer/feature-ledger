import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeJson, exists, fail, isBlank, COPY_BLOCK } from "../util.mjs";
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
export function ledgerReadmeOutputLine(config) {
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
  out(`  1. ledger bootstrap             # prints a survey prompt to paste into your coding agent`);
  out(`     (or \`ledger bootstrap --run claude\` to hand it over directly — codex and gemini work too)`);
  out(`  2. …the agent writes one entry per capability at v1 (areas only if the product needs`);
  out(`      them), how to see each one, and stops for you to read it`);
  out(`  3. read it with \`ledger preview\` and edit it — the words are yours: open`);
  out(`      .ledger/features/<id>.json and change anything that isn't how you'd say it to this client`);
  out(`  4. commit, then \`ledger cut --name "Baseline"\` prints the first edition`);
  out("");
  out("From then on the agent records each change as it works. Preview is free, the agent costs tokens, cut prints.");
  out("Run `ledger` on its own at any point: it says where things stand and what to run next.");
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
export async function cmdBootstrap({ flags, positional = [] }) {
  if (positional[0] === "complete") return bootstrapComplete(flags);
  if (positional[0] && positional[0] !== "brief") fail("usage: ledger bootstrap | bootstrap complete");
  let product = "the product";
  let config = DEFAULT_CONFIG;
  let ledgerDir = null;
  let redraft = null;
  let started = 0;
  try {
    const { openProject } = await import("../store.mjs");
    const project = openProject(flags);
    product = project.config.product;
    config = project.config;
    ledgerDir = project.ledgerDir;
    redraft = project.pendingRedraft;
    started = project.featureSet.features().length;
  } catch {
    // Printing the prompt before `ledger init` is still useful.
  }
  const style = resolveStyle(config, ledgerDir);
  process.stdout.write(
    asset("BOOTSTRAP.md")
      .replaceAll("{redraft_intro}", redraft ? redraftIntro(redraft) : "")
      .replaceAll("{resume_intro}", started ? resumeIntro(started) : "")
      .replaceAll("{baseline_step}", redraft ? redraftStep(redraft) : BASELINE_STEP)
      .replaceAll("{product}", product)
      .replaceAll("{style_line}", styleLine(style))
      .replaceAll("{copy_rule}", COPY_BLOCK),
  );
}

/**
 * A survey that stopped partway — out of context, interrupted — left entries
 * behind. The next one carries on from them rather than starting again, so
 * the batches already written are neither paid for twice nor duplicated.
 */
function resumeIntro(n) {
  return `**This survey has already started.** ${n} entr${n === 1 ? "y is" : "ies are"} recorded, by an
earlier run that stopped before it finished. Carry on from there: run
\`ledger list\` first, and treat what it shows as batches already written. Do
Step 1 against the whole codebase as usual, then write only the capabilities
that have no entry yet. Leave the existing entries as they are, unless one
breaks the bar below; then fix it by editing its file. If every capability
already has an entry, go straight to Step 5.

`;
}

/**
 * `ledger bootstrap complete`: records that the survey finished, so
 * `ledger agent` knows the corpus is a whole baseline and not one that
 * stopped halfway, and that the code as it stands has been read.
 */
async function bootstrapComplete(flags) {
  const { openProject } = await import("../store.mjs");
  const { stampBootstrap } = await import("../state.mjs");
  const project = openProject(flags);
  project.assertWritable();
  const n = project.featureSet.features().length;
  if (!n) fail("the ledger is still empty, so there is no survey to mark finished. `ledger bootstrap` prints it.");
  stampBootstrap(project);
  if (flags["dry-run"]) {
    out(JSON.stringify(project.state.bootstrap, null, 2));
    out("(--dry-run: nothing written)");
    return;
  }
  project.saveState();
  out(`recorded the survey as finished: ${n} entr${n === 1 ? "y" : "ies"} at v${project.state.bootstrap.version}`);
}

/** Step 4 of an ordinary survey: stop short of the cut, and say how to make it. */
const BASELINE_STEP = `## Step 4 — stop before the cut

When every capability is recorded and \`ledger status\` is clean, work out the
baseline's date from the repository rather than asking me — the first commit
is when work on this codebase started:

\`\`\`
git log --reverse --format=%ad --date=short | head -1
\`\`\`

Don't cut the release, and don't commit: I read the draft (\`ledger preview\`),
edit it, commit it, and cut it myself. Put the command in your note for me:

\`\`\`
ledger cut --name "Baseline" --date <that date, or today if there's no history>
\`\`\`

Version 1 has no predecessor, so its edition prints as a plain inventory with
nothing flagged as new or changed — which is exactly right for a snapshot of
work that was already there. From the next release onward, every edition
highlights only what actually moved.`;

/**
 * A survey run inside a redraft stops before the cut. The old corpus has to be
 * read against the new one first (`ledger redraft check`), and `ledger cut` refuses
 * until it has been. It is also told not to read the archive: a survey that
 * starts from the old structure reproduces it, and a new structure is the
 * reason for redrafting at all.
 */
function redraftStep(redraft) {
  const last = redraft.versions[redraft.versions.length - 1];
  return `## Step 4 — stop before the cut

This survey is a **redraft**. The ledger already had editions up to v${last},
and their corpus is archived in \`.ledger/${redraft.archive}/\`. Don't read the
archive, and don't try to match it: the point of starting again is a structure
and wording chosen fresh from the product as it is now. A separate step reads
the old corpus against yours afterwards and restores anything the survey
missed.

Everything you recorded is at v${redraft.opens}, the next edition after the one the
client already has. That is the right place for it.

Do **not** cut the release, don't commit, and don't run \`ledger build\`. The
cut refuses until the redraft is checked, and the check comes after I have
committed this work.`;
}

function redraftIntro(redraft) {
  return `This is a **redraft**: the corpus behind the editions up to
v${redraft.versions[redraft.versions.length - 1]} is archived in \`.ledger/${redraft.archive}/\`, and this survey
writes the new one from scratch, at v${redraft.opens}. It stops before the cut.
When it's done, commit what it recorded, then run \`ledger redraft check\` for the
step that checks the new corpus against the old one.

`;
}
