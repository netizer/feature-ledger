<!-- feature-ledger -->
## Feature ledger

This repo keeps a versioned, client-facing record of what the product does, in
`.ledger/`. **A change that ships a feature, or changes what an existing one
does, is not finished until the ledger records it.**

Do not read or hand-edit the JSON under `.ledger/`. It is large, and the tool
owns its shape. Use the CLI:

```
ledger list                  # the corpus, one line per feature
ledger show <id>             # the one entry you are about to touch
ledger add <id>              # a new feature    (JSON payload on stdin)
ledger update <id>           # a change to one  (JSON payload on stdin)
ledger status                # release, corpus and setup, checked
ledger rules                 # the full authoring rules; read before your first edit
```

Write every entry in **the Google developer documentation style guide**.
Run `ledger style`: it prints a sample of that tone and three feature
descriptions written in it. Match them, sentence for sentence.

One entry is one capability someone using the product would name — something
they could ask for, or would miss if it went away. Guardrails, defaults,
plumbing and polish are described inside the capability they belong to, or go
in as `dev`, or as `ledger other-change`. They never get an entry of their own.

Descriptions are present-tense statements of what the product does, never of
who did what to it. Client-facing prose, not release notes. Every sentence
states something a reader could confirm by using the product.

A `changes` bullet says what the feature was before, and why it moved. Never
invent a reason: ask.

Do not run `ledger build` as part of an ordinary change. The Markdown docs are
gitignored build output; the client PDFs in `docs/client/` are committed, and
are minted when a release is cut.
<!-- /feature-ledger -->
