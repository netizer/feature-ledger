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
import * as prepare from "./commands/prepare.mjs";
import * as migrate from "./commands/migrate.mjs";
import * as redraft from "./commands/redraft.mjs";
import * as sweep from "./commands/sweep.mjs";
import * as agent from "./commands/agent.mjs";

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
  change: write.cmdChange,
  update: write.cmdUpdate,
  remove: write.cmdRemove,
  note: write.cmdOtherChange,
  categories: write.cmdCategories,
  subcategories: write.cmdSubcategory,

  preview: build.cmdPreview,
  agent: agent.cmdAgent,
  prepare: prepare.cmdPrepare,
  sweep: sweep.cmdSweep,
  cut: release.cmdCut,

  releases: release.cmdReleases,
  build: build.cmdBuild,
  redraft: redraft.cmdRedraft,
  migrate: migrate.cmdMigrate,
  completion: cmdCompletion,
};

/**
 * Names that changed, and what they became. The old form keeps working and
 * says once, on stderr, what it is called now — so a script or an agent
 * stanza written against the old name doesn't break, and the person running
 * it learns the new one.
 */
const ALIASES = [
  { from: ["release", "cut"], to: ["cut"] },
  { from: ["release", "amend"], to: ["releases", "amend"] },
  { from: ["release", "list"], to: ["releases"] },
  { from: ["release"], to: ["releases"] },
  { from: ["other-change"], to: ["note"] },
  { from: ["subcategory"], to: ["subcategories"] },
];

/** What `prepare` replaced, said once for every command it took over. */
const PREPARED = `\`ledger prepare\` now. One interactive agent session, run when you ask for it, writes
the overview, the "What changed" notes and the summary, finds work nobody recorded, asks
you the reasons nobody gave, and checks what it wrote against the code. \`ledger preview\`
shows the edition as it would print, for free, at any time.`;

/** Commands that used to exist, and where their job went. */
const RETIRED = {
  check: "`ledger status` — it validates the corpus and still exits 1 on a problem, so a commit hook keeps working (`ledger status --quiet`)",
  doctor: "`ledger status` — the resolved setup is one of its sections",
  reword: `a hand-edit. Open .ledger/features/<id>.json and change the words in place: nothing lands on the
release, because nothing about the product moved. Run \`ledger status\` afterwards — it validates
every file. \`ledger rules\` has the section on editing by hand.`,
  rename: `two different things:
  the name was badly chosen      → edit "name" in .ledger/features/<id>.json. Nothing is recorded.
  the product renamed the thing  → \`ledger change <id> --name "New name" --what "…" --why "…"\``,
  audit: PREPARED,
  compose: PREPARED,
  summary: PREPARED,
  review: PREPARED,
  verify: PREPARED,
  questions: `gone as a store of its own. A reason nobody recorded stays on its change, marked as
unknown or read off a commit: bare \`ledger\` lists them, and \`ledger prepare\` asks you about them.`,
  own: `gone: the ledger no longer maps code to entries. Commits run across features, and keeping the
map true was a second job. \`ledger prepare\` reads the code since the last edition for work nobody recorded.`,
  paths: "gone with `ledger own`: the ledger no longer maps code to entries",
  diff: "`ledger preview`, which opens with what the release holds and how much code moved, then prints the draft",
};

const DELIVERY_HELP = `  Delivering a prompt (agent, prepare, bootstrap, sweep, redraft check, style rewrite)
    (default)        an explanation for you, then the prompt to paste into your agent session
    --print          the prompt alone, ready to pipe: \`ledger prepare --print | pbcopy\`
    --copy           the prompt, straight onto the clipboard
    --run AGENT      hand it to ${Object.keys(AGENTS).join(", ")} — or to "any command" that reads the prompt on
                     stdin — wait, check what it left behind, and print how to resume its session.
                     Only ever when you type it. A bare --run uses $LEDGER_AGENT, or "agent"
                     in .ledger/config.json — and so does \`ledger agent\` with no option at all`;

