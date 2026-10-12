# Keeping the feature ledger current

The ledger is a versioned record of what this product does, written for the
people who paid for it. It generates three Markdown docs for the team and one
archival PDF edition per release for the client.

**A change that ships a feature but doesn't update the ledger isn't done yet.**

## Where the line is

**Don't read the corpus by hand.** `.ledger/` is big, and opening it to change
one sentence pays for all of it every time. The commands cost a fraction:

```
ledger list                     # the whole corpus, one line per feature
ledger show <id>                # the single entry you're about to touch
ledger status                   # the release, the corpus and the setup, checked
ledger diff                     # what the open release holds, and how much code moved
ledger style                    # the tone to write in, on its own
```

**Record what moved through the CLI.** `ledger add`, `ledger change` and
`ledger remove` resolve which release the entry lands on, refuse a change that
never says why it happened, and keep the file formatting stable.

**The words are yours.** Once an entry exists, its prose is a text file you
open and edit. See *Editing the ledger by hand*, below.

{style}

## What counts as an entry

**One entry is one capability someone using this product would name.**
Something they could ask for, or would miss if it went away.

Two tests, and an entry has to pass both:

- **Could you demo it?** If showing it means pointing at a config file or a
  passing test rather than at the product doing something, it is not an entry.
- **Would demoing it look different from demoing the entry next to it?** If
  not, they are one capability described twice.

The bar doesn't move with the size of the project. Someone should be able to
read this document for a four-capability tool and for a two-hundred-capability
platform and understand each at the same altitude. The number of entries
follows the size of the product; how far in each entry zooms does not.

These are **below** the bar and don't get an entry at any size:

- Guardrails, refusals, validation, defaults: "it can't be submitted twice",
  "it's safe to run again", "the fields are checked first".
- Internal plumbing: file layouts, config keys, scripts, build steps.
- Polish: wording, colour, spacing, a better error message.
- Anything you can only describe as the absence of a problem.

A description has two or three sentences to work with: room for a capability
*and* the guardrail that makes it trustworthy, without that guardrail becoming
its own line in the contents. Everything else that deserves recording has a
home: `dev_notes` for the team's detail, `dev` features for internal
capabilities, `ledger note` for a tweak that spans the product.

## Naming an entry

The names *are* the document. Most people read down the contents list and stop
there, so the name has to carry the whole weight on its own:

> **Cover every description. Can a reader still say what the product does?**

Name the capability — a short noun phrase, or the action a person takes — in
the words the people who use the product use for their own work:

```
Daily calendar        Deposit refunds        Cutting a release
Saved baskets         Renaming a feature     Branding it for a client
```

It has to work in the contents list, next to entries from every other area,
and be tellable apart from its neighbours. What goes wrong:

- *The words are yours* → **Editing the ledger by hand.** A slogan, not the capability.
- *The codebase, checked against the record* → **The ledger audit.** A caption, not a name.
- *Reading the ledger without opening it* → **Listing and reading entries.** The mechanism.
- *What moved since the last edition* → **New and changed highlighting.** A question.
- *Areas, and the order they read in* → **Grouping features into areas.** Two ideas joined with "and".
- *Booking*, under an area called Bookings → **Guided booking wizard.** The area's name again.

Two to six words is usual. A name is wording, so improving one is an edit of
`name` in `.ledger/features/<id>.json`. `ledger change <id> --name "…"` is for
the other case: the *product* renamed something and the client needs telling.

## Recording what moved

### A new feature

```
ledger add booking-wizard <<'JSON'
{
  "audience": "user",
  "category": "Public Booking Website",
  "size": "Big",
  "name": "Guided online booking wizard",
  "description": "A guest can book services in a few simple steps, from service to date and time to details, with no account required.",
  "paths": ["web/booking/**", "api/bookings/**"]
}
JSON
```

- **`id`** — stable, kebab-case, never changed afterwards. It carries the
  feature's history across renames.
- **`audience`** — `user` if the client would ever care; `dev` if not. See
  *Where the bar is*, below.
- **`category`** — the area it belongs to. Optional while the ledger has fewer
  than two areas; `ledger categories` lists them.
