# .ledger

The source of truth for this product's feature ledger. Commit all of it.
The Markdown documents it generates (`docs/generated/`) are build output and
are not committed; the client editions in `docs/client/` are, so every
document handed over stays in the repo.

| File | What it is |
| --- | --- |
| `config.json` | Product name, the area list (which is the reading order of every document, and may be empty), and any wording overrides. |
| `brand.json` | The client-swap surface: logo, one accent colour, fonts. |
| `releases.json` | The version timeline. The last entry, `status: "future"`, is the release in progress — everything new records against it. |
| `features/<id>.json` | One feature, with its full version history. |
| `index.json` | The deliberate order of the corpus, which is what breaks ties within a size band. Maintained automatically. |
| `subcategories.json` | Sub-section headings, for an area that grew too big to read as one list. |
| `other-changes.json` | Changes belonging to no single feature. |
| `theme.css` | Optional. Appended last to the PDF's stylesheet, for a one-off nudge. |

**Don't hand-edit any of it.** Run `ledger rules` for how to write to it, and
`ledger --help` for the commands.
