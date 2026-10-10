# Workflows

Every workflow, step by step. When you're unsure where you are, run `ledger` on
its own: it shows what the open release holds, whether it's ready to cut, and
the one command to run next.

The commands come in two kinds:

- **runs**: the CLI does the work, and you see the result.
- **agent task**: the CLI prepares a prompt for a coding agent and changes
  nothing itself. By default it prints the prompt for you to paste into a fresh
  agent session. `--copy` puts it on the clipboard instead, `--print` prints
  the prompt alone for piping, and `--run claude` (or `codex`, `gemini`, or any
  command) hands it to an agent and waits. See [agents.md](agents.md).

## Setting up a new project

| | Command | Kind |
| --- | --- | --- |
| 1 | `ledger init --product "Acme Portal"` (add `--commit-pdfs` to keep the client PDFs in the repo) | runs |
| 2 | `ledger bootstrap`: the agent surveys the codebase, writes every entry, records the survey as a full audit, and cuts the baseline, which prints its PDF | agent task |
| 3 | Read the PDF, and fix the wording in `.ledger/features/<id>.json` | by hand |
| 4 | `ledger status`: checks every file you edited | runs |
| 5 | Commit `.ledger/` | git |

The survey runs start to finish without asking you anything. The agent lists
the capabilities first, against [the entry bar](concepts.md#one-altitude-whatever-the-size-of-the-project),
then decides whether the product needs areas at all, writes the entries a batch
at a time, and finally records the survey and cuts the baseline:

```bash
ledger status
ledger audit complete --full --commit a1b3f9c            # the survey IS a full sweep
ledger cut --name "Baseline" --date 2026-03-02           # the first commit's date; prints the PDF
```

Recording the survey as a full audit is what makes [the audit](checks.md#the-audit)
useful from day one: everything that lands afterwards is measured against it.
`ledger bootstrap --no-audit` leaves that step out.

Attempted in one pass, a survey runs out of context and starts inventing. In
batches it's reliable, so the prompt batches, and the agent moves between
batches on its own. It finishes by listing the entries it was least sure about.
The baseline it hands you is a draft: rewrite the wording straight in the
files ([editing.md](editing.md)).

### The baseline reads as an inventory, not as your work

- **Voice.** Every description is a present-tense statement of what the product
  does: "A guest can book without an account", never "added" or "we now
  support". A reader can't tell from the wording whether something shipped last
  week or three years ago.
- **No flags on version 1.** New and Changed are computed against a release's
  predecessor, and version 1 hasn't got one. The first edition prints as a plain
  catalogue. From version 2 on, each edition highlights only what moved.

## Day to day, while features are built with an agent

Nothing to run. The agent reads the stanza `ledger init` wrote into `CLAUDE.md`
or `AGENTS.md`, and records each feature as part of the change:

```bash
ledger add saved-baskets <<'JSON'
{
  "audience": "user",
  "category": "Ordering",
  "size": "Medium",
  "name": "Saved baskets",
  "description": "A customer keeps more than one basket — the weekly shop, the party order — and switches between them without either losing its contents."
}
JSON
```

Something that already exists changes:

```bash
ledger update delivery-windows <<'JSON'
{
  "description": "The full current-state text, rewritten. Not a diff.",
  "changes": [
    "The booking horizon went from fourteen days to twenty-eight. Fourteen covered the weekly shop but not the customers who plan a month ahead around a delivery, and those are the orders least likely to be cancelled."
  ]
}
JSON
```

Each `changes` bullet says what the feature was before **and why it moved**.
The description already shows what it is now; the reason is the part only you
know. `ledger update` refuses a change to an existing feature without one. That
refusal is deliberate, and it's the single most valuable thing the CLI does.

`ledger` or `ledger status` shows what the open release has collected so far.

## A feature was built without an agent

| | Command | Kind |
| --- | --- | --- |
| 1 | `ledger audit`: the agent reads everything that landed since the last audit, records what the ledger missed, and stamps the commit it checked (`--full` sweeps the whole codebase) | agent task |
| 2 | `ledger audit confirm <id>`: vouch for a reason the audit took from a commit message (`ledger status` lists them) | runs |

If you know exactly what shipped, skip the audit and record it yourself with
`ledger add <id>` or `ledger update <id>`.

## Reading the current state

| | Command | Kind |
| --- | --- | --- |
| — | `ledger list`, `ledger show <id>`: the corpus in the terminal, one line or one entry at a time | runs |
| — | `ledger preview`: the open release as a draft PDF (`--open` opens it) | runs |
| — | `ledger build`: the Markdown docs, any cut edition not yet printed, and the draft | runs |
| — | Edit names, descriptions and dev notes in `.ledger/features/<id>.json`, then `ledger status` | by hand |
| — | `ledger style rewrite`: the agent rewrites the whole ledger in the project's tone, without changing what it says | agent task |

A draft is named `…_N-draft.pdf` and goes in `docs/generated/`, which is
gitignored. It never lands next to the client editions, so a draft can't be
mistaken for one, or committed as one.

## Presenting to the client, and cutting the release

| | Command | Kind |
| --- | --- | --- |
| 1 | `ledger`: says whether the release is ready, and what's in the way | runs |
| 2 | `ledger audit`, if code landed since the last one | agent task |
| 3 | `ledger review`: the agent reads the release against the edition the client already has, fixes the wording, and records the review | agent task |
| 4 | `ledger cut --name "Sprint 6 demo"`: runs every check, prints the PDF into the client directory, and opens the next release | runs |
| 5 | Commit `.ledger/` (and `docs/client/`, if you keep the PDFs) | git |

Steps 2 to 4 in one command, with an agent doing the agent tasks:

```bash
ledger cut --name "Sprint 6 demo" --run claude
```

It hands whichever of the audit and the review is still open to the agent, one
after the other, checks what each left behind, then shows you the agent's notes
and asks before it cuts. `--yes` cuts without asking, for when nobody is at a
terminal.

When a check is open, `ledger cut` refuses, lists every check, and says what
to run for each:

```
$ ledger cut --name "Sprint 6 demo"
✗ v6 was NOT cut — 2 checks are open:

  ✓ redraft  no redraft waiting to be checked
  ✗ audit    23 commits since the last audit (a1b3f9c, September 12, 2026), changing 41 files …
             → ledger audit        (or `ledger audit --run <agent>` to hand it to one)
  ✓ content  14 entries recorded against v6
  ✗ review   2 client-facing entries have changed since v6 was reviewed on September 25, 2026 …
             → ledger review       (or `ledger review complete`, if you have read them yourself)
  ✓ moment   cutting at 3f9c21a on 2026-10-10

Nothing was written. Fix the above and cut again, or skip a check on purpose: --skip audit,review
```

It exits with code 3, so a script can tell a refusal from an error. What each
check means is in [checks.md](checks.md).

The PDF is printed before anything is written, so a machine with no browser
can't leave a release cut without its edition. `--no-pdf` cuts without
printing, and `ledger build v6` prints it later.

The cut also records the commit it happened at, because a date is too coarse to
name a moment: two demos in one day are ordinary. `--commit <sha>` cuts
retrospectively at a known point, and `ledger releases` prints the timeline with
each commit. A ledger that predates commits fills its history in with
`ledger releases amend <version> --commit <sha>`.

## Starting the document again from scratch

When the structure has grown too complex to fix by editing. The version numbers
and the editions already printed are kept. See [checks.md](checks.md#starting-over-the-redraft).

| | Command | Kind |
| --- | --- | --- |
| 1 | `ledger redraft start`: sets the corpus aside in `.ledger/archive/` and opens the next version on an empty one | runs |
| 2 | `ledger bootstrap`: the agent surveys the codebase from scratch, and stops before the cut | agent task |
| 3 | Commit `.ledger/` | git |
| 4 | `ledger redraft check`: the agent compares the new corpus with the old one, puts back anything lost, writes a note for the client, and records the check | agent task |
| 5 | Commit its edits | git |
| 6 | `ledger cut --name "…"`: the first edition in the new structure, opening with a note that it is reorganized | runs |

`ledger redraft` on its own says where a redraft stands and what comes next.

## Reprinting an edition the client already has

| | Command | Kind |
| --- | --- | --- |
| — | `ledger build v3`: prints one edition again, including an archived one, from its archive | runs |
| — | `ledger build all`: prints every edition of the current corpus | runs |
| — | `ledger releases`: which version is which, with the date and commit of each | runs |

## Preparing the document for a new client

| | Command | Kind |
| --- | --- | --- |
| 1 | Edit `.ledger/brand.json` (logo, accent colour) and the wording in `.ledger/config.json` | by hand |
| 2 | `ledger style set govuk` (or another tone): switches the tone, and updates the agent stanza | runs |
| 3 | `ledger style rewrite`, to bring the existing entries into the new tone | agent task |
| 4 | `ledger status`: shows the resolved palette, fonts and tone | runs |

See [documents.md](documents.md).

## Keeping it sound automatically

`ledger status --quiet` in a pre-commit hook or CI prints only warnings, skips
the browser check, and exits 1 when a file is broken. See
[agents.md](agents.md#make-it-happen-without-being-asked).
