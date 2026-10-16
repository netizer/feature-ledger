# feature-ledger

**feature-ledger keeps a client-facing list of what your product does. The list
lives in your repo, your coding agent updates it as it builds, and each release
prints it as a short PDF for your client.**

A changelog lists what changed, and a commit log lists what developers did. The
feature ledger answers the two questions a client asks: *what does this
software do, and what's new since last time?*

- **One entry per capability.** A capability is something a user of the product
  would name, and each one is sized so the big ones stand out.
- **A short edition that keeps every change.** An edition is the PDF you hand
  the client for one release. Its first page is the update: an overview and a
  short list of what's new and what changed. Next come the details of each
  change, with how to check it yourself. The edition ends with a catalogue of
  the whole product, one line per capability.
- **A reason for every change.** When nobody gave a reason, the edition says
  so. The ledger never invents one.
- **One PDF per release.** You can always see what the client was shown in any
  earlier release. [See an example edition](docs/client).

feature-ledger works in any repo, because the ledger is a folder of JSON files.
It works with any coding agent: the agent reads a short set of instructions,
and everything else is a CLI command.

## What you get

- **Tokens spent once per release.** Your agent records each change as a few
  lines of JSON as it works. The one task that uses many tokens is a single
  `ledger prepare` per release. `ledger preview` shows what the edition will
  most likely look like, and it runs no agent, so you can check it as often as
  you like.
- **Text that's easy to read.** Every entry follows a public style guide, the
  Google developer documentation style guide by default. Its short, plain,
  present-tense sentences read well even in a second language.
- **A layout shaped by use.** The layout was refined edition after edition, so
  that each feature is easy to find and the important points are easy to pick
  out. The update comes first, each change has its own short section with how
  to check it, and a one-line catalogue of the whole product comes last.
- **The real reason behind each change.** The people who do the work record
  the reason at the time. A reason nobody gave stays marked as unknown until
  someone supplies it.
- **What's new, in the context of the whole product.** Each edition shows what
  changed alongside everything the product already does.
- **A record of every edition.** Each release is a PDF in your repo, so you can
  always see what the client was shown, and when.
- **Every change covered.** `ledger prepare` reads the code changed since the
  last edition, and asks you about work that the ledger doesn't record yet.

## Commands at a glance

> **`preview` is free, `agent` spends tokens, and `cut` prints.**

```bash
ledger                    # shows the state of the release and the next command to run
ledger preview            # shows the edition as it would print now, with no agent
ledger agent              # runs the agent work that is due, and only the part not done yet
ledger cut --name "…"     # prints the edition and opens the next release
```

While you build, your coding agent records facts with `ledger add`,
`ledger change`, and `ledger remove`. The agent never commits for you, and no
agent runs unless you ask for one.

`ledger agent` is the one command for agent work. It reads `.ledger/` and git,
without an agent, to work out which task is due:

- The survey of a new codebase.
- A rewrite of existing entries into a new tone.
- The client's text for the release.
- A review of code changes that nobody recorded.

Each task covers only what changed since it last ran. When nothing is due,
`ledger agent` starts nothing. To see what it would do, run
`ledger agent --plan`.

## Install

```bash
npm install -g feature-ledger
```

feature-ledger requires Node 18.17 or later. To print the PDF, it also requires
Chrome or Chromium.

## Get started

1.  Create the ledger and start the survey:

    ```bash
    cd my-app
    ledger init --product "Acme Portal"
    ledger agent              # paste the prompt into your agent session
    ```

    `ledger init` creates `.ledger/` and adds instructions for your agent to
    `CLAUDE.md` or `AGENTS.md`. On an empty ledger, `ledger agent` prints the
    survey prompt (`ledger bootstrap`). The prompt asks your agent to read the
    codebase and write one entry per capability, with how to see each one.

    To put the prompt on your clipboard, add `--copy`. To hand it to an agent
    directly, add `--run claude`. The `--run` option also accepts `codex`,
    `gemini`, or any command that reads a prompt on stdin. To have
    `ledger agent` hand over the prompt every time, set `"agent": "claude"` in
    `.ledger/config.json`.

