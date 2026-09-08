<!-- feature-ledger -->
## Feature ledger

This repo keeps a versioned, client-facing record of what the product does, in
`.ledger/`. **A change that ships a feature, or changes what an existing one
does, is not finished until the ledger records it.**

Do not read `.ledger/` whole — it is large. Read it, and record what moved,
through the CLI:

```
ledger list                  # the corpus, one line per feature
ledger show <id>             # the one entry you are about to touch
ledger add <id>              # a new feature    (JSON payload on stdin)
ledger update <id>           # a change to one  (JSON payload on stdin)
ledger status                # release, corpus and setup, checked
ledger rules                 # the full authoring rules; read before your first edit
```

Wording is different: there is no command for it. To improve how an existing
entry is *said* — its name, its description, its dev notes, the text of a
change bullet — edit `.ledger/features/<id>.json` in place and run
`ledger status`. Nothing is recorded against the release, because nothing
about the product moved. Use `ledger update` only when the product actually
changed and the client should be told.

Write every entry in {style_line}

One entry is one capability someone using the product would name — something
they could ask for, or would miss if it went away. Guardrails, defaults,
plumbing and polish are described inside the capability they belong to, or go
in as `dev`, or as `ledger other-change`. They never get an entry of their own.

Descriptions are present-tense statements of what the product does, never of
who did what to it. Client-facing prose, not release notes. Every sentence
states something a reader could confirm by using the product.

A `changes` bullet says what the feature was before, and why it moved. Never
invent a reason: ask.

{build_line}
<!-- /feature-ledger -->
