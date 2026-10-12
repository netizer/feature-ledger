# Command reference

This is `ledger help`, verbatim. `ledger <command> --help` prints one
command's part of it, and never runs the command: `ledger cut --help` never
cuts, and `ledger add x --help` never waits for a payload.

```
ledger — a client-facing record of what your product does, kept in the repo

  Where you are
    ledger                              what's open, whether it's ready to cut, the next command
    ledger status [--json] [--quiet]    the release, the corpus and the setup, all checked
    ledger diff [--since vN|last] [--full] [--json]
                                        the size of the open release: entries by kind and size,
                                        and the code that moved under each, from the ledger and git
    ledger questions [--all]            what only you can answer: reasons nobody vouched for,
                                        and what a check doubted
    ledger questions answer <n> "..." | accept <n> | dismiss <n> | add <id> "..."

  Reading (cheap; don't read .ledger/ by hand — it's big)
    ledger list [--category C] [--audience user|dev] [--size S] [--changed] [--json]
    ledger show <id> [--history | --at vN | --diff] [--json]
    ledger paths [--unowned] [--json]   which code each entry lives in, and what no entry owns
    ledger rules                        the authoring rules, in full
    ledger style [show|list|set <id>]   the tone every entry is written in
    ledger export [--out FILE]          the whole corpus as one JSON document

  Recording (payload as JSON on stdin, or --file f.json; add --dry-run to preview)
    ledger add <id>                     { audience, size, name, description, paths[], category?, dev_notes? }
    ledger change <id>                  { what, why, description?, name? }   something about it moved
                                        --why-from commit   the reason was read off a commit message
                                        --why-unknown       nobody can say; asked as a question
                                        (size, category, paths, dev_notes alone record nothing)
    ledger remove <id> --why "..."
    ledger note --audience user --description "..."
                                        a change that belongs to no single feature
    ledger own <id> <glob...> [--remove]   which code an entry lives in
    ledger own --ignore <glob...>       files that aren't product code: tests, fixtures, CI
    ledger categories [list | add "Name" [--after "Other"] | rename "Old" "New" | remove "Name"]
    ledger subcategories [list | add]   { id, category, name, intro }
    ledger add/change/remove --backfilled            the product didn't move this cycle,
                                                     the record did — see `ledger audit`

  Releasing
    ledger preview [--size] [--open] [--run AGENT]
                                        the size readout, then the open release as a draft PDF.
                                        --run composes first, only if anything moved since
    ledger cut --name "..." [--date YYYY-MM-DD] [--commit SHA] [--skip CHECKS] [--no-pdf] [--run AGENT]
                                        runs every check, asks the open questions, prints the
                                        edition into the client directory, and opens the next
                                        release. --run hands an open audit, composition or verify
                                        to an agent first, then asks before cutting (--yes doesn't)
    ledger build [v3 | all | draft] [--md] [--pdf] [--out DIR] [--html] [--run AGENT]
                                        the Markdown docs, every cut edition not yet printed, and
                                        the draft of the open release; or just the one named
    ledger releases                     the timeline: every version, its date and its commit
    ledger releases amend <version> --commit SHA
                                        fill in the commit on a release cut before they were recorded

  Agent tasks (each prints a prompt for a coding agent; delivery options below)
    ledger bootstrap [--no-audit]       survey the codebase and write the baseline
    ledger audit [--full] [--since SHA] find what shipped without the ledger hearing about it:
                                        code that moved under an entry that didn't, and code
                                        no entry owns, with the diffs
    ledger audit complete [--commit SHA]    stamp the audited commit (default: HEAD)
    ledger audit log [--json]           every audit so far
    ledger compose                      write the "What changed" notes and the summary the
                                        edition opens with, from the last edition, now, and
                                        what was recorded between. Reads no code
    ledger compose complete             check it accounts for every entry, and stamp it
    ledger verify                       check what the edition says against the code; files
                                        what it doubts as questions. Opt-in for the cut
    ledger verify complete              stamp what was checked
    ledger paths brief                  say which code every entry lives in
    ledger style rewrite                bring every entry into the project's tone

  Redrafting (writing the corpus again from scratch, keeping the client's record)
    ledger redraft                      where a redraft stands, and the next step
    ledger redraft start [--force]      archive the corpus in .ledger/archive/, open the next version empty
    ledger redraft check                agent task: check the new corpus against the old one
    ledger redraft complete [--note "..."]  stamp the check, with the note the client reads

  Setup
    ledger init [--product "Name"] [--accent "#hex"] [--logo path] [--agents auto|none|claude,agents,...]
                [--style google|govuk|plain-language|ste] [--commit-pdfs]
    ledger migrate [--run AGENT]        bring a ledger written by an earlier version over; --run
                                        then has an agent say which code each entry lives in
    ledger completion zsh|bash|fish     shell completion; the script says how to load it

  Editing the words (no command — the corpus is yours to edit)
    .ledger/features/<id>.json          a name, a description, dev notes. Edit in place, then
                                        run `ledger status`.
    .ledger/compositions.json           a "What changed" note, a summary item
    .ledger/subcategories.json          sub-section headings and their overviews
    .ledger/config.json                 product name, tagline, document titles, ignore
    .ledger/other-changes.json          the product-wide notes

  Delivering a prompt (bootstrap, audit, compose, verify, paths brief, redraft check, style rewrite)
    (default)        an explanation for you, then the prompt to paste into a fresh agent session
    --print          the prompt alone, ready to pipe: `ledger compose --print | pbcopy`
    --copy           the prompt, straight onto the clipboard
    --run AGENT      hand it to claude, codex, gemini — or to "any command" that reads the prompt on
                     stdin — wait, check what it recorded, and print how to resume its session.
                     Only ever when you pass it. A bare --run uses $LEDGER_AGENT, or "agent"
                     in .ledger/config.json

  Global: --dir PATH (point at a .ledger directory), --json where offered, --help after any
          command. An option a command doesn't take is an error, and nothing is run.
  Exit codes: 0 done · 1 error · 2 a mistake in the command line · 3 a check said no
  Guides: the docs/ directory of this package, starting from its README.
```

