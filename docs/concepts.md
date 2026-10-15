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

**Facts are recorded; text for the client is prepared.** Alongside its states,
a feature keeps **events**: what moved and why, as somebody recorded them while
the work landed. The "What changed" notes, the summary and the message an
edition goes out with are written once per release, by `ledger prepare`, from
the two states and the events between, so they describe only differences the
client will see. See [releasing.md](releasing.md#facts-while-you-build-client-text-once-per-release).

**A feature says how to see it.** Each state can carry `how_to_see`: plain
instructions a client follows to check the claim themselves. It is versioned
with the description, so an old edition reprints the instructions it was sent
with.

**Nothing maps code to features.** Commits are horizontal and features are
vertical: shared files belong to many entries, cross-cutting work touches most
files without being about them, and a feature grows without touching the files
it started in. `ledger prepare` reads the code since the last edition as
evidence for work nobody recorded, never as the source of client text.

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

**Short editions, nothing dropped.** From the second edition on, the first page
is the update: an overview and a short list of what's new and what changed.
Then the details of every entry that moved, and a catalogue of the whole
service, one line per capability. Reprinting every unchanged entry in full
every time was most of an edition's length. `--full` prints them all in full.
See [documents.md](documents.md#what-an-edition-holds).

**Two highlight semantics, on purpose.** The living Markdown docs tag New and
Changed only while the release is open, so a shipped release reads as a clean
list. The PDF always diffs against its own predecessor, however old, because its
job is reproducing what was in front of the client that day.

**Released editions don't change.** A cut edition's notes are frozen in
`compositions.json`, including the recorded lines it printed for want of a
prepared note, so it reprints what was handed over.

## Layout of `.ledger/`

```
config.json          product, the area list (= reading order), tone, wording overrides, "schema": 3
brand.json           logo, accent, fonts
releases.json        the version timeline, each release with the commit it was cut at
features/<id>.json   one feature: its state at each version (name, description, how to see it),
                     its events (what changed and why), and dev notes
index.json           the deliberate corpus order (ties within a size band)
subcategories.json   sub-section headings
other-changes.json   changes belonging to no single feature
compositions.json    per release, the "What changed" notes, the summary and the message its
                     edition goes out with, and what `ledger prepare` had read
redrafts.json        every redraft, and whether the new corpus was checked against the old
state.json           how far the agent tasks have got: the tone each entry was last written
                     in, the code last read for unrecorded work, whether the survey finished.
                     Absent until there is something in it
archive/v1-v4/       a corpus a redraft set aside, read-only; its editions print from it
STYLE.md             optional, the project's own tone as prose
theme.css            optional, appended last to the PDF stylesheet
```

Everything here is committed. Which parts are yours to edit is in
[editing.md](editing.md). One file per feature keeps diffs readable, makes an
entry something you can open and edit, and stops two branches adding features
from conflicting.

## Not included, deliberately

**A code-to-feature map, audits and questions as stores of their own.** See
[releasing.md](releasing.md#deliberately-left-out).

**Screenshots.** "How to see it" is plain instructions for now; screenshots are
deferred, not rejected.

**User flows.** The original this was extracted from also carried a step-by-step
behavioural catalogue per feature, close to a test plan. It's valuable, and it's
a different job from documenting *what exists*. It's left out until "how do
these relate to tests?" has an answer worth building against.
