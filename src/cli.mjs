import { parseArgs, fail } from "./util.mjs";
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
    booleans: ["dry-run", "json", "history", "changed", "md", "pdf", "force", "quiet", "commit-pdfs",
      "backfilled", "reason-inferred", "full"],
  });
  await fn({ flags, positional });
}
