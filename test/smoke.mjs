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

function run(args, { stdin = "", expect = "ok" } = {}) {
  const r = spawnSync("node", [BIN, ...args], { cwd: dir, input: stdin, encoding: "utf8" });
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

run(["rename", "beta", "Beta prime"], { expect: "fail" });
run(["rename", "beta", "Beta prime", "--why", "Was “Beta”, which named the release it arrived in rather than what it does."]);
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

log("");
if (failures) {
  log(`${failures} failure${failures === 1 ? "" : "s"} — workspace kept at ${dir}`);
  process.exit(1);
}
fs.rmSync(dir, { recursive: true, force: true });
log("all good");
