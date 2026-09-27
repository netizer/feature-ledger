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
| **Generated** | `FEATURES.md`, `FEATURES_EXTENDED.md`, `DEV_FEATURES.md` — gitignored build output — and a PDF per release, which a project can keep or regenerate. |
| **Editions** | [`docs/client/`](docs/client) — this repo keeps its own, so you can open the document the tool actually produces. Start with [the v2 PDF](docs/client/feature-ledger-Feature-Ledger_2.pdf) to see what a client is handed. |
| **Interface** | `ledger` — read, write, status, build. What it records goes through the CLI; how it's worded is a text edit. |
| **Checks** | [`ledger audit`](#keeping-it-honest-ledger-audit) sweeps the codebase for what the ledger missed; [`ledger review`](#reading-a-release-as-the-client-will-ledger-review) reads a release against the last edition before it goes out. `ledger release cut` asks for both — and, after a [redraft](#starting-over-ledger-redraft), for the check that nothing was lost. |

---

## Why a CLI instead of "just edit the JSON"

Because the corpus grows past what's cheap to **read**. A mature ledger is
100+ features and 150–200 KB — around 45,000 tokens. An agent that opens all
of it to change one description pays that on every edit, and re-emits a large
chunk of it, and sometimes reformats the rest.

With the CLI, the same lookup is `ledger list` (~2k tokens, and only if it
doesn't already know the id) plus `ledger show <id>` (~250). That's the design
brief: **nothing reads the corpus whole.**

And because some writes are expensive to get wrong. `ledger add`, `update` and
`remove` resolve which release an edit belongs to — a fact that isn't visible
from inside a file, and the one every New/Changed tag is computed from — and
refuse the mistakes you'd find much later: a changed feature with no
explanation, an audit stamp with no sweep behind it, an accent colour that
collides with the "this changed" highlight.

Neither of those is an argument about **wording**, and that's the other half
of the design: once an entry exists, its prose is a 2 KB text file you open
and edit. See [Editing the ledger by hand](#editing-the-ledger-by-hand). A
ledger drafted by a coding agent is a first draft, and a first draft that can
only be revised through a command interface stays in the voice the agent wrote
it in.

---

## One altitude, whatever the size of the project

The failure mode of a generated feature document is granularity. Left alone,
an agent surveying a codebase writes down everything it finds — the guardrails,
the defaults, the "safe to run twice" — and a small tool comes out as
twenty-two pages that nobody reads, while a large one comes out as vague
gestures at subsystems. Two projects, two different altitudes, neither of them
the one the reader wanted.

So the ledger fixes the altitude and lets the *count* vary:

> **One entry is one capability someone using the product would name.**
> Something they could ask for, or would miss if it went away.
>
> Could you demo it? Would demoing it look different from demoing the entry
> next to it? Both, or it isn't an entry.

A four-capability tool gets four entries. A two-hundred-capability platform
gets two hundred. Each entry zooms in exactly as far as the other, so someone
who reads the ledger for one product and then for another understands both at
the same level. Guardrails, defaults, plumbing and polish still get recorded —
inside the description of the capability they belong to, as `dev_notes`, as a
`dev` feature, or as an `other-change` — just never as an entry of their own.

Everything scales from there:

- **Areas are optional.** A new ledger has none. An entry added without one
  lands in a single area called "Features", and the generators print that
  without a heading or a contents page — a product that is one coherent thing
  reads as a list of what it does, not as a chapter of one.
- **Areas arrive when the product has parts** a user would recognise and name.
  `ledger categories rename` turns the default area into the first real one,
  carrying its entries with it.
- **Sub-sections arrive when an area has a real part inside it**, holding
  however many entries that part turns out to have.
- **Nothing counts entries per area.** An editor with twenty distinct
  capabilities has an area with twenty entries in it; an area opened today for
  work starting tomorrow has one. Both are facts about the product, and a tool
  that warned about either would only teach people to flatten a shape that was
  already true.

`ledger size` is a ranking *within* one product (which capability is it chosen
for?), not a measure of how far down an entry is allowed to go. All three
sizes are capabilities.

---

## Install

Needs Node 18.17+. The PDF needs a Chromium: Google Chrome or Edge if you have
one (used automatically), otherwise `npx playwright install chromium`.

It's on npm as [`feature-ledger`](https://www.npmjs.com/package/feature-ledger).

```bash
npm install -g feature-ledger
```

That puts `ledger` on your PATH, and it works in any project, in any language.

**Without installing anything** — every command works through `npx`, which is
handy for a one-off, a container, or CI:

```bash
npx feature-ledger init
npx feature-ledger list
```

**As a dependency of a JS project** (pins the copy, survives a `git clone`):

```bash
cd ~/dev/my-app
npm install --save-dev feature-ledger
npx ledger --help
```

### In a project with no `package.json` (Python, Go, Rust…)

The global install already covers you — `ledger` is on your PATH and doesn't
care what the project is written in. If you'd rather not depend on a global,
commit a two-line wrapper so the whole team (and every agent) gets the same
entry point, pinned to one version:

```bash
# tools/ledger  — chmod +x, committed
#!/usr/bin/env bash
exec npx --yes feature-ledger@0.1.0 "$@"
```

Then it's `./tools/ledger list`, on the same version for everyone. Whichever
form you choose, use the same one in the agent instructions (below), so the
agent's commands always work.

### From a local checkout

For working on the tool itself, or running something that isn't released yet:

```bash
git clone git@github.com:netizer/feature-ledger.git
cd feature-ledger
npm install
npm link                 # puts `ledger` on your PATH, symlinked to this checkout
```

Edits to the source are then live everywhere; `npm unlink -g feature-ledger`
undoes it. Nothing has to be installed at all if you'd rather invoke it by
path — `node ~/dev/feature-ledger/bin/ledger.mjs list`.

---

## Getting started in an existing project

```bash
cd ~/dev/my-python-app
ledger init --product "Acme Portal"
```

That creates `.ledger/`, points your agent files at it, and adds the generated
docs directory to `.gitignore`.

Add `--commit-pdfs` if the client editions should live in the repo — see
[Where the documents go](#where-the-documents-go) — then:

```bash
ledger bootstrap        # prints a survey prompt — paste it into your coding agent
```

The survey is agent work: only something that can read the codebase can say
what it does. The prompt runs start to finish without asking you anything: the
agent lists the capabilities first — against the bar above — then decides
whether the product needs areas at all, then writes the entries a batch at a
time, and finally cuts and prints the baseline itself — the last four commands
it runs being:

```bash
ledger status
ledger audit complete --full --commit a1b3f9c            # the survey IS a full sweep
ledger release cut --name "Baseline" --date 2026-03-02   # the first commit's date
ledger build
```

That third command is what makes [the audit](#keeping-it-honest-ledger-audit) useful from
day one: the survey has just read the whole codebase against the record, so it
is recorded as a full sweep, and everything that lands afterwards is measured
against it. `ledger bootstrap --no-audit` leaves it out.

Attempted in one pass the survey runs out of context and starts inventing; in
batches it's reliable — so the prompt batches, but the agent moves between
batches on its own rather than checking in. Editing is deliberately after the
fact: it finishes by listing the entries it was least sure about, and the
baseline it hands you is a draft. Rewrite the wording straight in
`.ledger/features/<id>.json`; `ledger update` and `ledger remove` are for
anything where the product itself has moved. The output of `ledger bootstrap` is two parts, an explanation for you
and then the prompt itself: everything below the rule is what gets pasted, and
there's nothing after it.

### The baseline reads as an inventory, not as your work

Two things make that true, and both are already the default:

- **Voice.** The rules require every description to be a present-tense
  statement of what the product does: "A guest can book without an account",
  never "added", "we now support", "improved". A reader can't tell from the
  wording whether something shipped last week or three years ago. The
  bootstrap prompt says this twice, because it's the thing an agent drifts
  away from first. See [Tone](#tone) for the rest of it.
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
ledger audit             # a brief for an agent: what landed without the ledger hearing
ledger review            # a brief for an agent: read the release as the client will
ledger release cut --name "Sprint 6 demo" --date 2026-09-14
ledger build
```

The first two print prompts for a coding agent, and the cut refuses while either
is outstanding — see [Keeping it honest](#keeping-it-honest-ledger-audit) and
[Reading a release as the client will](#reading-a-release-as-the-client-will-ledger-review).
The cut mints the archival PDF for what was just shown, and opens the next
release. Every New/Changed tag from the cycle goes quiet on its own; there's
nothing to strip by hand.

The cut also records the commit it happened at, because a date is too coarse
to name the moment: two demos in one day are ordinary, and the document cut
this morning isn't the one cut this afternoon. Two releases can share a date
freely — what's refused is one sharing a date *and* a commit with the release
before it, since then nothing tells the two editions apart. `--force` covers a
deliberate re-issue, `--commit <sha>` cuts retrospectively at a known point,
and `ledger release list` prints the timeline with each commit against it.
A ledger that predates all this fills its history in with
`ledger release amend <version> --commit <sha>`.

And when a description just reads wrong — the wrong word for the client, a
sentence the agent invented, a detail they shouldn't be seeing — you open the
file and fix it. That's the next section, and it isn't an escape hatch: it's
half of how the ledger works.

Run `ledger rules` for the full authoring rules — the entry bar, sizing, the
`user`/`dev` split, areas, sub-sections, removals, and where everything that
*isn't* an entry goes instead.

---

## Editing the ledger by hand

The corpus is JSON in your repository, and the prose in it is yours. Open the
file and change it:

```bash
$EDITOR .ledger/features/saved-baskets.json
```

```json
{
  "id": "saved-baskets",
  "audience": "user",
  "category": "Ordering",
  "size": "Medium",
  "history": [
    {
      "version": 4,
      "name": "Saved baskets",
      "description": "A customer keeps more than one basket — the weekly shop, the party order — and switches between them without either losing its contents.",
      "changes": null,
      "dev_notes": "app/models/basket.rb; the switch is a session swap, not a copy."
    }
  ]
}
```

This is not a fallback for when the CLI won't do what you want. **It is how
the wording gets adopted for the client**, and it's expected to happen every
cycle — most usefully with the last edition open next to you. Three things
you're doing when you're in there:

- **Changing** the words. The draft says "users"; this client says "guests".
  A sentence is true but reads like a commit message. A name came out as a
  caption rather than a name. Rewrite them.
- **Adding** what the coding agent couldn't find. A survey reads code, and
  part of what a capability is *for* only ever existed in someone's head. If a
  description is missing the sentence that makes it make sense, write that
  sentence in.
- **Deleting** what the client shouldn't be reading. An internal detail that
  drifted into a description, a `dev_notes` line that says more than you want
  said, a change bullet about something they never asked for and won't thank
  you for explaining. Cut it.

None of that lands on a release and none of it tags anything as changed —
which is right, because the product didn't move. The improved wording reads as
though it had always been there, including in editions already printed: an
entry is worded once, and every document that shows it picks the change up on
the next `ledger build`.

Then run `ledger status`. It loads and validates every file, so a trailing
comma, a description that went missing or a history entry that lost its name
comes back as a message rather than as a broken build. `ledger show <id>`
prints the entry as the documents will read it.

### What's yours

On any entry in a feature's `history`:

| | |
| --- | --- |
| `name` | What the feature is called. The one on the newest entry is what it currently goes by; every document footnotes the previous one on its own. |
| `description` | The whole present-tense text. |
| `dev_notes` | The team's detail. Delete the key to drop it entirely. |
| `changes` | The wording of a bullet — or the bullet, if the client is better off not reading it. |

And at the top of the same file, where the entry lives rather than one moment
in its history:

| | |
| --- | --- |
| `size` | `Big`, `Medium` or `Small`. |
| `category`, `subcategory` | Must name one that already exists — `ledger status` refuses a typo rather than quietly inventing an area. |
| `id` | **Don't.** It's the filename as well as the identity that carries history across renames, and it's what `index.json` orders by — change it in the file only and the entry drops to the end of its size band. |

And elsewhere in `.ledger/`:

| | |
| --- | --- |
| `subcategories.json` | A sub-section's `name` and `intro`. |
| `config.json` | Product name, tagline, and the `docs` block that overrides document titles and intros. |
| `other-changes.json` | The `description` of a product-wide note. |
| `STYLE.md`, `theme.css` | Prose and CSS. They were always yours. |

Renaming an **area** is the exception, because the name is repeated on every
feature filed under it: `ledger categories rename "Old" "New"` carries them
all across.

### What stays with the CLI

Not much, and it's where a hand-edit would be either invisible or wrong.

- **Adding, dropping or re-dating an entry in `history`.** Which release an
  edit lands on is what every New/Changed tag is computed from, and which
  release is open isn't visible from inside the file. That's `ledger add`,
  `ledger update` and `ledger remove` — and `ledger update` is also what
  refuses a change that never says *why*, the rule that makes the document
  worth reading rather than a diff.
- **`releases.json`, and the stamps in `audits.json`, `reviews.json` and
  `redrafts.json`.** A timeline edited by hand stops matching the editions
  already handed over, and a stamp set without the sweep behind it makes a gap
  permanently invisible. The one exception is a redraft's `note`, which is
  wording. The same goes for `.ledger/archive/`: the old editions print from it.
- **Keeping `index.json` complete.** Every write adds a new id and prunes one
  whose file is gone, so the index can't rot. Only that half is the CLI's: the
  **order** in the list is the deliberate reading order within a size band, and
  reordering it by hand is exactly how you're meant to change it.

The test, when you can't tell which side of the line you're on:

> **Would the client want to be told?** If they would, it's a change — it goes
> through `ledger update`, dated and explained. If it's the same thing said
> better, said more, or said less, it's an edit.

Renaming a feature falls on both sides, which is why there's no one command
for it. A name that was simply chosen badly is wording: change `name` in the
file. A name the *product* changed is news:

```bash
ledger update saved-baskets --name "Saved baskets" \
  --description "…the full current-state text…" \
  --change "Was “Basket list”, which described the screen rather than the thing customers were actually keeping."
```

### A whole ledger at once

`ledger style rewrite` prints a brief for a coding agent to take the corpus
one area at a time, holding it to changing the words rather than the meaning.
That's the tool for adopting a new tone across a hundred entries; for the
handful you noticed while reading the last edition, just open the files.

---

## Keeping it honest: `ledger audit`

Everything above keeps the ledger current for work done **through a coding
agent that read the stanza**. Nothing keeps it current for the rest. A
developer who doesn't use one, or uses one that never saw the instructions,
ships a capability and the corpus never hears about it — and `ledger status`
in a commit hook can't help, because it catches a corpus that's been *broken*,
not one that's out of *date*.

`ledger audit` is the parallel track. It reads the codebase against the record
and prints a brief for a coding agent:

```bash
ledger audit                    # what has landed since the last sweep
ledger audit --full             # the whole codebase
```

The CLI does the cheap half first — resolves the range, clusters the changed
paths into batches, collects the commit subjects — so the agent gets a worked
checklist instead of a diff. The agent works the batches, records what it
finds, and stamps the commit it audited:

```bash
ledger audit complete --commit a1b3f9c
```

That stamp is a command, never a hand-edit, because it's the one field that
makes a gap permanently invisible if it's set without the work being done.

From then on the tool knows how much of the repository has never been
examined, and says so at the moment it matters:

```
$ ledger release cut --name "Sprint 6 demo"
ledger: 23 commits since the last audit (a1b3f9c, 12 September 2026), touching
41 files outside the ledger, so this edition may be missing capabilities the
client has already been given. Run `ledger audit` to sweep them, or pass
--force to cut anyway.
```

It refuses rather than warns, but only when there's something real to report —
a gate that fires on every cut is one people learn to `--force` past without
reading.

### What an audit finds, and how it prints

An audit turns up things that were already true. They still land on the open
release — *new* in a client edition means new **to the reader**, and this is
the first document that has ever mentioned them — but they must not print as
this release's work. So every write takes `--backfilled`, which draws the
entry in a third register:

| | |
| --- | --- |
| **green** | built this cycle |
| **blue** | reworked this cycle |
| **grey** | already in the product; this is the first edition to list it |

> **Grey means the product didn't move this cycle — the record did.**

Nothing is ever written into a past release, so every already-issued edition
still reprints exactly as it was. The third register is deliberately not a
fourth *hue*: green and blue are spoken for, an accent in that band is already
refused (see [Branding](#branding-it-for-a-new-client)), and a fifth hue would
squeeze every brand into reds, oranges, purples and browns. It's also not the
same kind of fact — green and blue say the software moved; grey says the
document caught up.

A capability the audit finds is **gone** is reported too, in the same register
and worded so it claims no date. A client learning that something was
withdrawn and never mentioned is the most valuable thing an audit produces for
them; a tool that decided on its own to withhold it would be worth less than
one that reports everything. If a team doesn't want to report a particular
one, that's an edit they make deliberately.

### Reasons an audit had to infer

`ledger update` refuses a change with no reason, and that rule doesn't relax
after the fact — which is a problem, because the person who knew why may be
long gone. So an audit takes the reason from the commit message and marks it
`--reason-inferred`. Those entries show up in `ledger status` until someone
vouches for the sentence — `ledger audit confirm <id>` takes it as it stands,
and rewriting the bullet yourself does the same thing more strongly (edit it in
the feature's file and delete that entry's `"reason_inferred"` line). The audit
writes first and asks afterwards, so an unattended run still lands its work,
and the questions outlive the terminal it ran in.

None of that reaches the client document. It's a note to the team.

---

## Reading a release as the client will: `ledger review`

The audit makes sure the release has everything in it. The review makes sure
what's in it reads right to the person it's for.

Every entry in a release was written the moment its work landed, one
`ledger update` at a time, and each update's bullet says what the feature was
*just before that update*. Every one of those bullets was true when it was
written. The client doesn't read them one at a time, though: they read the
whole release, against the edition they already have, and they never saw
anything in between. Read that way, a release written in instalments goes
wrong in predictable places:

- **A "before" that never shipped.** "Events synced from Acuity no longer
  appear under *Unpaid*. Before, they were listed there alongside the app's
  own bookings." True the day it was written — but the Acuity sync itself was
  new in the same release, so the client is told about a fix to a problem they
  never had.
- **A fix to something that is itself new.** "*Confirm all* is now near the
  top", in the release that introduced *Confirm all*.
- **Drafts instead of a result.** A chart added in one bullet and redesigned in
  the next three, where the client should read one sentence about a new chart.
- **A new feature with a "What changed" note**, or described as news: "every
  email is now actually delivered", in an entry the client is seeing for the
  first time.
- **The same change explained three times**, in three words for the same
  thing, with two different numbers.

`ledger review` prints a brief that has a coding agent read the release as one
document and fix that — by editing the entries in place, the same hand-edits
described in [Editing the ledger by hand](#editing-the-ledger-by-hand):

```bash
ledger review             # the brief, for a coding agent
ledger review complete    # stamp what was reviewed
```

As with the audit, the CLI does the mechanical half first. The brief lists what
arrived in this release — the things no bullet may describe a "before" for —
then every client-facing entry in it, area by area, and a short list of places
the drafts probably show: change bullets naming terms that appear nowhere in
the previous edition, new entries still carrying a change note, descriptions
that say "now" or "no longer". The agent then:

- tests every bullet against the **previous edition**, not against the state
  the last update started from, and drops or merges what fails;
- gives new entries no change note and a description that reads as though it
  had always been there;
- takes an entry off the updated list entirely when nothing the client would
  notice is left;
- makes names, numbers and cross-references agree across the release;
- changes wording only. It never changes what the ledger says the product does,
  and never invents a reason: whatever it can't settle comes back to you as a
  numbered list of questions.

`ledger review complete` refuses while a new entry still carries a change note
or an updated one has none, then records a fingerprint of every client-facing
entry it covered. From then on the tool knows which entries have moved since:

```
$ ledger release cut --name "Sprint 6 demo"
ledger: 2 client-facing entries have changed since v6 was reviewed on
September 25, 2026 (booking-detail, dashboard). Run `ledger review` for the
brief, `ledger review complete` if you have read them yourself, or pass
--force to cut anyway.
```

The fingerprint covers only what the client reads — names, descriptions,
change bullets, removals and product-wide notes. Editing dev notes or
confirming an inferred reason doesn't ask for another review. A first edition
isn't gated at all, because there is no earlier edition to compare it with.

Two guards at write time keep the review short. `ledger update` refuses a
change note on a feature that is new in the open release, and when a feature
changes a second time in one release it reminds the agent which edition its
bullets have to be true of.

---

## Starting over: `ledger redraft`

A ledger written one change at a time drifts into the shape its history gave
it: areas that made sense three releases ago, an entry that grew a second
capability inside it, names from before the product found its own words. Past
a point, the cheapest way to a document that reads well is a fresh survey.

What mustn't start again is everything the client already holds: the version
numbers on the editions they were handed, those editions themselves, and every
fact those editions told them. `ledger redraft` keeps all three.

```bash
ledger redraft start      # set the corpus aside, open the next version on an empty one
ledger bootstrap          # the survey, from scratch — it knows it's a redraft
git commit …
ledger redraft check      # a brief: check the new corpus against the old one
git commit …              # the check's edits, as a diff of their own
ledger release cut --name "…" && ledger build
```

**`redraft start`** copies the whole corpus into `.ledger/archive/v1-v4/`
(named for the editions it produced) and marks it read-only: the CLI refuses
to write there, and `--dir` reads it (`ledger list --dir .ledger/archive/v1-v4`).
The released versions stay in `releases.json` with `status: "archived"`, so
the next release is v5, not v1. Config, brand, tone and theme carry over; the
features, the areas, the sub-sections and the audit and review logs start
empty, because deciding those afresh is the point. It refuses while `.ledger/`
has uncommitted changes, so the corpus being set aside is one the history
already holds. It also refuses while the open release has work recorded
against it: the first edition after a redraft marks nothing as new, so that
work would reach the client unannounced. Cut it first, or pass `--force`.

**`bootstrap`**, run during a redraft, surveys as usual but doesn't read the
archive (a survey that starts from the old structure reproduces it), and stops
before the cut.

**`redraft check`** prints the check, which is the step that makes a fresh survey
safe. The CLI pairs every archived entry with its likely counterpart in the new
corpus, by id or by shared wording, and lists the ones it couldn't pair first.
The agent then reads each old description a statement at a time, finds where
the new corpus says the same thing, and puts back whatever it doesn't. That's
a detail the survey had no way of knowing, a capability hidden behind a
setting, or the client's own word for something. It keeps the new structure:
it restores facts, not the old arrangement. It also writes a short note for
the client on how the arrangement changed, and stamps the redraft with
`ledger redraft complete --note "…"`, recorded in `.ledger/redrafts.json`.
Statements no longer true of the product come back to you as a list: the
client read them in an earlier edition, so whether to tell them is your call.

Until that stamp is there, the redraft is unfinished, and the tool says so
where it matters:

```
$ ledger build
! Unfinished redraft: the ledger was redrafted on September 27, 2026: v1–v4 are
  archived in .ledger/archive/v1-v4/, and the new corpus hasn't been checked
  against it yet, so this edition may have lost something the client was told in v4.
  To finish it:
    1. commit the current state of .ledger/, so the check's edits are a diff of their own
    2. run `ledger redraft check` and hand the prompt it prints to your coding agent. …
    3. commit its edits
```

Bare `ledger redraft` prints the same steps at any point, or says the redraft
is complete. `ledger status` carries the same warning, and `ledger release cut` refuses
until the check is done. That's the same shape as the audit and the review, and
it's checked ahead of both.

### What the client sees

The first edition after a redraft prints as an inventory, like a first
edition, because there's nothing it can be diffed against entry by entry. In
place of the green-and-blue callout, it opens with a grey one:

> **This edition is reorganized.** Editions 1 to 4 arranged this ledger
> differently. This edition arranges it afresh, so its areas, names and
> descriptions don't match those editions line for line. Every capability from
> version 4 that Acme Portal still has is described here. Because the structure
> changed, nothing in this edition is marked as new or updated. From the next
> edition, changes are marked again.
>
> Bookings and Payments are one area, Bookings. Deposit refunds, previously its
> own entry, is part of Checkout.

The second paragraph is the agent's note, and the first can be overridden per
project under `docs.redraft` in `config.json`. Grey for the same reason as the
third register: the document moved, the product didn't. The edition after that
is compared with this one as usual.

The old editions are left alone. Their numbers never come round again, so no
new PDF overwrites one. `ledger build --version all` prints only the current
corpus's editions, and `ledger build --version 3` reprints an archived one from
its archive, so a project that doesn't commit its PDFs can still reproduce
every document it has handed over.

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
commands, draws the line between recording a change and rewording an entry,
names the project's tone, and tells the agent to run `ledger rules` before its
first edit. One source of truth, cheap in every session, and the full text is
only pulled when an edit is actually happening.

`ledger style set` rewrites that stanza in every agent file, so the tone the
agent reads is always the one the project is on.

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
      "Bash(npx feature-ledger:*)",
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
  ledger status --quiet || exit 1
  ```

  `--quiet` prints nothing when the corpus is sound and skips the browser
  probe, so the hook costs nothing on a normal commit.

  This catches a corpus that's been broken, not one that's out of date. For
  out-of-date, add a soft check: if the commit touches source files but
  nothing under `.ledger/`, print a reminder and let it through (`exit 0`) —
  a hard block here trains people to use `--no-verify` for everything.

- *A Claude Code Stop hook.* Fires when Claude finishes a turn, and can inject
  a reminder to check the ledger. Use this only if the first two aren't
  landing; a hook that fires on every turn becomes noise the model learns to
  skim.

**4. Keep it out of context the rest of the time.** The generated Markdown
docs are gitignored build output — don't commit them and don't point
`CLAUDE.md` at them. `FEATURES_EXTENDED.md` is genuinely useful for a human reading in, but
an agent should reach for `ledger list` / `ledger show` instead, which is the
same information at a fraction of the cost.

---

## Tone

A ledger is read by a client, often in a second language. Left to itself a
coding agent writes in its own voice: em-dash asides, a phrase repeated for
rhythm, sentences carrying three ideas at once. That voice is wrong for this
document, and "write more plainly" is too vague to survive across sessions and
across tools.

So the ledger names a **public style guide** instead. Every coding agent
already knows these documents, which makes one line of configuration do the
work of a page of instructions.

```bash
ledger style              # the tone this project writes in
ledger style list         # the four built in
ledger style set govuk    # switch, and update the agent stanza to match
ledger style rewrite      # the prompt for bringing an existing ledger over
```

| id | guide | reads like |
|----|-------|-----------|
| `google` *(default)* | [Google developer documentation style guide](https://developers.google.com/style) | Neutral and precise. The one most coding agents know best. |
| `govuk` | [GOV.UK content style guide](https://www.gov.uk/guidance/style-guide) | The plainest English of the four. Written to be understood by everyone. |
| `plain-language` | [Federal Plain Language Guidelines](https://www.plainlanguage.gov/guidelines/) | The US plain-writing standard, with more attention to structure. |
| `ste` | [ASD-STE100 Simplified Technical English](https://www.asd-ste100.org/) | The aviation standard. Maximum clarity, deliberately clipped. |

It is one line in `.ledger/config.json`, so it is per project. A public sector
client and a developer tool do not want the same voice.

```json
"style": "govuk"
```

There are no per-rule overrides — no word lists, no sentence limits, no
spelling switch. A tone that can be tuned clause by clause stops being a tone
and becomes a specification, and prose does not take instruction that way.

### Your own tone

If none of the four is what you want, write your own:

```bash
ledger style set custom     # starts .ledger/STYLE.md from a template
```

`.ledger/STYLE.md` is a page of prose, briefed the way you would brief a
writer joining the team: who reads this, how formal it should feel, the words
your product uses for its own things ("the people who book are guests, never
users"). Naming a well-known guide and saying where you differ carries
further than a page of rules — every coding agent knows the major ones.

### Where it lands

The tone reaches an agent at three points, all from the one setting:

- **The agent stanza** in `CLAUDE.md` / `AGENTS.md` names it and links it, so
  an agent making a small edit sees it without running anything.
- **`ledger rules`** prints it in full inside the authoring rules.
- **`ledger bootstrap`** puts it at the top of the baseline-survey prompt.

`ledger style set` rewrites the stanza too, so it never names a guide the
project has left.

### Moving an existing ledger to a new tone

Entry by entry it's a text edit — see [Editing the ledger by
hand](#editing-the-ledger-by-hand). Nothing lands on the open release and no
reader is told that something moved, which is right: the product didn't.

For a whole corpus at once, `ledger style rewrite` prints a brief for a coding
agent to work through it one area at a time, holding it to changing the words
rather than the meaning. A ledger written years ago in another voice comes over
without a single feature reading as new work.

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
  `ledger status` warns when a brand picks one that collides.

- **`.ledger/theme.css`** — appended last to the PDF's stylesheet, for a
  one-off nudge that isn't worth a fork.

Wording — the doc titles, the intro paragraphs, the colophon — is overridable
per project in `.ledger/config.json` under `docs`. The defaults are built from
`product` and the optional one-line `tagline`.

`ledger status` ends with the whole resolved setup: derived palette, masthead,
fonts, the style guide in force, and which browser will print.

---

## Where the documents go

`ledger build` writes two kinds of thing, and they don't want the same
treatment. The three Markdown docs are read in the repo, regenerated on every
build, and would fill a diff with noise; they are always gitignored build
output. The PDF is what a client was actually handed on a given day, which
some teams want the repo to keep and others would rather mint on demand.

So `ledger init` asks once:

```bash
ledger init --product "Acme Portal"                 # docs/generated/client/ — build output
ledger init --product "Acme Portal" --commit-pdfs   # docs/client/         — kept in the repo
```

|  | Markdown docs | Client PDFs |
| --- | --- | --- |
| default | `docs/generated/` — gitignored | `docs/generated/client/` — gitignored |
| `--commit-pdfs` | `docs/generated/` — gitignored | `docs/client/` — **committed** |

The only line `init` adds to `.gitignore` is `docs/generated/`, so the choice
is just whether the client directory sits inside it. Committing the editions
costs about 100 KB per release and buys an answer to "what exactly did we show
them in March" that doesn't depend on the corpus still rendering the same way.
Leaving them out keeps the repo to text, and any edition can be reprinted at
any time with `ledger build --version N`.

Either way the paths are `output.dir` and `output.client_dir` in
`.ledger/config.json`, and changing them later is an edit to those two fields
plus a matching `.gitignore` line. `ledger status` prints the resolved pair,
and says which shape is in force.

This repo runs its own ledger on itself with the editions kept:
[`docs/client/`](docs/client) holds one PDF per release, printed by the tool
from the corpus in `.ledger/`. The latest,
[`feature-ledger-Feature-Ledger_2.pdf`](docs/client/feature-ledger-Feature-Ledger_2.pdf),
is the clearest example of what this product produces.

---

## How the model works

**A release is a moment, named by a commit.** Every cut records the sha it
happened at, so an edition says which state of the product it was printed
from rather than only which day. That's what lets two demos in one day be two
real releases.

**A feature is its history.** A version only appears in a feature's history
when something about it actually changed; absent versions mean "still whatever
the last entry said". That's what makes "what did this look like at version
N?" answerable, and it's why an old release's PDF still reproduces exactly
what was presented then.

**Two audiences.** `user` features are what the client sees. `dev` features
are what only the team cares about — and `dev_notes` on a user feature is
implementation detail attached to a client-facing capability. The three
Markdown docs are those three combinations.

**Three sizes, all of them capabilities.** Big (one the product is chosen
for), Medium (a capability in its own right, inside a bigger one), Small (one
narrow enough to describe in a line). The scale ranks entries within a single
product and orders every section — an area can't bury its Big behind six
Smalls just because that's the order things got written down in. It says
nothing about how far down an entry may go; that's the entry bar's job, and
it's the same bar in every project.

**Three registers, two of them about the product.** Green means built this
cycle and blue means reworked this cycle; grey means the entry was already
true and this is simply the first edition to say so. The first two are facts
about the software, the third is a fact about the record — which is why it's a
neutral rather than a fourth hue, and why it reads quieter than either.

**Two highlight semantics, on purpose.** The living Markdown docs tag New and
Changed only while the target release is still in progress, so a shipped
release's docs read as a clean present-tense list. The archival PDF always
diffs against its own predecessor, however old, because its whole job is
reproducing what was in front of the client that day.

**Areas are a reading aid, not a taxonomy.** A ledger with none puts
everything in one called "Features" and prints it without a heading. Areas
appear when the product has parts a user would recognise, however many entries
each of them ends up holding.

**Sub-sections** sit between an area and a feature, for an area with a real
part inside it. The heading and its intro *are* that part's overview, which is
the one thing `ledger status` mentions: a sub-section leading with a `Big`
entry says it twice. When a whole sub-section arrives in one release it's
flagged once, as one green card, rather than as a column of identical "New"s
that says nothing.

---

## Commands

```
Reading
  ledger list [--category C] [--audience user|dev] [--size S] [--changed] [--json]
  ledger show <id> [--history] [--json]
  ledger status [--json] [--quiet]    the open release, the corpus and the
                                      setup, all checked; exit 1 on a problem
  ledger rules                        the authoring rules, in full
  ledger style [show | list | set <id> | rewrite]
                                      the tone every entry is written in
  ledger export [--out FILE]          the whole corpus as one JSON document

Writing            (JSON payload on stdin or --file; --dry-run previews)
  ledger add <id>
  ledger update <id>                  --name here is a rename the client is told about
  ledger remove <id> --reason "…"
      …add, update and remove all take --backfilled: the product didn't move
      this cycle, the record did. See `ledger audit`.
  ledger other-change --audience user --description "…"
  ledger categories [list | add "Name" [--after "Other" | --before "Other"]
                          | rename "Old" "New" | remove "Name"]
  ledger subcategory [list | add]

Wording            (no command — see Editing the ledger by hand)
  .ledger/features/<id>.json          names, descriptions, dev notes, the text
                                      of a change bullet
  .ledger/subcategories.json          sub-section headings and overviews
  .ledger/config.json                 product name, document titles
  .ledger/other-changes.json          the product-wide notes

Releases
  ledger release list
  ledger release cut --name "…" [--date YYYY-MM-DD] [--commit SHA] [--force]
  ledger release amend <version> --commit SHA

Auditing            (the periodic sweep of the codebase against the record)
  ledger audit [--full] [--since SHA]     the brief, for a coding agent
  ledger audit complete [--commit SHA]    stamp the audited commit (default HEAD)
  ledger audit confirm <id>               vouch for a reason an audit inferred
  ledger audit log [--json]               every audit so far

Reviewing           (reading the release against the last edition, before the cut)
  ledger review                           the brief, for a coding agent
  ledger review complete                  stamp what was reviewed

Redrafting          (writing the corpus again from scratch, keeping the client's record)
  ledger redraft start [--force]          archive the corpus, open the next version empty
  ledger redraft check                    the brief: check the new corpus against the old
  ledger redraft complete [--note "…"]    stamp the check, with the note the client reads
  ledger redraft                          where the redraft stands, and the next step

Output
  ledger build [--md] [--pdf] [--version N|all] [--out DIR] [--html]

Setup
  ledger init [--product "…"] [--accent "#hex"] [--logo PATH] [--agents …]
              [--style google|govuk|plain-language|ste] [--commit-pdfs]
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
config.json          product, the area list (= reading order; may be empty), tone, wording overrides
brand.json           logo, accent, fonts
releases.json        the version timeline, each release with the commit it was cut at
features/<id>.json   one feature, with its full history
index.json           the deliberate corpus order (ties within a size band)
subcategories.json   sub-section headings
other-changes.json   changes belonging to no single feature
audits.json          every audit so far, and the commit each was run against
reviews.json         every review of a release, and a fingerprint of what it read
redrafts.json        every redraft, and whether the new corpus was checked against the old
archive/v1-v4/       a corpus a redraft set aside, read-only; its editions print from it
STYLE.md             optional, the project's own tone as prose
theme.css            optional, appended last to the PDF stylesheet
```

Everything here is committed. The words in `features/`, `subcategories.json`,
`other-changes.json` and `config.json` are yours to edit directly, as is the
order of `index.json`; `releases.json`, `audits.json`, `reviews.json`,
`redrafts.json` and `archive/` are the CLI's. See
[Editing the ledger by hand](#editing-the-ledger-by-hand).

One file per feature is a deliberate change from the single-file original: a
2 KB file is what an agent — or a person — opens and edits, git diffs stay
readable, and two branches adding features stop conflicting.

---

## Development

```bash
npm install
node test/smoke.mjs      # builds a project from nothing, exercises every guardrail
```

`examples/northwind/` is a small worked corpus — two releases, a change, a
rename, a removal, a global change and a sub-section, and a good place to open
a feature file and see what one looks like. `cd examples/northwind
&& ledger build --version all` prints both editions.

Fonts: see `assets/fonts/README.md`. The short version is that they're
**static** instances, not variable ones, because Chromium exports a variable
font to PDF as a Type 3 font whose text copies out shredded — and that the
build asks Chromium which font actually drew each piece of text, so a
character they can't draw fails the build instead of silently falling back to
Arial in the client's hands. A symbol face is bundled for the UI icons (✕, ✉,
★) descriptions quote.

## Not included, deliberately

**User flows.** The original this was extracted from also carried a
step-by-step behavioural catalogue per feature — how each one is actually
used, in a form close to a test plan. It's genuinely valuable and it's most of
the corpus by weight, and it's a different job from documenting *what
exists*. It's left out until the question "how do these relate to tests?" has
an answer worth building against.

## Licence

MIT. Bundled fonts are SIL OFL 1.1 — see `assets/fonts/README.md`.
