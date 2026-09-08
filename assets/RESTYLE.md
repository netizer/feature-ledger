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

═════════════════════  COPY EVERYTHING BELOW THIS LINE  ═════════════════════

You are rewriting the wording of an existing feature ledger for {product}, so
that it reads as though it had always been written in one tone. There are
{count} entries. Nothing about the product is changing. Only the words are.

{style}

**The one command you need.** `ledger reword <id>` replaces the words of an
entry in place. It records nothing against the release and marks nothing as
changed, which is exactly right: the product did not move.

```
ledger reword some-feature <<'JSON'
{ "description": "The same feature, said in the new tone." }
JSON
```

It takes `name`, `description`, `dev_notes`, and `changes`. Pass only the
fields you are rewriting. `--version N` reaches back to an older release's
wording, and `ledger subcategory reword <id>` does the same for a
sub-section's heading and overview.

**What you must not change.** The meaning. Every entry states something that
is true of the product, and a rewrite that makes a description clearer at the
cost of making it slightly wrong is worse than the sentence it replaced. If a
description says something you cannot verify, keep it as it is and tell me.

You also cannot add or remove a `changes` bullet through a reword. Rewording
improves the words of a bullet that is already there.

**Work in this order.**

1. Run `ledger style` and read it properly. It is the whole brief.
2. Take one area at a time, in this order:
{categories}
3. For each area, run `ledger list --category "<area>"`, then `ledger show
   <id>` for each entry in it.
4. Rewrite each entry's name, description, and any dev notes and change
   bullets. Apply each with `ledger reword`.
5. Run `ledger status`, then stop and show me the area you just did before
   moving on.

**Then the parts that are not features.** Sub-section headings and overviews
(`ledger subcategory list`), and the product's one-line description in the
settings, if it has one.

**Then check your own work.** `ledger status` should be clean, and its release
section should show the same contents it showed before you started. If a
feature has appeared as new or changed, a `ledger update` was used where a
`ledger reword` was meant, and that needs undoing.
