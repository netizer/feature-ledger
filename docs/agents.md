# Coding agents

The ledger is agent-agnostic: the instructions live in a short stanza every
agent can read, and every operation is a CLI command. Two things connect it to
an agent:

1. **A stanza** in the agent's instruction file, so it records facts as it
   builds, and never commits for you.
2. **Agent tasks** — `bootstrap`, `redraft check`, `style rewrite`, `prepare`
   and `sweep` — which print a prompt for an agent to work through, and
   `ledger agent`, which works out which of them is due.

**Agents never run unless you ask.** No command starts one on its own:
`preview`, `cut` and `build` never do. An agent task hands its prompt to an
agent only when `--run` is on the command line, and `ledger agent` only when
you type it with an agent configured.

## `ledger agent` — the one command for agent work

You don't need to remember which task is due. `ledger agent` reads `.ledger/`
and git, with no agent and no tokens, and picks the first that applies:

| What it finds | What it runs |
| --- | --- |
| an empty corpus | `bootstrap`, the survey |
| entries, but no finished survey and no edition yet | nothing: it **stops** and asks you (below) |
| a redraft not yet checked | `redraft check` |
| entries in a tone the project has since left | `style rewrite`, of those entries only |
| changes `prepare` hasn't read | `prepare`, of only what moved since the last one |
| enough code nobody has read since | `sweep`, of only that code |
| none of these | **nothing**: no agent starts, exit 0 |

```
ledger agent — prepare: only what moved since the last prepare (October 12, 2026)
  moved: delivery-windows, saved-baskets, pick-scan
  412 lines in 9 files since a1b2c3d (the last prepare)
```

**How it knows.** Every decision comes from a record the CLI wrote when a task
finished, never from the text, so a task that is done is never sent round
again. Prepare's record is the stamp `ledger prepare complete` writes. The
rest is in `.ledger/state.json`, which only exists once there is something in
it:

- **The tone each entry was written in.** `ledger style set` records the old
  tone against every entry before it switches. An entry added, or given a new
  description, afterwards is in the new tone. `ledger style rewrite complete
  --category "<area>"` marks an area done as the rewrite finishes it. A
  rewrite that stops halfway carries on from the areas that are left. A
  hand-edit records nothing: rewording a sentence doesn't change its tone.
  Change the tone with `ledger style set`, not by editing `config.json`, or
  nothing records that the old entries are in the old one.
- **The code last read.** `ledger sweep complete` and `ledger prepare complete`
  record HEAD, and each uncommitted file as it was read. The next sweep starts
  from the latest of that, the last prepare, the survey and the last edition's
  commit, and leaves out any file that still holds exactly what was read.
- **The survey.** `ledger bootstrap complete` records that it finished. A survey
  that stopped partway leaves entries but no record, and the next
  `ledger bootstrap` carries on from those entries instead of starting again.

**How much.** Each task covers only what isn't done: the entries still in the
old tone, the entries that moved since the last prepare, the code since it was
last read. A sweep starts only for 20 lines or more outside tests, docs,
lockfiles and CI configuration; below that it says how much there is, and
`ledger agent --force` sweeps it anyway. When `prepare` is due, it reads the
code too, so no separate sweep is offered.

**What it asks you instead.** At a terminal, before anything spends tokens, it
asks each reason nobody has given, one at a time, and records your answer as
yours. Enter skips one, `q` skips the rest. A reason given after a release was
prepared sends that entry back to `prepare`, since its note was written without
it. And where the records can't settle what is due, it stops and says so
instead of paying an agent to guess. A corpus with entries, no finished survey
and no edition is either a survey that stopped partway (`ledger bootstrap`
carries it on) or a baseline you wrote yourself (`ledger bootstrap complete`
says so). Only you know which.

**One task per run.** Each task has its own check afterwards (below), and the
next `ledger agent` picks up the next one. `--plan` shows what it would run,
how much of it, and what comes after, and runs nothing.

**How it delivers.** Like any task: `--print`, `--copy` or `--run AGENT`. With
none of them, it hands the task to `$LEDGER_AGENT` or `"agent"` in
`.ledger/config.json` when one is set, because typing `ledger agent` is asking
for agent work, and otherwise prints the prompt to paste. `prepare` asks you
things, so it is best pasted into your own session even when an agent is
configured: `ledger agent --copy`.

It never runs `init`, `migrate`, `redraft start`, `style set` or `cut`: each
of those is a decision, not agent work. It names them when they're next.

## Delivering an agent task

Every agent task, `ledger agent` included, delivers its prompt the same four ways:

| | |
| --- | --- |
| *(default)* | An explanation for you, then the prompt under a rule, to paste into your agent session in the project root. |
| `--copy` | The prompt, straight onto the clipboard (`pbcopy`, `wl-copy`, `xclip` or `xsel`). |
| `--print` | The prompt alone, ready to pipe: `ledger prepare --print \| pbcopy`. Warnings still reach your screen, on stderr. |
| `--run AGENT` | The prompt handed to an agent, in the project root. The CLI waits for it, then reports. |

`ledger prepare` is meant for your own interactive session, because it asks
you things: the reasons nobody recorded, and what to do where the text and the
code disagree. An agent that can run commands can also be told to run
`ledger prepare --print` and follow what it prints.

## `--run`

