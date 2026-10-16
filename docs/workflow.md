# Workflows

Every workflow, step by step. When you're unsure where you are, run `ledger` on
its own: it shows what the open release holds, the reasons nobody has given,
what the cut would say, and the one command to run next. Whenever that is agent
work, it is `ledger agent`, which works out the task and how much of it (see
[agents.md](agents.md#ledger-agent--the-one-command-for-agent-work)). The
task names below are what it runs.

The commands come in two kinds:

- **runs**: the CLI does the work, and you see the result. Free.
- **agent task**: the CLI prints a prompt for a coding agent and changes
  nothing itself. By default it prints the prompt for you to paste into your
  agent session. `--copy` puts it on the clipboard instead, `--print` prints
  the prompt alone for piping, and `--run claude` (or `codex`, `gemini`, or any
  command) hands it to an agent and waits. Only an agent task spends tokens,
  and only when you start it. See [agents.md](agents.md).

## Setting up a new project

| | Command | Kind |
| --- | --- | --- |
| 1 | `ledger init --product "Acme Portal"` (add `--commit-pdfs` to keep the client PDFs in the repo) | runs |
| 2 | `ledger agent` (it runs `ledger bootstrap`): the agent surveys the codebase and writes every entry with how to see it, marks the survey finished, then stops | agent task |
| 3 | `ledger preview`, and fix the wording in `.ledger/features/<id>.json` | by hand |
| 4 | `ledger status`: checks every file you edited | runs |
| 5 | Commit `.ledger/` | git |
| 6 | `ledger cut --name "Baseline" --date <the first commit's date>`: prints the first edition | runs |

The survey runs start to finish without asking you anything. The agent lists
the capabilities first, against [the entry bar](concepts.md#one-altitude-whatever-the-size-of-the-project),
then decides whether the product needs areas at all, and writes the entries a
batch at a time. It doesn't cut and doesn't commit: it hands you a draft, the
entries it was least sure about, and the `ledger cut` command with the date
worked out from the repository.

Attempted in one pass, a survey runs out of context and starts inventing. In
batches it's reliable, so the prompt batches, and the agent moves between
batches on its own. A survey that stops partway anyway leaves its entries
behind, and the next `ledger agent` carries it on from them. The baseline it hands you is a draft: rewrite the wording
straight in the files ([editing.md](editing.md)).

### The baseline reads as an inventory, not as your work

- **Voice.** Every description is a present-tense statement of what the product
  does: "A guest can book without an account", never "added" or "we now
  support". A reader can't tell from the wording whether something shipped last
  week or three years ago.
- **No flags on version 1.** New and Changed are computed against a release's
  predecessor, and version 1 hasn't got one. The first edition prints as a plain
  catalogue, every entry in full. From version 2 on, each edition sets apart
  what moved.

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
  "description": "A customer keeps more than one basket, such as the weekly shop and a party order, and switches between them without either losing its contents.",
  "how_to_see": "Open the basket menu and choose New basket; the old one stays in the list."
}
JSON
```

Something that already exists changes:

```bash
ledger change delivery-windows <<'JSON'
{
  "what": "Delivery windows can be booked 28 days ahead instead of 14.",
  "why": "Fourteen covered the weekly shop but not the customers who plan a month ahead, and those are the orders least likely to be cancelled.",
  "description": "The full current-state text, rewritten. Not a diff."
}
JSON
```

A change is two facts, **what** moved and **why**, recorded as they are. `what`
is one sentence a client could read, so the free preview is already readable,
but nobody writes the client's note at this point: it is written once, for the
whole release, by `ledger prepare`, from what the last edition said, what the
entry says now and these facts. A feature that changes three times in a release
is three `ledger change`s, and none of them is ever revised.

`ledger change` refuses a change to an existing feature with no reason. An
agent takes the reason from the conversation when you have already given it,
or agreed to one it proposed, and lists the reasons it took that way when it
reports back; it asks only when nothing said explains the change. When
nobody can say why, `--why-unknown` records the gap; a reason read off a commit
message takes `--why-from commit`. Either stays a question for a person: bare
`ledger` lists it, and `ledger prepare` asks you. That refusal is deliberate,
and it's the most valuable thing the CLI does.

The agent writes into the working tree and never commits. You commit what it
recorded with the rest of the change.

### Seeing where the release stands

```bash
ledger preview
```

```
v6 so far, against v5 (September 12, 2026):
  new         2   1 Big · 1 Small
  updated     4   1 Big · 3 Medium        7 changes recorded, 3 since the last prepare
  removed     1   Small
  code            1,240 lines changed since v5's commit, working tree included

wrote v6 · DRAFT, not cut → docs/generated/Acme-Portal-Feature-Ledger_6-draft.pdf
```

The readout is worked out from the ledger and git alone, and the draft is laid
out exactly as the cut will print it. Where nothing is prepared yet, each
updated entry shows its changes as recorded, labelled "as recorded, not yet
prepared". It is free, so run it as often as you like. `--open` opens the PDF,
`--html` writes HTML instead.

## Preparing and cutting a release

| | Command | Kind |
| --- | --- | --- |
| 1 | `ledger`: what the release holds, and what the cut would say | runs |
| 2 | `ledger agent` (it runs `ledger prepare`), in your agent session, with you there | agent task |
| 3 | Read the diff, and commit | git |
| 4 | `ledger cut --name "Sprint 6 demo"`: prints the PDF into the client directory, and opens the next release | runs |
| 5 | Commit `.ledger/` (and `docs/client/`, if you keep the PDFs) | git |

`prepare` writes the overview, the "What changed" notes, a sentence per entry
for the first page, and how to see each new or updated entry, for a reader who has
never seen the code. In the same session it reads the
code since the last edition for work nobody recorded, asks you the reasons
nobody gave, and checks what it wrote against the code. Run it mid-release to
see the near-final text, and again before the cut: the second time it covers
only what moved since the first, and keeps every other note, including your own
edits. What it does, and what the
cut says before it prints, is in [releasing.md](releasing.md).

The PDF is printed before anything is written, so a machine with no browser
can't leave a release cut without its edition. `--no-pdf` cuts without
printing, and `ledger build v6` prints it later. `--full` prints every entry in
full instead of one line for the ones that didn't move, and every reprint of
that edition does the same.

The cut also records the commit it happened at, because a date is too coarse to
name a moment: two demos in one day are ordinary. `--commit <sha>` cuts
retrospectively at a known point, and `ledger releases` prints the timeline with
each commit. A ledger that predates commits fills its history in with
`ledger releases amend <version> --commit <sha>`.

## A feature was built without an agent

Record it yourself, with `ledger add <id>` or `ledger change <id>`. Or leave it:
`ledger prepare` reads the code since the last edition, and records what
someone using the product would notice that the ledger doesn't account for.
Between prepares, `ledger agent` sweeps the code nobody has read yet
(`ledger sweep`): it records what's missing and writes none of the client's
text. It starts one only for 20 lines or more outside tests and docs, and a
second run over the same code finds nothing to do.

## Reading the current state

| | Command | Kind |
| --- | --- | --- |
| — | `ledger list`, `ledger show <id>`: the corpus in the terminal, one line or one entry at a time (`show --diff` for the last edition beside now) | runs |
| — | `ledger preview`: the readout, then the open release as a draft PDF | runs |
| — | `ledger build`: the Markdown docs, any cut edition not yet printed, and the draft | runs |
| — | Edit names, descriptions, how-to-see texts and dev notes in `.ledger/features/<id>.json`, then `ledger status` | by hand |
| — | `ledger style rewrite`: the agent rewrites the whole ledger in the project's tone, without changing what it says | agent task |

A draft is named `…_N-draft.pdf` and goes in `docs/generated/`, which is
gitignored. It never lands next to the client editions, so a draft can't be
mistaken for one, or committed as one.

## Starting the document again from scratch

When the structure has grown too complex to fix by editing. The version numbers
and the editions already printed are kept. See [releasing.md](releasing.md#starting-over-the-redraft).

| | Command | Kind |
| --- | --- | --- |
| 1 | `ledger redraft start`: sets the corpus aside in `.ledger/archive/` and opens the next version on an empty one | runs |
| 2 | `ledger agent` (it runs `ledger bootstrap`): the agent surveys the codebase from scratch, and stops before the cut | agent task |
| 3 | Commit `.ledger/` | git |
| 4 | `ledger agent` (it runs `ledger redraft check`): the agent compares the new corpus with the old one, puts back anything lost, writes a note for the client, and records the check | agent task |
| 5 | Commit its edits | git |
| 6 | `ledger cut --name "…"`: the first edition in the new structure, opening with a note that it is reorganized | runs |

`ledger redraft` on its own says where a redraft stands and what comes next.

## Upgrading a ledger written by an earlier version

```bash
ledger migrate
git commit -am "Migrate the ledger"
```

Merge any branch that records into the ledger first, and have everyone upgrade
at once: an older CLI writing into a migrated ledger would drop what it doesn't
know, so each refuses the other's ledger.

The migration needs no agent. Every "What changed" note an edition already
printed is kept verbatim, the open release's notes become recorded changes,
dev notes move to the entry, and the code paths, questions and audits of the
intermediate version go. Anything it can't carry over — a note the old tool
accepted and never printed, a finding nobody settled — it lists word for word.
A feature file in an old shape that arrives later, on a merged branch, is
refused on load, and `ledger migrate` converts it on its own.

## Reprinting an edition the client already has

| | Command | Kind |
| --- | --- | --- |
| — | `ledger build v3`: prints one edition again, including an archived one, from its archive | runs |
| — | `ledger build all`: prints every edition of the current corpus | runs |
| — | `ledger releases`: which version is which, with the date and commit of each | runs |

A cut edition's notes are frozen in `compositions.json` and never rewritten,
so a reprint says what the client was handed. Wording you've improved by hand
since does show: that's the point of improving it.

## Preparing the document for a new client

| | Command | Kind |
| --- | --- | --- |
| 1 | Edit `.ledger/brand.json` (logo, accent colour) and the wording in `.ledger/config.json` | by hand |
| 2 | `ledger style set govuk` (or another tone): switches the tone, and updates the agent stanza | runs |
| 3 | `ledger agent` (it runs `ledger style rewrite`), to bring the existing entries into the new tone, an area at a time; a rewrite that stops carries on from the areas left | agent task |
| 4 | `ledger status`: shows the resolved palette, fonts and tone | runs |

See [documents.md](documents.md).

## Keeping it sound automatically

`ledger status --quiet` in a pre-commit hook or CI prints only warnings, skips
the browser check, and exits 1 when a file is broken. See
[agents.md](agents.md#make-it-happen-without-being-asked).
