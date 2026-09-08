#!/usr/bin/env node
/**
 * End-to-end smoke test: build a project from nothing, exercise both the
 * happy path and every guardrail that's meant to refuse, and print the two
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

function run(args, { stdin = "", expect = "ok", cwd = dir } = {}) {
  const r = spawnSync("node", [BIN, ...args], { cwd, input: stdin, encoding: "utf8" });
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

log(`workspace: ${dir}\n`);

run(["init", "--product", "Testbed", "--agents", "none"]);

// A ledger with no areas takes a feature without one: it opens the default
// area, and the generators print that without a heading.
run(["add", "solo"], {
  stdin: feature({ audience: "user", size: "Medium", name: "Solo", description: "Does the solo thing." }),
});
assert(
  "an unfiled feature opens the default area",
  JSON.parse(fs.readFileSync(path.join(dir, ".ledger/config.json"), "utf8")).categories.join() === "Features",
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
  stdin: feature({ audience: "user", category: "First area", size: "Big", name: "Alpha", description: "Does the alpha thing." }),
});
run(["add", "alpha"], { expect: "fail", stdin: feature({ audience: "user", category: "First area", size: "Big", name: "Dup", description: "x" }) });
run(["add", "beta"], { expect: "fail", stdin: feature({ audience: "user", category: "Nope", size: "Big", name: "Beta", description: "x" }) });
run(["add", "beta"], { expect: "fail", stdin: feature({ audience: "user", category: "First area", size: "Enormous", name: "Beta", description: "x" }) });
run(["add", "beta"], {
  stdin: feature({ audience: "user", category: "Second area", size: "Small", name: "Beta", description: "Does the beta thing." }),
});
run(["add", "gamma"], {
  stdin: feature({ audience: "dev", category: "Second area", size: "Medium", name: "Gamma", description: "An internal convenience." }),
});

run(["status"]);
run(["release", "cut", "--name", "Baseline", "--date", "2026-01-15"]);
// A release with nothing recorded against it would print an identical edition.
run(["release", "cut", "--name", "Too soon"], { expect: "fail" });

// …and for the same reason the edition to print straight after a cut is the
// one just shipped, not the empty release the cut opened.
const fresh = run(["build", "--pdf", "--html"]);
assert(
  "a fresh cut prints the edition just shipped, not the empty release it opened",
  fresh.includes("Testbed-Feature-Ledger_1.html") && !fresh.includes("_2.html"),
);
assert(
  "the empty in-progress release still prints on request",
  run(["build", "--pdf", "--html", "--version", "2"]).includes("Testbed-Feature-Ledger_2.html"),
);
fs.rmSync(path.join(dir, "docs/generated"), { recursive: true, force: true });

// A pre-existing feature can't quietly acquire a new description.
run(["update", "alpha", "--description", "Does the alpha thing, better."], { expect: "fail" });
run(["update", "alpha"], {
  stdin: feature({
    description: "Does the alpha thing, and the adjacent one.",
    changes: ["It used to stop at the alpha thing. The adjacent one was the question every user asked next, so leaving it out just moved the work elsewhere."],
  }),
});
// A second edit in the same cycle merges rather than appending a second entry.
run(["update", "alpha"], { stdin: feature({ add_changes: ["A second bullet, added later in the same cycle."] }) });

// A rename the client is told about is an ordinary change that happens to move
// the name: `update` still refuses it without a reason.
run(["update", "beta", "--name", "Beta prime", "--description", "Does the beta thing."], { expect: "fail" });
run(["update", "beta", "--name", "Beta prime", "--description", "Does the beta thing.",
  "--change", "Was “Beta”, which named the release it arrived in rather than what it does."]);
run(["remove", "gamma", "--reason", "Superseded by the build pipeline."]);
run(["other-change", "--audience", "user", "--description", "A global wording pass."]);

const alpha = JSON.parse(fs.readFileSync(path.join(dir, ".ledger/features/alpha.json"), "utf8"));
assert("one history entry per version", alpha.history.length === 2);
assert("add_changes appended rather than replaced", alpha.history[1].changes.length === 2);

// A sub-section is declared and then filled, and nothing counts what ends up
// in it. Leading one with a Big entry is worth a word, never a refusal.
run(["subcategory", "add"], {
  stdin: feature({ id: "cluster", category: "First area", name: "A cluster", intro: "Small things that belong together." }),
});
assert("an unfilled sub-section is not a failure", run(["status", "--quiet"]).trim() === "");
run(["update", "alpha", "--subcategory", "cluster"]);
assert(
  "a sub-section led by a Big entry is mentioned, not refused",
  run(["status", "--quiet"]).includes("leads with a Big entry"),
);
run(["update", "alpha", "--subcategory", ""]);
for (const id of ["c1", "c2", "c3", "c4"]) {
  run(["add", id], {
    stdin: feature({ audience: "user", category: "First area", subcategory: "cluster", size: "Small", name: `Cluster ${id}`, description: `The ${id} part of the cluster.` }),
  });
}
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
const releaseBefore = run(["status", "--json"]);
const c1Path = path.join(dir, ".ledger/features/c1.json");
const c1 = JSON.parse(fs.readFileSync(c1Path, "utf8"));
c1.history[0].name = "Cluster one";
c1.history[0].description = "The first part of the cluster, said the way the client says it.";
fs.writeFileSync(c1Path, `${JSON.stringify(c1, null, 2)}\n`);
assert("a hand-edited entry still validates", run(["status", "--quiet"]).trim() === "");
assert("the new wording is what `show` prints", run(["show", "c1"]).includes("said the way the client says it"));
assert(
  "rewording by hand records nothing against the release",
  JSON.stringify(JSON.parse(run(["status", "--json"])).release) ===
    JSON.stringify(JSON.parse(releaseBefore).release),
);

// …and a hand-edit that breaks the shape comes back as a message, not a build.
fs.writeFileSync(c1Path, JSON.stringify({ ...c1, history: [{ version: 1, name: "Cluster one" }] }, null, 2));
assert("a description deleted by hand is reported", run(["status"], { expect: "fail" }).includes("needs a description"));
c1.history[0].description = "The c1 part of the cluster.";
c1.history[0].name = "Cluster c1";
fs.writeFileSync(c1Path, `${JSON.stringify(c1, null, 2)}\n`);

const list = run(["list"]);
assert("list marks this release's work", list.includes("changed v2") && list.includes("new v2"));
const status = run(["status", "--json"]);
assert("status counts the removal", JSON.parse(status).removed.includes("gamma"));
assert("status reports the setup it used to need `doctor` for", JSON.parse(status).setup.fonts.includes("embedded"));

run(["build", "--md"]);
const md = fs.readFileSync(path.join(dir, "docs/generated/FEATURES.md"), "utf8");
assert("renamed feature footnotes its old name", md.includes("previously “Beta”"));
assert("global change appears once", md.split("Also since last time").length === 2);
assert("sub-section heading is numbered", md.includes("### 1.1 A cluster"));
assert("dev feature stays out of the client doc", !md.includes("An internal convenience"));
assert("areas are numbered once there are areas", md.includes("## 1. First area"));
const dev = fs.readFileSync(path.join(dir, "docs/generated/DEV_FEATURES.md"), "utf8");
assert("the removed dev feature is listed as gone, in the dev doc", dev.includes("No longer available") && dev.includes("Superseded by the build pipeline"));

const pdf = run(["build", "--pdf"], { expect: "ok" });
if (pdf.includes("wrote")) {
  const file = path.join(dir, "docs/generated/client/Testbed-Feature-Ledger_2.pdf");
  assert("the PDF edition is a real PDF", fs.existsSync(file) && fs.readFileSync(file).subarray(0, 4).toString() === "%PDF");
}

// ---- The third register ----
// Everything an audit finds still lands on the OPEN release — "new" in a client
// edition means new to the reader, and this is the first document to mention it
// — so nothing is ever written into a past release and an already-issued
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
run(["update", "beta", "--backfilled", "--reason-inferred"], {
  stdin: feature({
    description: "Does the beta thing, over a wider window.",
    changes: ["The window was narrower. Taken from the commit subject; why it widened is not recorded."],
  }),
});
run(["remove", "solo", "--backfilled", "--reason", "No longer part of the product."]);
// backfilled is written by an audit and only ever true; an explicit false is a
// third state every renderer would have to reason about.
fs.writeFileSync(
  path.join(dir, ".ledger/features/bad.json"),
  JSON.stringify({ id: "bad", audience: "user", category: "First area", size: "Small",
    history: [{ version: 1, name: "Bad", description: "x", changes: null, backfilled: false }] }),
);
run(["status", "--quiet"], { expect: "fail" });
fs.rmSync(path.join(dir, ".ledger/features/bad.json"));

run(["build", "--pdf", "--html", "--version", "1"]);
assert("a backfilled entry leaves an already-issued edition untouched", fs.readFileSync(v1Path, "utf8") === v1Before);

run(["build", "--pdf", "--html"]);
run(["build", "--md"]);
const v2 = fs.readFileSync(path.join(dir, "docs/generated/client/Testbed-Feature-Ledger_2.html"), "utf8");
assert("the third register draws in its own colour", v2.includes("tag-backfilled") && v2.includes("ALREADY IN PLACE"));
assert("…and never puts the internal key in front of a client", !v2.includes(">BACKFILLED<"));
assert("a removal found late is reported, apart from this cycle's news", v2.includes("No longer present"));
const md2 = fs.readFileSync(path.join(dir, "docs/generated/FEATURES.md"), "utf8");
assert("the living docs use the same words", md2.includes("Already in place]"));
assert(
  "an inferred reason is reported until somebody vouches for it",
  run(["status", "--quiet"]).includes("nobody has confirmed"),
);
run(["audit", "confirm", "beta"]);
assert("…and stops being reported once confirmed", !run(["status", "--quiet"]).includes("nobody has confirmed"));
fs.rmSync(path.join(dir, "docs/generated"), { recursive: true, force: true });

// The other output shape: a project that keeps its client editions. The
// Markdown docs stay build output either way; only the PDFs move, out of the
// one directory `init` gitignores.
const kept = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-kept-"));
run(["init", "--product", "Kept", "--agents", "none", "--commit-pdfs"], { cwd: kept });
const keptConfig = JSON.parse(fs.readFileSync(path.join(kept, ".ledger/config.json"), "utf8"));
assert("--commit-pdfs puts the editions outside the gitignored directory", keptConfig.output.client_dir === "docs/client");
assert(
  "…and the ignored directory still covers only the Markdown docs",
  fs.readFileSync(path.join(kept, ".gitignore"), "utf8").split("\n").filter(Boolean).join() === "docs/generated/",
);
run(["add", "kept-one"], {
  cwd: kept,
  stdin: feature({ audience: "user", size: "Medium", name: "Kept one", description: "Does the kept thing." }),
});
run(["build", "--pdf", "--html"], { cwd: kept });
assert(
  "…and `ledger build` prints the edition there",
  fs.existsSync(path.join(kept, "docs/client/Kept-Feature-Ledger_1.html")),
);
fs.rmSync(kept, { recursive: true, force: true });

// Every printed brief draws the boundary between "for you" and "paste this"
// the same way. Someone is going to select from that line to the end of the
// output, and three briefs marking it three ways teach them to look for three
// different things.
const RULE = "═════════════════════  COPY EVERYTHING BELOW THIS LINE  ═════════════════════";
for (const brief of [["bootstrap"], ["style", "rewrite"], ["audit"]]) {
  assert(`\`ledger ${brief.join(" ")}\` marks where the prompt starts, the same way`,
    run(brief, { cwd: dir }).includes(RULE));
}

// ---- The audit itself, which needs a real repository ----
// The range IS the signal: no per-feature map of source paths to keep true,
// just what has landed since the last time anyone looked.
const repo = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-audit-"));
const git = (...args) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
git("init", "-q", ".");
git("config", "user.email", "smoke@example.com");
git("config", "user.name", "Smoke");
fs.mkdirSync(path.join(repo, "src"), { recursive: true });
fs.writeFileSync(path.join(repo, "src/app.js"), "one\n");
git("add", "-A");
git("commit", "-qm", "Initial import");

run(["init", "--product", "Audited", "--agents", "none"], { cwd: repo });
run(["add", "one"], {
  cwd: repo,
  stdin: feature({ audience: "user", size: "Medium", name: "One", description: "Does the one thing." }),
});

// The baseline survey IS a full sweep of the codebase, so the prompt it prints
// ends by recording one — otherwise a freshly bootstrapped project reports as
// never audited and the cut gate stays silent until somebody runs it by hand.
const boot = run(["bootstrap"], { cwd: repo });
assert(
  "the baseline survey ends by recording itself as a full sweep",
  /ledger audit complete --full --commit [0-9a-f]{40}/.test(boot),
);
assert(
  "…and it is stamped before the cut, so it logs against the release the entries went into",
  boot.indexOf("audit complete") < boot.indexOf("release cut"),
);
assert("…and --no-audit leaves it out", !run(["bootstrap", "--no-audit"], { cwd: repo }).includes("audit complete"));

assert("with nothing to measure from, the brief sweeps everything", run(["audit"], { cwd: repo }).includes("full sweep"));
run(["audit", "complete", "--full"], { cwd: repo });
assert("the audit is logged with the mode it ran in", run(["audit", "log"], { cwd: repo }).includes("full"));
// The one field that makes a gap permanently invisible if it is set without the
// work being done, so a commit this history has never seen is refused.
run(["audit", "complete", "--commit", "0".repeat(40)], { cwd: repo, expect: "fail" });

run(["release", "cut", "--name", "Baseline", "--date", "2026-01-15"], { cwd: repo });
fs.writeFileSync(path.join(repo, "src/app.js"), "one\ntwo\n");
git("add", "-A");
git("commit", "-qm", "Add the two thing");

assert(
  "once source has landed unswept, the cut refuses and says how much",
  run(["release", "cut", "--name", "Next"], { cwd: repo, expect: "fail" }).includes("since the last audit"),
);
assert(
  "…and --force still gets through",
  run(["release", "cut", "--name", "Next", "--date", "2026-02-01", "--force"], { cwd: repo }).includes("cut v2"),
);
const incremental = run(["audit"], { cwd: repo });
assert("the brief then reads as a range, not a sweep", incremental.includes("incremental") && incremental.includes("Add the two thing"));
// A release is a moment, and a date is too coarse to name one: two demos in a
// day are ordinary. The commit says which state of the product an edition was
// printed from, so two same-day releases stay tellable apart.
const cutJson = () => JSON.parse(fs.readFileSync(path.join(repo, ".ledger/releases.json"), "utf8"));
assert("a cut records the commit it happened at", /^[0-9a-f]{40}$/.test(cutJson()[0].commit ?? ""));

fs.writeFileSync(path.join(repo, "src/app.js"), "one\ntwo\nthree\n");
git("add", "-A");
git("commit", "-qm", "Add the three thing");
run(["add", "two"], {
  cwd: repo,
  stdin: feature({ audience: "user", size: "Small", name: "Two", description: "Does the two thing." }),
});
run(["audit", "complete"], { cwd: repo });
// Same day as v2, but the code has moved — two real moments, two real editions.
run(["release", "cut", "--name", "Same day, later", "--date", "2026-02-01"], { cwd: repo });
const timeline = cutJson();
assert("two releases can share a date when the code moved between them",
  timeline[1].date === timeline[2].date && timeline[1].commit !== timeline[2].commit);
// Same day AND same commit is a re-issue of an edition already printed.
run(["add", "three"], {
  cwd: repo,
  stdin: feature({ audience: "user", size: "Small", name: "Three", description: "Does the third thing." }),
});
assert("…but not when the day and the code are both the same",
  run(["release", "cut", "--name", "Again", "--date", "2026-02-01"], { cwd: repo, expect: "fail" })
    .includes("nothing to tell the two editions apart"));
assert("…which --force still allows, as a deliberate re-issue",
  run(["release", "cut", "--name", "Again", "--date", "2026-02-01", "--force"], { cwd: repo }).includes("cut v4"));
assert("the timeline lists each release's commit", /[0-9a-f]{7}  Same day, later/.test(run(["release", "list"], { cwd: repo })));
// Every ledger that predates commits has a timeline of nulls, so they have to
// be fillable in after the fact — otherwise the field only ever works forward.
const head = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
run(["release", "amend", "1", "--commit", head], { cwd: repo });
assert("a release cut before commits were recorded can be filled in",
  cutJson()[0].commit === head);
// The in-progress release has no commit because it hasn't happened yet.
run(["release", "amend", "5", "--commit", head], { cwd: repo, expect: "fail" });
run(["release", "amend", "1", "--commit", "0".repeat(40)], { cwd: repo, expect: "fail" });

fs.rmSync(repo, { recursive: true, force: true });

log("");
if (failures) {
  log(`${failures} failure${failures === 1 ? "" : "s"} — workspace kept at ${dir}`);
  process.exit(1);
}
fs.rmSync(dir, { recursive: true, force: true });
log("all good");
