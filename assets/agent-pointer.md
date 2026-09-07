<!-- feature-ledger -->
## Feature ledger

This repo keeps a versioned, client-facing record of what the product does,
under `.ledger/`. **A change that ships a feature, or changes what an existing
one does, isn't finished until the ledger records it.**

Never read or hand-edit the JSON under `.ledger/` — it's large and the tool
owns its shape. Use the CLI:

```
ledger list                  # the corpus, one line per feature
ledger show <id>             # the one entry you're about to touch
ledger add <id>              # a new feature      (JSON payload on stdin)
ledger update <id>           # a change to one    (JSON payload on stdin)
ledger check                 # validate before you finish
ledger rules                 # the full authoring rules — read before your first edit
```

Two things the rules will insist on, worth knowing up front: a `changes`
bullet says what it was before **and why it moved** (never invent a reason —
ask), and descriptions are present-tense statements of what the product does,
never of who did what to it.

Don't run `ledger build` as part of an ordinary change; the generated docs are
build output and gitignored.
