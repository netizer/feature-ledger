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
// `status --quiet` is silent on a sound corpus — apart from asking for a
// review, which any release with work in it does until one is recorded.
const quietWarnings = (o) => o.split("\n").filter((l) => l.trim() && !/(been|was) reviewed/.test(l)).join("\n");

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
// A second edit in the same cycle merges rather than appending a second entry,
// and says what the client will compare it with: the last edition, not the
// state the first edit left it in.
assert(
  "a second change in one cycle is reminded what the client's \"before\" is",
  run(["update", "alpha"], { stdin: feature({ add_changes: ["A second bullet, added later in the same cycle."] }) })
    .includes("compares this release with v1"),
);

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
assert("an unfilled sub-section is not a failure", quietWarnings(run(["status", "--quiet"])) === "");
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
assert("a hand-edited entry still validates", quietWarnings(run(["status", "--quiet"])) === "");
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

// A feature the client has never seen has no "before": however often it moved
// while it was being built, the new state goes in the description.
run(["update", "c2"], { expect: "fail", stdin: feature({ description: "The c2 part, reworked.", changes: ["It was different a day ago."] }) });
run(["update", "c2"], { stdin: feature({ description: "The c2 part of the cluster, reworked." }) });

// ---- The review ----
// Nobody has read v2 as one release yet, so the corpus says so, and the brief
// names what arrived — the things no bullet may describe a "before" for.
assert("an unreviewed release is reported", run(["status", "--quiet"]).includes("v2 has not been reviewed"));
const reviewBrief = run(["review"]);
assert("the review brief names what arrived this cycle", reviewBrief.includes("What arrived in v2") && reviewBrief.includes("Cluster c1"));
assert("…and reads against the edition the client has", reviewBrief.includes("The client compares v2 with v1"));
// A new entry carrying a change note is refused outright: it has no "before".
const c3Path = path.join(dir, ".ledger/features/c3.json");
const c3 = JSON.parse(fs.readFileSync(c3Path, "utf8"));
fs.writeFileSync(c3Path, JSON.stringify({ ...c3, history: [{ ...c3.history[0], changes: ["Was a draft."] }] }, null, 2));
assert("a stray change note on a new entry is flagged", run(["status", "--quiet"]).includes("c3 is new in v2 but carries"));
assert("…and the review can't be recorded over it", run(["review", "complete"], { expect: "fail" }).includes("c3 is new in v2"));
fs.writeFileSync(c3Path, `${JSON.stringify(c3, null, 2)}\n`);
run(["review", "complete"]);
assert("a recorded review quiets the warning", !run(["status", "--quiet"]).includes("reviewed"));
// A later edit to what the client reads asks for another look, by name.
const a = JSON.parse(fs.readFileSync(path.join(dir, ".ledger/features/alpha.json"), "utf8"));
a.history[1].changes = [a.history[1].changes[0]];
fs.writeFileSync(path.join(dir, ".ledger/features/alpha.json"), `${JSON.stringify(a, null, 2)}\n`);
assert("an entry edited after the review is named", /changed since v2 was reviewed.*alpha/.test(run(["status", "--quiet"])));
assert("…and the brief marks it", /\* updated\s+alpha/.test(run(["review"])));
run(["review", "complete"]);

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
const relabelled = path.join(dir, "docs/generated/client/Testbed-Feature-Ledger_5.html");
assert("a later edition follows on from the printed number", fs.existsSync(relabelled) &&
  fs.readFileSync(relabelled, "utf8").includes("Version 5") && !fs.readFileSync(relabelled, "utf8").includes("Version 2"));
assert("…and `release list` shows it beside the real one", run(["release", "list"]).includes("printed as 5"));

