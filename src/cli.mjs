import { parseArgs, fail } from "./util.mjs";
import * as init from "./commands/init.mjs";
import * as read from "./commands/read.mjs";
import * as write from "./commands/write.mjs";
import * as release from "./commands/release.mjs";
import * as build from "./commands/build.mjs";
import * as status from "./commands/status.mjs";
import * as style from "./commands/style.mjs";

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
  reword: write.cmdReword,
  rename: write.cmdRename,
  remove: write.cmdRemove,
  "other-change": write.cmdOtherChange,
  categories: write.cmdCategories,
  subcategory: write.cmdSubcategory,

  release: release.cmdRelease,

  build: build.cmdBuild,
};

/** Commands that used to exist. `check` (is the corpus sound?), `doctor` (is
 *  the setup sound?) and `status` (what has this release collected?) were
 *  three ways of asking one question, and whichever one you hadn't run was
 *  where the problem was. They are now all `status`. */
const RETIRED = {
  check: "`ledger status` — it validates the corpus and still exits 1 on a problem, so a commit hook keeps working (`ledger status --quiet`)",
  doctor: "`ledger status` — the resolved setup is one of its sections",
};

const HELP = `ledger — a versioned feature ledger for any codebase

  Reading (cheap; never open the JSON by hand)
    ledger list [--category C] [--audience user|dev] [--size S] [--changed] [--json]
    ledger show <id> [--history] [--json]
    ledger status [--json] [--quiet]    the release, the corpus and the setup, checked
    ledger rules                        the authoring rules, in full
    ledger style [show|list|set <id>]   the tone every entry is written in
    ledger style rewrite                the procedure for moving an existing ledger to it

  Writing (payload as JSON on stdin, or --file f.json; add --dry-run to preview)
    ledger add <id>                     { audience, size, name, description, category?, dev_notes? }
    ledger update <id>                  { description, changes[], name?, size?, dev_notes?, add_changes[]? }
    ledger reword <id> [--version N]    fix the wording, not the thing (no history entry)
    ledger rename <id> "New name"       [--description "..."] [--why "..."]
    ledger remove <id> --reason "..."
    ledger other-change --audience user --description "..."
    ledger categories [list | add "Name" [--after "Other"] | rename "Old" "New" | remove "Name"]
    ledger subcategory [list | add | reword <id>]   { id, category, name, intro }

  Releases
    ledger release list
    ledger release cut --name "..." [--date YYYY-MM-DD]

  Output
    ledger build [--md] [--pdf] [--version N|all] [--out DIR]

  Setup
    ledger init [--product "Name"] [--accent "#hex"] [--logo path] [--agents auto|none|claude,agents,...]
                [--style google|govuk|plain-language|ste] [--commit-pdfs]
    ledger bootstrap                    prints the baseline-survey prompt for your coding agent

  Global: --dir PATH (point at a .ledger directory), --json where offered.
  Full docs: the README in this package, or \`ledger rules\`.
`;

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

  const { flags, positional } = parseArgs(argv.slice(1), {
    booleans: ["dry-run", "json", "history", "changed", "md", "pdf", "force", "quiet", "commit-pdfs"],
  });
  await fn({ flags, positional });
}
