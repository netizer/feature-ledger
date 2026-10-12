import { parseArgs, fail, usage, nearest } from "./util.mjs";
import { openProject, findLedgerDir } from "./store.mjs";
import { taskFor, deliver, deliveryMode, PROMPT_COMMANDS } from "./prompt.mjs";
import { AGENTS } from "./agents/index.mjs";
import { STYLES, CUSTOM_STYLE_ID } from "./style.mjs";
import * as init from "./commands/init.mjs";
import * as read from "./commands/read.mjs";
import * as write from "./commands/write.mjs";
import * as release from "./commands/release.mjs";
import * as build from "./commands/build.mjs";
import * as status from "./commands/status.mjs";
import * as style from "./commands/style.mjs";
import * as audit from "./commands/audit.mjs";
import * as compose from "./commands/compose.mjs";
import * as verify from "./commands/verify.mjs";
import * as questions from "./commands/questions.mjs";
import * as diff from "./commands/diff.mjs";
import * as paths from "./commands/paths.mjs";
import * as migrate from "./commands/migrate.mjs";
import * as redraft from "./commands/redraft.mjs";

const COMMANDS = {
  init: init.cmdInit,
  bootstrap: init.cmdBootstrap,

  list: read.cmdList,
  show: read.cmdShow,
  status: status.cmdStatus,
  diff: diff.cmdDiff,
  paths: paths.cmdPaths,
  questions: questions.cmdQuestions,
  rules: read.cmdRules,
  style: style.cmdStyle,
  export: read.cmdExport,

  add: write.cmdAdd,
  change: write.cmdChange,
  update: write.cmdUpdate,
  remove: write.cmdRemove,
  own: write.cmdOwn,
  note: write.cmdOtherChange,
  categories: write.cmdCategories,
  subcategories: write.cmdSubcategory,

  cut: release.cmdCut,
  releases: release.cmdReleases,
  audit: audit.cmdAudit,
  compose: compose.cmdCompose,
  verify: verify.cmdVerify,
  redraft: redraft.cmdRedraft,
  migrate: migrate.cmdMigrate,

  build: build.cmdBuild,
  preview: build.cmdPreview,
  completion: cmdCompletion,
};

/**
 * Names that changed, and what they became. The old form keeps working and
 * says once, on stderr, what it is called now — so a script or an agent
 * stanza written against the old name doesn't break, and the person running
 * it learns the new one.
 *
 * `release cut` became `cut` because cutting is the verb people reach for,
 * and the nesting only ever made them type it twice. `other-change` became
 * `note` because that is what it records. `subcategory` became
 * `subcategories` to match `categories`. `summary` became `compose`, which
 * writes the summary and the "What changed" notes together.
 */
const ALIASES = [
  { from: ["release", "cut"], to: ["cut"] },
  { from: ["release", "amend"], to: ["releases", "amend"] },
  { from: ["release", "list"], to: ["releases"] },
  { from: ["release"], to: ["releases"] },
  { from: ["other-change"], to: ["note"] },
  { from: ["subcategory"], to: ["subcategories"] },
  { from: ["summary"], to: ["compose"] },
];

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
  review: `two steps now, and neither edits what a person wrote:
  \`ledger compose\`  writes the "What changed" notes and the summary for the whole release at
                    once, from what the client's last edition said, what it says now, and
                    what was recorded between — so there are no mid-cycle drafts to repair.
  \`ledger verify\`   checks what the edition says against the code, and files what it doubts
                    as questions (\`ledger questions\`). Opt in with "checks": { "verify": true }.`,
  rename: `two different things, and the one command never told them apart:
  the name was badly chosen      → edit "name" in .ledger/features/<id>.json. A wording fix;
                                   nothing is recorded and no reader is told anything moved.
  the product renamed the thing  → \`ledger change <id> --name "New name" --what "…" --why "…"\`
                                   The client is told, on this release, with the reason. Every
                                   document footnotes the old name on its own, as it always did.`,
};

const DELIVERY_HELP = `  Delivering a prompt (bootstrap, audit, compose, verify, paths brief, redraft check, style rewrite)
    (default)        an explanation for you, then the prompt to paste into a fresh agent session
    --print          the prompt alone, ready to pipe: \`ledger compose --print | pbcopy\`
    --copy           the prompt, straight onto the clipboard
    --run AGENT      hand it to ${Object.keys(AGENTS).join(", ")} — or to "any command" that reads the prompt on
                     stdin — wait, check what it recorded, and print how to resume its session.
                     Only ever when you pass it. A bare --run uses $LEDGER_AGENT, or "agent"
                     in .ledger/config.json`;