const HELP = `ledger — a client-facing record of what your product does, kept in the repo

  Preview is free, the agent costs tokens, cut prints.

    ledger                              where things stand, and the one thing to run next
    ledger preview [--html] [--open] [--full]
                                        the edition as it would print now, after a short readout.
                                        Free: no agent
    ledger agent [--plan] [--force]     whatever agent work is due, worked out from .ledger/ and git
                                        for free: the survey, a rewrite into a new tone, prepare, or
                                        a sweep of the code for work nobody recorded — only the part
                                        not done yet. Asks the missing reasons first, at a terminal.
                                        Nothing due, no agent. --plan shows it; --force sweeps even
                                        a small change. Spends tokens
    ledger prepare [--full]             one interactive agent session that writes the client's text:
                                        the overview, the "What changed" notes, the summary and how
                                        to see each entry, and checks it against the code. After the
                                        first, only what moved since the last; --full for all of it
    ledger prepare complete             check what it wrote, and record what it was written from
    ledger cut --name "..." [--date YYYY-MM-DD] [--commit SHA] [--full] [--yes] [--no-pdf] [--html]
                                        print the edition into the client directory, and open
                                        the next release. Refuses only an edition that would be wrong;
                                        anything else it shows you and asks first (--yes, unattended)

  Recording, while you build (the agent stanza does this; payload as JSON on stdin, or --file f.json)
    ledger add <id>                     { audience, size, name, description, how_to_see?, category?, dev_notes? }
    ledger change <id>                  { what, why, description?, name?, how_to_see? }   something moved
                                        --why-from commit   the reason was read off a commit message
                                        --why-unknown       nobody can say; prepare asks about it
                                        (size, category, dev_notes alone record nothing)
    ledger remove <id> --why "..."      a capability that's gone, and why
    ledger note --audience user --description "..."
                                        a change that belongs to no single feature
    ledger add/change/remove --backfilled            already in the product before the last
                                                     edition, only now on the record
    ledger categories [list | add "Name" [--after "Other"] [--intro "..."] | rename "Old" "New" | remove "Name"]
    ledger subcategories [list | add]   { id, category, name, intro }
    (add --dry-run to any of them to see what it would write)

  Reading (cheap; don't read .ledger/ by hand — it's big)
    ledger status [--json] [--quiet]    the release, what stands before its cut, the corpus, the setup
    ledger list [--category C] [--audience user|dev] [--size S] [--changed] [--json]
    ledger show <id> [--history | --at vN | --diff] [--json]
    ledger rules                        how to record, in full
    ledger style [show|list|set <id>]   the tone every entry is written in
    ledger export [--out FILE]          the whole corpus as one JSON document

  Once, or rarely
    ledger init [--product "Name"] [--accent "#hex"] [--logo path] [--agents auto|none|claude,agents,...]
                [--style google|govuk|plain-language|ste] [--commit-pdfs]
    ledger bootstrap                    agent task: survey the codebase and write the baseline, or carry
                                        on a survey that stopped partway
    ledger bootstrap complete           record that the survey finished
    ledger sweep                        agent task: read the code since it was last read, and record
                                        the work nobody recorded
    ledger sweep complete               record the code as read
    ledger migrate [--dry-run]          bring a ledger written by an earlier version over
    ledger build [v3 | all | draft] [--md] [--pdf] [--full] [--out DIR] [--html]
                                        reprint an edition, or write the Markdown docs
    ledger releases                     the timeline: every version, its date and its commit
    ledger releases amend <version> --commit SHA
    ledger redraft [start | check | complete --note "..."]
                                        write the corpus again from scratch, keeping the client's record
    ledger style rewrite [--category "Area"]
                                        agent task: bring the entries still in an earlier tone into
                                        the project's tone
    ledger style rewrite complete [--category "Area" | <id>...]
                                        record those entries as rewritten (no area or id: all of it)
    ledger completion zsh|bash|fish     shell completion; the script says how to load it

  Editing the words (no command — the corpus is yours to edit; run \`ledger status\` after)
    .ledger/features/<id>.json          a name, a description, how to see it, dev notes
    .ledger/compositions.json           the overview, a "What changed" note, a summary sentence
    .ledger/subcategories.json          sub-section headings and their overviews
    .ledger/config.json                 product name, tagline, document titles, area overviews
    .ledger/other-changes.json          the product-wide notes

${DELIVERY_HELP}

  Global: --dir PATH (point at a .ledger directory), --json where offered, --help after any
          command. An option a command doesn't take is an error, and nothing is run.
  Exit codes: 0 done · 1 error · 2 a mistake in the command line · 3 refused
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
  bootstrap: { default: "brief", brief: [], complete: ["dry-run"] },
  sweep: { default: "brief", brief: [], complete: ["dry-run"] },
  agent: ["plan", "force", "print", "copy", "run"],
  migrate: ["dry-run"],

  list: ["category", "audience", "size", "changed", "json"],
  show: ["history", "at", "diff", "json"],
  status: ["json", "quiet"],
  rules: [],
  style: { default: "show", show: ["json"], list: ["json"], set: [], rewrite: ["category", "dry-run"] },
  export: ["out"],

  add: ["file", "audience", "category", "subcategory", "size", "name", "description", "how-to-see", "dev-notes", "paths",
    "backfilled", "dry-run"],
  change: ["file", "what", "why", "why-from", "why-unknown", "description", "name", "how-to-see", "size", "category",
    "subcategory", "dev-notes", "paths", "backfilled", "dry-run"],
  update: ["file", "description", "change", "add-change", "name", "size", "category", "subcategory", "dev-notes", "paths",
    "backfilled", "reason-inferred", "dry-run"],
  remove: ["why", "why-from", "reason", "backfilled", "reason-inferred", "dry-run"],
  note: ["file", "audience", "description", "dry-run"],
  categories: { default: "list", list: [], add: ["after", "before", "intro", "dry-run"], rename: ["dry-run"], remove: ["dry-run"] },
  subcategories: { default: "list", list: [], add: ["file", "id", "category", "name", "intro", "dry-run"] },

  preview: ["out", "html", "open", "full"],
  prepare: { default: "brief", brief: ["full"], complete: ["dry-run"] },
  cut: ["name", "date", "commit", "full", "pdf", "html", "out", "yes", "dry-run"],
  releases: { default: "list", list: [], amend: ["commit", "dry-run"] },
  build: ["md", "pdf", "version", "out", "html", "full"],
  redraft: { default: "status", status: [], start: ["force", "dry-run"], check: [], complete: ["note", "dry-run"] },
  completion: [],
};

const NEGATED = ["cut pdf", "init gitignore"];

const BOOLEANS = ["dry-run", "json", "history", "changed", "md", "pdf", "html", "open", "force", "quiet", "commit-pdfs",
  "backfilled", "reason-inferred", "full", "print", "prompt-only", "copy", "yes", "why-unknown", "diff", "plan"];

/** Options that used to exist on one command, and what to do instead. */
const RETIRED_FLAGS = {
  "cut skip": "`ledger cut` has no checks to skip any more. It refuses only an edition that would be wrong (a redraft " +
    "not yet checked, or nothing recorded); everything else it shows you, and asks before it goes ahead. --yes " +
    "answers for you when nobody is at a terminal.",
  "cut force": "`ledger cut` has nothing to force any more: what used to be a gate is a warning it shows before it asks " +
    "to go ahead. --yes answers for you when nobody is at a terminal.",
  "cut run": "`ledger cut` never starts an agent. Run `ledger prepare` first, in your own agent session.",
  "preview run": "`ledger preview` never starts an agent: it is the free look. `ledger prepare` is the step that spends tokens.",
  "preview size": "the readout is always printed now, before the draft.",
  "build run": "`ledger build` never starts an agent. `ledger prepare` is the step that spends tokens.",
  "migrate run": "`ledger migrate` no longer hands anything to an agent: there are no paths to settle.",
  "bootstrap audit": "the survey no longer records an audit; there are none.",
};

function checkFlags(command, flags, positional) {
  for (const f of Object.keys(flags)) {
    const gone = RETIRED_FLAGS[`${command} ${f}`];
    if (gone) usage(`--${f}: ${gone}`);
  }
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
  const visible = spec.filter((f) => f !== "paths");
  const takes = visible.length ? `it takes ${visible.map(shown).join(", ")}` : "it takes no options";
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
  const prompts = taskFor(name, sub) || ["bootstrap", "prepare", "sweep", "agent"].includes(name);
  return `${picked.join("\n")}\n${prompts ? `\n${DELIVERY_HELP}\n` : ""}\n  Global: --dir PATH, --json where offered.\n` +
    "  `ledger --help` lists every command.\n";
}

/**
 * Where a word that isn't a command most likely belongs: a near-miss of a
 * command, or a subcommand typed without the command it lives under
 * (`ledger amend` → `ledger releases amend`).
 */
const SUBCOMMANDS = {
  amend: ["releases amend"], complete: ["prepare complete", "bootstrap complete", "sweep complete", "redraft complete"],
  start: ["redraft start"], next: ["agent"], run: ["agent"], work: ["agent"],
  rewrite: ["style rewrite"], draft: ["preview"], publish: ["cut"], release: ["cut"], print: ["build"],
  check: ["status"], headline: ["prepare"], headlines: ["prepare"], highlights: ["prepare"], size: ["preview"],
  upgrade: ["migrate"],
};

function unknownCommand(word) {
  const near = nearest(word, [...Object.keys(COMMANDS), "help"]);
  const homes = SUBCOMMANDS[word];
  // A subcommand's real home beats a near-miss of spelling: `amend` is
  // `releases amend`, not a typo of `agent`.
  const hint = homes ? ` — did you mean ${homes.map((h) => `\`ledger ${h}\``).join(" or ")}?`
    : near ? ` — did you mean \`ledger ${near}\`?` : "";
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

  if (RETIRED[first]) fail(`\`ledger ${first}\` is ${RETIRED[first]}`);

  const fn = COMMANDS[first];
  if (!fn) unknownCommand(first);

  // Before anything is parsed or run: `ledger add --help` must never read a
  // payload, and `ledger cut --help` must never cut. Anywhere after the
  // command counts, so `ledger prepare complete --help` is help too.
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

  if (current.startsWith("-")) {
    const own = (Array.isArray(spec) ? spec : spec[sub ?? spec.default] ?? []).filter((f) => f !== "paths");
    const delivery = taskFor(command, sub) && command !== "agent" ? DELIVERY_FLAGS.filter((f) => f !== "prompt-only") : [];
    return say([...own, ...delivery, ...GLOBAL_FLAGS].map((f) => (NEGATED.includes(`${command} ${f}`) ? `--no-${f}` : `--${f}`)));
  }
  if (before.length === 1 && subs.length) return say(subs);
  if (command === "completion") return say(Object.keys(COMPLETION));
  if (command === "style" && sub === "set") return say([...Object.keys(STYLES), CUSTOM_STYLE_ID]);
  if (["show", "change", "update", "remove"].includes(command)) return say(featureIds());
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
