# Keeping it honest: the checks

`ledger cut` refuses to print an edition until seven things are true. It works
all of them out every time, and a refusal lists the whole set, each with the
command that fixes it. `ledger` and `ledger status` show the same list without
trying to cut.

| Check | Open when | Fixed by |
| --- | --- | --- |
| `redraft` | a redrafted corpus hasn't been checked against the one it replaced | the steps `ledger redraft` prints |
| `audit` | code moved that the ledger hasn't accounted for: under an entry that didn't move, or owned by no entry | `ledger audit` |
| `content` | nothing is recorded against the open release, so its edition would repeat the last one | recording the work, or `ledger audit` |
| `compose` | nothing is composed for the release, or an entry was recorded, changed or removed since it was | `ledger compose` |
| `verify` | it is turned on, and the composed text changed since it was last checked against the code | `ledger verify` |
| `questions` | a reason nobody vouched for, or something a check doubted, is still open on the release | `ledger questions`, or answering them when `ledger cut` asks |
| `moment` | the release would stand for the same day *and* the same commit as the one before | cutting at a later commit (`--commit`) |

`--skip audit,questions` passes the checks you name, and only those. `--force`
skips all of them; prefer `--skip`, so the one you meant is the only one you
passed. A refused cut exits with code 3. `--skip summary,review`, the old
names, still work and mean `compose,verify`.

The order is deliberate. Until a redrafted corpus is checked, anything the
others ask is asked of a corpus that may still be missing what the client was
told. Unaudited work comes before the empty-release check, because when both
fire they have one cause: work landed and the ledger never heard about it. The
composition comes next, because it is written from what was recorded, and the
verify after it, because it reads what was composed. Questions come last,
because every step before can open one.

## Recording facts, composing text

The checks rest on one split. While work lands, the ledger records **facts**:
an entry's state at each release, and for every change, what moved and why
(`ledger change`). Nobody writes for the client at that point. What the client
reads about a release (a "What changed" note under every updated entry and the
short lists the edition opens with) is **composed** once, for the whole
release, from the entry as the last edition showed it, as it stands now, and
the facts recorded between.

That is what makes the text trustworthy. A note written as a change landed
describes the state just before that change, which the client may never have
seen: a fix to something that is itself new this cycle, or a chart introduced
in one bullet and redesigned in the next three. A note composed from the two
editions can only describe a difference the client will see.

## The audit

Everything recorded through a coding agent that read the stanza is current. A
developer who doesn't use one can ship a capability, and the ledger never hears
about it. `ledger status` in a commit hook can't help: it catches a corpus
that's *broken*, not one that's out of *date*.

`ledger audit` is the parallel track. Each entry names the code it lives in
(`paths`), so the CLI does the cheap half first: it walks the commits since the
last audit and sets aside everything that was recorded, owned or ignored. What
is left is the residue:

- **code that moved under an entry whose record didn't**: not in the same
  commit, and not anywhere in the open release. For a file several entries
  share, any one of them moving accounts for it;
- **changed code no entry owns**; and
- **globs that no longer match a file**: a capability whose code moved or went.

The gate fires only on residue, so a release whose work was all recorded never
asks for an audit, however many commits landed. The brief hands the agent the
residue with its diffs, a few dozen lines per group and about a thousand in
all, so it reads changes rather than file names.

```bash
ledger audit                    # the residue since the last audit
ledger audit --full             # the whole codebase
ledger audit --run claude       # …handed straight to an agent
```

The agent records what it finds, claims unowned code for the entry it belongs
to (`ledger own`), marks what isn't product code as ignored
(`ledger own --ignore`), and stamps the commit it audited:

```bash
ledger audit complete --commit a1b3f9c
```

That stamp is a command, never a hand-edit, because it's the one field that
makes a gap permanently invisible if it's set without the work being done.

A project whose entries have no `paths` yet owns nothing, so every changed file
is residue: the audit works as a plain commit range until ownership is filled
in. `ledger paths` shows where it stands.

### What an audit finds, and how it prints

An audit turns up things that were already true. They still land on the open
release, since *new* in a client edition means new **to the reader**, but they
must not print as this release's work. So every write takes `--backfilled`,
which draws the entry in a third register:

| | |
| --- | --- |
| **green** | built this cycle |
| **blue** | reworked this cycle |
| **grey** | already in the product; this is the first edition to list it |

> **Grey means the product didn't move this cycle — the record did.**

Nothing is ever written into a past release, so every edition already issued
reprints exactly as it was. A capability the audit finds is **gone** is reported
too, worded so it claims no date.

## Questions

`ledger change` refuses a change with no reason, and that rule doesn't relax
after the fact, even when the person who knew why is long gone. So a reason
an agent read off a commit message is recorded with `--why-from commit`, and a
change nobody can explain with `--why-unknown`. Either opens a question in
`.ledger/questions.json`:

```bash
ledger questions                          # what's open
ledger questions answer 3 "Because …"     # the reason, in your words
ledger questions accept 3                 # the reason stands as it is
ledger questions dismiss 3                # nothing to do
```

An answer becomes the change's reason, so the next composition can say it. A
verify's findings are questions too. They outlive the terminal an agent ran in,
and an open one on the release holds the cut; at a terminal, `ledger cut` asks
them one at a time. None of it reaches the client document.

## Composing

From the second edition on, each edition says what moved: a "What changed"
note under every updated entry, and a page after the cover with short numbered
lists of what's new, what changed and, when there are any, what was already in
place, what is no longer available, and the product-wide notes. Many readers
read only that page, so it lists what is worth knowing, not everything that
moved.

```bash
ledger compose              # the prompt, for a coding agent
ledger compose --run claude
ledger compose complete     # check it accounts for every entry, and stamp it
```

The prompt carries each entry as the last edition showed it, as it is now,
and what was recorded between, so the agent reads nothing else, not even the
code: it is cheap enough to run every day, and `ledger preview --run` does. It
writes a note per updated entry, only from the recorded reasons, folding steps
into their result and leaving out what a later change undid. The summary items
fold consequences into their cause, and an entry nobody would miss goes in
`quiet`. It never supplies a reason the facts don't give.

`ledger compose complete` refuses an updated entry with no note, a note on an
entry the client has never seen, and an entry neither covered nor quiet, then
records a fingerprint of what each entry was composed from. Recording a change
afterwards puts the composition out of date, by name, and the next composition
rewrites only the entries that moved. Editing the composed words by hand
doesn't: the hand-edit is kept.

## Verifying

Composing reads only the ledger; `ledger verify` is the step that reads the
code. Its prompt lists every sentence the edition will print about the release
(each entry's description and note, and the summary), with the code each entry
lives in and the files that moved under it. The agent checks each one, edits
nothing, and files what it can't confirm as a question. `ledger verify
complete` stamps a fingerprint of the text it read.

It is off by default. Turn it on, and the cut asks for it, in
`.ledger/config.json`:

```json
{ "checks": { "verify": true } }
```

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
sub-sections, the audit log, compositions and questions start empty. It refuses while
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
is nothing to compare it with, `ledger cut` asks for no composition.