```bash
ledger prepare --run claude
ledger bootstrap --run gemini
ledger prepare --run "my-agent --headless"      # any command that reads the prompt on stdin
```

There is no default agent. A bare `--run` uses `$LEDGER_AGENT`, or `"agent"` in
`.ledger/config.json`, and refuses when neither is set.

A headless agent has nobody to ask, so where the prompt says to ask the
developer, it leaves that thing as it is and puts the question in its last
message.

While it works, you see what the agent says and one dim line per tool it uses.
When it stops, you get:

```
── Claude Code finished · 11 turns · $0.40 ──

I've written the notes and the summary. Two reasons nobody recorded: …   ← its last message, which
                                                                            often says what's left
✓ prepared (October 12, 2026), and nothing recorded since
✓ 2 reasons still not vouched for — `ledger` lists them

Resume the session:  claude --resume 7744d0d3-482a-4ac2-9fd1-0e1580121146
```

- **The last message** is held back from the progress and shown here, because
  that's where an agent puts its questions and next steps.
- **The check** is what the task is supposed to leave behind: a release
  prepared, a redraft marked complete, a survey or a tone rewrite marked
  finished, the code marked as read. An agent that exits
  cleanly without it is reported with ✗, and the command exits with 3.
- **Refused tool calls** are listed, one line each, when the agent tried
  something it wasn't allowed to do.
- **The resume command** reopens the agent's session, so you can answer its
  questions or finish what it couldn't. Ctrl-C stops the agent, and you still
  get the resume command.

### The agents it knows

Each one lives in its own file under [`src/agents/`](../src/agents): the command
that runs it headless, a parser for its event stream, and how to resume its
session. Adding an agent is adding a file there.

| | Runs | Allowed to | Resume |
| --- | --- | --- | --- |
| `claude` | `claude -p --output-format stream-json` | run `ledger` and read-only `git`, read and edit files; anything else is refused | `claude --resume <id>` |
| `codex` | `codex exec --json --sandbox workspace-write -` | run commands and edit files inside the project | `codex resume <id>` |
| `gemini` | `gemini --output-format stream-json --approval-mode auto_edit` | edit files; run `ledger` and `git` | `gemini --resume <id>` |
| anything else | the command, through the shell, with the prompt on stdin | whatever that agent allows | the agent's own |

The `claude` and `codex` adapters are tested against the real CLIs. The
`gemini` adapter follows Gemini CLI's documented headless mode and hasn't been
run against a live install yet.

## Wiring the stanza

`ledger init` appends a short stanza to whichever agent instruction files the
project already has — `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursor/rules/`,
`.github/copilot-instructions.md`, `.windsurfrules` — or creates `AGENTS.md` if
there are none:

```bash
ledger init --agents claude,cursor      # only these
ledger init --agents none               # wire nothing
```

The stanza says the ledger exists, that a feature change isn't finished until
the ledger records it, and lists the commands. It tells the agent to record
facts — what moved, in a sentence a client could read, and why, never invented
— with how to see it when it knows; draws the line between recording a change
and rewording an entry; names the project's tone; and says not to commit, and
not to run `prepare` or `cut` unless asked. `ledger style set` and
`ledger migrate` rewrite it in every agent file, so it never describes a tool
the project has moved off.

If you run the CLI through a wrapper (`./tools/ledger`), edit the stanza's
commands to match: the agent uses exactly what's written there.

## Claude Code specifically

**Stop the permission prompts.** Add to `.claude/settings.json`:

```json
{
  "permissions": {
    "allow": ["Bash(ledger:*)", "Bash(npx ledger:*)", "Bash(npx feature-ledger:*)", "Bash(./tools/ledger:*)"]
  }
}
```

Without this, every `ledger add` asks for approval, and an agent interrupted
mid-survey tends to give up on the tool.

### Make it happen without being asked

Weakest to strongest:

- **The stanza alone.** Usually enough for a session that's already doing
  feature work.
- **A pre-commit gate.** `ledger status --quiet || exit 1` prints nothing when
  the corpus is sound and skips the browser probe, so it costs nothing on a
  normal commit. It catches a corpus that's broken, not one that's out of date.
  For out-of-date, print a reminder when a commit touches source but nothing
  under `.ledger/`, and let it through: a hard block trains people to use
  `--no-verify`. `ledger prepare` reads the code since the last edition anyway.
- **A Stop hook** that reminds Claude to check the ledger when it finishes a
  turn. Use it only if the first two aren't landing; a hook that fires every
  turn becomes noise.

**Keep the generated docs out of context.** They're gitignored build output.
Point the agent at `ledger list` and `ledger show` instead: the same information
at a fraction of the cost.

## Why a CLI instead of "just edit the JSON"

Because the corpus grows past what's cheap to **read**. A mature ledger is 100+
features and 150–200 KB, around 45,000 tokens. With the CLI, the same lookup is
`ledger list` (about 2k tokens) plus `ledger show <id>` (about 250).

And because some writes are expensive to get wrong. `ledger add`, `change` and
`remove` resolve which release an edit belongs to — the fact every New/Changed
tag is computed from — and refuse the mistakes you'd find much later: a change
with no explanation, a removal with no reason.

Neither is an argument about **wording**: once an entry exists, its prose is a
2 KB file you open and edit ([editing.md](editing.md)).
