# Recording what the product does

The ledger is a versioned record of what this product does, written for the
people who paid for it. While you build, you record **facts** in it: a new
capability, or what changed in one and why. The text the client reads is
written later, once per release, by `ledger prepare`.

**A change that ships a feature but doesn't record it isn't done yet.**

## Read through the CLI

`.ledger/` is big, and opening it to change one sentence pays for all of it
every time:

```
ledger list                     # the whole corpus, one line per feature
ledger show <id>                # the single entry you're about to touch
ledger status                   # the release, the corpus and the setup, checked
ledger style                    # the tone to write in, on its own
```

{style}

## What counts as an entry

**One entry is one capability someone using this product would name.**
Something they could ask for, or would miss if it went away. Could you demo
it? Would demoing it look different from demoing the entry next to it? Both,
or it isn't an entry.

Below the bar, at any size of project: guardrails, refusals, validation and
defaults; internal plumbing (file layouts, config keys, scripts); polish
(wording, colour, a better error message); anything you can only describe as
the absence of a problem. They go inside the description of the capability they
belong to, in `dev_notes`, as a `dev` feature, or as `ledger note`. Never as an
entry of their own.

**The name** is a short noun phrase, or the action someone takes, in the words
the people who use the product use: *Daily calendar*, *Deposit refunds*,
*Saved baskets*. Not a caption, not the mechanism, not a question, not two
ideas joined with "and", and not the area's name again. Two to six words is
usual.

## A new feature

```
ledger add saved-baskets <<'JSON'
{
  "audience": "user",
  "category": "Ordering",
  "size": "Medium",
  "name": "Saved baskets",
  "description": "A customer keeps more than one basket, such as the weekly shop and a party order, and switches between them without either losing its contents.",
  "how_to_see": "Open the basket menu and choose New basket; the first one stays in the list."
}
JSON
```

- **`id`**: stable, kebab-case, never changed afterwards.
- **`audience`**: `user` if the client would ever care; `dev` if not.
- **`category`**: the area it belongs to. Optional while the ledger has fewer
  than two areas; `ledger categories` lists them.
- **`size`**: **Big** for a capability the product is chosen for, **Medium** for
  one in its own right inside a bigger one, **Small** for one narrow enough to
  describe in a line.
- **`description`**: what the product *does*, present tense, two or three
  sentences, each one something a reader could confirm by using the product.
  Never authorship: not "added X", not "we now support X".
- **`how_to_see`** (optional): plain instructions a client follows to check the
  claim themselves. Give it when you know; leave it out rather than guess.
- **`dev_notes`** (optional): implementation detail for the team.

## A change

```
ledger change delivery-windows <<'JSON'
{
  "what": "Delivery windows can be booked 28 days ahead instead of 14.",
  "why": "Wholesale customers plan their orders a month out.",
  "description": "The whole current state, rewritten, when it moved."
}
JSON
```

A change is two facts. **`what`** moved, in one sentence a client could read.
**`why`**, the part only the person who decided it knows. Record them as they
are; you don't write the client's note. A feature that changes three times in a
release is three `ledger change`s, and none is ever revised.

- **Never invent a reason.** If you don't know, ask. If nobody can say, pass
  `--why-unknown`. A reason read off a commit message or a pull request takes
  `--why-from commit`. Either stays a question for a person.
- **`description`**: the whole current state, when the change moves what it
  says. **`how_to_see`** too, when the way to reach it moved.
- A feature **new** in the open release has no "before" for the client: update
  its description, and nothing else is recorded.
- Size, area and dev notes alone (`ledger change <id> --size Small`) record
  nothing: where an entry is filed isn't news.

**A rename the product made**, which the client needs telling:

```
ledger change old-id --name "New name" --what "It was called “Old name”." --why "…"
```

**A removal**, whose reason is printed in the edition, so it can't be unknown:

```
ledger remove some-feature --why "…"
```

**Something that belongs to no single feature** (a colour change across every
screen, a wording pass):

```
ledger note --audience user --description "…"
```

**Already in the product before the last edition**, and only now on the record:
add `--backfilled` to `add`, `change` or `remove`. It prints grey: the product
didn't move this cycle; the record did.

## Better words for the same thing

Not a change. The product didn't move, so nothing lands on the release: edit
`name`, `description`, `how_to_see` or `dev_notes` in
`.ledger/features/<id>.json`, then run `ledger status`, which validates every
file. If you're unsure which you're doing, ask whether the client would want to
be told. If they would, it's a `ledger change`.

Leave `history` entries, `events`, `releases.json` and `.ledger/archive/` to
the CLI.

## Don't commit

What you record lands in the working tree. The developer reads it and commits
it with the rest of the change. Don't run `ledger prepare` or `ledger cut`
unless you are asked to, and don't run `ledger build` as part of an ordinary
change.

Before you finish: `ledger status`.
