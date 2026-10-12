# feature-ledger

**A living, client-facing list of what your product does — kept in the repo,
written by your coding agent as it builds, and printed as a PDF every time you
show the client.**

A changelog tells people what changed. A commit log tells developers what was
typed. Neither answers the question a client actually asks: *what does this
software do, and what's new since last time?* The feature ledger does:

- **One entry per capability** a user would name, sized so the big ones stand out.
- **Each release highlights only what moved**, and every change says *why*, or
  says that nobody knows: the ledger never invents a reason.
- **A PDF edition per release**, so "what did we show them in March" always has
  an answer. [Here's what one looks like](docs/client).

It works in any repo (the ledger is a folder of JSON) and with any coding agent
(the rules are one file the agent reads, and everything else is a CLI command).

## Install

```bash
npm install -g feature-ledger
```

Needs Node 18.17+, and Chrome or Chromium for the PDF.

## Get started

```bash
cd my-app
ledger init --product "Acme Portal"
ledger bootstrap --run claude
```

`init` creates `.ledger/` and tells your agent about it, in `CLAUDE.md` or
`AGENTS.md`. `bootstrap` has the agent survey the codebase, write an entry per
capability with the code it lives in, and print the first edition.

Don't want the CLI to start an agent? Leave off `--run`: the prompt is printed
for you to paste (or add `--copy` to put it on the clipboard). `--run` also
takes `codex`, `gemini`, or any command that reads a prompt on stdin.

Then read the PDF, and fix whatever doesn't sound like you. The words live in
`.ledger/features/<id>.json` and are yours to edit.

## Day to day

Mostly nothing to do: your agent records each feature as it ships it, as two
facts, what moved and why (`ledger add`, `ledger change`). Nobody writes the
client's "What changed" notes as they go; those are composed once per release.
When you want to know where things stand, or how big the release has got:

```bash
ledger preview --run claude
```

It opens with the size of the release, worked out from the ledger and git:
new and updated entries by size, how much code moved under each, and what
moved since you last looked. Then it prints a draft PDF, having an agent compose
what changed first, and only when something moved since it was last composed.
`ledger preview --size` stops at the readout, and bare `ledger` shows whether
the release is ready to cut and the one command to run next.

## Showing it to the client

```bash
ledger cut --name "Sprint 6 demo" --run claude
```

That runs whatever is still open, asks you the questions only you can answer,
and prints `docs/client/…_6.pdf`:

- **the audit**, only when code moved that the ledger hasn't accounted for:
  code under an entry that didn't move, or code no entry owns. Each entry names
  the code it lives in, so the agent gets those diffs and nothing else;
- **the composition**, the "What changed" notes and the short lists the edition
  opens with, written from what the last edition said, what the entries say now,
  and what was recorded between. It reads no code;
- **the verify**, if you turn it on: every sentence checked against the code,
  with what it doubts filed as a question;
- **the questions**: reasons nobody recorded or that were read off a commit,
  and anything the verify doubted. The ledger never invents a reason.

You say yes before anything is printed. Without `--run`, a cut that isn't
ready says what's in the way, all of it at once, and what to run:

```
✗ v6 was NOT cut — 2 checks are open:
  ✗ audit     since the last audit (a1b3f9c): 3 files under 1 entry changed without the entry moving …  → ledger audit
  ✗ compose   the composition of v6 is out of date: 2 moved since (pick-list, saved-baskets)       → ledger compose
```

Upgrading from an earlier version? `ledger migrate --run claude` brings the
ledger over, keeps every edition already handed over exactly as it printed,
and has the agent say which code each entry lives in.

## Learn more

- **[Workflows](docs/workflow.md)**: every step, from setup to reprinting an
  old edition.
- **[Editing by hand](docs/editing.md)**: what's yours to change, and what stays
  with the CLI.
- **[The checks](docs/checks.md)**: the audit, composing, verifying, questions,
  and starting over with a redraft.
- **[Coding agents](docs/agents.md)**: `--run`, resuming sessions, wiring the
  stanza, Claude Code permissions and hooks.
- **[The documents](docs/documents.md)**: editions and drafts, where they go,
  branding, tone.
- **[How it works](docs/concepts.md)**: the entry bar, releases, history, and the
  layout of `.ledger/`.
- **[Command reference](docs/commands.md)**: every command, exit codes, shell
  completion.

## Development

```bash
npm install
npm test        # builds projects from nothing and exercises every guardrail
```

`examples/northwind/` is a small worked corpus. This repo also runs its own
ledger on itself, in `.ledger/`.

MIT licensed. Bundled fonts are SIL OFL 1.1; see `assets/fonts/README.md`.
