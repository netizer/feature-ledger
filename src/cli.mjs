import { parseArgs, fail, COPY_RULE } from "./util.mjs";
import * as init from "./commands/init.mjs";
import * as read from "./commands/read.mjs";
import * as write from "./commands/write.mjs";
import * as release from "./commands/release.mjs";
import * as build from "./commands/build.mjs";
import * as status from "./commands/status.mjs";
import * as style from "./commands/style.mjs";
import * as audit from "./commands/audit.mjs";
import * as review from "./commands/review.mjs";
import * as redraft from "./commands/redraft.mjs";

const COMMANDS = {
  init: init.cmdInit,
  bootstrap: init.cmdBootstrap,

  list: read.cmdList,
  show: read.cmdShow,
  status: status.cmdStatus,
  rules: read.cmdRules,
  style: style.cmdStyle,
  export: read.cmdExport,

  add: write.cmdAdd,
  update: write.cmdUpdate,
  remove: write.cmdRemove,
  "other-change": write.cmdOtherChange,
  categories: write.cmdCategories,
  subcategory: write.cmdSubcategory,

  release: release.cmdRelease,
  audit: audit.cmdAudit,
  review: review.cmdReview,
  redraft: redraft.cmdRedraft,

  build: build.cmdBuild,
};

/** Commands that used to exist. `check` (is the corpus sound?), `doctor` (is
 *  the setup sound?) and `status` (what has this release collected?) were
 *  three ways of asking one question, and whichever one you hadn't run was
 *  where the problem was. They are now all `status`.
 *
 *  `reword` and `rename` were the two commands that only ever changed words.
 *  They earned their keep while nothing was supposed to touch the JSON, but
 *  the words are the part of this corpus a person most wants their hands on —
 *  the client's own vocabulary, a sentence the survey invented, a detail they
 *  shouldn't be reading — and putting a CLI in front of that made a text edit
 *  feel like a schema change, which is how a ledger ends up in the tone the
 *  agent wrote it in. Wording is a hand-edit now. The CLI keeps the parts that
 *  are expensive to get wrong: which release an edit lands on, whether a
 *  change was explained, and the audit stamp. */
const RETIRED = {
  check: "`ledger status` — it validates the corpus and still exits 1 on a problem, so a commit hook keeps working (`ledger status --quiet`)",
  doctor: "`ledger status` — the resolved setup is one of its sections",
  reword: `a hand-edit. Open .ledger/features/<id>.json and change the words in place: nothing lands on the
release and nothing is tagged, which was the whole point of the command. Run \`ledger status\`
afterwards — it validates every file. Sub-section headings live in subcategories.json, and document
titles in config.json. \`ledger rules\` has the section on editing by hand.`,
  rename: `two different things, and the one command never told them apart:
  the name was badly chosen      → edit "name" in .ledger/features/<id>.json. A wording fix;
                                   nothing is recorded and no reader is told anything moved.
  the product renamed the thing  → \`ledger update <id> --name "New name" --description "…" --change "…"\`
                                   The client is told, on this release, with the reason. Every
                                   document footnotes the old name on its own, as it always did.`,
};

