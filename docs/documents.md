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
a short readout of how big the release is (`--size` stops there), and so does
`ledger build` once the open release has something in it. `--run claude` on
either composes what changed first, when anything has moved since it was last
composed. Until then, an updated entry's "What changed" note prints the changes
as they were recorded, labelled as such. It goes in the
gitignored docs directory, with `-draft` in its name, so it can never be
mistaken for, or committed as, an edition:

```
docs/generated/Acme-Portal-Feature-Ledger_7-draft.pdf
```

`ledger build` with no arguments brings everything up to date: the Markdown,
every cut edition whose PDF isn't on disk (so a fresh clone gets them all back),
and the draft. `ledger build v3` prints one edition, `ledger build all` reprints
every edition with the current wording, and `--html` writes HTML instead of PDF
(the fast loop when you're tuning `theme.css`).

## The summary page

From the second edition on, the page after the cover lists what differs from
the last edition as short numbered lists, each under a plain heading in the
colour its entries wear: *What's new*, *What changed*, *Already in place*, *No
longer available*, and the product-wide notes. The first three are composed
with the release's "What changed" notes, by `ledger compose`: each item is a sentence that
reads on its own, followed by numbered links, `[1] [2] [3]`, to the entries it
sums up. A removal is listed by its name, and a product-wide note by its first
sentence. The first edition, and the first after a redraft, have nothing to
compare with and print no summary.

A draft whose composition is missing or out of date says so in a note at the
top of the page, and lists the entries by name where nothing is composed yet.
An edition cut before summaries existed lists its entries by name, as it
always did.

The heading, the sentence under it and the first two list headings are
`summary_title`, `summary_intro`, `summary_new` and `summary_updated` in the
`docs.pdf` block of `.ledger/config.json`. `{date}` in the intro becomes
the last edition's date.

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
