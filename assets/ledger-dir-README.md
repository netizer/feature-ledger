# .ledger

The source of truth for this product's feature ledger. Commit all of it.
{output_line}

| File | What it is |
| --- | --- |
| `config.json` | Product name, the area list (which is the reading order of every document, and may be empty), the tone, and any wording overrides. |
| `brand.json` | The client-swap surface: logo, one accent colour, fonts. |
| `releases.json` | The version timeline. The last entry, `status: "future"`, is the release in progress — everything new records against it. `status: "archived"` ones were printed from a corpus in `archive/`. |
| `features/<id>.json` | One feature: its state at every version it moved (`history`: name, description, how to see it), and what changed and why (`events`). |
| `compositions.json` | Per release, the "What changed" notes, the summary and the message its edition goes out with, written by `ledger prepare`, and what it had read when it wrote them (`prepared`). |
| `index.json` | The deliberate order of the corpus, which is what breaks ties within a size band. Maintained automatically. |
| `subcategories.json` | Sub-section headings, for an area that grew too big to read as one list. |
| `other-changes.json` | Changes belonging to no single feature. |
| `redrafts.json` | Every time the corpus was written again from scratch, and when the new one was checked against the old. Written by `ledger redraft`. |
| `archive/<label>/` | A corpus a redraft set aside, read-only. The editions it produced are printed from it. |
| `theme.css` | Optional. Appended last to the PDF's stylesheet, for a one-off nudge. |

## Which of it you edit

**The words are yours.** The names, descriptions, how-to-see texts and dev
notes in `features/<id>.json`, the notes, summary items and message in
`compositions.json`, and the prose in `subcategories.json`,
`other-changes.json` and the `docs` block of `config.json` are meant to be
opened and rewritten — that is how the ledger comes to sound like something
written for this client rather than by whatever drafted it. Nothing is
recorded against a release, because nothing about the product moved. Run
`ledger status` afterwards — it validates every file.

**What the product did goes through the CLI.** A new capability, a change to
one, a withdrawal: `ledger add`, `ledger change`, `ledger remove`. They resolve
which release the entry lands on, which is what every New/Changed tag is
computed from, and `ledger change` refuses a change that never says why it
happened, or that it isn't known.

**Leave `releases.json`, `redrafts.json`, the `events` in a feature, the
`prepared` stamp in `compositions.json` and `archive/` alone.** The timeline has
to keep matching the editions already handed over, and an edition already cut
reprints from what is recorded for it. One exception: when someone gives the
reason for a change that had none, it goes into that event's `why`, with
`"why_from": "person"`. `ledger prepare` does this as it asks.

Run `ledger rules` for how to record, and `ledger --help` for the commands.
