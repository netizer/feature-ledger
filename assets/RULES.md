# Keeping the feature ledger current

The ledger is a versioned record of what this product does, written for the
people who paid for it. It generates three Markdown docs for the team and one
archival PDF edition per release for the client.

**A change that ships a feature but doesn't update the ledger isn't done yet.**

## The one rule that matters

Never open, hand-edit, or read the JSON under `.ledger/` directly. Every read
and every write goes through the `ledger` command. It resolves which release
you're writing against, keeps the file formatting stable, and refuses the
mistakes that are expensive to find later.

```
ledger list                     # the whole corpus, one line per feature
ledger show <id>                # the single entry you're about to touch
ledger status                   # the release, the corpus and the setup, checked
ledger rules                    # this file
ledger style                    # the tone to write in, on its own
```

{style}

## What counts as an entry

**One entry is one capability someone using this product would name.**
Something they could ask for, or would miss if it went away.

Two tests, and an entry has to pass both:

- **Could you demo it?** If showing it means pointing at a config file or a
  passing test rather than at the product doing something, it is not an entry.
- **Would demoing it look different from demoing the entry next to it?** If
  not, they are one capability described twice.

The bar doesn't move with the size of the project. That is the whole point of
it: someone should be able to read this document for a four-capability tool
and for a two-hundred-capability platform and come away understanding each at
the same altitude — not the small one in forensic detail and the large one in
vague gestures. The number of entries follows the size of the product; how far
in each entry zooms does not.

These are **below** the bar and don't get an entry at any size:

- Guardrails, refusals, validation, defaults — "it can't be submitted twice",
  "it's safe to run again", "the fields are checked first".
- Internal plumbing: file layouts, config keys, scripts, build steps.
- Polish: wording, colour, spacing, a better error message.
- Anything you can only describe as the absence of a problem.

None of that is unimportant; it is just not what this document is for. A
description has two or three sentences to work with, which is room for a
capability *and* the guardrail that makes it trustworthy — without that
guardrail becoming its own line in the contents. Everything else that still
deserves recording has a home: `dev_notes` for the team's detail, `dev`
features for internal capabilities, `ledger other-change` for a tweak that
spans the product.

## Recording a change

### A new feature

```
ledger add booking-wizard <<'JSON'
{
  "audience": "user",
  "category": "Public Booking Website",
  "size": "Big",
  "name": "Guided online booking wizard",
  "description": "A guest can book services in a few simple steps (service → date & time → details → optional add-ons → review) with no account required."
}
JSON
```

- **`id`** — stable, kebab-case, and never changed afterwards. It's the
  identity that carries the feature's history across renames.
- **`audience`** — `user` if the client would ever care; `dev` if not. See
  *Where the bar is*, below.
