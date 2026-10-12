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
ledger add <id>              # a new feature    (JSON on stdin: audience, size, name, description, how_to_see)
ledger change <id>           # a change to one  ({ "what", "why", "description" } on stdin)
ledger remove <id> --why "…" # a feature that's gone
ledger note                  # something that belongs to no single feature
ledger status                # release, corpus and setup, checked
```

Record **facts**, as you work: **what** moved, in one sentence a client could
read ("Delivery windows can be booked 28 days ahead instead of 14."), and
**why**. The text the client reads is written later, once per release, by
`ledger prepare`. Never invent a reason: ask. If nobody can say, pass
`--why-unknown`, and a reason you read off a commit message takes
`--why-from commit`. Either stays a question for a person.

`how_to_see` says how a reader checks the claim themselves ("Open Settings →
Delivery and choose *Book ahead*"). Give it when you know; leave it out
rather than guess.

Wording is different: there is no command for it. To improve how an existing
entry is *said* — its name, its description, its dev notes — edit
`.ledger/features/<id>.json` in place and run `ledger status`. Nothing is
recorded against the release, because nothing about the product moved.

Write every entry in {style_line}

One entry is one capability someone using the product would name — something
they could ask for, or would miss if it went away. Guardrails, defaults,
plumbing and polish are described inside the capability they belong to, or go
in as `dev`, or as `ledger note`. They never get an entry of their own.

Descriptions are present-tense statements of what the product does for the
people who use it, in one or two sentences (about 40 words), never of who did
what to it. Every sentence states something a reader could confirm by using the
product. The client has never seen the code: no file names, paths, flags or
code terms in anything they read; those go in `dev_notes`.

**Don't commit.** What you record lands in the working tree, and the developer
commits it with everything else. Don't run `ledger prepare` or `ledger cut`
unless you are asked to.

{build_line}
<!-- /feature-ledger -->
