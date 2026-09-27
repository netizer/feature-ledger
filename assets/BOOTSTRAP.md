# Baseline survey — hand this to your coding agent

{redraft_intro}The survey is agent work: only something that can read the codebase can say
what {product} does. So this prints the brief, and whichever agent you use
runs it.

It runs start to finish on its own. The agent surveys, decides the areas,
writes every entry, cuts the baseline and prints it — without stopping to ask
you anything. Editing comes after, and what you get back is a **draft**: read
the finished document, then open `.ledger/features/<id>.json` and rewrite
anything that isn't how you'd say it to this client — the wrong word, a
sentence it invented, a detail they shouldn't be reading, or the sentence it
had no way of knowing. That records nothing and marks nothing as changed.
`ledger update <id>` and `ledger remove <id> --reason "…"` are for anything
where the product itself has moved since. The agent finishes by listing the
entries it was least sure about, so you know where to look first.

The prompt itself is everything under the rule below. Copy it whole, from
there to the end of this output, into a fresh agent session in the project
root. Nothing in it is specific to one tool, and there is nothing after it
that you need.

{copy_rule}

You are cataloguing what {product} already does, into a feature ledger. This
is an inventory of an existing codebase, not a record of anything you or I
built. Read `ledger rules` first — it defines every field and the house style.

Work through every step below to the end, in one session, without stopping to
ask me anything or waiting for my approval between steps. I will read the
finished document and edit it myself. Where a judgement call comes up, make
the most defensible call, write down that you made it, and keep going.

**Voice.** Write every entry in {style_line}
Read the sample before you write the first entry, and keep matching it as you
go. The sample is the brief; the name of the guide is only where it came from.

Each description is a present-tense statement of what the product does: "A
guest can book without an account." Every sentence states something a reader
could confirm by using the product. Never authorship, never history: no
"added", "we now support", "improved", "new". Someone reading the finished
document must not be able to tell whether a feature shipped last week or three
years ago. The first edition is a snapshot of the product as it already
stood.

## The bar

**One entry is one capability someone using {product} would name.** Something
they could ask for, or would miss if it went away.

Two tests, and an entry has to pass both:

- **Could you demo it?** If showing it means pointing at a settings file or a
  passing test rather than at the product doing something, it is not an entry.
- **Would demoing it look different from demoing the entry next to it?** If
  not, they are one capability described twice, and one entry says it better.

This bar does not move with the size of the project. A codebase with four
capabilities gets four entries; one with two hundred gets two hundred. What
must not happen is a small project being written up in fine detail to make the
document look substantial — the reader should come away understanding
{product} at the same altitude either way.

Below the bar, and therefore **not** entries:

- Guardrails, refusals, validation and defaults. "It can't be submitted
  twice", "the fields are checked before saving", "it's safe to run again".
  These belong in the description of the capability they protect, if they are
  worth a clause at all.
- Internal plumbing, file layouts, config keys, scripts, build steps.
- Polish: wording, colours, spacing, an error message that reads better.
- Anything you can only describe as the absence of a problem.

None of that is unimportant — it is just not what this document is for. A
description is two or three sentences, so a capability has room to mention the
guardrail that makes it trustworthy without that guardrail becoming its own
line in the contents.

## The names

The names *are* the document. Most readers go down the contents list and stop
there; a description is for someone digging into one entry, or surprised it
exists at all. Before you finish a batch, apply this test:

> **Cover the descriptions. Can someone still say what {product} does?**

Any name that leaves them saying "I'd have to read that one" isn't finished.

Name the capability — a short noun phrase, or the action someone takes — in
the words the people who use {product} use for their own work: *Daily
calendar*, *Deposit refunds*, *Saved baskets*, *Guided booking wizard*.

Not a caption (*The codebase, checked against the record*), not a comment on
the capability (*Better words for the same thing*), not the mechanism
(*One-command setup in any codebase*), not a question (*What moved since the
last edition*), and not two ideas joined with "and" — that last one usually
means half of it is the description, or that the entry is really two entries.
Don't restate the area either: under *Bookings*, an entry called *Booking* has
told the reader nothing.