- **`size`** — how much of *this* product the capability is. **Big**: one it
  is chosen for. **Medium**: a capability in its own right, inside a bigger
  one. **Small**: one narrow enough to describe in a line.
- **`description`** — what the product *does*, in the present tense, in two or
  three sentences. Never authorship: not "added X", not "we now support X".
  A reader must not be able to tell whether it shipped last week or three
  years ago.
- **`paths`** — the globs the capability's code lives in. See *Where the code
  lives*, below.
- **`dev_notes`** (optional) — implementation detail for the team. Appears in
  the extended doc, never in the client's.

### A change

```
ledger change event-end-time <<'JSON'
{
  "what": "The free rescheduling window is two hours instead of one.",
  "why": "A shift that small barely touches the artist's day, so it isn't worth charging for; it now matches the pricing rule.",
  "description": "The full current-state text, rewritten — not a diff."
}
JSON
```

A change is two facts: **what** moved, and **why**. You record them as they
are; you don't phrase them for the client. The "What changed" note the edition
prints is composed later, once, for the whole release (`ledger compose`), from
what the last edition said, what the entry says now, and these facts. So a
feature that changes three times in a release is three `ledger change`s, and
nobody has to revise the earlier ones.

- **`description`** — the whole current state, when it moved. Leave it out
  when the change doesn't touch what the description says.
- **`why`** is the part only the person who decided it knows. **Never invent
  one.** If you don't know, ask. If nobody can say, pass `--why-unknown`. A
  reason you read off a commit message or a pull request takes
  `--why-from commit`. Either opens a question for a person
  (`ledger questions`), and `ledger cut` asks it before printing.
- A feature that is **new** in the open release has no "before": update its
  description, and nothing else is recorded.
- Size, area, paths and dev notes alone (`ledger change <id> --size Small`)
  record nothing: where an entry lives isn't news.

### A rename

When the *product* renamed something and the client needs telling:

```
ledger change old-id --name "New name" --what "It was called “Old name”." --why "…"
```

The id never changes, and every document footnotes the previous name. A name
that was simply chosen badly is wording: edit it in the file.

### A removal

```
ledger remove some-feature --why "…"
```

The reason is printed in the edition, so it can't be left unknown.

### Something that isn't a whole capability

Most of what you ship is this: a guardrail, a default, a piece of behaviour
that's really part of something already listed. Record it as a change to the
one feature it belongs to, or, if it belongs to none (a colour-semantics
change, a wording pass across many screens):

```
ledger note --audience user --description "…"
```

### Better words for the same thing

Not a change. The product didn't move, so nothing should land on the release.
Edit the words in the file. If you're unsure which you're doing, ask whether
the client would want to be told. If they would, it's a `ledger change`.

## Where the code lives

Every entry carries `paths`: globs over the repository naming the files that
make the capability work. They are what let the ledger be checked against the
code: an audit can say which entry a changed file belongs to, a preview can say
how much code moved under each entry, and a glob that matches nothing is a
capability whose code moved or went.

```
ledger own booking-wizard 'web/booking/**'      # add a glob
ledger own booking-wizard 'web/old/**' --remove # take one off
ledger own --ignore 'scripts/release/**'        # not product code at all
ledger paths                                    # who owns what, and what nobody does
```

Prefer a directory or a pattern to a list of files. A module several
capabilities share can belong to several entries. Files that say nothing about
what the product does — tests, fixtures, CI, tooling — go in `ignore` in
config.json, so they never read as code no entry owns. When you add code for a
feature, make sure a glob of that feature covers it.

## Editing the ledger by hand

The corpus is JSON in your repository, and the prose in it is yours. Open the
file and change it. It's how a ledger drafted by a coding agent turns into a
document the client recognises:

- **Changing** the words. The draft says "users"; this client says "guests".
- **Adding** what the agent couldn't find: the sentence that says what a
  capability is *for*, which only ever existed in someone's head.
- **Deleting** what the client shouldn't read: an internal detail that drifted
  into a description, a note about something they never asked for.

None of that lands on a release or tags anything as changed, and the improved
wording reads as though it had always been there, including in editions
already printed. **Then run `ledger status`**: it validates every file.

