# feature-ledger

A versioned, client-facing record of what a product does — kept as a small
JSON corpus in the repo, and generated into three Markdown docs for the team
and one archival PDF edition per release for the client.

It exists because the useful version of "what does this software do" is not a
changelog and not a commit log. It's a list of capabilities, sized so the big
ones stand out, where each release highlights only what actually moved and
says **why** it moved. That document is worth reading. A diff isn't.

Language-agnostic (the corpus is JSON in a directory; the host project can be
Python, Go, Rails, anything) and coding-agent-agnostic (the authoring rules
live in one file every agent can read, and every operation is a CLI command).

<img width="0" alt=""> <!-- keeps the table below off the heading -->

|  |  |
| --- | --- |
| **Corpus** | `.ledger/` — one JSON file per feature, plus the release timeline. Committed. |
| **Generated** | `FEATURES.md`, `FEATURES_EXTENDED.md`, `DEV_FEATURES.md`, and a PDF per release. Gitignored build output. |
| **Interface** | `ledger` — read, write, check, build. Nothing hand-edits the JSON. |

---

## Why a CLI instead of "just edit the JSON"

Because the corpus grows past what's cheap to read. A mature ledger is 100+
features and 150–200 KB — around 45,000 tokens. An agent that opens it to
change one description pays that on every edit, and re-emits a large chunk of
it, and sometimes reformats the rest.

