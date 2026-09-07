# Baseline survey — hand this to your coding agent

Paste everything below the line into a fresh agent session in the project
root. It's written to be run by any coding agent; nothing in it is specific to
one tool.

Work through it in batches — one category per batch — and let the agent stop
between them. A survey attempted in one pass will run out of context and start
inventing.

---

You are cataloguing what {product} already does, into a feature ledger. This
is an inventory of an existing codebase, not a record of anything you or I
built. Read `ledger rules` first — it defines every field and the house style.

**Voice.** Every description is a present-tense statement of what the product
does: "A guest can book without an account." Never authorship, never history —
no "added", "we now support", "improved", "new". Someone reading the finished
document must not be able to tell whether a given feature shipped last week or
three years ago. This matters: the first edition is a snapshot of the product
as it already stood.

**Step 1 — the map.** Survey the codebase and propose the category list: the
6–15 top-level areas this product divides into, in the order a reader should
meet them. Name them the way the people who use the product would (what the
software is *for*), not the way the code is laid out. Show me the list and
wait for my confirmation before writing anything.

Then, once I've confirmed:

```
ledger categories add "First area"
ledger categories add "Second area" --after "First area"
```

**Step 2 — one category at a time.** For each category, in order:

1. Read the code that implements that area.
2. For each distinct capability, run `ledger add <id>` with a payload. Keep
   ids stable and kebab-case.
3. Size each one honestly — **Big** for a standalone capability, **Medium**
   for a meaningful piece of a bigger area, **Small** for a specific behaviour
   or guardrail. A category that is all Big is a category that hasn't been
   looked at closely.
4. Set `audience` to `dev` for anything a client would never knowingly
   encounter, and put implementation detail in `dev_notes` rather than in the
   description.
5. Run `ledger check`, then stop and show me what you added before moving on.

**What not to list.** Purely mechanical form checks (required fields, valid
email format), framework defaults, and anything you can only describe as the
absence of a problem ("can't submit twice") — those are `dev` at best. If a
capability has grown more than a handful of entries inside one category,
propose a sub-section for it instead of listing them flat.

**Where you're unsure.** If you can't tell from the code what something is
*for* — as opposed to what it does — say so and ask. A guess in this document
becomes a guess a client reads.

---

When the survey is done and `ledger check` is clean, cut the baseline:

```
ledger release cut --name "Baseline" --date <the date this codebase started, or today>
ledger build
```

Version 1 has no predecessor, so its edition prints as a plain inventory with
nothing flagged as new or changed — which is exactly right for a snapshot of
work that was already there. From the next release onward, every edition
highlights only what actually moved.