// A redraft done by hand is marked on its release: it reissues the number
// before it, says it is reorganized, and marks nothing new or updated.
const mark = (edit) => {
  const rs = JSON.parse(timelineBefore);
  edit(rs);
  fs.writeFileSync(releasesPath, JSON.stringify(rs, null, 2));
};
// On the first edition it stands for reports sent before the ledger existed.
mark((rs) => { rs[0].redraft = true; });
run(["build", "--pdf", "--html", "--version", "1"]);
const firstRedraft = path.join(dir, "docs/generated/client/Testbed-Feature-Ledger_1_redraft.html");
const firstHtml = fs.existsSync(firstRedraft) ? fs.readFileSync(firstRedraft, "utf8") : "";
assert("a first edition can be a redraft of reports sent another way",
  firstHtml.includes("Version 1 (redraft)") && firstHtml.includes("Earlier reports described"));
{
  const lines = run(["release", "list"]).split("\n");
  assert("…and the edition after it takes the next number",
    lines.find((l) => l.startsWith("v 1"))?.includes("printed as 1 (redraft)") &&
    !lines.find((l) => l.startsWith("v 2"))?.includes("printed as"));
}
mark((rs) => { rs[0].redraft = true; rs[0].display_version = 4; });
run(["build", "--pdf", "--html", "--version", "1"]);
assert("…printed under the number the client already counts by",
  fs.existsSync(path.join(dir, "docs/generated/client/Testbed-Feature-Ledger_4_redraft.html")));
assert("…with the release after it following on", run(["release", "list"]).includes("printed as 5"));
mark((rs) => { rs[1].redraft = "yes"; });
run(["status", "--quiet"], { expect: "fail" });
mark((rs) => { rs[0].display_version = 3; rs[1].redraft = true; });
run(["build", "--pdf", "--html", "--version", "2"]);
const redrafted = path.join(dir, "docs/generated/client/Testbed-Feature-Ledger_3_redraft.html");
const redraftHtml = fs.existsSync(redrafted) ? fs.readFileSync(redrafted, "utf8") : "";
assert("a redraft marked by hand reissues the number before it, in the file name too",
  redraftHtml.includes("Version 3 (redraft)"));