const HELP = `ledger — a client-facing record of what your product does, kept in the repo

  Where you are
    ledger                              what's open, whether it's ready to cut, the next command
    ledger status [--json] [--quiet]    the release, the corpus and the setup, all checked
    ledger diff [--since vN|last] [--full] [--json]
                                        the size of the open release: entries by kind and size,
                                        and the code that moved under each, from the ledger and git
    ledger questions [--all]            what only you can answer: reasons nobody vouched for,
                                        and what a check doubted
    ledger questions answer <n> "..." | accept <n> | dismiss <n> | add <id> "..."

  Reading (cheap; don't read .ledger/ by hand — it's big)
    ledger list [--category C] [--audience user|dev] [--size S] [--changed] [--json]
    ledger show <id> [--history | --at vN | --diff] [--json]
    ledger paths [--unowned] [--json]   which code each entry lives in, and what no entry owns
    ledger rules                        the authoring rules, in full
    ledger style [show|list|set <id>]   the tone every entry is written in
    ledger export [--out FILE]          the whole corpus as one JSON document

  Recording (payload as JSON on stdin, or --file f.json; add --dry-run to preview)
    ledger add <id>                     { audience, size, name, description, paths[], category?, dev_notes? }
    ledger change <id>                  { what, why, description?, name? }   something about it moved
                                        --why-from commit   the reason was read off a commit message
                                        --why-unknown       nobody can say; asked as a question
                                        (size, category, paths, dev_notes alone record nothing)
    ledger remove <id> --why "..."
    ledger note --audience user --description "..."
                                        a change that belongs to no single feature
    ledger own <id> <glob...> [--remove]   which code an entry lives in
    ledger own --ignore <glob...>       files that aren't product code: tests, fixtures, CI
    ledger categories [list | add "Name" [--after "Other"] | rename "Old" "New" | remove "Name"]
    ledger subcategories [list | add]   { id, category, name, intro }
    ledger add/change/remove --backfilled            the product didn't move this cycle,
                                                     the record did — see \`ledger audit\`

  Releasing
    ledger preview [--size] [--open] [--run AGENT]
                                        the size readout, then the open release as a draft PDF.
                                        --run composes first, only if anything moved since
    ledger cut --name "..." [--date YYYY-MM-DD] [--commit SHA] [--skip CHECKS] [--no-pdf] [--run AGENT]
                                        runs every check, asks the open questions, prints the
                                        edition into the client directory, and opens the next
                                        release. --run hands an open audit, composition or verify
                                        to an agent first, then asks before cutting (--yes doesn't)
    ledger build [v3 | all | draft] [--md] [--pdf] [--out DIR] [--html] [--run AGENT]
                                        the Markdown docs, every cut edition not yet printed, and
                                        the draft of the open release; or just the one named
    ledger releases                     the timeline: every version, its date and its commit
    ledger releases amend <version> --commit SHA
                                        fill in the commit on a release cut before they were recorded

  Agent tasks (each prints a prompt for a coding agent; delivery options below)
    ledger bootstrap [--no-audit]       survey the codebase and write the baseline
    ledger audit [--full] [--since SHA] find what shipped without the ledger hearing about it:
                                        code that moved under an entry that didn't, and code
                                        no entry owns, with the diffs
    ledger audit complete [--commit SHA]    stamp the audited commit (default: HEAD)
    ledger audit log [--json]           every audit so far
    ledger compose                      write the "What changed" notes and the summary the
                                        edition opens with, from the last edition, now, and
                                        what was recorded between. Reads no code
    ledger compose complete             check it accounts for every entry, and stamp it
    ledger verify                       check what the edition says against the code; files
                                        what it doubts as questions. Opt-in for the cut
    ledger verify complete              stamp what was checked
    ledger paths brief                  say which code every entry lives in
    ledger style rewrite                bring every entry into the project's tone

  Redrafting (writing the corpus again from scratch, keeping the client's record)
    ledger redraft                      where a redraft stands, and the next step
    ledger redraft start [--force]      archive the corpus in .ledger/archive/, open the next version empty
    ledger redraft check                agent task: check the new corpus against the old one
    ledger redraft complete [--note "..."]  stamp the check, with the note the client reads

  Setup
    ledger init [--product "Name"] [--accent "#hex"] [--logo path] [--agents auto|none|claude,agents,...]
                [--style google|govuk|plain-language|ste] [--commit-pdfs]
    ledger migrate [--run AGENT]        bring a ledger written by an earlier version over; --run
                                        then has an agent say which code each entry lives in
    ledger completion zsh|bash|fish     shell completion; the script says how to load it

  Editing the words (no command — the corpus is yours to edit)
    .ledger/features/<id>.json          a name, a description, dev notes. Edit in place, then
                                        run \`ledger status\`.
    .ledger/compositions.json           a "What changed" note, a summary item
    .ledger/subcategories.json          sub-section headings and their overviews
    .ledger/config.json                 product name, tagline, document titles, ignore
    .ledger/other-changes.json          the product-wide notes

${DELIVERY_HELP}

  Global: --dir PATH (point at a .ledger directory), --json where offered, --help after any
          command. An option a command doesn't take is an error, and nothing is run.
  Exit codes: 0 done · 1 error · 2 a mistake in the command line · 3 a check said no
  Guides: the docs/ directory of this package, starting from its README.
`;

