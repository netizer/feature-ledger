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
ledger add <id>              # a new feature    (JSON payload on stdin, with "paths")
ledger change <id>           # a change to one  ({ "what", "why", "description" } on stdin)
ledger own <id> '<glob>'     # code a feature lives in, when you add some
ledger status                # release, corpus and setup, checked
ledger rules                 # the full authoring rules; read before your first edit
```

A change records **what** moved and **why**, as facts; you don't write it for
the client. The edition's "What changed" note is composed later, for the whole
release at once. Never invent a reason: ask. If nobody can say, pass
`--why-unknown`, and a reason you read off a commit message takes
`--why-from commit`. Either is kept as a question for a person.

Wording is different: there is no command for it. To improve how an existing
entry is *said* — its name, its description, its dev notes — edit
`.ledger/features/<id>.json` in place and run `ledger status`. Nothing is
recorded against the release, because nothing about the product moved.

Write every entry in **the Google developer documentation style guide**.
Run `ledger style`: it prints a sample of that tone and three feature
descriptions written in it. Match them, sentence for sentence.

One entry is one capability someone using the product would name — something
they could ask for, or would miss if it went away. Guardrails, defaults,
plumbing and polish are described inside the capability they belong to, or go
in as `dev`, or as `ledger note`. They never get an entry of their own.

Descriptions are present-tense statements of what the product does, in two or
three sentences, never of who did what to it. Every sentence states something a
reader could confirm by using the product.

Do not run `ledger build` as part of an ordinary change. The Markdown docs are
gitignored build output; the client PDFs in `docs/client/` are committed, and
are minted when a release is cut.
<!-- /feature-ledger -->