assert("…opens with the reorganized note", redraftHtml.includes("This edition is reorganized") && redraftHtml.includes("Edition 3 arranged"));
assert("…and marks nothing as new or updated", !/tag-(new|updated)"/.test(redraftHtml));
mark((rs) => {
  rs[0].display_version = 3;
  Object.assign(rs[1], { redraft: true, status: "released", name: "Rewrite", date: "2026-02-01" });
  rs.push({ version: 3, name: null, date: null, status: "future", commit: null });
});
const listed = run(["release", "list"]);
assert("the release after a redraft takes the next number", listed.includes("printed as 3 (redraft)") && listed.includes("printed as 4"));
fs.writeFileSync(releasesPath, timelineBefore);
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
for (const brief of [["bootstrap"], ["style", "rewrite"], ["audit"], ["review"]]) {
  assert(`\`ledger ${brief.join(" ")}\` marks where the prompt starts, the same way`,
    run(brief, { cwd: dir }).includes(RULE));
}

// …and every one of them can print the prompt alone, ready to pipe into a
// clipboard: nothing above the rule, and not the rule itself.
for (const brief of [["bootstrap"], ["style", "rewrite"], ["audit"], ["review"]]) {
  const only = run([...brief, "--prompt-only"], { cwd: dir });
  assert(`\`ledger ${brief.join(" ")} --prompt-only\` prints just the prompt`,
    !only.includes(RULE) && !only.includes("Copy it whole") && only.trim().length > 200);
}
run(["status", "--prompt-only"], { cwd: dir, expect: "fail" });

// An option the command doesn't take is refused before anything runs, so a
// typo can't turn into a release cut without the guard it was meant to set.
const beforeTypo = fs.readFileSync(path.join(dir, ".ledger/releases.json"), "utf8");
assert("a mistyped option is refused, with the one it was probably meant to be",
  run(["release", "cut", "--name", "Typo", "--dryrun"], { cwd: dir, expect: "fail" }).includes("did you mean --dry-run?"));
assert("…and nothing was cut", fs.readFileSync(path.join(dir, ".ledger/releases.json"), "utf8") === beforeTypo);
run(["list", "--catgory", "x"], { cwd: dir, expect: "fail" });
run(["release", "list", "--force"], { cwd: dir, expect: "fail" });
run(["list", "--json", "--dir", ".ledger"], { cwd: dir });

// --help after any command is help, and never does the thing.
const releasesBefore = fs.readFileSync(path.join(dir, ".ledger/releases.json"), "utf8");
assert("`ledger release cut --help` prints help",
  run(["release", "cut", "--name", "Oops", "--help"], { cwd: dir }).includes("ledger release cut --name"));
assert("…and cuts nothing", fs.readFileSync(path.join(dir, ".ledger/releases.json"), "utf8") === releasesBefore);
assert("`ledger add --help` prints help without reading a payload",
  run(["add", "never", "--help"], { cwd: dir }).includes("ledger add <id>")
  && !fs.existsSync(path.join(dir, ".ledger/features/never.json")));
assert("-h works the same", run(["redraft", "-h"], { cwd: dir }).includes("ledger redraft check"));

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
// Set by hand, and every later rewrite of the timeline has to keep it.
{
  const p = path.join(repo, ".ledger/releases.json");
  const rs = JSON.parse(fs.readFileSync(p, "utf8"));
  rs[0].display_version = 4;
  fs.writeFileSync(p, JSON.stringify(rs, null, 2));
}
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
assert("…and keeps a printed number set by hand", cutJson()[0].display_version === 4);

fs.writeFileSync(path.join(repo, "src/app.js"), "one\ntwo\nthree\n");
git("add", "-A");
git("commit", "-qm", "Add the three thing");
run(["add", "two"], {
  cwd: repo,
  stdin: feature({ audience: "user", size: "Small", name: "Two", description: "Does the two thing." }),
});
run(["audit", "complete"], { cwd: repo });
// Audited, but not yet read as one release against the edition before it.
assert(
  "an unreviewed release can't be cut",
  run(["release", "cut", "--name", "Same day, later", "--date", "2026-02-01"], { cwd: repo, expect: "fail" })
    .includes("v3 has not been reviewed"),
);
run(["review", "complete"], { cwd: repo });
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

// ---- The redraft: a corpus written again, a record that carries on ----
const rd = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-redraft-"));
const rgit = (...args) => spawnSync("git", ["-C", rd, ...args], { encoding: "utf8" });
const commitAll = (msg) => { rgit("add", "-A"); rgit("commit", "-qm", msg); };
rgit("init", "-q", ".");
rgit("config", "user.email", "smoke@example.com");
rgit("config", "user.name", "Smoke");
run(["init", "--product", "Redrafted", "--agents", "none", "--commit-pdfs"], { cwd: rd });
run(["add", "kept"], { cwd: rd, stdin: feature({ audience: "user", size: "Big", name: "Kept", description: "Does the kept thing." }) });
run(["add", "lost"], { cwd: rd, stdin: feature({ audience: "user", size: "Small", name: "Quiet export", description: "Exports the ledger to spreadsheets." }) });
// A redraft keeps what a client holds, so with nothing handed over there is nothing to keep.
run(["redraft", "start"], { cwd: rd, expect: "fail" });
run(["release", "cut", "--name", "Baseline", "--date", "2026-03-01"], { cwd: rd });
assert("…and it refuses while the corpus it would set aside isn't committed",
  run(["redraft", "start"], { cwd: rd, expect: "fail" }).includes("uncommitted"));
commitAll("Baseline");
run(["redraft", "start"], { cwd: rd });
const rjson = (f) => JSON.parse(fs.readFileSync(path.join(rd, ".ledger", f), "utf8"));
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
assert("a survey inside a redraft stops before the cut", survey.includes("stop before the cut") && !survey.includes("release cut --name"));
assert("…and knows where the archive is", survey.includes(".ledger/archive/v1"));
assert("an unfinished redraft makes `ledger build` say what's left",
  run(["build", "--md"], { cwd: rd }).includes("Unfinished redraft") );
run(["redraft", "check"], { cwd: rd, expect: "fail" });   // nothing to compare yet
assert("bare `ledger redraft` says what comes next", run(["redraft"], { cwd: rd }).includes("ledger bootstrap"));
run(["add", "kept"], { cwd: rd, stdin: feature({ audience: "user", size: "Big", name: "Kept, reworded", description: "Does the kept thing, better said." }) });
run(["add", "fresh"], { cwd: rd, stdin: feature({ audience: "user", size: "Medium", name: "Fresh", description: "Does a thing the old ledger never listed." }) });
// Nothing in the new corpus can be recorded against a version it doesn't own.
const stray = path.join(rd, ".ledger/features/stray.json");
fs.writeFileSync(stray, JSON.stringify({ id: "stray", audience: "user", category: "Features", size: "Small",
  history: [{ version: 1, name: "Stray", description: "x", changes: null }] }));
assert("an entry recorded against an archived version is refused",
  run(["status"], { cwd: rd, expect: "fail" }).includes("belongs to the archived ledger"));
fs.unlinkSync(stray);
const check = run(["redraft", "check"], { cwd: rd });
assert("`ledger redraft check --prompt-only` prints just the prompt",
  !run(["redraft", "check", "--prompt-only"], { cwd: rd }).includes(RULE));
assert("the check pairs old entries with new ones, and flags what has none",
  check.includes(RULE) && /kept\s+→ kept/.test(check) && /lost\s+→ \(none found\)/.test(check));
assert("the cut refuses until the redraft is checked",
  run(["release", "cut", "--name", "Reorganized"], { cwd: rd, expect: "fail" }).includes("ledger redraft check"));
run(["redraft", "complete", "--note", "Exports are part of Kept."], { cwd: rd });
assert("…which is recorded in redrafts.json", rjson("redrafts.json").redrafts[0].reconciled !== null);
assert("…and bare `ledger redraft` says it's complete", run(["redraft"], { cwd: rd }).includes("is complete"));
assert("…and the warning goes quiet", !run(["build", "--md"], { cwd: rd }).includes("Unfinished redraft"));
run(["build", "--pdf", "--html", "--version", "2"], { cwd: rd });
const reorganized = fs.readFileSync(path.join(rd, "docs/client/Redrafted-Feature-Ledger_2.html"), "utf8");
assert("the first edition after a redraft says it is reorganized, with the note",
  reorganized.includes("This edition is reorganized") && reorganized.includes("Exports are part of Kept."));
assert("…and marks nothing as new", !reorganized.includes("class=\"tag tag-new\""));
run(["build", "--pdf", "--html", "--version", "1"], { cwd: rd });
assert("an archived edition still prints, from its archive",
  fs.readFileSync(path.join(rd, "docs/client/Redrafted-Feature-Ledger_1.html"), "utf8").includes("Quiet export"));
run(["release", "amend", "1", "--commit", rgit("rev-parse", "HEAD").stdout.trim()], { cwd: rd, expect: "fail" });
run(["release", "cut", "--name", "Reorganized", "--date", "2026-04-01"], { cwd: rd });
assert("the timeline lists the archived release where it came from",
  run(["release", "list"], { cwd: rd }).includes("archived in .ledger/archive/v1/"));
run(["add", "later"], { cwd: rd, stdin: feature({ audience: "user", size: "Small", name: "Later", description: "Does a later thing." }) });
run(["review", "complete"], { cwd: rd });
run(["build", "--pdf", "--html", "--version", "3"], { cwd: rd });
const after = fs.readFileSync(path.join(rd, "docs/client/Redrafted-Feature-Ledger_3.html"), "utf8");
assert("from the next edition, changes are marked again",
  after.includes("class=\"tag tag-new\"") && !after.includes("This edition is reorganized"));
fs.rmSync(rd, { recursive: true, force: true });

log("");
if (failures) {
  log(`${failures} failure${failures === 1 ? "" : "s"} — workspace kept at ${dir}`);
  process.exit(1);
}
fs.rmSync(dir, { recursive: true, force: true });
log("all good");
