# Keeping it honest: the checks

`ledger cut` refuses to print an edition until six things are true. It works
all of them out every time, and a refusal lists the whole set, each with the
command that fixes it. `ledger` and `ledger status` show the same list without
trying to cut.

| Check | Open when | Fixed by |
| --- | --- | --- |
| `redraft` | a redrafted corpus hasn't been checked against the one it replaced | the steps `ledger redraft` prints |
| `audit` | code landed since the last audit | `ledger audit` |
| `content` | nothing is recorded against the open release, so its edition would repeat the last one | recording the work, or `ledger audit` |
| `summary` | the release has no summary, or an entry was recorded, changed or removed since it was written, or it leaves an entry out of both `covers` and `quiet` | `ledger summary` |
| `review` | a client-facing entry changed since the release was last reviewed | `ledger review`, or `ledger review complete` if you read it yourself |
| `moment` | the release would stand for the same day *and* the same commit as the one before | cutting at a later commit (`--commit`) |

`--skip audit,review` passes the checks you name, and only those. `--force`
skips all six; prefer `--skip`, so the one you meant is the only one you
passed. A refused cut exits with code 3.

The order is deliberate. Until a redrafted corpus is checked, anything the
others ask is asked of a corpus that may still be missing what the client was
told. Unaudited work comes before the empty-release check, because when both
fire they have one cause — work landed and the ledger never heard about it.
The summary comes next, because it's written from what was recorded. The
review comes last, because any of the others can send someone off to record or
write more, and whatever is written is what a review has to read.

## The audit

Everything above keeps the ledger current for work done **through a coding
agent that read the stanza**. Nothing keeps it current for the rest. A developer
who doesn't use one ships a capability and the corpus never hears about it, and
`ledger status` in a commit hook can't help: it catches a corpus that's
*broken*, not one that's out of *date*.

`ledger audit` is the parallel track. It reads the codebase against the record
and prepares a prompt for a coding agent:

```bash
ledger audit                    # what has landed since the last sweep
ledger audit --full             # the whole codebase
ledger audit --run claude       # …handed straight to an agent
```

The CLI does the cheap half first: it resolves the range, clusters the changed
paths into batches, and collects the commit subjects, so the agent gets a worked
checklist instead of a diff. The agent works the batches, records what it finds,
and stamps the commit it audited:

```bash
ledger audit complete --commit a1b3f9c
```

That stamp is a command, never a hand-edit, because it's the one field that
makes a gap permanently invisible if it's set without the work being done.

The gate fires only when there's something real to report. A gate that fires on
every cut is one people learn to skip without reading.

### What an audit finds, and how it prints

An audit turns up things that were already true. They still land on the open
release — *new* in a client edition means new **to the reader** — but they must
not print as this release's work. So every write takes `--backfilled`, which
draws the entry in a third register:

| | |
| --- | --- |
| **green** | built this cycle |
| **blue** | reworked this cycle |
| **grey** | already in the product; this is the first edition to list it |

> **Grey means the product didn't move this cycle — the record did.**

Nothing is ever written into a past release, so every edition already issued
reprints exactly as it was.

A capability the audit finds is **gone** is reported too, worded so it claims no
date. A client learning that something was withdrawn and never mentioned is the
most valuable thing an audit produces. If a team doesn't want to report one,
that's an edit they make deliberately.

### Reasons an audit had to infer