Two to six words is usual. It has to work in the contents list, where it sits
next to entries from every other area with nothing underneath it, and two
names in one area that could swap places without a reader noticing are both
doing the job badly.

## Step 1 — the capabilities

Survey the codebase and list the capabilities that clear the bar. One line
each: a working name and a phrase saying what someone can do. No areas yet, no
ids, no sizes — just the list. The names are working titles at this stage, but
write them as though they were final — a placeholder written now is what ends
up in the document later.

This is the step that decides whether the finished document is worth reading,
so do it twice: go back over your own list and merge anything where two lines
would demo the same, and drop anything you couldn't demo at all. Review your
own list against the bar rather than showing it to me — I will read it as the
finished document, which is a better test of it than a list of working names.

## Step 2 — areas, if the product has them

Areas are a reading aid, not a required taxonomy. The question is not how long
your list is. It is whether the product genuinely falls into parts that
someone using it would recognise and name.

- **If it does**, create those parts: named for what the software is *for*
  rather than how the code is laid out, and ordered the way a reader should
  meet them. Some areas will hold two entries and some twenty. That's the
  shape of the product, not something to even out.
- **If it doesn't** — the product is one coherent thing, or the only groupings
  you can find are ones the code would recognise and a user wouldn't — leave
  every entry unfiled. They land in one area called "Features", which prints
  without a heading. When it's a close call, prefer no areas: adding them later
  is one command per area, and a taxonomy nobody recognises is harder to undo
  than it looks.

```
ledger categories add "First area"
ledger categories add "Second area" --after "First area"
```

If the product has grown parts since the last time, `ledger categories rename`
and `ledger categories remove` move the structure without touching the
entries.

## Step 3 — write the entries, a batch at a time

Take them in reading order, a batch at a time — one area, or a dozen or so
entries where there are no areas. Batching is how you keep the quality up over
a long list, not a checkpoint: finish a batch, then start the next one
yourself.

1. Read the code behind each capability before writing about it.
2. `ledger add <id>` with the payload. Ids are stable and kebab-case. Leave
   `category` out entirely when the ledger has no areas. Hold every `name` to
   **The names** above before you move on: it is the part of the entry most
   readers will ever actually read.
3. Size each entry — **Big** for a capability the product is chosen for,
   **Medium** for a capability in its own right inside a bigger one, **Small**
   for one narrow enough to describe in a line. The scale ranks entries within
   this product; it is not permission to record something smaller than a
   capability.
4. Set `audience` to `dev` for a capability only the team would ever
   encounter, and put implementation detail in `dev_notes` rather than in the
   description.
5. Run `ledger status` at the end of each batch, fix anything it reports, and
   move straight on to the next batch.

Where you can't tell from the code what something is *for* — as opposed to
what it does — write the reading the code best supports, and keep the entry's
id on a list of open questions for Step 5. Don't ask me mid-run and don't
invent a purpose to fill the gap: describe what you can actually see the
product doing, and flag it. A guess in this document becomes a guess a client
reads, so the flag is what stops it being one.

{baseline_step}

## Step 5 — hand it back

Before you write the note, run `ledger list` and read only the names, in
order, ignoring everything else on each line. That is what most people will
read of this document. Anything you can't tell apart from its neighbours, or
that you'd have to open the description to understand, gets one more pass:
edit `name` in `.ledger/features/<id>.json`, which changes the words and
nothing about the release, and re-run `ledger status`.

Finish with a short note for me, and nothing else to do:

- How many entries you recorded, and the areas you settled on — or why you
  left the ledger unfiled.
- **The open questions**: every entry where you couldn't tell what something
  was *for*, one line each, with the id and the reading you went with. This is
  the list I'll work through first, so don't pad it with entries you're
  confident about, and don't leave one off because it's probably fine.
- Anything you found and deliberately left out, if a reasonable person might
  have expected it in the document.

Then stop. What you hand me is a draft: I'll rewrite the wording myself in
`.ledger/features/<id>.json`, and `ledger update <id>` and
`ledger remove <id> --reason "…"` cover anything that has actually moved.
Rebuilding is `ledger build`.