With the CLI, the same edit is `ledger list` (~2k tokens, and only if it
doesn't already know the id) plus `ledger show <id>` (~250) plus the new
prose. That's the whole design brief: **the agent never reads the corpus and
never writes JSON by hand.**

Everything else follows from that. The CLI owns file formatting (so diffs stay
small), resolves which release an edit belongs to, and refuses the mistakes
that are expensive to find later — a changed feature with no explanation, a
sub-section with two features in it, an accent colour that collides with the
"this changed" highlight.

---

## Install

Needs Node 18.17+. The PDF needs a Chromium: Google Chrome or Edge if you have
one (used automatically), otherwise `npx playwright install chromium`.

### From npm

```bash
npx feature-ledger init          # or: npm install -g feature-ledger
```

### From a local checkout — no registry, no remote

This is the normal case while the tool is still yours. Pick one:

**Globally linked (recommended — edits to the source are live everywhere):**

```bash
cd ~/dev/feature-ledger
npm install
npm link                 # puts `ledger` on your PATH, symlinked to this checkout
```

Now `ledger` works in any project, in any language. `npm unlink -g
feature-ledger` undoes it.

**As a dependency of a JS project (pins the copy, survives a `git clone`):**

```bash
cd ~/dev/my-app
npm install --save-dev file:../feature-ledger
npx ledger --help
```

**As a tarball (pins an exact build — good for CI):**

```bash
cd ~/dev/feature-ledger && npm pack        # → feature-ledger-0.1.0.tgz
npm install -g ~/dev/feature-ledger/feature-ledger-0.1.0.tgz
```

**Without installing anything at all** — every command works when invoked by
path, which is handy for a one-off or a container:

```bash
node ~/dev/feature-ledger/bin/ledger.mjs list
```

### In a project with no `package.json` (Python, Go, Rust…)

`npm link` above already covers you — `ledger` is on your PATH and doesn't
care what the project is written in. If you'd rather not depend on a global,
commit a two-line wrapper so the whole team (and every agent) gets the same
entry point:

```bash
# tools/ledger  — chmod +x, committed
#!/usr/bin/env bash
exec node "${LEDGER_HOME:-$HOME/dev/feature-ledger}/bin/ledger.mjs" "$@"
```

Then it's `./tools/ledger list`, and `LEDGER_HOME` lets anyone point at their
own checkout. Whichever form you choose, use the same one in the agent
instructions (below), so the agent's commands always work.

---

## Getting started in an existing project

```bash
cd ~/dev/my-python-app
ledger init --product "Acme Portal"
```

That creates `.ledger/`, points your agent files at it, and adds the generated
docs directory to `.gitignore`. Then:

```bash
ledger bootstrap        # prints a survey prompt — paste it into your coding agent
```

The survey is agent work: only something that can read the codebase can say
what it does. The prompt has the agent propose the category list first (and
wait for you to confirm it), then work through one category at a time, adding
a feature per capability with `ledger add`, stopping between batches. Attempted
in one pass it runs out of context and starts inventing; in batches it's
reliable.

When it's done:

```bash
ledger check
ledger release cut --name "Baseline" --date 2026-03-02   # when work on it started
ledger build
```

### The baseline reads as an inventory, not as your work

Two things make that true, and both are already the default:

- **Voice.** The rules require every description to be a present-tense
  statement of what the product does — "A guest can book without an account",
  never "added", "we now support", "improved". A reader can't tell from the
  wording whether something shipped last week or three years ago. The
  bootstrap prompt says this twice, because it's the thing an agent drifts
  away from first.
- **No flags on version 1.** New/Changed highlighting is computed against a
  release's predecessor, and version 1 hasn't got one. So the first edition
  prints as a plain catalogue with nothing marked as new. From version 2 on,
  each edition highlights only what actually moved.

---

## Day-to-day

A feature ships, so the ledger records it:

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

Something existing changes:

```bash
ledger update delivery-windows <<'JSON'
{
  "description": "The full current-state text, rewritten. Not a diff.",
  "changes": [
    "The booking horizon went from fourteen days to twenty-eight. Fourteen covered the weekly shop but not the customers who plan a month ahead around a delivery, and those are the orders least likely to be cancelled — so the longer horizon costs nothing to offer and holds the more valuable bookings."
  ]
}
JSON
```

`changes` is the rule that makes the ledger worth reading: each bullet says
what it was before **and why it moved**. The description already shows what it
is now; the reason is the part only you know. The CLI refuses an update to a
pre-existing feature that doesn't have one — which is deliberate, and is the
single most valuable thing it does.

When you present to the client:

```bash
ledger release cut --name "Sprint 6 demo" --date 2026-09-14
ledger build
```

That mints the archival PDF for what was just shown, and opens the next
release. Every New/Changed tag from the cycle goes quiet on its own; there's
nothing to strip by hand.

Run `ledger rules` for the full authoring rules — sizing, the `user`/`dev`
bar, sub-sections, removals, and what *isn't* worth a feature entry.

---

## Wiring it into a coding agent

### Any agent

`ledger init` appends a short stanza to whichever agent instruction files the
project already has — `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`,
`.cursor/rules/`, `.github/copilot-instructions.md`, `.windsurfrules` — or
creates `AGENTS.md` if there are none. Control it with `--agents`:

```bash
ledger init --agents claude,cursor      # only these
ledger init --agents none               # wire nothing
```

The stanza is a **pointer**, not a copy: it says the ledger exists, that a
feature change isn't finished until the ledger records it, lists the six
commands, and tells the agent to run `ledger rules` before its first edit.
One source of truth, cheap in every session, and the full text is only pulled
when an edit is actually happening.

If you use the `tools/ledger` wrapper instead of a global install, edit the
stanza's commands to match — the agent will use exactly what's written there.

### Claude Code specifically

**1. Make it aware.** `ledger init` (or `ledger init --agents claude`) writes
the stanza into `CLAUDE.md`. That's the whole of "make Claude aware of it" —
`CLAUDE.md` is loaded into every session in that repo.

**2. Stop the permission prompts.** Add to `.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "Bash(ledger:*)",
      "Bash(npx ledger:*)",
      "Bash(./tools/ledger:*)"
    ]
  }
}
```

Without this, every `ledger add` asks for approval, and an agent that gets
interrupted mid-survey tends to give up on the tool. (`/permissions` in the
session does the same thing interactively.)

**3. Make it happen without being asked.** Three options, weakest to
strongest:

- *The `CLAUDE.md` stanza alone.* Usually enough for a session that's already
  doing feature work. It's what the stanza's first line is for: "A change that
  ships a feature isn't finished until the ledger records it."

- *A pre-commit gate.* The blunt, reliable one:

  ```bash
  # .git/hooks/pre-commit  — or via husky/lefthook/pre-commit
  #!/usr/bin/env bash
  ledger check || exit 1
  ```

  This catches a corpus that's been broken, not one that's out of date. For
  out-of-date, add a soft check: if the commit touches source files but
  nothing under `.ledger/`, print a reminder and let it through (`exit 0`) —
  a hard block here trains people to use `--no-verify` for everything.

- *A Claude Code Stop hook.* Fires when Claude finishes a turn, and can inject
  a reminder to check the ledger. Use this only if the first two aren't
  landing; a hook that fires on every turn becomes noise the model learns to
  skim.

**4. Keep it out of context the rest of the time.** The generated docs are
gitignored build output — don't commit them and don't point `CLAUDE.md` at
them. `FEATURES_EXTENDED.md` is genuinely useful for a human reading in, but
an agent should reach for `ledger list` / `ledger show` instead, which is the
same information at a fraction of the cost.

---

## Branding it for a new client

`.ledger/brand.json` is the swap surface:

```json
{
  "name": "Acme Portal",
  "logo": "public/logo.png",
  "logo_height": 32,
  "accent": "#b4531f"
}
```

- **`logo`** — a path relative to the project root; PNG, JPG, SVG or WebP,
  embedded into the PDF as a data URI so a finished file depends on nothing.
  Leave it out and the front page uses the product name as a serif wordmark,
  which is a real masthead, not a placeholder — a new client gets a
  presentable ledger before anyone has found their asset files.
- **`accent`** — give it one hex and the other four tints of the family are
  derived from it. Pin any of them (`accent_deep`, `accent_quiet`,
  `accent_mid`, `accent_pale`) when a brand guide insists.

  One constraint: **the accent may not be green, blue or teal.** Those two
  hues carry meaning in every edition — green is "new", blue is "reworked" —
  and an accent in that range makes an unchanged row read as a changed one.
  `ledger check` warns when a brand picks one that collides.

- **`.ledger/theme.css`** — appended last to the PDF's stylesheet, for a
  one-off nudge that isn't worth a fork.

Wording — the doc titles, the intro paragraphs, the colophon — is overridable
per project in `.ledger/config.json` under `docs`. The defaults are built from
`product` and the optional one-line `tagline`.

`ledger doctor` shows the whole resolved setup: derived palette, masthead,
fonts, and which browser will print.

---

## How the model works

**A feature is its history.** A version only appears in a feature's history
when something about it actually changed; absent versions mean "still whatever
the last entry said". That's what makes "what did this look like at version
N?" answerable, and it's why an old release's PDF still reproduces exactly
what was presented then.

**Two audiences.** `user` features are what the client sees. `dev` features
are what only the team cares about — and `dev_notes` on a user feature is
implementation detail attached to a client-facing capability. The three
Markdown docs are those three combinations.

**Three sizes.** Big (a standalone capability), Medium (a meaningful piece of
a bigger area), Small (a specific behaviour or guardrail). They order every
section — a category can't bury its Big behind six Smalls just because that's
the order things got written down in.

**Two highlight semantics, on purpose.** The living Markdown docs tag New and
Changed only while the target release is still in progress, so a shipped
release's docs read as a clean present-tense list. The archival PDF always
diffs against its own predecessor, however old, because its whole job is
reproducing what was in front of the client that day.

**Sub-sections** sit between a category and a feature, for an area that grew
big enough to read as a wall. At least four features, and no `Big` among them
— the heading and its intro *are* the overview. When a whole sub-section
arrives in one release it's flagged once, as one green card, rather than as a
column of identical "New"s that says nothing.

---

## Commands

```
Reading
  ledger list [--category C] [--audience user|dev] [--size S] [--changed] [--json]
  ledger show <id> [--history] [--json]
  ledger status [--json]              what this in-progress release has so far
  ledger rules                        the authoring rules, in full
  ledger export [--out FILE]          the whole corpus as one JSON document

Writing            (JSON payload on stdin or --file; --dry-run previews)
  ledger add <id>
  ledger update <id>
  ledger rename <id> "New name" --why "…"
  ledger remove <id> --reason "…"
  ledger other-change --audience user --description "…"
  ledger categories [list | add "Name" [--after "Other" | --before "Other"]]
  ledger subcategory [list | add]

Releases
  ledger release list
  ledger release cut --name "…" [--date YYYY-MM-DD] [--force]

Output
  ledger check
  ledger build [--md] [--pdf] [--version N|all] [--out DIR] [--html]
  ledger doctor

Setup
  ledger init [--product "…"] [--accent "#hex"] [--logo PATH] [--agents …]
  ledger bootstrap
```

Every command takes `--dir PATH` to point at a `.ledger` directory
elsewhere; otherwise it's found by walking up from the working directory.
`$LEDGER_DIR` does the same thing.

`ledger build` prints the newest edition that has something in it. Straight
after `ledger release cut` that's the release you just cut, not the empty one
the cut opened — so the usual `cut && build` mints the edition for what was
just shipped. Once work is recorded against the open release, the default
moves on to it, and `--version N` prints any release by number, including an
empty one.

`ledger build --html` writes the ledger as HTML instead of printing it — the
fast loop when you're tuning `theme.css`.

---

## Layout of `.ledger/`

```
config.json          product, the category list (= reading order), wording overrides
brand.json           logo, accent, fonts
releases.json        the version timeline; the trailing "future" one is in progress
features/<id>.json   one feature, with its full history
index.json           the deliberate corpus order (ties within a size band)
subcategories.json   sub-section headings
other-changes.json   changes belonging to no single feature
theme.css            optional, appended last to the PDF stylesheet
```

One file per feature is a deliberate change from the single-file original: a
2 KB file is what an agent edits, git diffs stay readable, and two branches
adding features stop conflicting.

---

## Development

```bash
npm install
node test/smoke.mjs      # builds a project from nothing, exercises every guardrail
```

`examples/northwind/` is a small worked corpus — two releases, a change, a
rename, a removal, a global change and a sub-section. `cd examples/northwind
&& ledger build --version all` prints both editions.

Fonts: see `assets/fonts/README.md`. The short version is that they're
**static** instances, not variable ones, because Chromium exports a variable
font to PDF as a Type 3 font whose text copies out shredded — and that
`scripts/font-coverage.mjs` reads their real coverage out of the files so a
character they can't draw fails the build instead of silently falling back to
Arial in the client's hands.

## Not included, deliberately

**User flows.** The original this was extracted from also carried a
step-by-step behavioural catalogue per feature — how each one is actually
used, in a form close to a test plan. It's genuinely valuable and it's most of
the corpus by weight, and it's a different job from documenting *what
exists*. It's left out until the question "how do these relate to tests?" has
an answer worth building against.

## Licence

MIT. Bundled fonts are SIL OFL 1.1 — see `assets/fonts/README.md`.