const HELP = `ledger — a versioned feature ledger for any codebase

  Reading (cheap; don't read the corpus by hand — it's big)
    ledger list [--category C] [--audience user|dev] [--size S] [--changed] [--json]
    ledger show <id> [--history] [--json]
    ledger status [--json] [--quiet]    the release, the corpus and the setup, checked
    ledger rules                        the authoring rules, in full
    ledger style [show|list|set <id>]   the tone every entry is written in
    ledger style rewrite                the procedure for moving an existing ledger to it
    ledger export [--out FILE]          the whole corpus as one JSON document

  Writing (payload as JSON on stdin, or --file f.json; add --dry-run to preview)
    ledger add <id>                     { audience, size, name, description, category?, dev_notes? }
    ledger update <id>                  { description, changes[], name?, size?, dev_notes?, add_changes[]? }
                                        (--name here is a rename the client is told about)
    ledger remove <id> --reason "..."
    ledger other-change --audience user --description "..."
    ledger categories [list | add "Name" [--after "Other"] | rename "Old" "New" | remove "Name"]
    ledger subcategory [list | add]     { id, category, name, intro }
    ledger add/update/remove --backfilled            the product did not move this cycle,
                                                     the record did — see \`ledger audit\`

  Releases
    ledger release list
    ledger release cut --name "..." [--date YYYY-MM-DD] [--commit SHA] [--force]
    ledger release amend <version> --commit SHA     fill in the commit on a release
                                                    cut before commits were recorded
                                        records the commit it was cut at, so two
                                        editions on one day stay tellable apart

  Auditing (the periodic sweep of the codebase against the record)
    ledger audit [--full] [--since <sha>]     print the audit brief for a coding agent
    ledger audit complete [--commit <sha>]    stamp the audited commit (default: HEAD)
    ledger audit confirm <id>                 vouch for a reason an audit inferred
    ledger audit log [--json]                 every audit so far

  Reviewing (reading the release as the client will, before it's cut)
    ledger review                             print the review brief for a coding agent
    ledger review complete                    stamp what was reviewed; \`release cut\` refuses
                                              an edition changed since its last review

  Redrafting (starting the corpus again from scratch, keeping the client's record)
    ledger redraft start [--force]            archive the corpus in .ledger/archive/, open the next
                                              version on an empty one; numbering carries on
    ledger redraft check                      print the brief: check the new corpus against the old
    ledger redraft complete [--note "..."]    stamp the check; until then \`build\` warns and
                                              \`release cut\` refuses
    ledger redraft                            where the redraft stands, and the next step

  Output
    ledger build [--md] [--pdf] [--version N|all] [--out DIR]
                                        an archived version prints from its archive

  Setup
    ledger init [--product "Name"] [--accent "#hex"] [--logo path] [--agents auto|none|claude,agents,...]
                [--style google|govuk|plain-language|ste] [--commit-pdfs]
    ledger bootstrap [--no-audit]       prints the baseline-survey prompt for your coding agent
                                        (the survey is a full sweep, so the prompt ends by
                                        recording one; --no-audit leaves that out)

  Editing the words (no command — the corpus is yours to edit)
    .ledger/features/<id>.json          a name, a description, dev notes, the text of a change
                                        bullet. Edit in place, then run \`ledger status\`.
    .ledger/subcategories.json          sub-section headings and their overviews
    .ledger/config.json                 product name, tagline, document titles
                                        (an area's name: \`ledger categories rename\`)
    .ledger/other-changes.json          the product-wide notes
                                        Adding, dropping or re-dating a history *entry* stays with
                                        the CLI. \`ledger rules\` draws the line.

  Global: --dir PATH (point at a .ledger directory), --json where offered.
          --prompt-only on a command that prints a prompt for a coding agent (bootstrap,
          style rewrite, audit, review, redraft check): the prompt alone, ready to pipe,
          e.g. \`ledger review --prompt-only | pbcopy\`.
          --help (or -h) after any command: its lines of this help, and nothing run.
          An option the command doesn't take is an error, and nothing is run.
  Full docs: the README in this package, or \`ledger rules\`.
`;

/**
 * Which commands print a prompt for a coding agent, by subcommand (undefined
 * is the bare command). Each prints an explanation for the person first, then
 * COPY_RULE, then the prompt, so `--prompt-only` is one mechanism for all of
 * them rather than a flag each command has to remember to honour.
 */
const PROMPT_COMMANDS = {
  bootstrap: [undefined],
  style: ["rewrite"],
  audit: [undefined, "brief"],
  review: [undefined, "brief"],
  redraft: ["check"],
};

/**
 * The options each command reads, by subcommand where it has them (the key a
 * bare command dispatches to is its default). Anything else is refused before
 * the command runs: `--dryrun` on `release cut` must not cut a release, and
 * `--catgory` on `list` must not quietly list everything.
 *
 * `--dir` is taken everywhere, and `--prompt-only` has its own check below.
 * A subcommand missing from its table is left to the command, which refuses
 * it with its usage line.
 */
const GLOBAL_FLAGS = ["dir", "prompt-only"];
const FLAGS = {
  init: ["root", "product", "tagline", "prepared-for", "logo", "accent", "agents", "style", "commit-pdfs", "force", "gitignore"],
  bootstrap: ["audit"],

  list: ["category", "audience", "size", "changed", "json"],
  show: ["history", "json"],
  status: ["json", "quiet"],
  rules: [],
  style: { default: "show", show: ["json"], list: ["json"], set: [], rewrite: [] },
  export: ["out"],

  add: ["file", "audience", "category", "subcategory", "size", "name", "description", "dev-notes", "backfilled", "dry-run"],
  update: ["file", "description", "change", "add-change", "name", "size", "category", "subcategory", "dev-notes",
    "backfilled", "reason-inferred", "dry-run"],
  remove: ["reason", "backfilled", "reason-inferred", "dry-run"],
  "other-change": ["file", "audience", "description", "dry-run"],
  categories: { default: "list", list: [], add: ["after", "before", "dry-run"], rename: ["dry-run"], remove: ["dry-run"] },
  subcategory: { default: "list", list: [], add: ["file", "id", "category", "name", "intro", "dry-run"] },

  release: { default: "list", list: [], cut: ["name", "date", "commit", "force", "dry-run"], amend: ["commit", "force", "dry-run"] },
  audit: { default: "brief", brief: ["full", "since"], complete: ["commit", "full", "since", "dry-run"],
    confirm: ["version", "dry-run"], log: ["json"] },
  review: { default: "brief", brief: [], complete: ["dry-run"] },
  redraft: { default: "status", status: [], start: ["force", "dry-run"], check: [], complete: ["note", "dry-run"] },

  build: ["md", "pdf", "version", "out", "html"],
};

