# .ledger

The source of truth for this product's feature ledger. Commit all of it,
except `.cache/`, which is gitignored.
The Markdown documents it generates (`docs/generated/`) are build output and
are not committed; the client editions in `docs/client/` are, so every
document handed over stays in the repo.

| File | What it is |
| --- | --- |
| `config.json` | Product name, the area list (which is the reading order of every document, and may be empty), the files that aren't product code (`ignore`), opt-in checks, and any wording overrides. |
| `brand.json` | The client-swap surface: logo, one accent colour, fonts. |
| `releases.json` | The version timeline. The last entry, `status: "future"`, is the release in progress — everything new records against it. `status: "archived"` ones were printed from a corpus in `archive/`. |
| `features/<id>.json` | One feature: the code it lives in (`paths`), its state at every version it moved (`history`), and what changed and why (`events`). |
| `compositions.json` | Per release, the "What changed" notes and the summary its edition prints, and a fingerprint of what they were composed from. Written with `ledger compose`. |
| `questions.json` | What only a person can settle: reasons read off a commit or never recorded, and what a check doubted. `ledger questions`. |
| `index.json` | The deliberate order of the corpus, which is what breaks ties within a size band. Maintained automatically. |
| `subcategories.json` | Sub-section headings, for an area that grew too big to read as one list. |
| `other-changes.json` | Changes belonging to no single feature. |
| `audits.json` | Every audit so far, and the commit each one covered. Written by `ledger audit complete`. |
| `redrafts.json` | Every time the corpus was written again from scratch, and when the new one was checked against the old. Written by `ledger redraft`. |
| `archive/<label>/` | A corpus a redraft set aside, read-only. The editions it produced are printed from it. |
| `theme.css` | Optional. Appended last to the PDF's stylesheet, for a one-off nudge. |
| `.cache/` | What the last `ledger preview` saw, for "since your last look". Not committed. |

## Which of it you edit

**The words are yours.** The names, descriptions and dev notes in
`features/<id>.json`, the notes and summary items in `compositions.json`, and
the prose in `subcategories.json`, `other-changes.json` and the `docs` block of
`config.json` are meant to be opened and rewritten — that is how the ledger
comes to sound like something written for this client rather than by whatever
drafted it. Nothing is recorded against a release, because nothing about the
product moved. Run `ledger status` afterwards — it validates every file.

**What the product did goes through the CLI.** A new capability, a change to
one, a withdrawal: `ledger add`, `ledger change`, `ledger remove`. They resolve
which release the entry lands on, which is what every New/Changed tag is
computed from, and `ledger change` refuses a change that never says why it
happened, or that it isn't known.

**Leave `releases.json`, `audits.json`, `redrafts.json`, the `events` in a
feature, the stamps in `compositions.json` (`date`, `commit`, `inputs`,
`verified`) and `archive/` alone.** The timeline has to keep matching the
editions already handed over, and a stamp set without the work behind it hides
exactly what it exists to catch. `index.json` is in between: every write keeps
it complete, and the order in it is the deliberate reading order — reorder that
freely.

Run `ledger rules` for how to write, and `ledger --help` for the commands.