/**
 * The options each command reads, by subcommand where it has them (the key a
 * bare command dispatches to is its default). Anything else is refused before
 * the command runs: `--dryrun` on `cut` must not cut a release, and
 * `--catgory` on `list` must not quietly list everything.
 *
 * `--dir` is taken everywhere, and the delivery options wherever a command
 * prints a prompt. A subcommand missing from its table is left to the
 * command, which refuses it with its usage line.
 */
const GLOBAL_FLAGS = ["dir"];
const DELIVERY_FLAGS = ["print", "prompt-only", "copy", "run"];
const FLAGS = {
  init: ["root", "product", "tagline", "prepared-for", "logo", "accent", "agents", "style", "commit-pdfs", "force", "gitignore"],
  bootstrap: ["audit"],
  migrate: ["run", "yes", "dry-run"],

  list: ["category", "audience", "size", "changed", "json"],
  show: ["history", "at", "diff", "json"],
  status: ["json", "quiet"],
  diff: ["since", "full", "json"],
  paths: { default: "list", list: ["unowned", "json"], brief: [] },
  questions: { default: "list", list: ["all", "json"], answer: ["dry-run"], accept: ["dry-run"], dismiss: ["dry-run"], add: ["dry-run"] },
  rules: [],
  style: { default: "show", show: ["json"], list: ["json"], set: [], rewrite: [] },
  export: ["out"],

  add: ["file", "audience", "category", "subcategory", "size", "name", "description", "dev-notes", "paths", "backfilled", "dry-run"],
  change: ["file", "what", "why", "why-from", "why-unknown", "description", "name", "size", "category", "subcategory",
    "dev-notes", "paths", "backfilled", "dry-run"],
  update: ["file", "description", "change", "add-change", "name", "size", "category", "subcategory", "dev-notes", "paths",
    "backfilled", "reason-inferred", "dry-run"],
  remove: ["why", "why-from", "reason", "backfilled", "reason-inferred", "dry-run"],
  own: ["ignore", "remove", "clear", "dry-run"],
  note: ["file", "audience", "description", "dry-run"],
  categories: { default: "list", list: [], add: ["after", "before", "dry-run"], rename: ["dry-run"], remove: ["dry-run"] },
  subcategories: { default: "list", list: [], add: ["file", "id", "category", "name", "intro", "dry-run"] },

  cut: ["name", "date", "commit", "skip", "force", "pdf", "html", "out", "run", "yes", "dry-run"],
  releases: { default: "list", list: [], amend: ["commit", "force", "dry-run"] },
  audit: { default: "brief", brief: ["full", "since"], complete: ["commit", "full", "since", "dry-run"],
    confirm: ["version", "dry-run"], log: ["json"] },
  compose: { default: "brief", brief: [], complete: ["dry-run"] },
  verify: { default: "brief", brief: [], complete: ["dry-run"] },
  redraft: { default: "status", status: [], start: ["force", "dry-run"], check: [], complete: ["note", "dry-run"] },

  build: ["md", "pdf", "version", "out", "html", "run"],
  preview: ["out", "html", "open", "run", "size"],
  completion: [],
};

const NEGATED = ["cut pdf", "bootstrap audit", "init gitignore"];

const BOOLEANS = ["dry-run", "json", "history", "changed", "md", "pdf", "html", "open", "force", "quiet", "commit-pdfs",
  "backfilled", "reason-inferred", "full", "print", "prompt-only", "copy", "yes", "why-unknown", "diff", "unowned",
  "all", "ignore", "remove", "clear"];

