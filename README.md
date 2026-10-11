# feature-ledger

**A living, client-facing list of what your product does — kept in the repo,
written by your coding agent as it builds, and printed as a PDF every time you
show the client.**

A changelog tells people what changed. A commit log tells developers what was
typed. Neither answers the question a client actually asks: *what does this
software do, and what's new since last time?* The feature ledger does:

- **One entry per capability** a user would name, sized so the big ones stand out.
- **Each release highlights only what moved**, and every change says *why*.
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
capability, and print the first edition.

Don't want the CLI to start an agent? Leave off `--run`: the prompt is printed
for you to paste (or add `--copy` to put it on the clipboard). `--run` also
takes `codex`, `gemini`, or any command that reads a prompt on stdin.

Then read the PDF, and fix whatever doesn't sound like you. The words live in
`.ledger/features/<id>.json` and are yours to edit.

## Day to day

Mostly nothing to do: your agent records each feature as it ships it
(`ledger add`, `ledger update`). When you want to know where things stand, run:

```bash
ledger
```

It shows what the open release holds, whether it's ready to cut, and the one
command to run next.

## Showing it to the client

```bash
ledger cut --name "Sprint 6 demo"
```

That checks the release is ready, prints `docs/client/…_6.pdf`, and opens the
next release. If something's in the way, it says what — all of it at once — and
what to run:

```
✗ v6 was NOT cut — 2 checks are open:
  ✗ audit    23 commits since the last audit …     → ledger audit
  ✗ review   v6 has not been reviewed …            → ledger review
```

`ledger audit` finds work that shipped without the ledger hearing about it.
`ledger summary` writes the short lists of what's new and what changed that
the edition opens with, from what the ledger already says, so a reader can see
what moved without reading the rest.
`ledger review` reads the release the way the client will, against the edition
they already have. All three are agent tasks, so you can hand them over too, or let
the cut do it:

```bash
ledger cut --name "Sprint 6 demo" --run claude
```

The agent runs the open checks, you read its notes, and you say yes before
anything is printed. Want a look first? `ledger preview` prints a draft, which
never lands next to the real editions.

## Learn more

- **[Workflows](docs/workflow.md)**: every step, from setup to reprinting an
  old edition.
- **[Editing by hand](docs/editing.md)**: what's yours to change, and what stays
  with the CLI.
- **[The checks](docs/checks.md)**: the audit, the review, and starting over
  with a redraft.
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
