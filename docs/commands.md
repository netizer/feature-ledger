# Command reference

This is `ledger help`, verbatim. `ledger <command> --help` prints one
command's part of it, and never runs the command: `ledger cut --help` never
cuts, and `ledger add x --help` never waits for a payload.

```
ledger — a client-facing record of what your product does, kept in the repo

  Preview is free, the agent costs tokens, cut prints.

    ledger                              where things stand, and the one thing to run next
    ledger preview [--html] [--open] [--full]
                                        the edition as it would print now, after a short readout.
                                        Free: no agent
    ledger agent [--plan] [--force]     whatever agent work is due, worked out from .ledger/ and git
                                        for free: the survey, a rewrite into a new tone, prepare, or
                                        a sweep of the code for work nobody recorded — only the part
                                        not done yet. Asks the missing reasons first, at a terminal.
                                        Nothing due, no agent. --plan shows it; --force sweeps even
                                        a small change. Spends tokens
    ledger prepare [--full]             one interactive agent session that writes the client's text:
                                        the overview, the "What changed" notes, the summary and how
                                        to see each entry, and checks it against the code. After the
                                        first, only what moved since the last; --full for all of it
    ledger prepare complete             check what it wrote, and record what it was written from
    ledger cut --name "..." [--date YYYY-MM-DD] [--commit SHA] [--full] [--yes] [--no-pdf] [--html]
                                        print the edition into the client directory, and open
                                        the next release. Refuses only an edition that would be wrong;
                                        anything else it shows you and asks first (--yes, unattended)

  Recording, while you build (the agent stanza does this; payload as JSON on stdin, or --file f.json)
    ledger add <id>                     { audience, size, name, description, how_to_see?, category?, dev_notes? }
    ledger change <id>                  { what, why, description?, name?, how_to_see? }   something moved
                                        --why-from commit   the reason was read off a commit message
                                        --why-unknown       nobody can say; prepare asks about it
                                        (size, category, dev_notes alone record nothing)
    ledger remove <id> --why "..."      a capability that's gone, and why
    ledger note --audience user --description "..."
                                        a change that belongs to no single feature
    ledger add/change/remove --backfilled            already in the product before the last
                                                     edition, only now on the record
    ledger categories [list | add "Name" [--after "Other"] [--intro "..."] | rename "Old" "New" | remove "Name"]
    ledger subcategories [list | add]   { id, category, name, intro }
    (add --dry-run to any of them to see what it would write)

  Reading (cheap; don't read .ledger/ by hand — it's big)
    ledger status [--json] [--quiet]    the release, what stands before its cut, the corpus, the setup
    ledger list [--category C] [--audience user|dev] [--size S] [--changed] [--json]
    ledger show <id> [--history | --at vN | --diff] [--json]
    ledger rules                        how to record, in full
    ledger style [show|list|set <id>]   the tone every entry is written in
    ledger export [--out FILE]          the whole corpus as one JSON document

  Once, or rarely
    ledger init [--product "Name"] [--accent "#hex"] [--logo path] [--agents auto|none|claude,agents,...]
                [--style google|govuk|plain-language|ste] [--commit-pdfs]
    ledger bootstrap                    agent task: survey the codebase and write the baseline, or carry
                                        on a survey that stopped partway
    ledger bootstrap complete           record that the survey finished
    ledger sweep                        agent task: read the code since it was last read, and record
                                        the work nobody recorded
    ledger sweep complete               record the code as read
    ledger migrate [--dry-run]          bring a ledger written by an earlier version over
    ledger build [v3 | all | draft] [--md] [--pdf] [--full] [--out DIR] [--html]
                                        reprint an edition, or write the Markdown docs
    ledger releases                     the timeline: every version, its date and its commit
    ledger releases amend <version> --commit SHA
    ledger redraft [start | check | complete --note "..."]
                                        write the corpus again from scratch, keeping the client's record
    ledger style rewrite [--category "Area"]
                                        agent task: bring the entries still in an earlier tone into
                                        the project's tone
    ledger style rewrite complete [--category "Area" | <id>...]
                                        record those entries as rewritten (no area or id: all of it)
    ledger completion zsh|bash|fish     shell completion; the script says how to load it

  Editing the words (no command — the corpus is yours to edit; run `ledger status` after)
    .ledger/features/<id>.json          a name, a description, how to see it, dev notes
    .ledger/compositions.json           the overview, a "What changed" note, a summary sentence
    .ledger/subcategories.json          sub-section headings and their overviews
    .ledger/config.json                 product name, tagline, document titles, area overviews
    .ledger/other-changes.json          the product-wide notes

  Delivering a prompt (agent, prepare, bootstrap, sweep, redraft check, style rewrite)
    (default)        an explanation for you, then the prompt to paste into your agent session
    --print          the prompt alone, ready to pipe: `ledger prepare --print | pbcopy`
    --copy           the prompt, straight onto the clipboard
    --run AGENT      hand it to claude, codex, gemini — or to "any command" that reads the prompt on
                     stdin — wait, check what it left behind, and print how to resume its session.
                     Only ever when you type it. A bare --run uses $LEDGER_AGENT, or "agent"
                     in .ledger/config.json — and so does `ledger agent` with no option at all

  Global: --dir PATH (point at a .ledger directory), --json where offered, --help after any
          command. An option a command doesn't take is an error, and nothing is run.
  Exit codes: 0 done · 1 error · 2 a mistake in the command line · 3 refused
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
| `ledger update <id>` with `changes` | `ledger change <id>` with `what` and `why` (each old bullet becomes one event) |
| `ledger remove --reason` | `ledger remove --why` |
| `--reason-inferred` | `--why-from commit` |
| `--prompt-only` | `--print` |
| `ledger build --version N` | `ledger build vN` |
| `"paths"` in an `add` or `change` payload | dropped, with a note: the ledger no longer maps code to entries |

These are retired, and each says where its job went:

| Retired | Now |
| --- | --- |
| `ledger audit`, `compose`, `summary`, `review`, `verify` | `ledger prepare` |
| `ledger questions` | bare `ledger` lists the reasons nobody gave; `ledger prepare` asks them |
| `ledger own`, `ledger paths` | nothing: the ledger no longer maps code to entries |
| `ledger diff` | `ledger preview`, which opens with the readout |
| `ledger cut --skip`, `--force`, `--run` | the cut warns and asks; `--yes` answers when nobody is at a terminal |
| `ledger preview --run`, `--size` | the readout always prints; `ledger prepare` is the only step that spends tokens |

A ledger written by an earlier version refuses to load until `ledger migrate`
brings it over.

A mistyped command or option is refused before anything runs, with the nearest
match suggested (`ledger amend` → `ledger releases amend`).

## Exit codes

| | |
| --- | --- |
| 0 | done |
| 1 | an error: a broken corpus, a missing browser, an agent that crashed |
| 2 | a mistake in the command line: an unknown command or option, a missing argument |
| 3 | refused: a cut whose edition would be wrong, or that nobody confirmed; an agent that finished without leaving what its task asks for |

## Shell completion

```bash
source <(ledger completion zsh)        # in ~/.zshrc
eval "$(ledger completion bash)"       # in ~/.bashrc
ledger completion fish | source        # or save it in ~/.config/fish/completions/ledger.fish
```

Completion covers commands, subcommands, options, feature ids (for `show`,
`change`, `update` and `remove`), editions (for `build`) and agents (after
`--run`).

## Colour

Reports and errors use colour when the output is a terminal. Set `NO_COLOR`
to turn it off; pipes and agents always get plain text.
