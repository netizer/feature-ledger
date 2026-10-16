# The documents

The ledger produces two kinds of document:

- **Three Markdown docs** for the team: `FEATURES.md`, `FEATURES_EXTENDED.md`
  (with dev notes) and `DEV_FEATURES.md`. They're regenerated on every build
  and always gitignored.
- **One PDF edition per release** for the client: what they were handed on a
  given day. Some teams keep these in the repo; others print them on demand.

## Editions and drafts

An **edition** is a release that was cut. `ledger cut` prints it into the client
directory under the name the client sees, and that is the only way a file gets
there:

```
docs/client/Acme-Portal-Feature-Ledger_6.pdf
```

A **draft** is the open release as it stands. `ledger preview` prints it, after
a short readout of where the release stands, and so does `ledger build` once
the open release has something in it. Neither ever starts an agent. Where
`ledger prepare` hasn't written a note yet, an updated entry prints its changes
as they were recorded, labelled as such. It goes in the gitignored docs
directory, with `-draft` in its name, so it can never be mistaken for, or
committed as, an edition:

```
docs/generated/Acme-Portal-Feature-Ledger_7-draft.pdf
```

`ledger build` with no arguments brings everything up to date: the Markdown,
every cut edition whose PDF isn't on disk (so a fresh clone gets them all back),
and the draft. `ledger build v3` prints one edition, `ledger build all` reprints
every edition with the current wording, and `--html` writes HTML instead of PDF
(the fast loop when you're tuning `theme.css`).

## What an edition holds

Every feature has **one number** throughout an edition: its area and its place
in it, `2.4`. The summary cites it, the details print it in the margin and the
catalogue lists by it, so a reader holding paper can follow any reference, and
on screen every number is a link. The PDF carries bookmarks for every part, area
and changed entry, so the reader's sidebar is a contents list.

Every status is printed as a word (*New*, *Changed*, *Already in place*,
*Removed*) as well as worn in a colour, so an edition survives a black-and-white
printer.

The **first edition**, and the first after a redraft, is an inventory: the
first page with the counts (features, areas, sizes), a contents list and a key
to the sizes, then every entry in full, area by area, each with how to see it.

**Every later edition** is short without dropping work:

1. **The first page is the update**, the page most clients stop at: the
   version, its name and date, what it is compared with, an overview of two or
   three sentences on what the release is about, a row of counts (new, changed,
   removed, unchanged, and features in all), the edition's three parts, each a
   link with a line on what it is for, and the summary lists (below).
2. **The changes in detail**, starting on a new page: every new, changed,
   in-place and removed entry, grouped the way the summary groups them, and in
   number order within each group. Each entry has a margin with its number,
   status and size. A new entry prints its description; an updated one leads
   with what changed, under the first sentence of its description, since the
   client read the rest last time. Each can say how to see it. Then the
   product-wide notes. The summary lists the same
   entries, one sentence each; this section gives them in full.
3. **Everything the product does**, starting on a new page: every feature,
   area by area, one line each (its number, its size, its name and its first
   sentence) under the area's one-sentence overview. It opens on its own
   contents, every area with its count and how many of its features moved,
   and the key to the sizes. What moved carries its status, which links to its details.

`ledger cut --full` (or `ledger build vN --full`) prints any edition as a full
inventory instead, with a contents list and what moved still marked. An edition
cut with `--full` reprints that way on its own.

Area overviews are `area_intros` in `.ledger/config.json`
(`{ "Ordering": "Everything a customer does to place an order." }`), or
`ledger categories add "Name" --intro "…"`. `ledger prepare` asks for any that
are missing.

## The summary page

From the second edition on, the first page lists what differs from the last
edition as short lists, each under a plain heading in the colour its entries
wear, with its count: *What's new*, *What changed*, *Already in place*, *No
longer available*, and *Across the product* for the product-wide notes.

The lists are the changes in detail read at one sentence each: the same groups,
the same entries in the same order, so the counts on the page agree with each
other. Each new, changed or in-place entry gets one line, linking to its
details and followed by its number. The line is the entry's sentence in
`summary` in `compositions.json`, written by `ledger prepare`: what the reader
gains, said the way they would pass it on ("Customers can book delivery a month
ahead, so regular orders no longer need a weekly reminder."), not the entry's
name. A removal's line says why it went and what to use instead, and a
product-wide note is listed by its first sentence.

Editions prepared before this wrote items that each summed up several entries
(`new`, `changed`, `in_place` and `quiet` lists of `{ text, covers }`), and
they reprint that way. They may also carry `matters`, a "Why it matters to
you" line on an entry, which no edition prints any more (the summary sentence
says it), and `message`, a text to send with the edition, which the cut no
longer writes. A release still open with that shape needs
`ledger prepare` again before its first page has one line per entry.

A draft says in a note at the top of the list when changes were recorded that
`prepare` hasn't read, and lists the entries by name where nothing is prepared
yet. An edition cut without a summary lists its entries by name too. Every page
of a draft says *Draft, not yet presented* in its footer.

The summary page's heading, the sentence under it and its first two list
headings are `summary_title`, `summary_intro`, `summary_new` and
`summary_updated` in the `docs.pdf` block of `.ledger/config.json`; the details
reuse the two list headings for their groups. The two parts after it are
`changed_title`, `changed_intro`, `rest_title` and `rest_intro`; what each of
the three parts is for, in the list on the first page, is `summary_role`,
`changed_role` and `rest_role`. The line on sizes is `key_sizes`.

## Writing for the client

The person reading has never seen the code, and reads the first page and
little else. `ledger status` warns when what they read drifts from that:

- a description past one or two sentences, or about 55 words for a Big entry,
  45 for a Medium and 35 for a Small;
- a "What changed" note past one sentence per change;
- a summary sentence past 25 words, or an overview past three sentences;
- client text that reads like code: something in backticks, a file name, a
  path into the source or a command-line flag. Those go in `dev_notes`.

All of it is a warning, never a refusal. The `prepare` brief and the agent
stanza ask for the same.

## Where they go

`ledger init` asks once:

```bash
ledger init --product "Acme Portal"                 # docs/generated/client/ — build output
ledger init --product "Acme Portal" --commit-pdfs   # docs/client/         — kept in the repo
```

|  | Markdown docs | Client PDFs | Drafts |
| --- | --- | --- | --- |
| default | `docs/generated/` — gitignored | `docs/generated/client/` — gitignored | `docs/generated/` |
| `--commit-pdfs` | `docs/generated/` — gitignored | `docs/client/` — **committed** | `docs/generated/` |

The only line `init` adds to `.gitignore` is `docs/generated/`. Committing the
editions costs about 100 KB per release and answers "what exactly did we show
them in March" without depending on the corpus still rendering the same way.
Leaving them out keeps the repo to text; any edition can be reprinted with
`ledger build vN`.

The paths are `output.dir` and `output.client_dir` in `.ledger/config.json`.
`ledger status` prints the resolved pair and which shape is in force.

The PDF needs a Chromium: Google Chrome or Edge if you have one (used
automatically), otherwise `npx playwright install chromium`.

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

- **`logo`**: a path relative to the project root; PNG, JPG, SVG or WebP,
  embedded so the finished file depends on nothing. Leave it out and the front
  page uses the product name as a serif wordmark.
- **`accent`**: one hex, and the other four tints are derived from it. Pin any
  of them (`accent_deep`, `accent_quiet`, `accent_mid`, `accent_pale`) when a
  brand guide insists. **The accent may not be green, blue or teal**: those hues
  mean "new" and "reworked" in every edition. `ledger status` warns when a brand
  picks one that collides.
- **`.ledger/theme.css`**: appended last to the PDF's stylesheet, for a one-off
  nudge.

Document titles, intros and the colophon are overridable in `.ledger/config.json`
under `docs`. The defaults are built from `product` and the one-line `tagline`.

## Tone

A ledger is read by a client, often in a second language. Left to itself, a
coding agent writes in its own voice. So the ledger names a **public style
guide**, which every coding agent already knows:

```bash
ledger style              # the tone this project writes in
ledger style list         # the four built in
ledger style set govuk    # switch, and update the agent stanza to match
ledger style rewrite      # an agent task: bring the existing entries over
```

| id | guide | reads like |
|----|-------|-----------|
| `google` *(default)* | [Google developer documentation style guide](https://developers.google.com/style) | Neutral and precise. The one most coding agents know best. |
| `govuk` | [GOV.UK content style guide](https://www.gov.uk/guidance/style-guide) | The plainest English of the four. |
| `plain-language` | [Federal Plain Language Guidelines](https://www.plainlanguage.gov/guidelines/) | The US plain-writing standard, with more attention to structure. |
| `ste` | [ASD-STE100 Simplified Technical English](https://www.asd-ste100.org/) | The aviation standard. Maximum clarity, deliberately clipped. |

There are no per-rule overrides. If none of the four fits,
`ledger style set custom` starts `.ledger/STYLE.md`: a page of prose, briefed
the way you'd brief a writer joining the team.

The tone reaches an agent through the stanza, through `ledger rules`, and at the
top of the bootstrap prompt, all from the one setting.

## Carrying on from earlier reports

A ledger started after the client already has reports numbered some other way
would hand them a "Version 1" they've seen before. Set `display_version` on a
release in `.ledger/releases.json`:

```json
{ "version": 1, "name": "Baseline", "date": "2026-09-08", "status": "released", "commit": "…", "display_version": 4 }
```

The v1 edition prints as Version 4, and every later one follows on. It's a label
only: the ledger still counts 1..N, and every command takes the real number.
`ledger releases` shows the printed number beside each release it differs on.
