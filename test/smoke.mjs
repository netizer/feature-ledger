#!/usr/bin/env node
/**
 * End-to-end smoke test: build a project from nothing, exercise both the
 * happy path and every guardrail that's meant to refuse, and print the
 * documents. Runs the real CLI in a real temp directory — the corpus is
 * files, so anything that stubs the filesystem stops testing the thing.
 *
 *   node test/smoke.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "ledger.mjs");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-smoke-"));

let failures = 0;
const log = (s) => process.stdout.write(`${s}\n`);

// The exit code of the last `run`, for the checks that care which kind of
// failure it was: 2 for a mistake in the command line, 3 for a refusal.
let lastStatus = null;

function run(args, { stdin = "", expect = "ok", cwd = dir, env = process.env } = {}) {
  const r = spawnSync("node", [BIN, ...args], { cwd, input: stdin, encoding: "utf8", env });
  lastStatus = r.status;
  const output = `${r.stdout}${r.stderr}`;
  const ok = r.status === 0;
  if ((expect === "ok") !== ok) {
    failures++;
    log(`FAIL  ledger ${args.join(" ")}  (expected ${expect}, got ${ok ? "ok" : `exit ${r.status}`})`);
    log(output.split("\n").map((l) => `      ${l}`).join("\n"));
  } else {
    log(`  ok  ${expect === "ok" ? "" : "rejected: "}ledger ${args.join(" ")}`);
  }
  return output;
}

function assert(label, cond) {
  if (cond) log(`  ok  ${label}`);
  else { failures++; log(`FAIL  ${label}`); }
}

const feature = (o) => JSON.stringify(o);
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

// Writes a release's composition the way an agent would, by hand, replacing
// any earlier one, and returns what the command given makes of it.
function writeComposition(version, body, { cwd = dir, then = ["prepare", "complete"], expect = "ok" } = {}) {
  const file = path.join(cwd, ".ledger/compositions.json");
  const all = fs.existsSync(file) ? readJson(file).compositions : [];
  const kept = all.find((x) => x.version === version)?.prepared;
  fs.writeFileSync(file, JSON.stringify({ compositions: [...all.filter((x) => x.version !== version),
    { version, ...body, ...(kept ? { prepared: kept } : {}) }] }, null, 2));
  return then ? run(then, { cwd, expect }) : "";
}

log(`workspace: ${dir}\n`);

run(["init", "--product", "Testbed", "--agents", "none"]);

// A ledger with no areas takes a feature without one: it opens the default
// area, and the generators print that without a heading.
run(["add", "solo"], {
  stdin: feature({ audience: "user", size: "Medium", name: "Solo", description: "Does the solo thing." }),
});
assert(
  "an unfiled feature opens the default area",
  readJson(path.join(dir, ".ledger/config.json")).categories.join() === "Features",
);
run(["build", "--md"]);
assert(
  "an undivided ledger prints no area heading",
  !fs.readFileSync(path.join(dir, "docs/generated/FEATURES.md"), "utf8").includes("## 1. Features"),
);
fs.rmSync(path.join(dir, "docs/generated"), { recursive: true, force: true });

// …and once it has real areas, the default one is renamed into the first of
// them rather than being left behind as a heading nobody meant.
run(["categories", "rename", "Features", "First area"]);
run(["categories", "add", "Second area", "--after", "First area"]);
// With two areas, the tool stops guessing where an entry belongs.
run(["add", "unfiled"], { expect: "fail", stdin: feature({ audience: "user", size: "Small", name: "Unfiled", description: "x" }) });
run(["categories", "remove", "First area"], { expect: "fail" });

run(["add", "alpha"], {
  stdin: feature({ audience: "user", category: "First area", size: "Big", name: "Alpha", description: "Does the alpha thing.",
    how_to_see: "Open Alpha from the main menu." }),
});
run(["add", "alpha"], { expect: "fail", stdin: feature({ audience: "user", category: "First area", size: "Big", name: "Dup", description: "x" }) });
run(["add", "beta"], { expect: "fail", stdin: feature({ audience: "user", category: "Nope", size: "Big", name: "Beta", description: "x" }) });
run(["add", "beta"], { expect: "fail", stdin: feature({ audience: "user", category: "First area", size: "Enormous", name: "Beta", description: "x" }) });
run(["add", "beta"], {
  stdin: feature({ audience: "user", category: "Second area", size: "Small", name: "Beta", description: "Does the beta thing." }),
});
run(["add", "delta"], {
  stdin: feature({ audience: "user", category: "Second area", size: "Small", name: "Delta",
    description: "Does the delta thing. It also does a second thing nobody reads on a one-line listing." }),
});
run(["add", "gamma"], {
  stdin: feature({ audience: "dev", category: "Second area", size: "Medium", name: "Gamma", description: "An internal convenience." }),
});
// A stanza written for the version that mapped code to entries still sends
// "paths". It is dropped, with a word, rather than refused.
assert("a payload that still carries \"paths\" is recorded without them",
  run(["add", "epsilon", "--dry-run"], { stdin: feature({ audience: "user", category: "Second area", size: "Small",
    name: "Epsilon", description: "Does the epsilon thing.", paths: ["src/**"] }) }).includes("no longer recorded"));

run(["status"]);
// Nothing is prepared and nobody is at a terminal, so the cut says so and
// waits for --yes rather than going ahead.
const unconfirmed = run(["cut", "--name", "Baseline", "--date", "2026-01-15", "--no-pdf"], { expect: "fail" });
assert("a cut with something to say says it first, and waits to be told to go ahead",
  unconfirmed.includes("hasn't run for v1") && unconfirmed.includes("--yes") && lastStatus === 3);
run(["cut", "--name", "Baseline", "--date", "2026-01-15", "--no-pdf", "--yes"]);
// A release with nothing recorded against it would print the same edition again.
const tooSoon = run(["cut", "--name", "Too soon", "--no-pdf", "--yes"], { expect: "fail" });
assert("…and a release with nothing recorded is refused, --yes or not", tooSoon.includes("would be the same as v1's") && lastStatus === 3);
assert("…and the old ways round a refusal are gone, with a pointer",
  run(["cut", "--name", "Too soon", "--skip", "content"], { expect: "fail" }).includes("no checks to skip") && lastStatus === 2);
run(["cut", "--name", "Too soon", "--force"], { expect: "fail" });

// …and for the same reason the edition to print straight after a cut is the
// one just shipped, not the empty release the cut opened.
const fresh = run(["build", "--pdf", "--html"]);
assert(
  "a fresh cut prints the edition just shipped, not the empty release it opened",
  fresh.includes("Testbed-Feature-Ledger_1.html") && !fresh.includes("_2.html"),
);
const v1Html = fs.readFileSync(path.join(dir, "docs/generated/client/Testbed-Feature-Ledger_1.html"), "utf8");
assert("a first edition is an inventory: every entry in full, with how to see it",
  v1Html.includes('<article class="feature" id="f-delta">') && v1Html.includes("Open Alpha from the main menu.") &&
  !v1Html.includes('class="summary"'));
assert("…and its cover says how many features, in how many areas",
  v1Html.includes('class="tally"') && v1Html.includes('<div class="stat is-total"><b>4</b><span>features</span></div>') &&
  v1Html.includes('<div class="stat is-plain"><b>2</b><span>areas</span></div>'));
assert(
  "the empty in-progress release still prints on request",
  run(["build", "v2", "--html"]).includes("Testbed-Feature-Ledger_2-draft.html"),
);
fs.rmSync(path.join(dir, "docs/generated"), { recursive: true, force: true });

// ---- Recording facts ----
// A pre-existing feature can't quietly acquire a new description: a change
// says what moved and why.
run(["change", "alpha", "--description", "Does the alpha thing, better."], { expect: "fail" });
assert("a change with no reason is refused, and says how to record that nobody knows",
  run(["change", "alpha", "--what", "It covers the adjacent thing too."], { expect: "fail" }).includes("--why-unknown"));
run(["change", "alpha"], {
  stdin: feature({
    what: "It covers the adjacent thing as well as the alpha one.",
    why: "The adjacent one was the question every user asked next, so leaving it out just moved the work elsewhere.",
    description: "Does the alpha thing, and the adjacent one.",
  }),
});
// A second change in the same cycle is just another fact: nothing earlier to revise.
const second = run(["change", "alpha", "--why-unknown", "--what", "It also remembers the last choice."]);
assert("a change nobody can explain is recorded, and kept as a question rather than guessed",
  second.includes("the reason isn't known") && second.includes("`ledger prepare` asks it"));
// The old command still works, and says what it is called now.
assert("`ledger update` still records a change, as one event per bullet",
  run(["update", "alpha"], { stdin: feature({ add_changes: ["A third change, written the old way, with its reason in it."] }) })
    .includes("`ledger change`"));

// A rename the client is told about is an ordinary change that happens to move
// the name: it still needs what and why.
run(["change", "beta", "--name", "Beta prime"], { expect: "fail" });
run(["change", "beta", "--name", "Beta prime", "--what", "It was called “Beta”.",
  "--why", "That named the release it arrived in rather than what it does."]);
run(["remove", "gamma", "--why", "Superseded by the build pipeline."]);
run(["remove", "delta"], { expect: "fail" });   // a removal's reason is printed, so it can't be unknown
assert("`other-change` still works, and says it is `note` now",
  run(["other-change", "--audience", "user", "--description", "A global wording pass."]).includes("`ledger note`"));

// How to see an entry is part of its state: set on its own once the entry is
// in the release, and wording otherwise.
assert("how to see an entry that didn't move is a hand-edit, and the command says where",
  run(["change", "delta", "--how-to-see", "Open Delta."], { expect: "fail" }).includes(".ledger/features/delta.json"));
assert("…and on one that did, it records nothing",
  run(["change", "alpha", "--how-to-see", "Open Alpha, then Adjacent."]).includes("nothing is recorded"));

const alpha = readJson(path.join(dir, ".ledger/features/alpha.json"));
assert("one history entry per version", alpha.history.length === 2);
assert("every change is kept as an event, in the order it was recorded",
  alpha.events.length === 3 && alpha.events[1].why_from === "unknown" && alpha.events[2].combined === true);
assert("…and nothing phrased for the client is written into the feature", !("changes" in alpha.history[1]));
assert("how to see it is kept with the state it describes, at each version",
  alpha.history[0].how_to_see === "Open Alpha from the main menu." && alpha.history[1].how_to_see === "Open Alpha, then Adjacent.");
assert("nothing maps code to an entry any more", !("paths" in alpha));
// Before anything is prepared, a preview prints the changes as recorded, and says so.
run(["build", "--pdf", "--html"]);
assert("an unprepared draft prints the recorded changes, labelled as such",
  fs.readFileSync(path.join(dir, "docs/generated/Testbed-Feature-Ledger_2-draft.html"), "utf8").includes("as recorded, not yet prepared"));
fs.rmSync(path.join(dir, "docs/generated"), { recursive: true, force: true });

// A sub-section is declared and then filled, and nothing counts what ends up
// in it. Leading one with a Big entry is worth a word, never a refusal.
run(["subcategory", "add"], {
  stdin: feature({ id: "cluster", category: "First area", name: "A cluster", intro: "Small things that belong together." }),
});
assert("an unfilled sub-section is not a failure", run(["status", "--quiet"]).trim() === "");
assert("filing an entry records nothing", run(["change", "alpha", "--subcategory", "cluster"]).includes("nothing is recorded"));
assert(
  "a sub-section led by a Big entry is mentioned, not refused",
  run(["status", "--quiet"]).includes("leads with a Big entry"),
);
run(["change", "alpha", "--subcategory", ""]);
for (const id of ["c1", "c2", "c3", "c4"]) {
  run(["add", id], {
    stdin: feature({ audience: "user", category: "First area", subcategory: "cluster", size: "Small", name: `Cluster ${id}`,
      description: `The ${id} part of the cluster.` }),
  });
}
// A team-only entry never reaches the client, so the summary never has to account for it.
run(["add", "tooling"], { stdin: feature({ audience: "dev", category: "Second area", size: "Small",
  name: "Tooling", description: "An internal script." }) });
run(["status"]);
run(["check"], { expect: "fail" });   // merged into `status`, and says so
run(["doctor"], { expect: "fail" });
// Wording is a hand-edit now, and the retired commands say where to go.
for (const [gone, points] of [
  [["reword", "alpha"], ".ledger/features/"],
  [["rename", "alpha", "Alpha prime"], ".ledger/features/"],
  [["subcategory", "reword", "cluster"], "subcategories.json"],
]) {
  assert(`\`ledger ${gone.join(" ")}\` points at the file to edit`, run(gone, { expect: "fail" }).includes(points));
}

// The hand-edit itself: the words change, and nothing lands on the release.
const releaseOf = (o) => { const j = JSON.parse(o); return JSON.stringify([j.added, j.changed, j.removed, j.other_changes]); };
const releaseBefore = releaseOf(run(["status", "--json"]));
const c1Path = path.join(dir, ".ledger/features/c1.json");
const c1 = readJson(c1Path);
c1.history[0].name = "Cluster one";
c1.history[0].description = "The first part of the cluster, said the way the client says it.";
fs.writeFileSync(c1Path, `${JSON.stringify(c1, null, 2)}\n`);
assert("a hand-edited entry still validates", run(["status", "--quiet"]).trim() === "");
assert("the new wording is what `show` prints", run(["show", "c1"]).includes("said the way the client says it"));
assert("rewording by hand records nothing against the release", releaseOf(run(["status", "--json"])) === releaseBefore);

// …and a hand-edit that breaks the shape comes back as a message, not a build.
fs.writeFileSync(c1Path, JSON.stringify({ ...c1, history: [{ version: 1, name: "Cluster one" }] }, null, 2));
assert("a description deleted by hand is reported", run(["status"], { expect: "fail" }).includes("needs a description"));
c1.history[0].description = "The c1 part of the cluster.";
c1.history[0].name = "Cluster c1";
fs.writeFileSync(c1Path, `${JSON.stringify(c1, null, 2)}\n`);

// A feature the client has never seen has no "before": however often it moved
// while it was being built, the new state goes in the description.
assert("a change to an entry new this cycle only moves its text",
  run(["change", "c2"], { stdin: feature({ what: "It was different a day ago.", why: "x", description: "The c2 part of the cluster, reworked." }) })
    .includes("is new in v2, so its description is the whole story"));
assert("…and records no event", !("events" in readJson(path.join(dir, ".ledger/features/c2.json"))));

// ---- Preparing the edition ----
// One agent session, run when someone asks for it, turns the facts into what
// the client reads. Bare `ledger` says when that is due, and which reasons
// nobody gave.
const overviewBefore = run([]);
assert("bare `ledger` says nothing is prepared yet, and that prepare is next",
  overviewBefore.includes("hasn't run for v2") && overviewBefore.includes("Next: ledger agent") && overviewBefore.includes("prepares the edition"));
assert("…and lists the reasons nobody vouched for",
  overviewBefore.includes("Reasons nobody has vouched for") && overviewBefore.includes("alpha: It also remembers the last choice.  — why: not recorded"));
const brief = run(["prepare"]);
assert("`ledger prepare` carries each updated entry as the client saw it, as it is now, and what was recorded",
  brief.includes("in v1: Does the alpha thing.") && brief.includes("now:   Does the alpha thing, and the adjacent one.") &&
  brief.includes("why: not recorded") && brief.includes("how to see it: Open Alpha, then Adjacent."));
assert("…every entry it has to account for, and removals", brief.includes("c4  —  Cluster c4"));
assert("…asks the developer for the reasons nobody recorded, and never invents one",
  brief.includes("## 3. Reasons nobody recorded") && brief.includes("alpha, event 2: It also remembers the last choice.") &&
  brief.includes("never invent one") && brief.includes("don't ask for one you were already given"));
assert("…looks for work nobody recorded, and checks what it writes against the code",
  brief.includes("## 2. Work nobody recorded") && brief.includes("## 5. Check it against the code"));
assert("…writes how to see each entry, and no message or \"Why it matters\"",
  brief.includes("**How to see it") && !brief.includes("\"message\":") && !brief.includes("\"matters\""));
assert("…and never commits", brief.includes("Don't commit"));
assert("…and nothing that only the team reads", !brief.includes("Tooling"));
const v2Composition = {
  changes: {
    alpha: ["It stopped at the alpha thing. The adjacent one was the question every user asked next, so it covers that too."],
    beta: ["It was called “Beta”, which named the release it arrived in rather than what it does."],
  },
  summary: {
    c1: "Customers can handle the first new part.",
    c2: "Customers can handle the second new part.",
    c3: "Customers can handle the third new part.",
    c4: "Customers can handle the fourth new part.",
    alpha: "Alpha covers the adjacent thing as well as the alpha one.",
    beta: "Beta has a name that says what it does.",
  },
};
const without = (id) => Object.fromEntries(Object.entries(v2Composition.summary).filter(([k]) => k !== id));
assert("an entry with no sentence on the first page is refused",
  writeComposition(2, { ...v2Composition, summary: without("beta") }, { expect: "fail" }).includes("no sentence in \"summary\": beta"));
assert("…and so is an id that's no entry in the release",
  writeComposition(2, { ...v2Composition, summary: { ...v2Composition.summary, tooling: "Tools." } }, { expect: "fail" })
    .includes("not a client-facing entry in v2: tooling"));
assert("…and a sentence that won't read as one of its own",
  writeComposition(2, { ...v2Composition, summary: { ...v2Composition.summary, alpha: "ledger alpha covers more." } }, { expect: "fail" })
    .includes("starts with a lower-case letter"));
assert("…and a message or a \"Why it matters\", which nothing writes any more",
  writeComposition(2, { ...v2Composition, message: "Hi." }, { expect: "fail" }).includes("\"message\" is no longer written") &&
  writeComposition(2, { ...v2Composition, matters: { alpha: "Faster." } }, { expect: "fail" }).includes("\"matters\" is no longer printed"));
assert("…and the lists an older edition wrote its first page with",
  writeComposition(2, { ...v2Composition, changed: [{ text: "Alpha covers more.", covers: ["alpha"] }] }, { expect: "fail" })
    .includes("Write \"summary\" instead"));
assert("…and an updated entry with no note",
  writeComposition(2, { ...v2Composition, changes: { alpha: v2Composition.changes.alpha } }, { expect: "fail" })
    .includes("updated with no \"What changed\" note in \"changes\": beta"));
assert("…and a note on an entry the client has never seen",
  writeComposition(2, { ...v2Composition, changes: { ...v2Composition.changes, c1: ["Was a draft."] } }, { expect: "fail" })
    .includes("isn't an updated entry in v2: c1"));
// Any command can be the agent; this one writes the composition and marks it
// prepared, the way an agent would.
const writer = path.join(dir, "write-composition.cjs");
const prepareAgent = (body) => {
  fs.writeFileSync(writer, `const fs = require("node:fs"); const { spawnSync } = require("node:child_process");
process.stdin.resume(); process.stdin.on("end", () => {
  const file = ${JSON.stringify(path.join(dir, ".ledger/compositions.json"))};
  const all = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).compositions : [];
  fs.writeFileSync(file, JSON.stringify({ compositions: [...all.filter((c) => c.version !== 2), { version: 2, ...${JSON.stringify(body)} }] }, null, 2));
  spawnSync("node", [${JSON.stringify(BIN)}, "prepare", "complete"], { stdio: "ignore" });
});`);
  return `node ${JSON.stringify(writer)}`;
};
const handed = run(["prepare", "--run", prepareAgent(v2Composition)]);
assert("`ledger prepare --run` hands it to an agent and checks it left the release prepared",
  /✓ prepared \(.*\), and nothing recorded since/.test(handed));
const stamp = readJson(path.join(dir, ".ledger/compositions.json")).compositions.find((c) => c.version === 2).prepared;
assert("…and the stamp counts, per entry, the changes it was written from",
  stamp.entries.alpha === 3 && stamp.entries.c1 === 0 && Object.keys(stamp.entries).length === 6 && stamp.notes === 1);
const completed = run(["prepare", "complete"]);
assert("`prepare complete` prints the summary as the edition will, and no message",
  completed.includes("What's new (4)") && completed.includes("1. Customers can handle the first new part.  [c1]") &&
  !completed.includes("feature ledger is attached"));
assert("`ledger compose` and the other retired steps point at `ledger prepare`",
  ["compose", "summary", "review", "verify", "audit"].every((c) => run([c], { expect: "fail" }).includes("`ledger prepare` now")));
// Editing the prepared words by hand is the point, and asks for nothing.
const compositionsPath = path.join(dir, ".ledger/compositions.json");
const reword = (edit) => {
  const all = readJson(compositionsPath);
  edit(all.compositions.find((c) => c.version === 2));
  fs.writeFileSync(compositionsPath, JSON.stringify(all, null, 2));
};
reword((x) => { x.summary.alpha = "alpha covers the adjacent thing too."; });
assert("an item hand-edited into lower case is reported", run(["status", "--quiet"]).includes("won't read as a sentence"));
reword((x) => {
  x.changes.alpha = ["It covers the adjacent thing now, said by hand. It runs on past one sentence."];
  x.summary.alpha = "Alpha covers the adjacent thing too, and a good deal more besides, said at length, " +
    "with every last detail of how it does it spelled out for the reader.";
  x.overview = "This edition adds a cluster of four parts. Alpha covers the adjacent thing. Beta has a new name. And more.";
});
const wordy = run(["status", "--quiet"]);
assert("…a note past one sentence per change is mentioned", wordy.includes("runs past 1 sentence"));
assert("…and so is a summary sentence past 25 words, and an overview past three sentences",
  wordy.includes("past 25 words") && wordy.includes("overview of v2 runs past 3 sentences"));
reword((x) => { x.summary.alpha = "Alpha covers the adjacent thing too."; delete x.overview; });
reword((x) => { x.changes.alpha = ["It covers the adjacent thing now, said by hand."]; });
assert("…but a hand-edit doesn't count as news since the prepare", run([]).includes("nothing recorded since"));
// A change recorded afterwards does, by name, and the brief marks it.
run(["change", "alpha", "--what", "It shows the adjacent thing first.", "--why", "That is where users start."]);
assert("a change recorded after the prepare is news since it, by name",
  /1 change recorded since the last prepare \(.*\), on alpha/.test(run([])));
assert("…and the brief marks what moved, keeping the rest as written", /\* updated\s+alpha/.test(run(["prepare"])) &&
  !/\* updated\s+beta/.test(run(["prepare"])) && run(["prepare"]).includes("said by hand"));
// The developer gives the reason nobody recorded, in the session: it goes into
// that event, and is not news.
const alphaPath = path.join(dir, ".ledger/features/alpha.json");
const answered = readJson(alphaPath);
Object.assign(answered.events[1], { why: "It saves a step on every visit.", why_from: "person" });
fs.writeFileSync(alphaPath, `${JSON.stringify(answered, null, 2)}\n`);
assert("a reason given by a person stops being asked", !run([]).includes("Reasons nobody has vouched for"));
assert("…and is no news of its own", /1 change recorded since the last prepare/.test(run([])));
run(["prepare", "complete"]);
assert("…until it is prepared again", run([]).includes("nothing recorded since"));

const list = run(["list"]);
assert("list marks this release's work", list.includes("changed v2") && list.includes("new v2"));
const status = run(["status", "--json"]);
assert("status counts the removal", JSON.parse(status).removed.includes("gamma"));
assert("status reports the setup it used to need `doctor` for", JSON.parse(status).setup.fonts.includes("embedded"));
assert("…and what stands before the cut", Array.isArray(JSON.parse(status).cut.warnings));

run(["build", "--md"]);
const md = fs.readFileSync(path.join(dir, "docs/generated/FEATURES.md"), "utf8");
assert("renamed feature footnotes its old name", md.includes("previously “Beta”"));
assert("global change appears once", md.split("Also since last time").length === 2);
assert("sub-section heading is numbered", md.includes("### 1.1 A cluster"));
assert("dev feature stays out of the client doc", !md.includes("An internal convenience"));
assert("areas are numbered once there are areas", md.includes("## 1. First area"));
assert("how to see it is in the docs too", md.includes("*How to see it:* Open Alpha, then Adjacent."));
const dev = fs.readFileSync(path.join(dir, "docs/generated/DEV_FEATURES.md"), "utf8");
assert("the removed dev feature is listed as gone, in the dev doc", dev.includes("No longer available") && dev.includes("Superseded by the build pipeline"));

const pdf = run(["build", "--pdf"], { expect: "ok" });
if (pdf.includes("wrote")) {
  const file = path.join(dir, "docs/generated/Testbed-Feature-Ledger_2-draft.pdf");
  assert("the PDF edition is a real PDF", fs.existsSync(file) && fs.readFileSync(file).subarray(0, 4).toString() === "%PDF");
}

// ---- The third register ----
// Everything recorded late still lands on the OPEN release — "new" in a client
// edition means new to the reader, and this is the first document to mention
// it — so nothing is ever written into a past release and an already-issued
// edition reprints exactly as it was.
const v1Path = path.join(dir, "docs/generated/client/Testbed-Feature-Ledger_1.html");
run(["build", "--pdf", "--html", "--version", "1"]);
const v1Before = fs.readFileSync(v1Path, "utf8");

run(["add", "always-there", "--backfilled"], {
  stdin: feature({
    audience: "user", category: "First area", size: "Medium", name: "Always there",
    description: "Something the product could always do.",
  }),
});
run(["change", "beta", "--backfilled", "--why-from", "commit"], {
  stdin: feature({
    description: "Does the beta thing, over a wider window.",
    what: "The window was narrower.",
    why: "Widened for the overnight batch.",
  }),
});
run(["remove", "solo", "--backfilled", "--reason", "No longer part of the product."]);
// backfilled is only ever true; an explicit false is a third state every
// renderer would have to reason about.
fs.writeFileSync(
  path.join(dir, ".ledger/features/bad.json"),
  JSON.stringify({ id: "bad", audience: "user", category: "First area", size: "Small",
    history: [{ version: 1, name: "Bad", description: "x", backfilled: false }] }),
);
run(["status", "--quiet"], { expect: "fail" });
fs.rmSync(path.join(dir, ".ledger/features/bad.json"));

run(["build", "--pdf", "--html", "--version", "1"]);
assert("work recorded late leaves an already-issued edition byte for byte as it was", fs.readFileSync(v1Path, "utf8") === v1Before);

run(["build", "--pdf", "--html"]);
const stale = fs.readFileSync(path.join(dir, "docs/generated/Testbed-Feature-Ledger_2-draft.html"), "utf8");
assert("a draft says on its summary page what was recorded since the prepare",
  stale.includes('class="draft-note"') && stale.includes("since the last prepare") && stale.includes("always-there"));
// A preview is free: it opens with the size of the release, then prints the
// draft, and never hands anything to an agent.
const preview = run(["preview", "--html"]);
assert("`ledger preview` opens with the size of the release, and what the prepare hasn't read",
  preview.includes("v2 so far, against v1") && /new +4 +4 Small/.test(preview) &&
  /\d+ changes recorded, \d+ since the last prepare/.test(preview) && preview.includes("wrote v2"));
assert("…and never starts an agent", run(["preview", "--run", "claude"], { expect: "fail" }).includes("never starts an agent"));
const v2Caught = { ...v2Composition, changes: { alpha: ["It covers the adjacent thing now, said by hand."],
  beta: ["Its window was narrower; it was widened for the overnight batch."] },
overview: "This edition adds a cluster of four parts, and Alpha now covers the adjacent thing.",
summary: { ...v2Composition.summary, "always-there": "Something the product could always do is on the record.",
  solo: "Solo went before the last edition; Alpha does what it did." } };
// The catalogue opens each area with its own overview, kept with the area.
run(["categories", "add", "Third area", "--intro", "Things for a third purpose."]);
run(["categories", "rename", "Third area", "Last area"]);
assert("an area's overview is kept with it through a rename",
  readJson(path.join(dir, ".ledger/config.json")).area_intros["Last area"] === "Things for a third purpose.");
run(["categories", "remove", "Last area"]);
assert("…and goes with it", !("Last area" in readJson(path.join(dir, ".ledger/config.json")).area_intros));
{
  const cfgPath = path.join(dir, ".ledger/config.json");
  const cfg = readJson(cfgPath);
  cfg.area_intros = { "Second area": "Everything second, in one place." };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
}
// What the client reads is written for someone who has never seen the code.
const deltaPath = path.join(dir, ".ledger/features/delta.json");
const deltaBefore = fs.readFileSync(deltaPath, "utf8");
const deltaTech = JSON.parse(deltaBefore);
deltaTech.history[0].description = "Does the delta thing, configured in src/delta/config.json with --delta-mode.";
fs.writeFileSync(deltaPath, JSON.stringify(deltaTech, null, 2));
assert("client text that reads like code is pointed out", run(["status", "--quiet"]).includes("read like code (delta: a file name)") ||
  run(["status", "--quiet"]).includes("reads like code (delta: a file name)"));
fs.writeFileSync(deltaPath, deltaBefore);
// An updated entry leads with its change: the client read its description
// last time, so only the first sentence prints above the note.
{
  const a = readJson(alphaPath);
  a.history[1].description = "Does the alpha thing, and the adjacent one. It remembers where you left off.";
  fs.writeFileSync(alphaPath, `${JSON.stringify(a, null, 2)}\n`);
}
run(["prepare", "--run", prepareAgent(v2Caught)]);
fs.rmSync(writer);
run(["build", "--pdf", "--html"]);
run(["build", "--md"]);
const v2 = fs.readFileSync(path.join(dir, "docs/generated/Testbed-Feature-Ledger_2-draft.html"), "utf8");
assert("the third register draws in its own colour", v2.includes('<span class="status is-backfilled">Already in place</span>'));
assert("…and never puts the internal key in front of a client", !v2.includes(">BACKFILLED<"));
assert("a removal found late is reported, apart from this cycle's news", v2.includes("No longer present"));
// The page after the cover: the release's summary, each item followed by links to the entries it sums up.
const summaryStart = v2.indexOf('<section class="summary"');
const summary = v2.slice(summaryStart, v2.indexOf("</section>", summaryStart));
assert("the edition opens with a summary of what's different", summary.includes("different in this edition"));
assert("…as one line per entry: its sentence, linking to it, then its number",
  summary.includes("<ol>") &&
  /<li><span class="text"><a href="#f-c1">Customers can handle the first new part\.<\/a><\/span> <span class="refs"><a class="ref" href="#f-c1">\d+\.\d+<\/a><\/span><\/li>/.test(summary) &&
  v2.includes('id="f-c4"'));
{
  // The lines are the details at one sentence each: same entries, same order.
  const order = (html) => [...html.matchAll(/(?:href|id)="#?f-([\w-]+)"/g)].map((m) => m[1]).filter((id, i, a) => a.indexOf(id) === i);
  const details = v2.slice(v2.indexOf('id="whats-changed"'), v2.indexOf('id="everything-else"'));
  const inDetails = order(details).filter((id) => details.includes(`<article class="feature`) && details.includes(`id="f-${id}"`));
  assert("…covering exactly the entries the details print, in the same order",
    JSON.stringify(order(summary)) === JSON.stringify(inDetails));
}
{
  // The number a reference cites is the number the entry prints beside it.
  const cited = summary.match(/<a class="ref" href="#f-c4">([\d.]+)<\/a>/)?.[1];
  assert("…and each number is the one its entry prints in the margin",
    Boolean(cited) && v2.includes(`id="f-c4"><div class="rail"><span class="no">${cited}</span>`));
}
assert("…beta among them", summary.includes("f-beta"));
assert("…and, once it is prepared, no draft note", !summary.includes("draft-note"));
assert("…under plain headings, each with its count",
  summary.includes('<h3>What&#39;s new<span class="count">4</span></h3>') && summary.includes('<h3>What changed<span class="count">'));
// gamma, the one removal this cycle, was team-only, so it has no group here.
assert("…grouped the way the ledger colours them",
  ["is-new", "is-updated", "is-backfilled", "is-gone", "is-other"].every((g) => summary.includes(`sum-group ${g}`)) &&
  !summary.includes("is-removed"));
assert("…with a removal listed by its sentence, not the reason its details give",
  summary.includes('<a href="#gone-solo">Solo went before the last edition; Alpha does what it did.</a>') && v2.includes('id="gone-solo"') &&
  !summary.includes("No longer part of the product."));
assert("…and nothing that only the team reads", !summary.includes("Tooling"));
// Short without dropping work: everything that moved in full, then one line
// for everything else.
assert("every entry that moved prints in full",
  v2.includes('id="whats-changed"') && /<article class="feature[^"]*" id="f-beta">/.test(v2) &&
  v2.includes("Its window was narrower; it was widened for the overnight batch."));
{
  const card = v2.slice(v2.indexOf('id="f-alpha"')).split('class="feature')[0];
  assert("an updated entry leads with what changed, under the first sentence of its description",
    card.includes('<p class="desc is-brief">Does the alpha thing, and the adjacent one.</p><div class="changes">') &&
    !card.includes("It remembers where you left off."));
}
assert("…with how to see it under each",
  v2.slice(v2.indexOf('id="f-alpha"')).split('class="feature')[0].includes("Open Alpha, then Adjacent."));
assert("…and no separate line on why it matters: the summary sentence says it", !v2.includes('class="matters"'));
assert("the first page opens with the overview, then the counts, then the summary",
  v2.indexOf('class="overview">This edition adds a cluster of four parts') > 0 &&
  v2.indexOf('class="overview"') < v2.indexOf('class="tally"') && v2.indexOf('class="tally"') < v2.indexOf('<section class="summary"') &&
  v2.indexOf('<section class="summary"') < v2.indexOf('id="whats-changed"'));
assert("…with its parts listed between the counts and the summary, each a link with what it is for",
  v2.indexOf('class="tally"') < v2.indexOf('<nav class="contents parts">') &&
  v2.indexOf('<nav class="contents parts">') < v2.indexOf('<section class="summary"') &&
  ["whats-different", "whats-changed", "everything-else"].every((id) => v2.includes(`<a href="#${id}">`)) &&
  v2.includes('<span class="role">Every feature, one line each'));
assert("…with what the sizes mean said once, where the catalogue compares them",
  v2.split('class="size-key"').length === 2 && v2.indexOf('class="size-key"') > v2.indexOf('id="everything-else"') &&
  v2.includes("Size is how much of the service a feature is") && !v2.includes('class="callout"'));
assert("…and no list of areas on it: the catalogue has its own", !v2.includes('<nav class="contents">'));
assert("the catalogue lists every capability once, with its size, name and first sentence",
  v2.includes('id="everything-else"') && /<li id="f-delta"><span class="no">[\d.]+<\/span><span class="sz"><span class="size size-small"/.test(v2) &&
  v2.includes('<span class="nm">Delta</span><span class="first">Does the delta thing.</span><span class="mv"></span></li>') &&
  !v2.includes("nobody reads on a one-line listing") && !v2.includes('<article class="feature" id="f-delta">'));
assert("…marks what moved, linking to its details",
  v2.includes('<span class="nm">Alpha</span><span class="first">Does the alpha thing, and the adjacent one.</span>' +
    '<span class="mv"><a class="moved is-updated" href="#f-alpha">Changed</a></span>'));
assert("…and opens on a map of its areas, linking to each",
  v2.includes('<nav class="contents is-index">') && v2.indexOf('class="contents is-index"') > v2.indexOf('id="everything-else"') &&
  v2.includes('<li><a href="#area-1"><span class="num">1</span>'));
assert("…and opens an area with its overview", v2.includes('<p class="area-intro">Everything second, in one place.</p>'));
assert("the cover counts it all in one row",
  v2.includes('<div class="stat is-new"><b>4</b><span>new</span></div>') &&
  v2.includes('<div class="stat is-backfilled"><b>2</b><span>already in place</span></div>') &&
  v2.includes('<div class="stat is-same"><b>1</b><span>unchanged</span></div>'));
run(["build", "v2", "--html", "--full"]);
const v2Full = fs.readFileSync(path.join(dir, "docs/generated/Testbed-Feature-Ledger_2-draft.html"), "utf8");
assert("`--full` prints every entry in full instead, with a contents list",
  v2Full.includes('<article class="feature" id="f-delta">') && !v2Full.includes('id="everything-else"') &&
  v2Full.includes("It remembers where you left off.") && v2Full.includes('<nav class="contents">'));
const md2 = fs.readFileSync(path.join(dir, "docs/generated/FEATURES.md"), "utf8");
assert("the living docs use the same words", md2.includes("Already in place]"));
assert("a reason read off a commit is listed until somebody vouches for it",
  run([]).includes("beta: The window was narrower.  — why: Widened for the overnight batch.  [from a commit message]"));
fs.rmSync(path.join(dir, "docs/generated"), { recursive: true, force: true });

// ---- A printed number carried on from earlier reports ----
// display_version relabels the editions and nothing else: the ledger still
// counts 1..N, and --version still takes the real number.
const releasesPath = path.join(dir, ".ledger/releases.json");
const timelineBefore = fs.readFileSync(releasesPath, "utf8");
const relabel = (v) => {
  const rs = JSON.parse(timelineBefore);
  rs[0].display_version = v;
  fs.writeFileSync(releasesPath, JSON.stringify(rs, null, 2));
};
relabel(0);
run(["status", "--quiet"], { expect: "fail" });
relabel(4);
run(["build", "--pdf", "--html", "--version", "2"]);
const relabelled = path.join(dir, "docs/generated/Testbed-Feature-Ledger_5-draft.html");
assert("a later edition follows on from the printed number", fs.existsSync(relabelled) &&
  fs.readFileSync(relabelled, "utf8").includes("Version 5") && !fs.readFileSync(relabelled, "utf8").includes("Version 2"));
assert("…and `releases` shows it beside the real one", run(["releases"]).includes("printed as 5"));

// A redraft done by hand is marked on its release: it reissues the number
// before it, says it is reorganized, and marks nothing new or updated.
const markReleases = (edit) => {
  const rs = JSON.parse(timelineBefore);
  edit(rs);
  fs.writeFileSync(releasesPath, JSON.stringify(rs, null, 2));
};
// On the first edition it stands for reports sent before the ledger existed.
markReleases((rs) => { rs[0].redraft = true; });
run(["build", "--pdf", "--html", "--version", "1"]);
const firstRedraft = path.join(dir, "docs/generated/client/Testbed-Feature-Ledger_1_redraft.html");
const firstHtml = fs.existsSync(firstRedraft) ? fs.readFileSync(firstRedraft, "utf8") : "";
assert("a first edition can be a redraft of reports sent another way",
  firstHtml.includes("Version 1 (redraft)") && firstHtml.includes("Earlier reports described"));
{
  const lines = run(["releases"]).split("\n");
  assert("…and the edition after it takes the next number",
    lines.find((l) => l.startsWith("v 1"))?.includes("printed as 1 (redraft)") &&
    !lines.find((l) => l.startsWith("v 2"))?.includes("printed as"));
}
markReleases((rs) => { rs[0].redraft = true; rs[0].display_version = 4; });
run(["build", "--pdf", "--html", "--version", "1"]);
assert("…printed under the number the client already counts by",
  fs.existsSync(path.join(dir, "docs/generated/client/Testbed-Feature-Ledger_4_redraft.html")));
assert("…with the release after it following on", run(["releases"]).includes("printed as 5"));
markReleases((rs) => { rs[1].redraft = "yes"; });
run(["status", "--quiet"], { expect: "fail" });
markReleases((rs) => { rs[1].layout = "compact"; });
run(["status", "--quiet"], { expect: "fail" });
markReleases((rs) => { rs[0].display_version = 3; rs[1].redraft = true; });
run(["build", "--pdf", "--html", "--version", "2"]);
const redrafted = path.join(dir, "docs/generated/Testbed-Feature-Ledger_3_redraft-draft.html");
const redraftHtml = fs.existsSync(redrafted) ? fs.readFileSync(redrafted, "utf8") : "";
assert("a redraft marked by hand reissues the number before it, in the file name too",
  redraftHtml.includes("Version 3 (redraft)"));
assert("…opens with the reorganized note", redraftHtml.includes("This edition is reorganized") && redraftHtml.includes("Edition 3 arranged"));
assert("…and marks nothing as new or updated, printing every entry in full", !/tag-(new|updated)"/.test(redraftHtml) &&
  !redraftHtml.includes('id="everything-else"'));
markReleases((rs) => {
  rs[0].display_version = 3;
  Object.assign(rs[1], { redraft: true, status: "released", name: "Rewrite", date: "2026-02-01" });
  rs.push({ version: 3, name: null, date: null, status: "future", commit: null });
});
const listed = run(["release", "list"]);   // the old name still works
assert("the release after a redraft takes the next number", listed.includes("printed as 3 (redraft)") && listed.includes("printed as 4"));
fs.writeFileSync(releasesPath, timelineBefore);
fs.rmSync(path.join(dir, "docs/generated"), { recursive: true, force: true });

// The other output shape: a project that keeps its client editions. The
// Markdown docs stay build output either way; only the PDFs move, out of the
// one directory `init` gitignores.
const kept = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-kept-"));
run(["init", "--product", "Kept", "--agents", "none", "--commit-pdfs"], { cwd: kept });
const keptConfig = readJson(path.join(kept, ".ledger/config.json"));
assert("--commit-pdfs puts the editions outside the gitignored directory", keptConfig.output.client_dir === "docs/client");
assert("…and the ignored directory covers only the Markdown docs",
  fs.readFileSync(path.join(kept, ".gitignore"), "utf8").split("\n").filter(Boolean).join() === "docs/generated/");
assert("…and a fresh config carries nothing that maps code", !("ignore" in keptConfig) && !("checks" in keptConfig) && keptConfig.schema === 3);
run(["add", "kept-one"], {
  cwd: kept,
  stdin: feature({ audience: "user", size: "Medium", name: "Kept one", description: "Does the kept thing." }),
});
run(["build", "--pdf", "--html"], { cwd: kept });
assert("a first edition's prepare writes no notes or summary, and says why",
  run(["prepare"], { cwd: kept }).includes("prints as an inventory"));
assert(
  "…and a draft never lands there, under a name that says it's a draft",
  !fs.existsSync(path.join(kept, "docs/client")) &&
    fs.existsSync(path.join(kept, "docs/generated/Kept-Feature-Ledger_1-draft.html")),
);
assert("`ledger cut` prints the edition there itself, and nothing beside it",
  run(["cut", "--name", "Baseline", "--html", "--yes"], { cwd: kept }).includes("docs/client/Kept-Feature-Ledger_1.html") &&
  fs.readdirSync(path.join(kept, "docs/client")).join() === "Kept-Feature-Ledger_1.html");
assert("…and clears away the draft it replaces",
  !fs.existsSync(path.join(kept, "docs/generated/Kept-Feature-Ledger_1-draft.html")));
fs.rmSync(kept, { recursive: true, force: true });

// Every printed brief draws the boundary between "for you" and "paste this"
// the same way. Someone is going to select from that line to the end of the
// output, and briefs that mark it differently teach them to look for different things.
const RULE = "═════════════════════  COPY EVERYTHING BELOW THIS LINE  ═════════════════════";
for (const b of [["bootstrap"], ["style", "rewrite"], ["prepare"]]) {
  assert(`\`ledger ${b.join(" ")}\` marks where the prompt starts, the same way`, run(b, { cwd: dir }).includes(RULE));
}

// …and every one of them can print the prompt alone, ready to pipe into a
// clipboard: nothing above the rule, and not the rule itself.
for (const b of [["bootstrap"], ["style", "rewrite"], ["prepare"]]) {
  const only = run([...b, "--prompt-only"], { cwd: dir });
  assert(`\`ledger ${b.join(" ")} --prompt-only\` prints just the prompt`,
    !only.includes(RULE) && !only.includes("Paste the prompt") && only.trim().length > 200);
}
run(["status", "--prompt-only"], { cwd: dir, expect: "fail" });

// An option the command doesn't take is refused before anything runs, so a
// typo can't turn into a release cut without the guard it was meant to set.
const beforeTypo = fs.readFileSync(path.join(dir, ".ledger/releases.json"), "utf8");
assert("a mistyped option is refused, with the one it was probably meant to be",
  run(["release", "cut", "--name", "Typo", "--dryrun"], { cwd: dir, expect: "fail" }).includes("did you mean --dry-run?"));
assert("…and nothing was cut", fs.readFileSync(path.join(dir, ".ledger/releases.json"), "utf8") === beforeTypo);
run(["list", "--catgory", "x"], { cwd: dir, expect: "fail" });
run(["releases", "--force"], { cwd: dir, expect: "fail" });
run(["list", "--json", "--dir", ".ledger"], { cwd: dir });

// --help after any command is help, and never does the thing.
const releasesBefore = fs.readFileSync(path.join(dir, ".ledger/releases.json"), "utf8");
assert("`ledger cut --help` prints help",
  run(["cut", "--name", "Oops", "--help"], { cwd: dir }).includes("ledger cut --name"));
assert("…and so does the old name for it", run(["release", "cut", "--help"], { cwd: dir }).includes("ledger cut --name"));
assert("…and cuts nothing", fs.readFileSync(path.join(dir, ".ledger/releases.json"), "utf8") === releasesBefore);
assert("`ledger add --help` prints help without reading a payload",
  run(["add", "never", "--help"], { cwd: dir }).includes("ledger add <id>")
  && !fs.existsSync(path.join(dir, ".ledger/features/never.json")));
assert("-h works the same", run(["redraft", "-h"], { cwd: dir }).includes("ledger redraft"));
assert("the help leads with the mental model", run(["--help"], { cwd: dir }).includes("Preview is free, the agent costs tokens, cut prints."));

// ---- Finding your way ----
// Bare `ledger` says where things stand and what to run next; outside a
// project it is the help.
const overview = run([], { cwd: dir });
assert("bare `ledger` shows what stands before the cut, and the next command", overview.includes("Ready to cut?") && overview.includes("Next:"));
assert("…and outside a project it prints the help", run([], { cwd: os.tmpdir() }).includes("a client-facing record"));
assert("`ledger status` carries the same report", run(["status"], { cwd: dir }).includes("Ready to cut?"));
assert("a subcommand typed on its own points at where it lives",
  run(["amend"], { cwd: dir, expect: "fail" }).includes("ledger releases amend") && lastStatus === 2);
assert("a near-miss of a command is suggested", run(["prepre"], { cwd: dir, expect: "fail" }).includes("ledger prepare"));
for (const [gone, says] of [["questions", "`ledger prepare` asks"], ["own", "no longer maps code"], ["paths", "no longer maps code"],
  ["diff", "`ledger preview`"]]) {
  assert(`\`ledger ${gone}\` says where its job went`, run([gone], { cwd: dir, expect: "fail" }).includes(says));
}
assert("completion offers the feature ids", run(["__complete", "show", ""], { cwd: dir }).includes("alpha"));
assert("…and every shell gets a script", ["zsh", "bash", "fish"].every((sh) => run(["completion", sh], { cwd: dir }).includes("__complete")));
run(["prepare", "--print", "--copy"], { cwd: dir, expect: "fail" });
assert("a bare --run with no agent configured is refused, not guessed",
  run(["prepare", "--run"], { cwd: dir, expect: "fail", env: { ...process.env, LEDGER_AGENT: "" } }).includes("--run needs an agent"));
assert("a misspelt agent is caught before anything runs",
  run(["prepare", "--run", "cluade"], { cwd: dir, expect: "fail" }).includes("did you mean claude?"));

// ---- Handing a prompt to an agent ----
// Fake agents on PATH, speaking each one's real event format, so the
// adapters, the runner and the checks afterwards run end to end offline.
const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-agents-"));
const fakeAgent = (name, body) => {
  const file = path.join(fakeBin, name);
  fs.writeFileSync(file, `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const say = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const ledger = (...a) => spawnSync(process.execPath, [${JSON.stringify(BIN)}, ...a], { encoding: "utf8" });
let prompt = ""; process.stdin.on("data", (d) => { prompt += d; }); process.stdin.on("end", () => { ${body} });
`);
  fs.chmodSync(file, 0o755);
};
fakeAgent("claude", `
  say({ type: "system", subtype: "init", session_id: "sess-123" });
  say({ type: "assistant", message: { content: [{ type: "text", text: "Reading the release." }, { type: "tool_use", name: "Bash", input: { command: "ledger list" } }] } });
  if (!prompt.includes("Prepare the v2 edition")) process.exit(9);
  ledger("prepare", "complete");
  say({ type: "result", result: "Prepared. Next: cut it.", session_id: "sess-123", num_turns: 3, total_cost_usd: 0.1,
    permission_denials: [{ tool_name: "Bash", tool_input: { command: "rm -rf build\\nand more" } }] });
`);
fakeAgent("codex", `
  say({ type: "thread.started", thread_id: "th-9" });
  say({ type: "item.completed", item: { type: "agent_message", text: "I looked, and stopped." } });
`);
const withFakes = { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` };
run(["change", "alpha", "--what", "It shows a count of adjacent things.", "--why", "Asked for at the demo."], { cwd: dir });
const ran = run(["prepare", "--run", "claude"], { cwd: dir, env: withFakes });
assert("--run claude shows the agent's last message", ran.includes("Prepared. Next: cut it."));
assert("…checks what it left behind", /✓ prepared \(.*\), and nothing recorded since/.test(ran));
assert("…names the tool calls it was refused, one line each", ran.includes("refused 1 tool call (Bash rm -rf build)"));
assert("…and says how to resume its session", ran.includes("claude --resume sess-123"));
run(["change", "alpha", "--what", "It sorts adjacent things by date.", "--why", "Asked for at the demo."], { cwd: dir });
const stopped = run(["prepare", "--run", "codex"], { cwd: dir, env: withFakes, expect: "fail" });
assert("an agent that stops before `prepare complete` is reported, and exits 3",
  stopped.includes("stopped before `ledger prepare complete`") && lastStatus === 3);
assert("…still with the way back into its session", stopped.includes("codex resume th-9"));
const customAgent = path.join(fakeBin, "custom-agent.cjs");
fs.writeFileSync(customAgent, `const { spawnSync } = require("node:child_process");
process.stdin.resume(); process.stdin.on("end", () => {
  spawnSync(process.execPath, [${JSON.stringify(BIN)}, "prepare", "complete"], { stdio: "inherit" });
});`);
const custom = run(["prepare", "--run", `node ${JSON.stringify(customAgent)}`], { cwd: dir });
assert("any command can be the agent, with the prompt on stdin", /✓ prepared \(/.test(custom));
assert("…and it says the resume command is the agent's own", custom.includes("agent's own command"));
fs.rmSync(fakeBin, { recursive: true, force: true });

// ---- A real repository: commits, the code since, and the cut ----
const repo = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-git-"));
const git = (...args) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
const commitAll = (msg) => { git("add", "-A"); git("commit", "-qm", msg); };
git("init", "-q", ".");
git("config", "user.email", "smoke@example.com");
git("config", "user.name", "Smoke");
fs.mkdirSync(path.join(repo, "src"), { recursive: true });
fs.writeFileSync(path.join(repo, "src/app.js"), "one\n");
commitAll("Initial import");

run(["init", "--product", "Audited", "--agents", "none"], { cwd: repo });
run(["add", "one"], { cwd: repo, stdin: feature({ audience: "user", size: "Medium", name: "One", description: "Does the one thing." }) });
run(["add", "steady"], { cwd: repo, stdin: feature({ audience: "user", size: "Small", name: "Steady", description: "Does the steady thing." }) });

// The survey writes the baseline and hands it back: the developer reads it,
// commits it and cuts it.
const boot = run(["bootstrap"], { cwd: repo });
assert("the baseline survey stops before the cut, and commits nothing",
  boot.includes("Don't cut the release, and don't commit") && !boot.includes("audit"));
assert("…and writes how to see each entry", boot.includes("how_to_see"));

const dirty = run([], { cwd: repo });
assert("an uncommitted ledger is said before the cut, as something the edition can't be traced to",
  dirty.includes(".ledger/ has uncommitted changes") && dirty.includes("can't be traced to a commit"));
commitAll("Baseline ledger");
run(["cut", "--name", "Baseline", "--date", "2026-01-15", "--no-pdf", "--yes"], { cwd: repo });
// Set by hand, and every later rewrite of the timeline has to keep it.
{
  const p = path.join(repo, ".ledger/releases.json");
  const rs = readJson(p);
  rs[0].display_version = 4;
  fs.writeFileSync(p, JSON.stringify(rs, null, 2));
}
commitAll("Cut the baseline");
fs.writeFileSync(path.join(repo, "src/app.js"), "one\ntwo\n");
commitAll("Add the two thing");

const nothing = run(["cut", "--name", "Next", "--no-pdf", "--yes"], { cwd: repo, expect: "fail" });
assert("code that moved with nothing recorded is refused, since the edition would repeat the last",
  nothing.includes("was NOT cut") && nothing.includes("nothing is recorded against v2") && lastStatus === 3);
run(["change", "one", "--what", "It does the two thing as well.", "--why", "Asked for at the demo."], { cwd: repo });
fs.writeFileSync(path.join(repo, "src/app.js"), "one\ntwo\nthree\n");
const prepBrief = run(["prepare"], { cwd: repo });
assert("the prepare brief carries the code since the last edition, working tree included, and the commits",
  prepBrief.includes("## 2. Work nobody recorded") && /src\/app\.js\s+\d+/.test(prepBrief) && prepBrief.includes("Add the two thing") &&
  prepBrief.includes("Uncommitted right now: src/app.js"));
assert("…and the readout says how much code moved", /code +\d+ lines changed since v1's commit, working tree included/.test(run(["preview", "--html"], { cwd: repo })));
assert("work outside the ledger left uncommitted is said before the cut",
  run([], { cwd: repo }).includes("outside the ledger is uncommitted (src/app.js)"));
commitAll("Add the three thing");
// Nobody prepared a note for `one`, so the cut says the edition prints its
// changes as recorded, and freezes them with it.
const recordedCut = run(["cut", "--name", "Demo", "--date", "2026-02-01", "--no-pdf", "--yes"], { cwd: repo });
assert("an updated entry with no prepared note is said, and the cut goes ahead with --yes",
  recordedCut.includes("prints its changes as recorded (one)") && recordedCut.includes("cut v2"));
const frozen = readJson(path.join(repo, ".ledger/compositions.json")).compositions.find((c) => c.version === 2);
assert("…its recorded lines frozen with the edition", frozen.changes.one[0] === "It does the two thing as well. Asked for at the demo.");
run(["build", "v2", "--html"], { cwd: repo });
const v2Path = path.join(repo, "docs/generated/client/Audited-Feature-Ledger_5.html");
const v2Before = fs.readFileSync(v2Path, "utf8");
assert("a cut edition prints its recorded lines as its note, unlabelled",
  v2Before.includes("It does the two thing as well. Asked for at the demo.") && !v2Before.includes("not yet prepared"));
const onePath = path.join(repo, ".ledger/features/one.json");
const one = readJson(onePath);
one.events[0].what = "Reworded long after the edition went out.";
fs.writeFileSync(onePath, JSON.stringify(one, null, 2));
run(["build", "v2", "--html"], { cwd: repo });
assert("…and reprints byte for byte, whatever happens to the events afterwards", fs.readFileSync(v2Path, "utf8") === v2Before);
commitAll("Cut v2");

// A release is a moment, and a date is too coarse to name one: two demos in a
// day are ordinary. The commit says which state of the product an edition was
// printed from, so two same-day releases stay tellable apart.
const cutJson = () => readJson(path.join(repo, ".ledger/releases.json"));
assert("a cut records the commit it happened at", /^[0-9a-f]{40}$/.test(cutJson()[0].commit ?? ""));
assert("…and keeps a printed number set by hand", cutJson()[0].display_version === 4);
run(["add", "two"], { cwd: repo, stdin: feature({ audience: "user", size: "Small", name: "Two", description: "Does the two thing.",
  how_to_see: "Open Two." }) });
writeComposition(3, { summary: { two: "Customers can do the two thing." } }, { cwd: repo });
commitAll("Two, prepared");
// Prepared and committed: nothing to say, so nothing to confirm.
const clean = run(["cut", "--name", "Same day, later", "--date", "2026-02-01", "--no-pdf", "--full"], { cwd: repo });
assert("a prepared, committed release cuts without asking", clean.includes("cut v3") && !clean.includes("Before v3 is cut"));
assert("…`--full` is kept with the release, so every reprint is in full",
  cutJson()[2].layout === "full" && run(["releases"], { cwd: repo }).includes("printed in full"));
run(["build", "v3", "--html"], { cwd: repo });
assert("…and a reprint without the flag still prints every entry in full",
  fs.readFileSync(path.join(repo, "docs/generated/client/Audited-Feature-Ledger_6.html"), "utf8").includes('<article class="feature" id="f-steady">'));
const timeline = cutJson();
assert("two releases can share a date when the code moved between them",
  timeline[1].date === timeline[2].date && timeline[1].commit !== timeline[2].commit);
// Same day AND same commit is a re-issue of an edition already printed.
run(["add", "three"], { cwd: repo, stdin: feature({ audience: "user", size: "Small", name: "Three", description: "Does the third thing." }) });
const again = run(["cut", "--name", "Again", "--date", "2026-02-01", "--no-pdf", "--dry-run"], { cwd: repo });
assert("…but the day and the code both being the same is said before the cut",
  again.includes("stand for the same moment") && again.includes("--dry-run: nothing written") && cutJson().length === 4);
assert("the timeline lists each release's commit", /[0-9a-f]{7}  Same day, later/.test(run(["releases"], { cwd: repo })));
// Every ledger that predates commits has a timeline of nulls, so they have to
// be fillable in after the fact — otherwise the field only ever works forward.
const head = git("rev-parse", "HEAD").stdout.trim();
run(["releases", "amend", "1", "--commit", head], { cwd: repo });
assert("a release cut before commits were recorded can be filled in", cutJson()[0].commit === head);
// The in-progress release has no commit because it hasn't happened yet.
run(["releases", "amend", "4", "--commit", head], { cwd: repo, expect: "fail" });
run(["release", "amend", "1", "--commit", "0".repeat(40)], { cwd: repo, expect: "fail" });   // the old name, still refusing
fs.rmSync(repo, { recursive: true, force: true });

// ---- One command for agent work ----
// `ledger agent` works out which task is due from what the CLI recorded when
// each one finished, and how much of it, so a task already done is never
// sent round again and nothing due starts nothing.
{
  const ag = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-agent-"));
  const agit = (...args) => spawnSync("git", ["-C", ag, ...args], { encoding: "utf8" });
  const commit = (msg) => { agit("add", "-A"); agit("commit", "-qm", msg); };
  const state = () => (fs.existsSync(path.join(ag, ".ledger/state.json")) ? readJson(path.join(ag, ".ledger/state.json")) : {});
  const on = (args, o = {}) => run(args, { cwd: ag, ...o });
  agit("init", "-q", ".");
  agit("config", "user.email", "smoke@example.com");
  agit("config", "user.name", "Smoke");
  fs.mkdirSync(path.join(ag, "src"));
  fs.writeFileSync(path.join(ag, "src/app.js"), "one\n");
  commit("Initial import");

  assert("outside a ledger, `ledger agent` says to init, and starts nothing",
    on(["agent"], { expect: "fail" }).includes("`ledger init`") && lastStatus === 3);
  on(["init", "--product", "Routed", "--agents", "none"]);
  assert("an empty corpus is a survey", on(["agent", "--plan"]).includes("bootstrap: survey the codebase"));
  assert("…delivered like any task", on(["agent", "--print"]).includes("You are cataloguing what Routed already does"));

  on(["add", "one"], { stdin: feature({ audience: "user", size: "Medium", name: "One", description: "Does the one thing." }) });
  const unsure = on(["agent"], { expect: "fail" });
  assert("entries with no finished survey and no edition stop for a person, not an agent",
    unsure.includes("Only you can say which it is") && unsure.includes("ledger bootstrap complete") && lastStatus === 3);
  assert("…and the survey carries on from the entries already there",
    on(["bootstrap"]).includes("This survey has already started.** 1 entry is recorded"));
  on(["bootstrap", "complete"]);
  assert("`bootstrap complete` stamps the survey", state().bootstrap?.version === 1);
  commit("Baseline");
  assert("a finished survey with nothing else due starts no agent", on(["agent"]).includes("Nothing for an agent to do."));

  // The tone each entry was written in is recorded, never read off the text.
  on(["style", "set", "govuk"]);
  assert("`style set` records the tone every entry was in until now",
    state().styles?.entries?.one === "google" && state().styles?.other === "google");
  on(["add", "two"], { stdin: feature({ audience: "user", size: "Small", name: "Two", description: "Does the two thing." }) });
  assert("…and an entry written after it is in the new tone", !("two" in (state().styles?.entries ?? {})));
  assert("a rewrite is due for the entries in the old tone only",
    on(["agent", "--plan"]).includes("style rewrite: 1 entry and the text that belongs to no entry"));
  const restyle = on(["style", "rewrite"]);
  assert("…and its brief lists only those", restyle.includes("1 of the 2 entries are still in an earlier tone") &&
    restyle.includes("  - Features: one") && restyle.includes("ledger style rewrite complete --category"));
  on(["style", "rewrite", "complete", "--category", "Features"]);
  assert("an area marked done leaves only the rest of the text", on(["agent", "--plan"]).includes("style rewrite: 0 entries and the text"));
  on(["style", "rewrite", "complete"]);
  assert("…and once it's all done, no rewrite is due again", !("styles" in state()) && on(["agent"]).includes("Nothing for an agent to do."));
  assert("asked for anyway, the rewrite is a second pass", on(["style", "rewrite"]).includes("this is a second pass"));

  on(["cut", "--name", "Baseline", "--no-pdf", "--yes"]);
  commit("Cut v1");

  // A sweep is for code nobody has read, and enough of it.
  fs.writeFileSync(path.join(ag, "src/app.js"), "one\ntwo\n");
  const small = on(["agent", "--plan"]);
  assert("a small change is under the sweep threshold, and says how to sweep it anyway",
    small.includes("Nothing for an agent to do.") && small.includes("under the 20-line threshold") && small.includes("--force"));
  assert("…which --force does", on(["agent", "--plan", "--force"]).includes("sweep: read the code nobody has read yet"));
  fs.writeFileSync(path.join(ag, "src/app.js"), Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n"));
  fs.mkdirSync(path.join(ag, "test"));
  fs.writeFileSync(path.join(ag, "test/app.test.js"), Array.from({ length: 200 }, (_, i) => `t ${i}`).join("\n"));
  const sweepPlan = on(["agent", "--plan"]);
  assert("enough code since the last edition is a sweep", sweepPlan.includes("sweep:") && sweepPlan.includes("since v1's commit"));
  const sweepBrief = on(["agent", "--print"]);
  assert("…whose brief is the diff and the release's record, and no client text",
    sweepBrief.includes("src/app.js") && sweepBrief.includes("ledger sweep complete") && sweepBrief.includes("Don't") &&
    !sweepBrief.includes("## 4. What to write"));
  on(["sweep", "complete"]);
  assert("swept, the same uncommitted work is nothing new", on(["agent", "--plan"]).includes("Nothing for an agent to do."));
  assert("`ledger sweep` with nothing to read prints no prompt",
    !on(["sweep"]).includes("COPY EVERYTHING") && on(["sweep", "--print"]).includes("Nothing to sweep"));
  fs.writeFileSync(path.join(ag, "test/app.test.js"), "changed\n");
  assert("…and a change to tests alone starts no agent", on(["agent", "--plan"]).includes("Nothing for an agent to do."));
  assert("…though `ledger sweep`, asked for, still shows it", on(["sweep"]).includes("test/app.test.js"));
  commit("More of it");

  // Prepare: the whole release the first time, then only what moved.
  on(["change", "one", "--what", "It does the one thing twice.", "--why-unknown"]);
  assert("recorded changes nobody prepared are a prepare", on(["agent", "--plan"]).includes("prepare: write the client's text for v2"));
  writeComposition(2, { changes: { one: ["It does the one thing twice."] }, summary: { one: "One does its thing twice." } }, { cwd: ag });
  assert("prepare complete records the code as read", state().sweep?.commit === agit("rev-parse", "HEAD").stdout.trim());
  assert("…and the reasons still open", readJson(path.join(ag, ".ledger/compositions.json")).compositions
    .find((x) => x.version === 2).prepared.unvouched?.join() === "one#0");
  assert("prepared, nothing is due", on(["agent", "--plan"]).includes("Nothing for an agent to do."));
  on(["change", "two", "--what", "It does the two thing faster.", "--why", "It was slow."]);
  assert("a change since is a prepare of what moved", on(["agent", "--plan"]).includes("prepare: only what moved since the last prepare"));
  const delta = on(["prepare"]);
  assert("…whose brief gives the moved entries in full and the rest one line each",
    delta.includes("Only what moved since the last prepare: two") && delta.includes("one  —  One  (prepared, unchanged)") &&
    /now: +Does the two thing\./.test(delta));
  assert("…and --full prepares the whole release", !on(["prepare", "--full"]).includes("(prepared, unchanged)"));
  writeComposition(2, { changes: { one: ["It does the one thing twice."], two: ["It does the two thing faster, because it was slow."] },
    summary: { one: "One does its thing twice.", two: "Two does its thing faster." } }, { cwd: ag });
  // A reason given after the note was written makes that note out of date.
  const onePath = path.join(ag, ".ledger/features/one.json");
  const one = readJson(onePath);
  one.events[0].why = "Customers asked for it.";
  one.events[0].why_from = "person";
  fs.writeFileSync(onePath, JSON.stringify(one, null, 2));
  const answered = on(["agent", "--plan"]);
  assert("a reason given since the last prepare sends that entry back to it",
    answered.includes("prepare: only what moved") && answered.includes("a reason given for one"));
  assert("…and bare `ledger` says so", on([]).includes("a reason given for one since the last prepare"));

  // With an agent configured, `ledger agent` hands the task to it, and checks it.
  const fake = path.join(ag, "fake-agent.cjs");
  fs.writeFileSync(fake, `const { spawnSync } = require("node:child_process");
process.stdin.resume(); process.stdin.on("end", () => {
  spawnSync(process.execPath, [${JSON.stringify(BIN)}, "prepare", "complete"], { stdio: "inherit" });
});`);
  const handed = on(["agent", "--run", `node ${JSON.stringify(fake)}`]);
  assert("`ledger agent --run` hands the due task over and checks what it left", /✓ prepared \(/.test(handed));
  fs.rmSync(fake);
  const viaConfig = on(["agent"], { env: { ...process.env, LEDGER_AGENT: `node -e "process.exit(0)"` } });
  assert("…and with nothing due, an agent configured or not, nothing starts",
    viaConfig.includes("Nothing for an agent to do.") && !viaConfig.includes("Handing"));
  fs.rmSync(ag, { recursive: true, force: true });
}

// ---- The redraft: a corpus written again, a record that carries on ----
const rd = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-redraft-"));
const rgit = (...args) => spawnSync("git", ["-C", rd, ...args], { encoding: "utf8" });
const rcommit = (msg) => { rgit("add", "-A"); rgit("commit", "-qm", msg); };
rgit("init", "-q", ".");
rgit("config", "user.email", "smoke@example.com");
rgit("config", "user.name", "Smoke");
run(["init", "--product", "Redrafted", "--agents", "none", "--commit-pdfs"], { cwd: rd });
run(["add", "kept"], { cwd: rd, stdin: feature({ audience: "user", size: "Big", name: "Kept", description: "Does the kept thing." }) });
run(["add", "lost"], { cwd: rd, stdin: feature({ audience: "user", size: "Small", name: "Quiet export", description: "Exports the ledger to spreadsheets." }) });
// A redraft keeps what a client holds, so with nothing handed over there is nothing to keep.
run(["redraft", "start"], { cwd: rd, expect: "fail" });
run(["cut", "--name", "Baseline", "--date", "2026-03-01", "--no-pdf", "--yes"], { cwd: rd });
assert("…and it refuses while the corpus it would set aside isn't committed",
  run(["redraft", "start"], { cwd: rd, expect: "fail" }).includes("uncommitted"));
rcommit("Baseline");
run(["redraft", "start"], { cwd: rd });
const rjson = (f) => readJson(path.join(rd, ".ledger", f));
assert("the old corpus is set aside, whole, in the archive",
  fs.existsSync(path.join(rd, ".ledger/archive/v1/features/lost.json")));
assert("the numbering carries on: v1 stays in the timeline, archived, and v2 opens",
  rjson("releases.json").map((r) => `${r.version}:${r.status}`).join() === "1:archived,2:future");
assert("the live corpus starts empty, areas and all",
  fs.readdirSync(path.join(rd, ".ledger/features")).length === 0 && rjson("config.json").categories.length === 0);
// The archive is what the old editions print from, so nothing writes to it.
run(["add", "sneaky", "--dir", ".ledger/archive/v1"], { cwd: rd, expect: "fail",
  stdin: feature({ audience: "user", size: "Small", name: "Sneaky", description: "Does the sneaky thing." }) });
assert("the archive reads through --dir", run(["list", "--dir", ".ledger/archive/v1"], { cwd: rd }).includes("Quiet export"));
run(["redraft", "start"], { cwd: rd, expect: "fail" });
const survey = run(["bootstrap"], { cwd: rd });
assert("a survey inside a redraft stops before the cut", survey.includes("stop before the cut") && !survey.includes("ledger cut --name"));
assert("…and knows where the archive is", survey.includes(".ledger/archive/v1"));
assert("an unfinished redraft makes `ledger build` say what's left",
  run(["build", "--md"], { cwd: rd }).includes("Unfinished redraft"));
run(["redraft", "check"], { cwd: rd, expect: "fail" });   // nothing to compare yet
assert("bare `ledger redraft` says what comes next", run(["redraft"], { cwd: rd }).includes("ledger bootstrap"));
run(["add", "kept"], { cwd: rd, stdin: feature({ audience: "user", size: "Big", name: "Kept, reworded", description: "Does the kept thing, better said." }) });
run(["add", "fresh"], { cwd: rd, stdin: feature({ audience: "user", size: "Medium", name: "Fresh", description: "Does a thing the old ledger never listed." }) });
// Nothing in the new corpus can be recorded against a version it doesn't own.
const stray = path.join(rd, ".ledger/features/stray.json");
fs.writeFileSync(stray, JSON.stringify({ id: "stray", audience: "user", category: "Features", size: "Small",
  history: [{ version: 1, name: "Stray", description: "x" }] }));
assert("an entry recorded against an archived version is refused",
  run(["status"], { cwd: rd, expect: "fail" }).includes("belongs to the archived ledger"));
fs.unlinkSync(stray);
const check = run(["redraft", "check"], { cwd: rd });
assert("`ledger redraft check --prompt-only` prints just the prompt",
  !run(["redraft", "check", "--prompt-only"], { cwd: rd }).includes(RULE));
assert("the check pairs old entries with new ones, and flags what has none",
  check.includes(RULE) && /kept\s+→ kept/.test(check) && /lost\s+→ \(none found\)/.test(check));
assert("the cut refuses until the redraft is checked, --yes or not",
  run(["cut", "--name", "Reorganized", "--no-pdf", "--yes"], { cwd: rd, expect: "fail" }).includes("ledger redraft check"));
run(["redraft", "complete", "--note", "Exports are part of Kept."], { cwd: rd });
assert("…which is recorded in redrafts.json", rjson("redrafts.json").redrafts[0].reconciled !== null);
assert("…and bare `ledger redraft` says it's complete", run(["redraft"], { cwd: rd }).includes("is complete"));
assert("…and the warning goes quiet", !run(["build", "--md"], { cwd: rd }).includes("Unfinished redraft"));
run(["build", "--pdf", "--html", "--version", "2"], { cwd: rd });
const reorganized = fs.readFileSync(path.join(rd, "docs/generated/Redrafted-Feature-Ledger_2-draft.html"), "utf8");
assert("the first edition after a redraft says it is reorganized, with the note",
  reorganized.includes("This edition is reorganized") && reorganized.includes("Exports are part of Kept."));
assert("…and marks nothing as new", !reorganized.includes('class="status is-new"'));
run(["build", "--pdf", "--html", "--version", "1"], { cwd: rd });
assert("an archived edition still prints, from its archive",
  fs.readFileSync(path.join(rd, "docs/client/Redrafted-Feature-Ledger_1.html"), "utf8").includes("Quiet export"));
run(["releases", "amend", "1", "--commit", rgit("rev-parse", "HEAD").stdout.trim()], { cwd: rd, expect: "fail" });
run(["cut", "--name", "Reorganized", "--date", "2026-04-01", "--no-pdf", "--yes"], { cwd: rd });
assert("the timeline lists the archived release where it came from",
  run(["releases"], { cwd: rd }).includes("archived in .ledger/archive/v1/"));
run(["add", "later"], { cwd: rd, stdin: feature({ audience: "user", size: "Small", name: "Later", description: "Does a later thing." }) });
writeComposition(3, { summary: { later: "Customers can do a later thing." } }, { cwd: rd });
run(["build", "--pdf", "--html", "--version", "3"], { cwd: rd });
const after = fs.readFileSync(path.join(rd, "docs/generated/Redrafted-Feature-Ledger_3-draft.html"), "utf8");
assert("from the next edition, changes are marked again",
  after.includes('class="status is-new"') && !after.includes("This edition is reorganized"));
fs.rmSync(rd, { recursive: true, force: true });

// ---- Migrating a ledger written by an earlier version ----
const put = (root, f, data) => {
  fs.mkdirSync(path.dirname(path.join(root, ".ledger", f)), { recursive: true });
  fs.writeFileSync(path.join(root, ".ledger", f), JSON.stringify(data, null, 2));
};

// The first shape kept the client's "What changed" bullets on each feature,
// written as the change landed. Migrating keeps every edition already handed
// over exactly as it printed, and turns the open release's bullets into events.
const old = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-migrate-v1-"));
put(old, "config.json", { product: "Old", categories: ["Features"], style: "google" });
put(old, "releases.json", [
  { version: 1, name: "One", date: "2026-01-01", status: "released" },
  { version: 2, name: "Two", date: "2026-02-01", status: "released" },
  { version: 3, name: null, date: null, status: "future" },
]);
put(old, "features/a.json", { id: "a", audience: "user", category: "Features", size: "Big", history: [
  { version: 1, name: "A", description: "Does a.", changes: null, dev_notes: "Lives in src/a.js." },
  { version: 2, description: "Does a, twice.", changes: ["It did a once. Twice was asked for."], dev_notes: "Lives in src/a.js." },
  { version: 3, description: "Does a, three times.", changes: ["It did a twice. Taken from the commit."], reason_inferred: true },
] });
put(old, "features/b.json", { id: "b", audience: "user", category: "Features", size: "Small", history: [
  { version: 3, name: "B", description: "Does b.", changes: ["Was a draft nobody printed."] },
] });
put(old, "summaries.json", { summaries: [{ version: 3, new: [{ text: "B is new.", covers: ["b"] }], quiet: ["a"], date: "2026-02-10", entries: { a: "x" } }] });
put(old, "reviews.json", { reviews: [] });
assert("a ledger in the first shape is refused, pointing at `ledger migrate`",
  run(["status"], { cwd: old, expect: "fail" }).includes("Run `ledger migrate`"));
const migrated = run(["migrate"], { cwd: old });
assert("`ledger migrate` says what it moved", migrated.includes("from schema 1") &&
  migrated.includes("1 \"What changed\" note from released editions kept as printed") &&
  migrated.includes("1 change on the open release (v3) recorded as events") && migrated.includes("1 reason read off a commit message"));
assert("…and lists, word for word, a note the old tool took and never printed", migrated.includes("b (v3): Was a draft nobody printed."));
const ojson = (root, f) => readJson(path.join(root, ".ledger", f));
assert("an edition already handed over keeps its notes, verbatim",
  ojson(old, "compositions.json").compositions.find((c) => c.version === 2).changes.a[0] === "It did a once. Twice was asked for.");
assert("the open release's notes become events, and stay the note until a prepare",
  ojson(old, "features/a.json").events[0].combined === true && ojson(old, "features/a.json").events[0].why_from === "commit" &&
  ojson(old, "compositions.json").compositions.find((c) => c.version === 3).changes.a.length === 1);
assert("dev notes are kept once, and no paths appear",
  ojson(old, "features/a.json").dev_notes === "Lives in src/a.js." && !("paths" in ojson(old, "features/a.json")) &&
  !("dev_notes" in ojson(old, "features/a.json").history[0]));
assert("an inferred reason is listed as one nobody vouched for", run([], { cwd: old }).includes("[reason from a commit message]"));
assert("the old summary and review files go", !fs.existsSync(path.join(old, ".ledger/summaries.json")) && !fs.existsSync(path.join(old, ".ledger/reviews.json")));
assert("a summary that wasn't current is kept, and the release isn't marked prepared", run([], { cwd: old }).includes("hasn't run for v3"));
run(["build", "--pdf", "--html", "--version", "2"], { cwd: old });
assert("…and the old edition still prints its note", fs.readFileSync(path.join(old, "docs/generated/client/Old-Feature-Ledger_2.html"), "utf8")
  .includes("It did a once. Twice was asked for."));
assert("migrating twice does nothing", run(["migrate"], { cwd: old }).includes("nothing to migrate"));
// A branch recorded with the old CLI and merged after the migration brings a
// file in the old shape. It is refused, and `migrate` converts that file alone.
put(old, "features/late.json", { id: "late", audience: "user", category: "Features", size: "Small", history: [
  { version: 3, name: "Late", description: "Does the late thing.", changes: null, dev_notes: "From a branch." },
] });
assert("a feature file in an old shape, merged after the migration, is refused",
  run(["status"], { cwd: old, expect: "fail" }).includes("run `ledger migrate`"));
assert("…and `ledger migrate` converts it on its own", run(["migrate"], { cwd: old }).includes("1 feature file in an older shape") &&
  ojson(old, "features/late.json").dev_notes === "From a branch.");
fs.rmSync(old, { recursive: true, force: true });

// The second shape mapped code to entries, kept questions and audits, and
// stamped compositions. Migrating drops all of that without losing a word.
const mid = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-migrate-v2-"));
const archived = { product: "Mid", categories: ["Features"], style: "google", schema: 2, ignore: ["test/**"], checks: { verify: true } };
put(mid, "config.json", archived);
put(mid, "releases.json", [
  { version: 1, name: "One", date: "2026-01-01", status: "archived", archive: "archive/v1" },
  { version: 2, name: "Two", date: "2026-02-01", status: "released" },
  { version: 3, name: null, date: null, status: "future" },
]);
put(mid, "redrafts.json", { redrafts: [{ opens: 2, archive: "archive/v1", versions: [1], started: { date: "2026-01-15", commit: null },
  reconciled: { date: "2026-01-20" }, note: null }] });
put(mid, "archive/v1/config.json", archived);
put(mid, "archive/v1/archived.json", { versions: [1], archived: "2026-01-15", commit: null, superseded_at: 2 });
put(mid, "archive/v1/releases.json", [{ version: 1, name: "One", date: "2026-01-01", status: "released" }, { version: 2, name: null, date: null, status: "future" }]);
put(mid, "archive/v1/features/x.json", { id: "x", audience: "user", category: "Features", size: "Small", paths: ["src/x/**"],
  history: [{ version: 1, name: "X", description: "Does x." }] });
put(mid, "features/m.json", { id: "m", audience: "user", category: "Features", size: "Big", paths: ["src/m/**"], history: [
  { version: 2, name: "M", description: "Does m." }, { version: 3, description: "Does m, more." }],
events: [{ version: 3, kind: "change", what: "It does more.", why: null, why_from: "unknown", date: "2026-02-05" }] });
put(mid, "compositions.json", { compositions: [
  { version: 3, changes: { m: ["It did m. It does more now."] }, new: [], changed: [{ text: "M does more.", covers: ["m"] }], quiet: [],
    date: "2026-02-06", commit: null, inputs: { m: "0000000000000000" }, verified: { date: "2026-02-06", fingerprint: "x" } },
] });
put(mid, "questions.json", { questions: [
  { id: 1, kind: "why", feature: "m", version: 3, event: 0, what: "It does more.", text: "Why did M change?", status: "open" },
  { id: 2, kind: "finding", feature: "m", version: 3, text: "The note says more; the code caps it at three.", status: "open" },
] });
put(mid, "audits.json", { audits: [{ commit: null, date: "2026-02-01", mode: "full" }] });
assert("a ledger in the second shape is refused too", run(["status"], { cwd: mid, expect: "fail" }).includes("Run `ledger migrate`"));
const midOut = run(["migrate"], { cwd: mid });
assert("migrating it takes the paths off every entry, archives included",
  midOut.includes("from schema 2") && !("paths" in ojson(mid, "features/m.json")) && !("paths" in ojson(mid, "archive/v1/features/x.json")));
assert("…drops the questions, audits and stamps nothing reads",
  !fs.existsSync(path.join(mid, ".ledger/questions.json")) && !fs.existsSync(path.join(mid, ".ledger/audits.json")) &&
  !("inputs" in ojson(mid, "compositions.json").compositions[0]) && !("verified" in ojson(mid, "compositions.json").compositions[0]) &&
  !("ignore" in ojson(mid, "config.json")) && ojson(mid, "config.json").schema === 3);
assert("…lists a finding nobody settled, word for word", midOut.includes("m: The note says more; the code caps it at three."));
assert("…keeps a reason nobody gave on its event, where `ledger` lists it",
  run([], { cwd: mid }).includes("m: It does more.  — why: not recorded"));
assert("…and keeps the written note, with the release not marked prepared since it was out of date",
  ojson(mid, "compositions.json").compositions[0].changes.m[0] === "It did m. It does more now." && run([], { cwd: mid }).includes("hasn't run for v3"));
run(["build", "v1", "--html"], { cwd: mid });
assert("an archived edition still prints from its migrated archive",
  fs.readFileSync(path.join(mid, "docs/generated/client/Mid-Feature-Ledger_1.html"), "utf8").includes("Does x."));
fs.rmSync(mid, { recursive: true, force: true });

log("");
if (failures) {
  log(`${failures} failure${failures === 1 ? "" : "s"} — workspace kept at ${dir}`);
  process.exit(1);
}
fs.rmSync(dir, { recursive: true, force: true });
log("all good");