function checkFlags(command, flags, positional) {
  let spec = FLAGS[command];
  let label = `ledger ${command}`;
  if (!Array.isArray(spec)) {
    const sub = positional[0] ?? spec.default;
    if (!Object.hasOwn(spec, sub) || sub === "default") return;
    if (positional[0]) label += ` ${sub}`;
    spec = spec[sub];
  }
  const unknown = Object.keys(flags).filter((f) => !spec.includes(f) && !GLOBAL_FLAGS.includes(f));
  if (!unknown.length) return;

  const lines = unknown.map((f) => {
    const near = spec.find((s) => editDistance(s, f) <= 2);
    return `unknown option --${f} for \`${label}\`${near ? ` — did you mean --${near}?` : ""}`;
  });
  const takes = spec.length ? `it takes ${spec.map((s) => `--${s}`).join(", ")}` : "it takes no options";
  fail(`${lines.join("\n")}\n  (${takes}; nothing was run — \`${label} --help\` for more)`);
}

function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

/**
 * Runs a prompt command with stdout held back, then prints only what follows
 * the rule. The explanation is for someone reading a terminal, and piping it
 * into a clipboard would put it in front of the agent. Its warnings (the lines
 * that start with "!") still matter to the person, so they go to stderr, which
 * a pipe leaves on screen.
 */
async function promptOnly(run) {
  const chunks = [];
  const write = process.stdout.write;
  process.stdout.write = (chunk, ...rest) => {
    chunks.push(String(chunk));
    const cb = rest.find((x) => typeof x === "function");
    if (cb) cb();
    return true;
  };
  try {
    await run();
  } finally {
    process.stdout.write = write;
  }
  const text = chunks.join("");
  const at = text.indexOf(COPY_RULE);
  if (at === -1) fail("this command printed no prompt, so there is nothing for --prompt-only to keep");

  let warning = false;
  for (const line of text.slice(0, at).split("\n")) {
    if (line.startsWith("!")) warning = true;
    else if (!line.startsWith("  ")) warning = false;
    if (warning) process.stderr.write(`${line}\n`);
  }
  process.stdout.write(text.slice(at + COPY_RULE.length).replace(/^\s*\n/, ""));
}

/**
 * `ledger <command> --help`: that command's lines of the main help, picked out
 * by the command name at the start of each, with their continuation lines.
 * Taken from HELP rather than written a second time, so the two can't drift.
 */
function commandHelp(name) {
  const lines = HELP.split("\n");
  const picked = [];
  let taking = false;
  let heading = null;
  for (const line of lines) {
    if (/^ {2}\S/.test(line)) { heading = line; taking = false; continue; }
    const m = /^ {4}ledger (\S+)/.exec(line);
    if (m) {
      taking = m[1].split("/").includes(name);
      if (taking && heading) { if (picked.length) picked.push(""); picked.push(heading); heading = null; }
    } else if (!/^ {6,}\S/.test(line)) {
      taking = false;
    }
    if (taking) picked.push(line);
  }
  if (!picked.length) return null;
  return `${picked.join("\n")}\n\n  Global: --dir PATH, --json where offered` +
    `${PROMPT_COMMANDS[name] ? ", --prompt-only (the prompt alone, ready to pipe)" : ""}.\n` +
    "  `ledger --help` lists every command.\n";
}

export async function main(argv) {
  const first = argv[0];
  if (!first || first === "--help" || first === "-h" || first === "help") {
    process.stdout.write(HELP);
    return;
  }
  if (first === "--version" || first === "-v") {
    const { readJson } = await import("./util.mjs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const here = path.dirname(fileURLToPath(import.meta.url));
    process.stdout.write(`${readJson(path.join(here, "..", "package.json")).version}\n`);
    return;
  }

  if (RETIRED[first]) fail(`\`ledger ${first}\` is now ${RETIRED[first]}`);

  const fn = COMMANDS[first];
  if (!fn) fail(`unknown command "${first}" — run \`ledger --help\``);

  // Before anything is parsed or run: `ledger add --help` must never read a
  // payload, and `ledger release cut --help` must never cut. Anywhere after
  // the command counts, so `ledger audit complete --help` is help too.
  const rest = argv.slice(1);
  if (rest.some((a) => a === "--help" || a === "-h" || a.startsWith("--help="))) {
    process.stdout.write(commandHelp(first) ?? HELP);
    return;
  }

  const { flags, positional } = parseArgs(rest, {
    booleans: ["dry-run", "json", "history", "changed", "md", "pdf", "force", "quiet", "commit-pdfs",
      "backfilled", "reason-inferred", "full", "prompt-only"],
  });
  if (flags["prompt-only"]) {
    if (!PROMPT_COMMANDS[first]?.includes(positional[0])) {
      const which = Object.entries(PROMPT_COMMANDS)
        .flatMap(([c, subs]) => subs.filter((x) => x !== "brief").map((x) => `ledger ${c}${x ? ` ${x}` : ""}`));
      fail(`--prompt-only is for the commands that print a prompt: ${which.join(", ")}`);
    }
  }
  checkFlags(first, flags, positional);
  if (flags["prompt-only"]) {
    await promptOnly(() => fn({ flags, positional }));
    return;
  }
  await fn({ flags, positional });
}
