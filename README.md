# feature-ledger

**A living, client-facing list of what your product does — kept in the repo,
recorded by your coding agent as it builds, and printed as a short PDF every
time you show the client.**

A changelog tells people what changed. A commit log tells developers what was
typed. Neither answers the question a client actually asks: *what does this
software do, and what's new since last time?* The feature ledger does:

- **One entry per capability** a user would name, sized so the big ones stand out.
- **Each edition is short without dropping work**: a first page that is the
  update (an overview and a short list of what's new and what changed), the
  details of each change with how to check it yourself, and a one-line-each
  catalogue of the whole service.
- **Every change says why**, or says that nobody knows: the ledger never
  invents a reason.
- **A PDF edition per release**, with the message to send beside it, so "what
  did we show them in March" always has an answer. [Here's what one looks
  like](docs/client).

It works in any repo (the ledger is a folder of JSON) and with any coding agent
(the instructions are a short stanza the agent reads, and everything else is a
CLI command).

## The whole API

> **Preview is free, the agent costs tokens, cut prints.**

```bash
ledger                    # where things stand, and the one thing to run next
ledger preview            # the edition as it would print now — free, no agent
ledger agent              # whatever agent work is due, and only the part not done yet — spends tokens
ledger cut --name "…"     # print the edition and the message to send with it
```

While you build, your coding agent records facts with `ledger add`,
`ledger change` and `ledger remove`. It never commits for you, and no agent
runs unless you ask for one.

`ledger agent` is the one command for agent work. It reads `.ledger/` and git,
for free, to work out what is due: the survey, a rewrite into a new tone, the
client's text for the release, or a look at code nobody has read for work
nobody recorded. It covers only what changed since that task last ran, and
with nothing due it starts nothing. `ledger agent --plan` shows what it would
do.

## Install

```bash
npm install -g feature-ledger
```

Needs Node 18.17+, and Chrome or Chromium for the PDF.

## Get started

```bash
cd my-app
ledger init --product "Acme Portal"
ledger agent              # paste the prompt into your agent session
```

`init` creates `.ledger/` and tells your agent about it, in `CLAUDE.md` or
`AGENTS.md`. On an empty ledger, `ledger agent` prints the survey
(`ledger bootstrap`): a prompt for your agent to read the codebase and write an
entry per capability, with how to see each one. Add `--copy` to
put the prompt on the clipboard, or `--run claude` to hand it to an agent
directly (`codex`, `gemini`, or any command that reads a prompt on stdin work
too). Set `"agent": "claude"` in `.ledger/config.json` and `ledger agent` hands
it over on its own.

Then read it with `ledger preview`, and fix whatever doesn't sound like you:
the words live in `.ledger/features/<id>.json` and are yours to edit. Commit,
and `ledger cut --name "Baseline"` prints the first edition.

## Day to day

Mostly nothing to do. Your agent records each change as two facts as it
works, what moved and why:

```bash
ledger change delivery-windows <<'JSON'
{ "what": "Delivery windows can be booked 28 days ahead instead of 14.",
  "why": "Wholesale customers plan their orders a month out." }
JSON
```

Nobody writes the client's "What changed" notes as they go: those are written
once, for the whole release, by `ledger prepare`. Whenever you want to see
where the release stands, `ledger preview` prints a readout and the draft:

```
v6 so far, against v5 (September 12, 2026):
  new         2   1 Big · 1 Small
  updated     4   1 Big · 3 Medium        7 changes recorded, 3 since the last prepare
  removed     1   Small
  code            1,240 lines changed since v5's commit, working tree included
```

Where nothing is prepared yet, the draft shows the changes as they were
recorded, so the size and content of the latest work is always visible, for
nothing.

## Showing it to the client

```bash
ledger agent              # prepares the edition: in your agent session, with you there
ledger cut --name "Sprint 6 demo"
```

When changes are recorded that nobody has prepared, `ledger agent` runs
`ledger prepare`, and before it, at a terminal, asks you for the reasons nobody
gave, for free. `prepare` is one interactive session that writes everything the client reads:
an overview of the release, a one-sentence note on each change, the summary
list, how to see each new or updated capability, and the message to send, all
in plain language for someone who has never seen the code. In the same session it reads the
code since the last edition for work nobody recorded, asks you the reasons
nobody gave, and checks what it wrote against the code, which is a good moment
to fix either. It doesn't commit: it ends with a list of what it changed. Run
again later in the release, it covers only what moved since.

`cut` refuses only an edition that would be wrong: nothing recorded, or a
redraft not yet checked. Everything else it says before it asks to go ahead:

```
Before v6 is cut:
  ! 2 changes recorded since the last prepare (October 3, 2026), on pick-list, saved-baskets
    → ledger prepare
  ! 1 reason nobody has vouched for (1 unknown: pick-list)
    → ledger prepare asks you about them
Cut v6 and print its edition anyway? [y/N]
```

It prints `docs/client/…_6.pdf` and `…_6-message.txt` beside it.

Upgrading from an earlier version? `ledger migrate` brings the ledger over and
keeps every edition already handed over exactly as it printed.

## Learn more

- **[Workflows](docs/workflow.md)**: every step, from setup to reprinting an
  old edition.
- **[Preview, prepare, cut](docs/releasing.md)**: what each does, what the cut
  says, reasons nobody gave, and starting over with a redraft.
- **[Editing by hand](docs/editing.md)**: what's yours to change, and what stays
  with the CLI.
- **[Coding agents](docs/agents.md)**: the stanza, `--run`, resuming sessions,
  Claude Code permissions.
- **[The documents](docs/documents.md)**: the edition's layout, where files go,
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