- **`category`** — the area it belongs to. **Optional**: a ledger with no
  areas puts everything in one called "Features", which prints without a
  heading, and a ledger with exactly one area puts it there. Once there are
  two or more, name one — the list is the reading order of every document, so
  the tool won't guess. `ledger categories` lists them; `ledger categories add
  "Name" --after "Other"` places a new one.
- **`size`** — how much of *this* product the capability is. **Big** = one it
  is chosen for. **Medium** = a capability in its own right, inside a bigger
  one. **Small** = one narrow enough to describe in a line. All three are
  capabilities: the scale ranks them, it doesn't lower the bar.
- **`description`** — what the product *does*, in the present tense, written
  in the tone above. Never authorship: not "added X", not "we now
  support X", not "improved X". Just "X". A reader must not be able to tell
  from the wording whether this shipped last week or three years ago.
- **`dev_notes`** (optional, `user` features only) — implementation detail for
  the team: file and class names, gotchas. Appears in the extended doc, never
  in the client-facing one.

### A changed feature

```
ledger update event-end-time <<'JSON'
{
  "description": "The full current-state text, rewritten — not a diff.",
  "changes": [
    "Free rescheduling window widened from 1 hour to 2, matching the pricing rule: a shift that small barely touches the artist's plan for the day, so it isn't worth charging for."
  ]
}
JSON
```

`changes` is a JSON **array**, one entry per distinct thing that's different,
and each bullet carries **two** things: what it was before, and **why it
moved**. The client can already see *what* it is now from the description; the
reason is the part only you know, and it's what makes the ledger worth reading
rather than a diff. Two or three sentences per bullet is normal.

Change notes are written in the same tone as everything else. Skip
throat-clearing like "New this cycle" or "Changed this release". The
surrounding document already labels the section.

**Never invent a reason.** If you don't know why a change was made, ask —
don't write a plausible-sounding one into a client-facing document.

Adding a second bullet later in the same release cycle: `"add_changes": [...]`
appends instead of replacing.

### Better words for the same thing

A copy fix is not a change. The product did not move, so nothing should land
on the release and nothing should be tagged:

```
ledger reword some-feature <<'JSON'
{ "description": "The same feature, said more clearly." }
JSON
```

It edits the text of the entry in place. `--version N` reaches back to fix an
older edition's wording, and `ledger subcategory reword <id>` does the same
for a sub-section's heading and overview. Rewording can improve a `changes`
bullet, but it cannot add or remove one: that is recording a change, and
belongs in `ledger update` where it will be dated. To bring a whole ledger
into a new tone at once, `ledger style rewrite` prints the procedure.

Use this when a description reads badly, not when the thing it describes has
moved. If you are unsure which one you are doing, ask whether the client would
want to know. If they would, it is an `update`.

### A rename

```
ledger rename old-id "New name" --why "…what it was called before, and why the name moved."
```

The generators footnote the old name automatically; `--why` is the bullet the
reader gets.

### A removal

```
ledger remove some-feature --reason "…"
```

### Something that isn't a whole capability

Most of what you ship is this: a guardrail, a copy change, a default, a piece
of behaviour that's really part of something already listed. It does not get
an entry. Either fold it into the `changes` of the one feature it belongs to,
or, if it belongs to no single feature (a colour-semantics change, a wording
pass across many screens), use:

```
ledger other-change --audience user --description "…"
```

That's exactly what it's for, so one global tweak doesn't force a `changes`
note onto a dozen unrelated features.

## Where the bar is

`audience: "user"` means it's worth something to the **client**. Not every
capability clears that bar. These go in as `dev` instead, or as `dev_notes` on
the user feature they're part of:

- Internal and developer conveniences — a preview toggle for switching a look
  on before rolling it out, a landing page meant for demoing the build,
  anything a regular user wouldn't knowingly encounter.
- A fix or a hardening described as the *absence* of a problem rather than a
  capability: "a stray click can't submit twice", "guests get no data leakage
  from X".
- Minor copy or label rewordings of an already-listed feature that don't
  change what it does. Don't add those as `changes`; use `ledger reword`.

## Areas

A ledger starts with no areas and doesn't need any: everything sits in one
called "Features", which prints without a heading, so a product that is one
coherent thing reads as a list of what it does rather than as a chapter of
one.

Add areas when the product actually has parts — parts someone using it would
recognise and name, not the ones the code is organised into. Name each for
what the software is *for*, and place it deliberately, because the list is the
reading order of every document:

```
ledger categories add "Bookings" --after "Public Booking Website"
ledger update some-feature --category "Bookings"
```

`ledger categories rename "Features" "Bookings"` turns the default area into
the first real one, carrying its features with it; `ledger categories remove`
drops one once it's empty.

There is no right number of entries in an area. A product with an editor in it
has an editor-shaped area, and if that's twenty distinct capabilities that
don't group any further, twenty is what it holds. An area opened today for
work starting tomorrow holds one. Nothing counts them.

## Sub-sections

The level between an area and a feature, for when one area inside a category
has grown big enough that its features would otherwise read as a wall. Declare
one, then file features into it:

```
ledger subcategory add <<'JSON'
{ "id": "daily-calendar", "category": "Bookings", "name": "Daily calendar",
  "intro": "One or two sentences saying what this whole area is." }
JSON

ledger update some-feature --subcategory daily-calendar
```

Reach for one when an area has a real part inside it, not when its list passes
some length. A long list of genuinely distinct capabilities is a long list;
breaking it up on a count invents headings a reader then has to learn. Nothing
counts how many features a sub-section holds, either: two is fine if two is
what that part of the product is.

One thing to watch, and `ledger status` mentions it rather than refusing: a
sub-section that leads with a `Big` entry says the same thing twice, because
its heading and intro are already that part's overview.

## New / Changed tagging is automatic

There is nothing to tag and nothing to strip. A feature is marked **New** or
**Changed** wherever its latest history entry lands on the release that's
currently in progress. When that release is cut, every tag from the cycle goes
quiet on its own.

## Releases

All work records against the open (in-progress) release. When a release is
actually presented to the client:

```
ledger release cut --name "Client demo" --date 2026-08-21
ledger build
```

That mints the archival PDF edition for what was just shown, and opens the
next release for the work that follows. The PDF for an old release always
reproduces what was presented at that moment, however long ago.

## Generating

`ledger build` writes the three Markdown docs and the PDF edition. They're
build output and are gitignored — **the corpus under `.ledger/` is the thing
that's committed**, and it carries the documentation's git history on its own.

Don't regenerate as part of an ordinary change. Generation is run by hand,
occasionally, by whoever needs a fresh copy — and always when cutting a
release.

Before you finish: `ledger status`.
