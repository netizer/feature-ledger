# How the ledger works

## One altitude, whatever the size of the project

The failure mode of a generated feature document is granularity. Left alone, an
agent surveying a codebase writes down everything it finds — the guardrails, the
defaults, the "safe to run twice" — and a small tool comes out as twenty-two
pages nobody reads, while a large one comes out as vague gestures at
subsystems.

So the ledger fixes the altitude and lets the *count* vary:

> **One entry is one capability someone using the product would name.**
> Something they could ask for, or would miss if it went away.
>
> Could you demo it? Would demoing it look different from demoing the entry
> next to it? Both, or it isn't an entry.

A four-capability tool gets four entries. A two-hundred-capability platform gets
two hundred. Guardrails, defaults, plumbing and polish still get recorded —
inside the capability they belong to, as `dev_notes`, as a `dev` feature, or as
a product-wide note (`ledger note`) — just never as an entry of their own.

- **Areas are optional.** A new ledger has none, and prints as one list.
- **Areas arrive when the product has parts** a user would recognise and name.
  `ledger categories rename` turns the default area into the first real one.
- **Sub-sections arrive when an area has a real part inside it.**
- **Nothing counts entries per area.** Twenty capabilities in one area is a fact
  about the product, not a defect.

## The model

**A release is a moment, named by a commit.** Every cut records the commit it
happened at, so an edition says which state of the product it was printed from.
That's what lets two demos in one day be two real releases.

**A feature is its history.** A version only appears in a feature's history when
something about it changed; absent versions mean "still whatever the last entry
said". That's what makes "what did this look like at version N?" answerable, and
why an old edition still reproduces exactly what was presented then.

**Facts are recorded; text for the client is composed.** Alongside its states,
a feature keeps **events**: what moved and why, as somebody recorded them while
the work landed. The "What changed" notes and the summary an edition prints are
composed once per release from the two states and the events between, so they
describe only differences the client will see. See
[checks.md](checks.md#recording-facts-composing-text).

**A feature names its code.** Each entry's `paths` are globs over the
repository. They let the ledger be checked against the code: the audit looks
only at code the record doesn't account for, and the size readout says how
much code moved under each entry.

**Two audiences.** `user` features are what the client sees; `dev` features are
what only the team cares about. `dev_notes` on a user feature is implementation
detail attached to a client-facing capability.

**Three sizes, all of them capabilities.** Big (one the product is chosen for),
Medium (a capability in its own right, inside a bigger one), Small (one narrow
enough to describe in a line). The scale orders every section; it says nothing
about how far down an entry may go.

**Three registers.** Green means built this cycle, blue means reworked this
cycle, grey means already true and only now on the record. The first two are
facts about the software, the third a fact about the record.

**Two highlight semantics, on purpose.** The living Markdown docs tag New and
Changed only while the release is open, so a shipped release reads as a clean
list. The PDF always diffs against its own predecessor, however old, because its
job is reproducing what was in front of the client that day.

## Layout of `.ledger/`

```
config.json          product, the area list (= reading order), tone, wording overrides
brand.json           logo, accent, fonts
releases.json        the version timeline, each release with the commit it was cut at
features/<id>.json   one feature: the code it lives in, its state at each version, and its events
index.json           the deliberate corpus order (ties within a size band)
subcategories.json   sub-section headings
other-changes.json   changes belonging to no single feature
audits.json          every audit so far, and the commit each was run against
compositions.json    per release, the "What changed" notes and the summary its edition prints,
                     and what they were composed from
questions.json       reasons nobody vouched for, and what a check doubted
redrafts.json        every redraft, and whether the new corpus was checked against the old
archive/v1-v4/       a corpus a redraft set aside, read-only; its editions print from it
STYLE.md             optional, the project's own tone as prose
theme.css            optional, appended last to the PDF stylesheet
.cache/              gitignored; what the last `ledger preview` saw
```

Everything here is committed. Which parts are yours to edit is in
[editing.md](editing.md). One file per feature keeps diffs readable, makes an
entry something you can open and edit, and stops two branches adding features
from conflicting.

## Not included, deliberately

**User flows.** The original this was extracted from also carried a step-by-step
behavioural catalogue per feature, close to a test plan. It's valuable, and it's
a different job from documenting *what exists*. It's left out until "how do
these relate to tests?" has an answer worth building against.