### What's yours

| | |
| --- | --- |
| `.ledger/features/<id>.json` | `name` and `description` on any `history` entry; `dev_notes`; `paths`; `size`, `category` and `subcategory`, which must name ones that exist. Not `id`. |
| `.ledger/compositions.json` | A release's "What changed" notes (`changes`), its summary items' `text`, `covers` and `quiet`. Not `date`, `commit`, `inputs` or `verified`. |
| `.ledger/subcategories.json` | A sub-section's `name` and `intro`. |
| `.ledger/config.json` | Product name, tagline, the `docs` block, `ignore`, `checks`. |
| `.ledger/other-changes.json` | The `description` of a product-wide note. |
| `STYLE.md`, `theme.css` | Prose and CSS. |

Editing a composed note or summary item by hand is safe: it doesn't put the
composition out of date, and the next `ledger compose` keeps it unless the
entry it is about moves again.

### What stays with the CLI

- **History and events.** Adding, dropping or re-dating a `history` entry, and
  anything in `events`: which release an edit lands on is what every New and
  Changed tag is computed from, and an event is a fact somebody recorded.
- **`releases.json`, and the stamps** in `audits.json`, `compositions.json`
  and `redrafts.json`. A stamp set without the work behind it hides exactly
  what it exists to catch.
- **Anything under `.ledger/archive/`.** The editions already handed over
  print from it.
- **Keeping `index.json` complete.** The *order* in it is yours: it is the
  reading order within a size band.

## Where the bar is

`audience: "user"` means it's worth something to the **client**. These go in
as `dev` instead, or as `dev_notes` on the user feature they're part of:

- Internal and developer conveniences, anything a regular user wouldn't
  knowingly encounter.
- A fix described as the *absence* of a problem: "a stray click can't submit
  twice".
- A minor copy change to an already-listed feature: edit the description.

## Areas and sub-sections

A ledger starts with no areas: everything sits in one called "Features", which
prints without a heading. Add areas when the product has parts someone using
it would recognise and name, not the ones the code is organised into. The list
is the reading order of every document:

```
ledger categories add "Bookings" --after "Public Booking Website"
ledger change some-feature --category "Bookings"
```

A sub-section is for an area with a real part inside it, not one whose list
passes some length:

```
ledger subcategories add <<'JSON'
{ "id": "daily-calendar", "category": "Bookings", "name": "Daily calendar",
  "intro": "One or two sentences saying what this whole part is." }
JSON
```

Nothing counts entries per area or per sub-section.

## Recording something that was already there

An audit finds capabilities that shipped without the ledger hearing about it.
They land on the open release, because *new* in a client edition means new to
the reader, but they must not print as this release's work. So every write
takes `--backfilled`, which draws the entry grey: **the product didn't move
this cycle; the record did.** Use it only for what happened before the last
cut; the commit dates answer that, never a guess.

## Releases

All work records against the open release. When a release is shown to the
client:

```
ledger cut --name "Client demo"
```

The cut runs every check (`redraft`, `audit`, `content`, `compose`, `verify`,
`questions`, `moment`), asks the open questions at a terminal, and refuses
with the whole list when any is open, each with what to run. `--run claude`
hands an open audit, composition or verify to an agent first. It prints the
PDF edition and opens the next release, and every edition reprints exactly as
it was presented, however long ago.

## The checks, in brief

- **`ledger audit`** — what landed without the ledger hearing about it: code
  that moved under an entry that didn't, and changed code no entry owns. It
  carries the diffs. `--full` sweeps everything.
- **`ledger compose`** — the "What changed" notes and the summary the edition
  opens with, from the ledger alone. Cheap enough to run every day.
- **`ledger verify`** — what the edition says, checked against the code. It
  edits nothing; what it doubts becomes a question. Opt-in for the cut.

## Generating

`ledger preview` prints the size readout and a draft of the open release.
`ledger build` writes the Markdown docs and any edition not on disk yet. All of
it is build output: **the corpus under `.ledger/` is what's committed**. Don't
regenerate as part of an ordinary change.

Before you finish: `ledger status`.