function checkFlags(command, flags, positional) {
  const task = taskFor(command, positional[0]);
  let spec = FLAGS[command];
  let label = `ledger ${command}`;
  if (!Array.isArray(spec)) {
    const sub = positional[0] ?? spec.default;
    if (!Object.hasOwn(spec, sub) || sub === "default") return;
    if (positional[0]) label += ` ${sub}`;
    spec = spec[sub];
  }
  const allowed = [...spec, ...GLOBAL_FLAGS, ...(task ? DELIVERY_FLAGS : [])];
  const unknown = Object.keys(flags).filter((f) => !allowed.includes(f));
  if (!unknown.length) return;

  const delivery = unknown.find((f) => DELIVERY_FLAGS.includes(f));
  if (delivery && !spec.includes(delivery)) {
    usage(`--${delivery} is for the commands that print a prompt: ${PROMPT_COMMANDS.join(", ")}`);
  }
  const lines = unknown.map((f) => {
    const near = nearest(f, allowed);
    return `unknown option --${f} for \`${label}\`${near ? ` — did you mean --${near}?` : ""}`;
  });
  // Options that only make sense switched off are shown the way they're typed.
  const shown = (f) => (NEGATED.includes(`${command} ${f}`) ? `--no-${f}` : `--${f}`);
  const takes = spec.length ? `it takes ${spec.map(shown).join(", ")}` : "it takes no options";
  usage(`${lines.join("\n")}\n  (${takes}; nothing was run — \`${label} --help\` for more)`);
}

/**
 * `ledger <command> --help`: that command's lines of the main help, picked out
 * by the command name at the start of each, with their continuation lines.
 * Taken from HELP rather than written a second time, so the two can't drift.
 */
function commandHelp(name, sub) {
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
  const prompts = taskFor(name, sub) || ["bootstrap", "audit", "compose", "verify"].includes(name);
  return `${picked.join("\n")}\n${prompts ? `\n${DELIVERY_HELP}\n` : ""}\n  Global: --dir PATH, --json where offered.\n` +
    "  `ledger --help` lists every command.\n";
}

/**
 * Where a word that isn't a command most likely belongs: a near-miss of a
 * command, or a subcommand typed without the command it lives under
 * (`ledger amend` → `ledger releases amend`).
 */
const SUBCOMMANDS = {
  amend: ["releases amend"], complete: ["audit complete", "compose complete", "verify complete", "redraft complete"],
  confirm: ["questions accept"], answer: ["questions answer"], accept: ["questions accept"], dismiss: ["questions dismiss"],
  log: ["audit log"], start: ["redraft start"], rewrite: ["style rewrite"], brief: ["paths brief"],
  draft: ["preview", "build draft"], publish: ["cut"], release: ["cut"], print: ["build"], check: ["status"],
  headline: ["compose"], headlines: ["compose"], highlights: ["compose"], size: ["diff", "preview --size"],
  ignore: ["own --ignore"], owner: ["own"], owners: ["paths"], upgrade: ["migrate"],
};

function unknownCommand(word) {
  const near = nearest(word, [...Object.keys(COMMANDS), "help"]);
  const homes = SUBCOMMANDS[word];
  const hint = near ? ` — did you mean \`ledger ${near}\`?`
    : homes ? ` — did you mean ${homes.map((h) => `\`ledger ${h}\``).join(" or ")}?` : "";
  usage(`unknown command "${word}"${hint}\n  (\`ledger help\` lists every command)`);
}

