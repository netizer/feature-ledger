# Editing the ledger by hand

The corpus is JSON in your repository, and the prose in it is yours. Open the
file and change it:

```bash
$EDITOR .ledger/features/saved-baskets.json
```

```json
{
  "id": "saved-baskets",
  "audience": "user",
  "category": "Ordering",
  "size": "Medium",
  "paths": ["app/models/basket.rb", "app/views/baskets/**"],
  "dev_notes": "The switch is a session swap, not a copy.",
  "history": [
    {
      "version": 4,
      "name": "Saved baskets",
      "description": "A customer keeps more than one basket, such as the weekly shop and a party order, and switches between them without either losing its contents."
    }
  ]
}
```

This isn't a fallback for when the CLI won't do what you want. **It's how the
wording gets adopted for the client**, and it's expected every cycle, most
usefully with the last edition open next to you. You're doing three things in
there:

- **Changing** the words. The draft says "users"; this client says "guests". A
  sentence is true but reads like a commit message. Rewrite it.
- **Adding** what the coding agent couldn't find. A survey reads code, and part
  of what a capability is *for* only ever existed in someone's head.
- **Deleting** what the client shouldn't read: an internal detail that drifted
  into a description, a `dev_notes` line that says too much, a "What changed"
  note about something they never asked for.

None of that lands on a release or tags anything as changed, which is right,
because the product didn't move. The improved wording reads as though it had
always been there, including in editions already printed: every document that
shows the entry picks the change up the next time it's printed.

Then run `ledger status`. It loads and validates every file, so a trailing
comma or a missing description comes back as a message rather than a broken
build. `ledger show <id>` prints the entry as the documents will read it.

## What's yours

On any entry in a feature's `history`:

| | |
| --- | --- |
| `name` | What the feature is called. The newest entry's name is what it goes by; every document footnotes the previous one on its own. |
| `description` | The whole present-tense text, in two or three sentences. `ledger status` says when one runs long for its size. |

At the top of the same file:

| | |
| --- | --- |
| `dev_notes` | The team's detail. Delete the key to drop it. |
| `paths` | The globs the capability's code lives in. `ledger own` does the same from the command line. |
| `size` | `Big`, `Medium` or `Small`. |
| `category`, `subcategory` | Must name one that already exists — `ledger status` refuses a typo rather than inventing an area. |
| `id` | **Don't.** It's the filename and the identity that carries history across renames, and `index.json` orders by it. |

Elsewhere in `.ledger/`:

| | |
| --- | --- |
| `subcategories.json` | A sub-section's `name` and `intro`. |
| `compositions.json` | A release's "What changed" notes (`changes`, by entry id), a summary item's `text` and `covers`, and `quiet`. `ledger compose complete` writes `date`, `commit` and `inputs`, and `ledger verify complete` writes `verified`. |
| `config.json` | Product name, tagline, `ignore` (files that aren't product code), `checks`, and the `docs` block that overrides document titles and intros. |
| `other-changes.json` | The `description` of a product-wide note. |
| `releases.json` | A release's `display_version` and `redraft` (see [documents.md](documents.md#carrying-on-from-earlier-reports) and [checks.md](checks.md#a-redraft-done-by-hand)). Nothing else in the file. |
| `STYLE.md`, `theme.css` | Prose and CSS. They were always yours. |

A hand-edit of a composed note or summary item doesn't put the composition out
of date, and the next `ledger compose` keeps it unless the entry it is about
moves again.

Renaming an **area** is the exception, because its name is repeated on every
feature filed under it: `ledger categories rename "Old" "New"` carries them all
across.

## What stays with the CLI

Not much, and only where a hand-edit would be invisible or wrong.

- **Adding, dropping or re-dating an entry in `history`, and anything in
  `events`.** Which release an edit lands on is what every New/Changed tag is
  computed from, and which release is open isn't visible from inside the file.
  An event is a fact somebody recorded: what moved, and why. That's
  `ledger add`, `change` and `remove`, and `change` is also what refuses a
  change that never says *why*.
- **`releases.json`, `questions.json`, and the stamps in `audits.json`,
  `compositions.json` and `redrafts.json`.** A timeline edited by hand stops matching the editions
  already handed over, and a stamp set without the sweep behind it makes a gap
  permanently invisible. The exceptions are a redraft's `note`, and a release's
  `display_version` and `redraft`. The same goes for `.ledger/archive/`: the old
  editions print from it.
- **Keeping `index.json` complete.** Every write adds a new id and prunes one
  whose file is gone. The **order** in the list is yours: it's the reading order
  within a size band, and reordering it by hand is how you change it.

The test, when you can't tell which side of the line you're on:

> **Would the client want to be told?** If they would, it's a change: it goes
> through `ledger change`, dated and explained. If it's the same thing said
> better, said more, or said less, it's an edit.

Renaming a feature falls on both sides. A name that was chosen badly is wording:
change `name` in the file. A name the *product* changed is news:

```bash
ledger change saved-baskets --name "Saved baskets" \
  --what "It was called “Basket list”." \
  --why "That described the screen rather than the thing customers were actually keeping."
```

## A whole ledger at once

`ledger style rewrite` prepares a prompt for a coding agent to take the corpus
one area at a time, changing the words and never the meaning. That's the tool
for adopting a new tone across a hundred entries; for the handful you noticed
while reading the last edition, open the files.
