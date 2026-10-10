# Coding agents

The ledger is agent-agnostic: the rules live in one file every agent can read,
and every operation is a CLI command. Two things connect it to an agent:

1. **A stanza** in the agent's instruction file, so it records features as it
   builds them.
2. **Agent tasks** — `bootstrap`, `audit`, `review`, `redraft check` and
   `style rewrite` — which prepare a prompt for an agent to work through.

## Delivering an agent task

Every agent task delivers its prompt the same four ways:

| | |
| --- | --- |
| *(default)* | An explanation for you, then the prompt under a rule, to paste into a fresh agent session in the project root. |
| `--copy` | The prompt, straight onto the clipboard (`pbcopy`, `wl-copy`, `xclip` or `xsel`). |
| `--print` | The prompt alone, ready to pipe: `ledger review --print \| pbcopy`. Warnings still reach your screen, on stderr. |
| `--run AGENT` | The prompt handed to an agent, in the project root. The CLI waits for it, then reports. |

An agent that can run commands doesn't need any of this: tell it to run
`ledger review --print` and follow what it prints.

## `--run`

```bash
ledger audit --run claude
ledger review --run codex
ledger bootstrap --run gemini
ledger audit --run "my-agent --headless"      # any command that reads the prompt on stdin
```

**Nothing runs an agent unless `--run` is on the command line.** There is no
default. A bare `--run` uses `$LEDGER_AGENT`, or `"agent"` in
`.ledger/config.json`, and refuses when neither is set.

While it works, you see what the agent says and one dim line per tool it uses.
When it stops, you get:

```
── Claude Code finished · 11 turns · $0.40 ──

I've audited the range and recorded one new entry. …   ← its last message, which
                                                          often says what's left
✓ incremental audit recorded at d7e043f: 1 entry recorded (orders-csv-export)

Resume the session:  claude --resume 7744d0d3-482a-4ac2-9fd1-0e1580121146
```

- **The last message** is held back from the progress and shown here, because
  that's where an agent puts its questions and next steps.
- **The check** is the stamp the task is supposed to leave: an audit recorded, a
  review recorded, a redraft marked complete, a baseline cut. An agent that
  exits cleanly without it is reported with ✗, and the command exits with 3.
- **Refused tool calls** are listed, one line each, when the agent tried
  something it wasn't allowed to do.
- **The resume command** reopens the agent's session, so you can answer its
  questions or finish what it couldn't. Ctrl-C stops the agent, and you still
  get the resume command.

`ledger cut --name "…" --run claude` hands whichever of the audit and the
review is still open to the agent, one after the other, then shows you the
agent's notes and asks before it cuts. `--yes` cuts without asking.

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

The stanza is a **pointer**, not a copy: it says the ledger exists, that a
feature change isn't finished until the ledger records it, lists the commands,
draws the line between recording a change and rewording an entry, names the
project's tone, and tells the agent to run `ledger rules` before its first edit.
`ledger style set` rewrites it in every agent file, so it never names a tone
the project has left.

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
  `--no-verify`.
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

And because some writes are expensive to get wrong. `ledger add`, `update` and
`remove` resolve which release an edit belongs to — the fact every New/Changed
tag is computed from — and refuse the mistakes you'd find much later: a change
with no explanation, an audit stamp with no sweep behind it.

Neither is an argument about **wording**: once an entry exists, its prose is a
2 KB file you open and edit ([editing.md](editing.md)).
