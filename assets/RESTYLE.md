# Rewriting the ledger in a new tone — hand this to your coding agent

Rewriting an existing ledger is agent work: only something that can read a
description can say the same thing differently. So this prints the brief, and
whichever agent you use runs it.

It works one area at a time and stops between them, for your confirmation. A
rewrite attempted in one pass runs out of context and starts drifting from
what the entries actually say.

The prompt itself is everything under the rule below. Copy it whole, from
there to the end of this output, into a fresh agent session in the project
root. Nothing in it is specific to one tool, and there is nothing after it
that you need.

{copy_rule}

You are rewriting the wording of an existing feature ledger for {product}, so
that it reads as though it had always been written in one tone. There are
{count} entries. Nothing about the product is changing. Only the words are.

{style}

**How you apply a rewrite.** By editing the file. Each entry is its own small
JSON file at `.ledger/features/<id>.json`, and the words in it are yours to
change:

```json
{
  "id": "some-feature",
  "audience": "user",
  "category": "…",
  "size": "Medium",
  "history": [
    { "version": 1,
      "name": "The same name, in the new tone",
      "description": "The same feature, said in the new tone.",
      "changes": null,
      "dev_notes": "…" }
  ]
}
```

Change `name`, `description`, `dev_notes` and the text of any `changes`
bullet, on whichever `history` entry carries them. Nothing else. There is no
command for this and there should not be: nothing is being recorded, because
the product did not move — so no release collects anything and nothing is
marked as changed. A sub-section's heading and overview are the `name` and
`intro` in `.ledger/subcategories.json`, and they work the same way.

An entry whose text is spread over several `history` entries has been reworded
at more than one version. Rewrite each of them: the older ones are what an
already-printed edition reprints from.

**What you must not change.** The meaning. Every entry states something that
is true of the product, and a rewrite that makes a description clearer at the
cost of making it slightly wrong is worse than the sentence it replaced. If a
description says something you cannot verify, keep it as it is and tell me.

Nor the structure. Do not add or remove a `history` entry, do not touch a
`version`, and do not add or remove a `changes` bullet — every one of those
says the product moved, and it did not. You are rewriting the words that are
already there.

**The names carry the document.** Most readers go down the contents list and
stop there, so a retone is the moment to fix a name that was never really a
name. The test: cover the descriptions, read only the names in order, and see
whether someone could still say what {product} does. Anything that leaves them
saying "I'd have to read that one" gets rewritten.

A name states the capability — a short noun phrase, or the action someone
takes — in the words the people who use {product} use for their own work. Not
a caption (*The codebase, checked against the record* → *The ledger audit*),
not a comment on it (*The words are yours* → *Editing the ledger by hand*),
not the mechanism (*One-command setup in any codebase* → *Setting up a
ledger*), not a question (*What moved since the last edition* → *New and
changed highlighting*). Two to six words is usual.

This is still only the words. If the *product* renamed something, that is a
change the client is told about (`ledger update <id> --name "…"` with a reason)
and it is not part of a retone — tell me instead.

**Work in this order.**

1. Run `ledger style` and read it properly. It is the whole brief.
2. Take one area at a time, in this order:
{categories}
3. For each area, run `ledger list --category "<area>"`, then `ledger show
   <id>` for each entry in it. Read the entries through the commands rather
   than by opening the corpus: the whole of `.ledger/` is far more than you
   need in context at once.
4. Rewrite each entry's name, description, and any dev notes and change
   bullets, editing `.ledger/features/<id>.json` in place. Do the names first
   and hold them to the test above — they are the part of the area a reader is
   most likely to be left with.
5. Run `ledger status` — it revalidates every file you touched — then stop and
   show me the area you just did before moving on.

**Then the parts that are not features.** Sub-section headings and overviews
(`ledger subcategory list`, edited in `.ledger/subcategories.json`), any
product-wide notes in `.ledger/other-changes.json`, and the product's one-line
description in `.ledger/config.json`, if it has one.

**Then check your own work.** `ledger status` should be clean, and its release
section should show the same contents it showed before you started. If a
feature has appeared as new or changed, something was recorded that should
only have been reworded — a `ledger update`, or a `history` entry that grew a
version — and that needs undoing.
