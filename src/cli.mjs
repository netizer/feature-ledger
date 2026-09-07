import { parseArgs, fail } from "./util.mjs";
import * as init from "./commands/init.mjs";
import * as read from "./commands/read.mjs";
import * as write from "./commands/write.mjs";
import * as release from "./commands/release.mjs";
import * as build from "./commands/build.mjs";

const COMMANDS = {
  init: init.cmdInit,
  bootstrap: init.cmdBootstrap,

  list: read.cmdList,
  show: read.cmdShow,
  status: read.cmdStatus,
  rules: read.cmdRules,
  export: read.cmdExport,

  add: write.cmdAdd,
  update: write.cmdUpdate,
  rename: write.cmdRename,
  remove: write.cmdRemove,
  "other-change": write.cmdOtherChange,
  categories: write.cmdCategories,
  subcategory: write.cmdSubcategory,

  release: release.cmdRelease,

  check: build.cmdCheck,
  build: build.cmdBuild,
  doctor: build.cmdDoctor,
};

const HELP = `ledger — a versioned feature ledger for any codebase

  Reading (cheap; never open the JSON by hand)
    ledger list [--category C] [--audience user|dev] [--size S] [--changed] [--json]
    ledger show <id> [--history] [--json]
    ledger status                       what this in-progress release has so far
    ledger rules                        the authoring rules, in full

  Writing (payload as JSON on stdin, or --file f.json; add --dry-run to preview)
    ledger add <id>                     { audience, category, size, name, description, dev_notes? }
    ledger update <id>                  { description, changes[], name?, size?, dev_notes?, add_changes[]? }
    ledger rename <id> "New name"       [--description "..."] [--why "..."]
    ledger remove <id> --reason "..."
    ledger other-change --audience user --description "..."
    ledger categories [add "Name" [--after "Other"] | list]
    ledger subcategory add              { id, category, name, intro }

  Releases
    ledger release list
    ledger release cut --name "..." [--date YYYY-MM-DD]

  Output
    ledger check                        validate the corpus (exit 1 on any problem)
    ledger build [--md] [--pdf] [--version N|all] [--out DIR]
    ledger doctor                       config, fonts, and which browser prints the PDF

  Setup
    ledger init [--product "Name"] [--accent "#hex"] [--logo path] [--agents auto|none|claude,agents,...]
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

  const fn = COMMANDS[first];
  if (!fn) fail(`unknown command "${first}" — run \`ledger --help\``);

  const { flags, positional } = parseArgs(argv.slice(1), {
    booleans: ["dry-run", "json", "history", "changed", "md", "pdf", "force", "quiet"],
  });
  await fn({ flags, positional });
}
