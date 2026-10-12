# Preview, prepare, cut

> **Preview is free, prepare costs tokens, cut prints.**

Three commands take a release from open to handed over. Only one of them
spends tokens, and only when you run it.

## Facts while you build, client text once per release

While work happens, the coding agent records **facts**: a new capability
(`ledger add`), or what changed in one and why (`ledger change`), as one event
each. Nobody writes for the client at that point.

The reason is the client's point of view. They hold the last edition and never
saw anything in between, so a note written as a change lands describes a
"before" they may never have had. Written mid-release, a ledger says things like
"Events synced from Acuity no longer appear under Unpaid" in the release that
introduced the sync, or "Confirm all is now near the top" in the release that
introduced Confirm all, or adds a chart in one note and redesigns it in the next
three. Written once, from the last edition, the entry as it stands now, and the
events between, a note can only describe a difference the client will see.

## `ledger preview` — free

```
v6 so far, against v5 (September 12, 2026):
  new         2   1 Big · 1 Small
  updated     4   1 Big · 3 Medium        7 changes recorded, 3 since the last prepare
  removed     1   Small
  code            1,240 lines changed since v5's commit, working tree included
```

Then the draft, laid out exactly like the edition the cut will print. Where
`prepare` has written a note, the note shows; where it hasn't, the recorded
changes show instead, each with its reason, labelled "as recorded, not yet
prepared". The first page lists entries by name until a summary is written.

No agent, no cache, nothing that ties code to entries. The line count is git's,
for the whole working tree since the last edition's commit.

## `ledger prepare` — one interactive session

`ledger prepare` prints one brief, meant to be pasted into **your** agent
session, in the project root, with you there (`--copy` puts it on the
clipboard; `--run claude` only if you type it). It carries, where there is
something to say:

1. **What the client last saw, against now.** For every new, updated, in-place
   and removed client-facing entry: its text in the last edition, its text now,
   how to see it, and the events recorded between (what, why, and where the why
   came from). Entries that moved since the last prepare are marked `*`, and
   what was written before is included, so notes that still hold are kept as
   they are, hand-edits included.
2. **Work nobody recorded.** The code since the last edition's commit, working
   tree included, as a diffstat, with the commit subjects. The agent reads what
   it needs, compares it with section 1, and records what someone using the
   product would notice (`ledger add` / `change`; `--backfilled` for a
   capability that was there before the last edition).
3. **Reasons nobody recorded.** Events whose reason is unknown or was read off a
   commit message. The agent asks you, one at a time, and writes your answer
   into the event.
4. **What to write.** The overview that opens the edition, the "What changed"
   note on each updated entry, why a change matters where a reason was given,
   the summary lists, `how_to_see` for each new or updated entry, an overview
   for any area without one, and the message to send. All of it for a reader
   who has never seen the code.
5. **Check it against the code.** Every sentence it wrote, and every
   description it touched. Where the text and the code disagree, it tells you,
   and you fix the code or the text right there.

It ends with `ledger prepare complete`, which refuses what would print wrong
(an updated entry with no note, an entry neither summed up nor left off the
summary on purpose, an item that won't read as a sentence) and records what the
release looked like when it was prepared. Then a short list of what it changed.
It doesn't commit.

Run it mid-release to see the near-final text, and again before the cut. A
change recorded afterwards shows as news since the last prepare, everywhere;
editing the words by hand never does.

### The overview

Two or three sentences under the version number on the first page: what this
release is about, as a whole. The list under it does the itemising.

### The notes

One per updated entry, one sentence per change: what it was in the last
edition, what it is now, and why, from the recorded reasons or from you, and
from nowhere else. Steps toward one result are one note; a change a later one
undid is no note at all. A change whose "before" is itself new this release
says how the entry works with the new thing and points to it by name.

### Why it matters

Optional, one sentence per new or updated entry, on what the change does for the
client: time saved, a mistake that can't happen now. Only from a reason the
events or you gave; otherwise left out.

### The summary lists

A handful of items of at most 12 words, most important first, each followed by
links to the entries it covers: *What's new*, *What changed*, and *Already in
place* for capabilities recorded late. Removals and product-wide notes list
themselves. The summary picks highlights; the edition still prints every
recorded change in detail after it. `quiet` only keeps an entry off the list.

### How to see it

A short text per entry telling the client how to check the claim themselves:
"Open Settings → Delivery and choose *Book ahead*; dates up to four weeks out
are selectable." It lives next to the description, so an old edition reprints
the instructions it was sent with. Plain instructions, read off the routes and
labels in the code; left empty rather than guessed.

### The message

The text to paste into an email or chat with the edition: an opening line with
no greeting ("Version 6 of the Acme Portal feature ledger is attached."), the
summary items as a short list, and a line on anything removed. Plain text. When
`prepare` didn't write one, the cut builds a plain one from the summary.

## Reasons nobody recorded

The ledger never invents a reason. A change recorded with `--why-unknown`, or
with a reason read off a commit (`--why-from commit`), keeps that on its event.
Bare `ledger` lists them; `ledger prepare` asks you about them; the cut says
how many are left. When you give one, it goes into the event with
`"why_from": "person"`: the one change ever made to an event. When nobody knows,
the note says what changed, and stops.

## `ledger cut` — prints

```bash
ledger cut --name "Sprint 6 demo"
```

It prints the edition into the client directory with the message beside it,
records the release's commit, and opens the next release. It **refuses** only
when the edition would be wrong:

- the corpus doesn't load (a broken file),
- a redraft hasn't been checked against the corpus it replaced,
- nothing is recorded against the release (the edition would repeat the last).

Everything else is a **warning**, shown before it asks to go ahead:

- changes recorded since the last prepare, or no prepare at all,
- updated entries with no prepared note (they print their changes as recorded,
  and those lines are frozen with the edition),
- reasons nobody has vouched for,
- uncommitted changes in `.ledger/` (the edition can't be traced to a commit),
  or in the code (the commit it records doesn't include them),
- the same day and commit as the previous release.

At a terminal it asks; anywhere else it needs `--yes`. `--dry-run` shows all of
it and writes nothing. There are no checks to skip and nothing to force: the
tool's job is to say clearly what isn't done, and yours to decide.

`ledger` and `ledger status` show the same report, so "is it ready?" can be
asked without trying to cut. A refusal exits with code 3.

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
sub-sections and compositions start empty. It refuses while `.ledger/` has
uncommitted changes, and while the open release has work recorded against it
(cut it first, or pass `--force`).

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
is nothing to compare it with, it has no notes and no summary.

## Deliberately left out

- Mapping code to entries. Commits run across features, a feature can grow
  without touching the files it started in, and keeping the map true is a
  second job. `prepare` reads the code since the last edition instead.
- A standalone audit, summary, review or verify, and stamps that invalidate each
  other. They are the steps of one `prepare` session.
- Agents started by `cut`, `preview` or `build`. Tokens are spent on purpose.
- Gates, `--skip` and `--force`. Warnings, and your call.