## Finding the ledger

Every command takes `--dir PATH` to point at a `.ledger` directory elsewhere;
otherwise it's found by walking up from the working directory. `$LEDGER_DIR`
does the same thing.

## Old names

These still work, and say on stderr what they're called now:

| Old | New |
| --- | --- |
| `ledger release cut` | `ledger cut` |
| `ledger release list` | `ledger releases` |
| `ledger release amend` | `ledger releases amend` |
| `ledger other-change` | `ledger note` |
| `ledger subcategory` | `ledger subcategories` |
| `ledger update <id>` with `changes` | `ledger change <id>` with `what` and `why` (the old payload is turned into events) |
| `ledger remove --reason` | `ledger remove --why` |
| `--reason-inferred` | `--why-from commit` |
| `ledger summary` | `ledger compose` |
| `ledger audit confirm <id>` | `ledger questions accept <n>` |
| `--skip summary,review` | `--skip compose,verify` |
| `--prompt-only` | `--print` |
| `ledger build --version N` | `ledger build vN` |

`ledger review` is retired: it says that `ledger compose` and `ledger verify`
replaced it. A ledger written by an earlier version refuses to load until
`ledger migrate` brings it over.

A mistyped command or option is refused before anything runs, with the nearest
match suggested (`ledger amend` → `ledger releases amend`).

## Exit codes

| | |
| --- | --- |
| 0 | done |
| 1 | an error: a broken corpus, a missing browser, an agent that crashed |
| 2 | a mistake in the command line: an unknown command or option, a missing argument |
| 3 | a check said no: a refused `ledger cut`, or an agent that finished without leaving the stamp its task asks for |

## Shell completion

```bash
source <(ledger completion zsh)        # in ~/.zshrc
eval "$(ledger completion bash)"       # in ~/.bashrc
ledger completion fish | source        # or save it in ~/.config/fish/completions/ledger.fish
```

Completion covers commands, subcommands, options, feature ids (for `show`,
`change`, `remove`, `own` and `audit confirm`), open question numbers (for
`questions answer|accept|dismiss`), editions (for `build`), agents (after
`--run`) and check names (after `--skip`).

## Colour

Checklists and errors use colour when the output is a terminal. Set `NO_COLOR`
to turn it off; pipes and agents always get plain text.
