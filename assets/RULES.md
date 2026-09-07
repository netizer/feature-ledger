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
ledger rules                    # this file
```

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
- **`category`** — one of the existing ones (`ledger categories`), or a new
  one placed deliberately with `ledger categories add "Name" --after "Other"`.
  The category list is the reading order of every document.
- **`size`** — **Big** = a standalone capability. **Medium** = a meaningful
  piece of a bigger area. **Small** = a specific behaviour or guardrail.
- **`description`** — plain language, present tense, describing what the
  product *does*. Never authorship: not "added X", not "we now support X",
  not "improved X" — just "X". A reader should not be able to tell from the
  wording whether this shipped last week or three years ago.
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

Phrase it plainly. Skip throat-clearing like "New this cycle" or "Changed this
release" — the surrounding document already labels the section.

**Never invent a reason.** If you don't know why a change was made, ask —
don't write a plausible-sounding one into a client-facing document.

Adding a second bullet later in the same release cycle: `"add_changes": [...]`
appends instead of replacing.

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

### Something that isn't a whole feature

A cosmetic tweak, a copy change, a guardrail that's really part of something
already listed — don't invent a feature entry for it. Either fold it into the
`changes` of the one feature it belongs to, or, if it belongs to no single
feature (a colour-semantics change, a wording pass across many screens), use:

```
ledger other-change --audience user --description "…"
```

That's exactly what it's for, so one global tweak doesn't force a `changes`
note onto a dozen unrelated features.

## Where the bar is

`audience: "user"` means it's worth something to the **client**. Not every
change clears that bar. These go in as `dev` instead, or as `dev_notes` on the
user feature they're part of:

- Internal and developer conveniences — a preview toggle for switching a look
  on before rolling it out, a landing page meant for demoing the build,
  anything a regular user wouldn't knowingly encounter.
- A fix or a hardening described as the *absence* of a problem rather than a
  capability: "a stray click can't submit twice", "guests get no data leakage
  from X".
- Minor copy or label rewordings of an already-listed feature that don't
  change what it does. Don't even add those as `changes` — just update the
  `description` text in place.

## Sub-sections

The level between a category and a feature, for when one area inside a
category has grown big enough that its features would otherwise read as a
wall. Declare one, then file features into it:

```
ledger subcategory add <<'JSON'
{ "id": "daily-calendar", "category": "Bookings", "name": "Daily calendar",
  "intro": "One or two sentences saying what this whole area is." }
JSON

ledger update some-feature --subcategory daily-calendar
```

Two rules keep the level load-bearing rather than a third tier of taxonomy to
maintain, and both are enforced:

- **At least 4 features** (counting both audiences), or it isn't a
  sub-section — its features belong loose in the category like everything
  else.
- **No `Big` inside one.** The heading and its intro *are* the overview, so a
  lead Big entry alongside them just rebuilds the wall the sub-section was
  meant to break up.

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

Before you finish: `ledger check`.
