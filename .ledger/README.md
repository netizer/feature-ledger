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

## Which of it you edit

**The words are yours.** The prose in `features/<id>.json`, in
`subcategories.json`, in `other-changes.json` and in the `docs` block of
`config.json` is meant to be opened and rewritten — that is how the ledger
comes to sound like something written for this client rather than by whatever
drafted it. Change a name, a description, a dev note or the text of a change
bullet; add the sentence the survey couldn't have known; cut what the client
shouldn't be reading. Nothing is recorded against a release, because nothing
about the product moved. Run `ledger status` afterwards — it validates every
file.

**What the product did goes through the CLI.** A new capability, a change to
one, a withdrawal: `ledger add`, `ledger update`, `ledger remove`. They resolve
which release the entry lands on, which is what every New/Changed tag in every
document is computed from, and `ledger update` refuses a change that never
says why it happened.

**Leave `releases.json` and `audits.json` alone.** The timeline has to keep
matching the editions already handed over, and an audit stamp set without the
sweep behind it makes a gap permanently invisible. `index.json` is in between:
every write keeps it complete, and the order in it is the deliberate reading
order — reorder that freely.

Run `ledger rules` for how to write, and `ledger --help` for the commands.