`ledger update` refuses a change with no reason, and that rule doesn't relax
after the fact, even when the person who knew why is long gone. So an audit
takes the reason from the commit message and marks it `--reason-inferred`.
Those entries show up in `ledger status` until someone vouches for the
sentence: `ledger audit confirm <id>` takes it as it stands, and rewriting the
bullet yourself does the same thing more strongly (edit it in the feature's file
and delete that entry's `"reason_inferred"` line). None of that reaches the
client document.

## The review

The audit makes sure the release has everything in it. The review makes sure
what's in it reads right to the person it's for.

Every entry in a release was written the moment its work landed, and each
update's bullet says what the feature was *just before that update*. The client
doesn't read them one at a time: they read the whole release, against the
edition they already have. Read that way, a release written in instalments goes
wrong in predictable places:

- **A "before" that never shipped.** "Events synced from Acuity no longer appear
  under *Unpaid*" — when the Acuity sync is itself new in the same release.
- **A fix to something that is itself new.** "*Confirm all* is now near the
  top", in the release that introduced *Confirm all*.
- **Drafts instead of a result.** A chart added in one bullet and redesigned in
  the next three.
- **A new feature with a "What changed" note**, or described as news.
- **The same change explained three times**, in three words for the same thing.

`ledger review` prepares a prompt that has a coding agent read the release as
one document and fix that, by editing the entries in place:

```bash
ledger review             # the prompt, for a coding agent
ledger review complete    # stamp what was reviewed
```

The prompt lists what arrived in this release (the things no bullet may
describe a "before" for), every client-facing entry in it, and a short list of
places the drafts probably show. The agent changes wording only. It never
changes what the ledger says the product does, never invents a reason, and
hands back whatever it couldn't settle as a numbered list of questions.

`ledger review complete` refuses while a new entry still carries a change note,
an updated one has none, or the summary doesn't account for every entry, then
records a fingerprint of every client-facing entry it covered, and of the
summary. From then on the tool knows which entries moved since. The
fingerprint covers only what the client reads, so editing dev notes or
confirming an inferred reason doesn't ask for another review. A first edition
isn't checked at all.

The review reads the summary against the entries as it leaves them, so
recording it also records those entries as what the summary was written from.
Otherwise a review that rewords an entry would put the summary out of date,
and writing the summary again would put the review out of date.

## The summary

From the second edition on, the page after the cover lists what differs from
the edition before, as short numbered lists: *What's new*, *What changed*, and
when there are any, *Already in place*, *No longer available* and the
product-wide notes. It's the page to read when there's no time for the rest,
so it lists what is worth knowing, not everything that moved.

The first three lists are the release's summary, in `.ledger/summaries.json`.
Each item is one sentence, followed by numbered links to the entries it sums
up (`covers`). One item can cover several entries, so three changes that all
follow from one new capability read as that capability. An entry nobody would
miss goes in `quiet`. Every client-facing entry in the release is in one or the
other.

```bash
ledger summary              # the prompt, for a coding agent
ledger summary --run claude
ledger summary complete     # check it accounts for every entry, and stamp it
```

The prompt carries the text of every entry in the release, so the agent reads
nothing else, not even the code: it is cheap enough to run every day. It
writes the summary again as a whole, keeping what still holds of the one
before, and it may say why something changed, or who it helps, when the
entries don't. It ends with a list of what it left out and every reason it
supplied, for the developer to check before the client reads it.

`ledger summary complete` records a fingerprint of each entry it was written
from. An entry recorded, changed or removed after that puts the summary out of
date, and `ledger status` names it. Editing an item's text by hand doesn't: the
review reads the summary, and a reworded one asks for another review.

`ledger preview --run claude` writes the summary first when it's out of date,
and nothing else: a preview is for seeing what the release says so far, and an
audit or a review belongs to the cut. Without `--run`, the draft still prints,
with a note on its summary page saying the summary hasn't caught up.

## Starting over: the redraft

A ledger written one change at a time drifts into the shape its history gave
it. Past a point, the cheapest way to a document that reads well is a fresh
survey. What mustn't start again is everything the client already holds: the
version numbers, the editions themselves, and every fact those editions told
them. `ledger redraft` keeps all three.

```bash
ledger redraft start      # set the corpus aside, open the next version on an empty one
ledger bootstrap          # the survey, from scratch — it knows it's a redraft
git commit …
ledger redraft check      # check the new corpus against the old one
git commit …              # the check's edits, as a diff of their own
ledger cut --name "…"
```

**`redraft start`** copies the corpus into `.ledger/archive/v1-v4/` and marks it
read-only; `--dir` reads it (`ledger list --dir .ledger/archive/v1-v4`). The
released versions stay in `releases.json` as `archived`, so the next release is
v5, not v1. Config, brand, tone and theme carry over; features, areas,
sub-sections and the audit and review logs start empty. It refuses while
`.ledger/` has uncommitted changes, and while the open release has work recorded
against it (cut it first, or pass `--force`).

**`bootstrap`**, run during a redraft, doesn't read the archive (a survey that
starts from the old structure reproduces it), and stops before the cut.

**`redraft check`** is the step that makes a fresh survey safe. The CLI pairs
every archived entry with its likely counterpart, by id or by shared wording,
and lists the ones it couldn't pair first. The agent reads each old description
a statement at a time, finds where the new corpus says the same thing, and puts
back whatever it doesn't. It keeps the new structure: it restores facts, not the
old arrangement. It also writes a short note for the client on how the
arrangement changed, and stamps the redraft with
`ledger redraft complete --note "…"`.

Until that stamp is there, `ledger build` warns and `ledger cut` refuses.

### What the client sees

The first edition after a redraft prints as an inventory, opening with a grey
callout:

> **This edition is reorganized.** Editions 1 to 4 arranged this ledger
> differently. … Every capability from version 4 that Acme Portal still has is
> described here. …
>
> Bookings and Payments are one area, Bookings. Deposit refunds, previously its
> own entry, is part of Checkout.

The second paragraph is the agent's note; the first can be overridden under
`docs.redraft` in `config.json`. The old editions are left alone, and
`ledger build v3` reprints an archived one from its archive.

### A redraft done by hand

When you've reworked the entries yourself, mark the release in
`.ledger/releases.json`:

```json
{ "version": 4, "name": "Rewrite", "date": "2026-10-02", "status": "released", "commit": "…", "redraft": true }
```

Its edition opens with the same grey note and prints as an inventory, but
nothing is archived. It reissues the number before it and says so in the file
name (`HappyCake-Feature-Ledger_3_redraft.pdf`). It works on the first release
too, for a ledger that takes over from reports sent some other way. Since there
is nothing to compare it with, `ledger cut` doesn't ask for a review of it.