export async function main(argv) {
  let first = argv[0];
  if (!first) return status.cmdOverview({ flags: {}, help: HELP });
  if (first === "--help" || first === "-h" || first === "help") {
    process.stdout.write((argv[1] && commandHelp(argv[1], argv[2])) || HELP);
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
  if (first === "__complete") return complete(argv.slice(1));

  for (const alias of ALIASES) {
    if (alias.from.every((w, i) => argv[i] === w)) {
      const was = argv.slice(0, alias.from.length).join(" ");
      argv = [...alias.to, ...argv.slice(alias.from.length)];
      const now = alias.to.join(" ");
      process.stderr.write(`note: \`ledger ${was}\` is now \`ledger ${now}\` — the old name still works.\n`);
      first = argv[0];
      break;
    }
  }

  if (RETIRED[first]) fail(`\`ledger ${first}\` is now ${RETIRED[first]}`);

  const fn = COMMANDS[first];
  if (!fn) unknownCommand(first);

  // Before anything is parsed or run: `ledger add --help` must never read a
  // payload, and `ledger cut --help` must never cut. Anywhere after the
  // command counts, so `ledger audit complete --help` is help too.
  const rest = argv.slice(1);
  if (rest.some((a) => a === "--help" || a === "-h" || a.startsWith("--help="))) {
    process.stdout.write(commandHelp(first, rest[0]) ?? HELP);
    return;
  }

  const { flags, positional } = parseArgs(rest, { booleans: BOOLEANS });
  checkFlags(first, flags, positional);

  const task = taskFor(first, positional[0]);
  const mode = task ? deliveryMode(flags) : null;
  if (mode) {
    process.exitCode = await deliver(mode, task, flags, { openProject });
    return;
  }
  await fn({ flags, positional });
}

/* ---- shell completion -------------------------------------------------- */

const COMPLETION = {
  zsh: `#compdef ledger
# ledger completion for zsh. Add to ~/.zshrc:  source <(ledger completion zsh)
_ledger() {
  local -a candidates
  candidates=("\${(@f)$(ledger __complete "\${(@)words[2,CURRENT]}" 2>/dev/null)}")
  compadd -a candidates
}
compdef _ledger ledger
`,
  bash: `# ledger completion for bash. Add to ~/.bashrc:  eval "$(ledger completion bash)"
_ledger() {
  local candidates
  candidates=$(ledger __complete "\${COMP_WORDS[@]:1:COMP_CWORD}" 2>/dev/null)
  local IFS=$'\\n'
  COMPREPLY=($(compgen -W "$candidates" -- "\${COMP_WORDS[COMP_CWORD]}"))
}
complete -F _ledger ledger
`,
  fish: `# ledger completion for fish. Save as ~/.config/fish/completions/ledger.fish,
# or run:  ledger completion fish | source
complete -c ledger -f -a '(ledger __complete (commandline -opc)[2..-1] (commandline -ct))'
`,
};

async function cmdCompletion({ positional }) {
  const shell = positional[0];
  if (!COMPLETION[shell]) usage(`usage: ledger completion zsh|bash|fish`);
  process.stdout.write(COMPLETION[shell]);
}

/**
 * The candidates for the last word of a partial command line, one per line.
 * Every shell's script asks this rather than carrying its own copy of the
 * commands, so completion can't drift from what the CLI accepts.
 */
function complete(words) {
  const say = (list) => process.stdout.write(list.length ? `${list.join("\n")}\n` : "");
  const current = words[words.length - 1] ?? "";
  const before = words.slice(0, -1);
  const command = before[0];

  if (!command) return say(Object.keys(COMMANDS));
  const spec = FLAGS[command];
  if (!spec) return say([]);
  const subs = Array.isArray(spec) ? [] : Object.keys(spec).filter((k) => k !== "default" && k !== spec.default && k !== "brief");
  const sub = subs.includes(before[1]) ? before[1] : undefined;

  const previous = before[before.length - 1];
  if (previous === "--run") return say(Object.keys(AGENTS));
  if (previous === "--skip") return say(release.CHECK_IDS);

  if (current.startsWith("-")) {
    const own = Array.isArray(spec) ? spec : spec[sub ?? spec.default] ?? [];
    const delivery = taskFor(command, sub) ? DELIVERY_FLAGS.filter((f) => f !== "prompt-only") : [];
    return say([...own, ...delivery, ...GLOBAL_FLAGS].map((f) => (NEGATED.includes(`${command} ${f}`) ? `--no-${f}` : `--${f}`)));
  }
  if (before.length === 1 && subs.length) return say(subs);
  if (command === "completion") return say(Object.keys(COMPLETION));
  if (command === "style" && sub === "set") return say([...Object.keys(STYLES), CUSTOM_STYLE_ID]);
  if (["show", "change", "update", "remove", "own"].includes(command) || (command === "audit" && sub === "confirm")) {
    return say(featureIds());
  }
  if (command === "questions" && ["answer", "accept", "dismiss"].includes(sub)) {
    try { return say(questions.questionIds(openProject({}))); } catch { return say([]); }
  }
  if (command === "build" && before.length === 1) {
    const versions = (() => { try { return openProject({}).releases.versions; } catch { return []; } })();
    return say(["all", "draft", ...versions.map((v) => `v${v}`)]);
  }
  return say([]);
}

function featureIds() {
  try {
    findLedgerDir();
    return openProject({}).featureSet.features().map((f) => f.id);
  } catch {
    return [];
  }
}