1.  Read the result with `ledger preview`, and change any wording that doesn't
    sound like you. The text of each entry is in
    `.ledger/features/<id>.json`, and you can edit it directly.

1.  Commit, and then print the first edition:

    ```bash
    ledger cut --name "Baseline"
    ```

## Day to day

While you work, your agent does the recording. For each change, it records two
facts: what moved, and why.

```bash
ledger change delivery-windows <<'JSON'
{ "what": "Delivery windows can be booked 28 days ahead instead of 14.",
  "why": "Wholesale customers plan their orders a month out." }
JSON
```

Nobody writes the client's "What changed" notes during the release.
`ledger prepare` writes them once, for the whole release. To see where the
release stands, run `ledger preview`. It prints a summary and the draft
edition:

```
v6 so far, against v5 (September 12, 2026):
  new         2   1 Big · 1 Small
  updated     4   1 Big · 3 Medium        7 changes recorded, 3 since the last prepare
  removed     1   Small
  code            1,240 lines changed since v5's commit, working tree included
```

Before `ledger prepare` runs, the draft shows each change as it was recorded.
You can see the size and content of the latest work at any time, without
running an agent.

## Show an edition to the client

```bash
ledger agent              # prepares the edition in your agent session, with you present
ledger cut --name "Sprint 6 demo"
```

When the release has changes that nobody has prepared, `ledger agent` runs
`ledger prepare`. First, at the terminal and without an agent, it asks you for
any reasons that nobody gave.

`ledger prepare` is one interactive session. It writes everything the client
reads, in plain language for someone who has never seen the code:

- An overview of the release.
- A one-sentence note on each change.
- A sentence for each capability on the first page.
- How to see each new or updated capability.

In the same session, `ledger prepare` reads the code changed since the last
edition and looks for work that nobody recorded. It asks you for missing
reasons, and checks what it wrote against the code. If the text and the code
disagree, this is a good moment to fix either one. `ledger prepare` doesn't
commit. It ends with a list of what it changed. If you run it again later in
the release, it covers only what changed since its last run.

`ledger cut` refuses to print an edition only when the edition would be wrong:
when nothing is recorded, or when a redraft isn't checked yet. For anything
else, it shows a warning and asks you to confirm:

```
Before v6 is cut:
  ! 2 changes recorded since the last prepare (October 3, 2026), on pick-list, saved-baskets
    → ledger prepare
  ! 1 reason nobody has vouched for (1 unknown: pick-list)
    → ledger prepare asks you about them
Cut v6 and print its edition anyway? [y/N]
```

`ledger cut` prints `docs/client/…_6.pdf`.

If you're upgrading from an earlier version of feature-ledger, run
`ledger migrate`. It converts the ledger and keeps every edition you already
handed over exactly as it printed.

## Learn more

- [Workflows](docs/workflow.md): every step, from setup to reprinting an old
  edition.
- [Preview, prepare, cut](docs/releasing.md): what each command does, what
  `ledger cut` reports, how to handle missing reasons, and how to start over
  with a redraft.
- [Editing by hand](docs/editing.md): which files you can edit, and which
  changes go through the CLI.
- [Coding agents](docs/agents.md): the agent instructions, `--run`, resuming
  sessions, and Claude Code permissions.
- [The documents](docs/documents.md): the edition's layout, file locations,
  branding, and tone.
- [How it works](docs/concepts.md): what qualifies as an entry, releases,
  history, and the layout of `.ledger/`.
- [Command reference](docs/commands.md): every command, exit codes, and shell
  completion.

## Development

```bash
npm install
npm test        # builds projects from scratch and tests every guardrail
```

`examples/northwind/` contains a small example ledger. This repo also keeps a
ledger of its own, in `.ledger/`.

feature-ledger is MIT licensed. The bundled fonts are licensed under SIL OFL
1.1. For details, see `assets/fonts/README.md`.
