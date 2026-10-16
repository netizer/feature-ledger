import path from "node:path";
import { openProject, findLedgerDir, pdfsAreCommitted } from "../store.mjs";
import { exists, UserError } from "../util.mjs";
import { resolveBrand, accentCollides } from "../render/brand.mjs";
import { fontFaceCss } from "../render/fonts.mjs";
import { probeBrowser } from "../render/pdf.mjs";
import { resolveStyle, styleTitle } from "../style.mjs";
import {
  prepareReport, prepareLine, textProblems, longNotes, longItems, unknownReasons, sentences, summaryItems,
  NOTE_SENTENCES, ITEM_WORDS, OVERVIEW_SENTENCES,
} from "../compose.mjs";
import { eventLine } from "../diff.mjs";
import { redraftReport, redraftSteps, rangeLabel } from "./redraft.mjs";
import { cutReport, renderReport, nextStep } from "./release.mjs";
import { color } from "../ui.mjs";

const out = (s) => process.stdout.write(`${s}\n`);

/** About how many words a description has before it stops reading at a glance. */
const DESCRIPTION_WORDS = { Big: 55, Medium: 45, Small: 35 };
const DESCRIPTION_SENTENCES = 2;

/**
 * Words a client shouldn't have to read: code in backticks, a file name with
 * its extension, a path into the source, a command-line flag. They belong in
 * dev_notes. How to see it is left alone: an instruction may need a label.
 */
const CODE_TERMS = [
  [/`[^`]+`/, "code in backticks"],
  [/\b[\w.-]+\.(?:m?js|ts|tsx|jsx|json|rb|py|go|rs|java|php|css|scss|html|ya?ml|sql|sh|md|toml)\b/i, "a file name"],
  [/(?:^|[\s(])(?:\.?\/)?(?:src|lib|app|config|bin|docs|\.ledger)\/[\w./-]+/, "a path"],
  [/(?:^|\s)--[a-z][\w-]*/, "a command-line flag"],
];
const codeTerm = (text) => CODE_TERMS.find(([re]) => re.test(String(text)))?.[1] ?? null;
const field = (k, v) => out(`  ${k.padEnd(11)} ${v}`);

/**
 * One command for "is this ledger in good shape, and what is it about to
 * print?": the open release, what stands before its cut, the corpus and the
 * setup.
 *
 * A corpus that would make a document wrong — an entry with no description, a
 * version that isn't a release, an area that doesn't exist — fails on load,
 * before any of this runs, and takes the exit code to 1 with it. That's what
 * makes `ledger status --quiet` usable in a commit hook. Everything reported
 * here is a warning, because everything left is a judgement call.
 */
export async function cmdStatus({ flags }) {
  const project = openProject(flags); // throws on anything structurally wrong
  const warnings = collectWarnings(project);
  const release = releaseReport(project);
  const corpus = corpusReport(project);
  const open = project.releases.current.future;
  const cut = open ? cutReport(project) : null;
  const prepared = open ? prepareReport(project) : null;

  if (flags.json) {
    const setup = setupReport(project);
    setup.browser = await browserLine();
    out(JSON.stringify({
      ...release,
      prepared: prepared && { ok: prepared.ok, recorded: prepared.recorded, since: prepared.since, line: prepareLine(prepared) },
      cut: cut && { refusals: cut.refusals, warnings: cut.warnings, next: nextStep(project, cut) },
      corpus, setup, warnings,
    }, null, 2));
    return;
  }

  // --quiet is the hook and CI shape: say nothing when there's nothing to
  // say, and don't pay for a browser launch to find that out.
  if (flags.quiet) {
    for (const w of warnings) out(`! ${w}`);
    return;
  }

  const rel = project.releases.current;
  out(`${project.config.product} — release v${rel.version}, ${rel.future ? "in progress" : `shipped ${rel.date}`}${rel.name ? ` (${rel.name})` : ""}`);

  out("");
  out("This release");
  if (release.nothing) {
    out("  nothing recorded against it yet");
  } else {
    listing(project, "added", release.added);
    listing(project, "changed", release.changed);
    listing(project, "removed", release.removed);
    if (release.other_changes) {
      out(`  other (${release.other_changes}) — change${release.other_changes === 1 ? "" : "s"} belonging to no single feature`);
    }
    if (prepared) out(`  prepared    ${prepareLine(prepared)}`);
  }

  if (cut) {
    out("");
    out(readiness(cut));
    if (cut.refusals.length || cut.warnings.length) out(renderReport(cut));
  }

  out("");
  out("Corpus");
  field("features", `${corpus.features} (${corpus.user} client-facing, ${corpus.dev} team-only)`);
  field("areas", corpus.areas === 0
    ? "none yet — the first feature opens one"
    : `${corpus.areas}${corpus.largest ? `, largest is “${corpus.largest.category}” with ${corpus.largest.count}` : ""}`);
  field("releases", `${corpus.releases} (\`ledger releases\` lists them)`);
  const lastRedraft = project.redrafts[project.redrafts.length - 1];
  if (lastRedraft) {
    field("redrafted", `${lastRedraft.started.date}, ${rangeLabel(lastRedraft.versions)} archived in .ledger/${lastRedraft.archive}/` +
      (lastRedraft.reconciled ? `, checked against it ${lastRedraft.reconciled.date}` : " — not yet checked against it"));
  }

  out("");
  out("Setup");
  const setup = setupReport(project);
  field("project", setup.project);
  field("ledger", setup.ledger_dir);
  field("style", setup.style);
  field("output", setup.output);
  field("accent", setup.accent);
  field("masthead", setup.masthead);
  field("fonts", setup.fonts);
  field("theme.css", setup.theme_css);
  field("browser", await browserLine());

  out("");
  for (const w of warnings) out(`! ${w}`);
  if (!warnings.length) out("Nothing to fix.");
}

/** The heading over a cut report. */
function readiness(report) {
  if (report.refusals.length) return "Ready to cut?  no — the edition would be wrong:";
  if (report.warnings.length) return `Ready to cut?  yes, with ${report.warnings.length} warning${report.warnings.length === 1 ? "" : "s"} it will show you first:`;
  return "Ready to cut?  yes — `ledger cut --name \"…\"`";
}

function listing(project, label, ids) {
  if (!ids.length) return;
  out(`  ${label} (${ids.length})`);
  for (const id of ids) out(`    ${id.padEnd(32)} ${project.featureSet.find(id).currentName}`);
}

/** What the open release has collected so far — the thing to look at before
 *  cutting it, and the cheap way for an agent to see whether the work it just
 *  did is already recorded. */
function releaseReport(project) {
  const target = project.releases.latestVersion;
  const rel = project.releases.at(target);

  const touched = project.featureSet.features().filter((f) => f.touchedAt(target));
  const added = touched.filter((f) => f.firstVersion === target);
  const removed = touched.filter((f) => f.entryAt(target)?.removed);
  const changed = touched.filter((f) => !added.includes(f) && !removed.includes(f));
  const other = project.featureSet.otherChanges({ version: target });

  return {
    version: target,
    status: rel.status,
    name: rel.name,
    commit: rel.commit ?? null,
    added: added.map((f) => f.id),
    changed: changed.map((f) => f.id),
    removed: removed.map((f) => f.id),
    other_changes: other.length,
    nothing: !touched.length && !other.length,
  };
}

function corpusReport(project) {
  const all = project.featureSet.features();
  return {
    features: all.length,
    user: all.filter((f) => f.audience === "user").length,
    dev: all.filter((f) => f.audience === "dev").length,
    areas: project.featureSet.categories().length,
    largest: project.featureSet.largestArea(),
    releases: project.releases.releases.length,
    prints: project.editionVersion,
  };
}

function setupReport(project) {
  const brand = resolveBrand(project.brand);
  let style;
  try {
    const s = resolveStyle(project.config, project.ledgerDir);
    style = `${styleTitle(s)}${s.url ? `  ${s.url}` : ""}`;
  } catch (e) {
    style = `misconfigured — ${e.message}`;
  }
  return {
    project: project.root,
    ledger_dir: `${path.relative(project.root, project.ledgerDir)}/`,
    output: `${project.config.output.dir}/ (docs) · ${project.config.output.client_dir}/ ` +
      `(client editions, ${pdfsAreCommitted(project.config) ? "kept in the repo" : "build output"})`,
    style,
    accent: `${brand.accent} → deep ${brand.accent_deep} · quiet ${brand.accent_quiet} · mid ${brand.accent_mid} · pale ${brand.accent_pale}`,
    masthead: brand.logo ?? `wordmark “${brand.name}”`,
    fonts: `${brand.fonts.display} / ${brand.fonts.body} — ${fontFaceCss(brand).embedded ? "embedded" : "NOT bundled, will fall back"}`,
    theme_css: exists(project.themeCssPath) ? "present" : "none",
  };
}

async function browserLine() {
  try {
    return await probeBrowser();
  } catch (e) {
    return `unavailable — ${e.message.split("\n")[0]}`;
  }
}

/**
 * Everything that is valid and would still print badly. None of these fail
 * the command: each one is a judgement call, and a corpus mid-survey trips
 * several of them on the way to being finished.
 */
function collectWarnings(project) {
  const warnings = [];
  const set = project.featureSet;
  const brand = resolveBrand(project.brand);

  if (accentCollides(brand.accent)) {
    warnings.push(
      `the brand accent ${brand.accent} sits in the green/blue band. Those two hues mean "new" and "updated" ` +
      "in every edition — an accent in that range makes an unchanged row look like a changed one. Pick a warm hue.",
    );
  }
  if (!fontFaceCss(brand).embedded) {
    warnings.push(
      `brand.json asks for fonts this package doesn't bundle (${brand.fonts.display} / ${brand.fonts.body}); ` +
      "the PDF will print in whatever the machine has and may not copy cleanly.",
    );
  }
  if (brand.logo && !exists(path.resolve(project.root, brand.logo))) {
    warnings.push(`brand.json points at a logo that isn't there: ${brand.logo}`);
  }

  const unsized = set.features().filter((f) => !f.size);
  if (unsized.length) {
    warnings.push(`${unsized.length} feature(s) have no size and will print without a chip: ${unsized.map((f) => f.id).join(", ")}`);
  }

  const empty = project.config.categories.filter((c) => !set.features().some((f) => f.category === c));
  if (empty.length) {
    warnings.push(`${empty.length} area${empty.length === 1 ? "" : "s"} with no features, which won't render: ${empty.join(", ")}`);
  }

  for (const { sub, big } of set.subsectionsLedByBig()) {
    warnings.push(
      `the sub-section “${sub.name}” leads with a Big entry (${big.map((f) => f.id).join(", ")}). Its heading and ` +
      "intro are already the overview of that part of the product, so the two say the same thing twice.",
    );
  }

  const redraft = redraftReport(project);
  if (!redraft.ok) {
    warnings.push(`unfinished redraft: ${redraft.line}. \`ledger cut\` refuses until it's finished:\n${redraftSteps(redraft)}`);
  }

  // An edition's opening page prints these exactly as written, so they are
  // said here, where whoever edited them by hand will look.
  const open = project.releases.current.future ? project.releases.current.version : null;
  const composition = open ? project.compositionOf(open) : null;
  if (composition) {
    const faulty = textProblems(composition);
    if (faulty.length) {
      warnings.push(
        `${faulty.length} item${faulty.length === 1 ? "" : "s"} in the summary of v${open} won't read as a sentence ` +
        `of ${faulty.length === 1 ? "its" : "their"} own: ${faulty.map(([text, problems]) => `“${text.slice(0, 50)}${text.length > 50 ? "…" : ""}” ` +
        `(${problems.join(", ")})`).join("; ")}. Reword one that opens on a command or a file name, in .ledger/compositions.json.`,
      );
    }
    const long = longNotes(composition);
    if (long.length) {
      warnings.push(
        `${long.length} "What changed" note${long.length === 1 ? " runs" : "s run"} past ${NOTE_SENTENCES} sentence ` +
        `(${[...new Set(long.map(([id]) => id))].join(", ")}). A note says what one change was and why it moved, in one ` +
        "sentence; shorten it in .ledger/compositions.json.",
      );
    }
    const wordy = longItems(composition);
    if (wordy.length) {
      warnings.push(
        `${wordy.length} summary sentence${wordy.length === 1 ? " runs" : "s run"} past ${ITEM_WORDS} words ` +
        `(${wordy.map(([text, n]) => `“${text.slice(0, 40)}${text.length > 40 ? "…" : ""}” ${n}`).join("; ")}). ` +
        "A summary sentence is read at a glance on the first page; shorten it in .ledger/compositions.json.",
      );
    }
    if (composition.overview && sentences(composition.overview) > OVERVIEW_SENTENCES) {
      warnings.push(`the overview of v${open} runs past ${OVERVIEW_SENTENCES} sentences. It opens the edition: say what the ` +
        "release is about, and leave the rest to the list under it.");
    }
  }

  // One or two sentences is what a description has to work with; past this
  // it is usually describing how, or carrying detail that belongs in dev notes.
  const now = set.features({ audience: "user" })
    .map((f) => [f, f.stateAt(project.releases.latestVersion)])
    .filter(([, st]) => st && !st.removed);
  const long = now
    .map(([f, st]) => [f, st.description.split(/\s+/).length, sentences(st.description)])
    .filter(([f, n, s]) => n > (DESCRIPTION_WORDS[f.size] ?? DESCRIPTION_WORDS.Medium) || s > DESCRIPTION_SENTENCES);
  if (long.length) {
    warnings.push(
      `${long.length} description${long.length === 1 ? " runs" : "s run"} long for ${long.length === 1 ? "its" : "their"} size ` +
      `(${long.map(([f, n, s]) => `${f.id} ${n} words${s > DESCRIPTION_SENTENCES ? `, ${s} sentences` : ""}`).join("; ")}). ` +
      `A description says what the product does for the people who use it, in one or two sentences — about ` +
      `${DESCRIPTION_WORDS.Big} words for a Big entry, ${DESCRIPTION_WORDS.Medium} for a Medium, ${DESCRIPTION_WORDS.Small} for a Small; ` +
      "the mechanics go in dev_notes. Shortening one is wording: edit it in .ledger/features/<id>.json.",
    );
  }

  // The client reads these. A file name or a flag in them is detail written
  // for the team, and belongs in dev_notes.
  const technical = [
    ...now.map(([f, st]) => [f.id, st.description]),
    ...(composition ? [
      ...Object.entries(composition.changes ?? {}).flatMap(([id, list]) => (Array.isArray(list) ? list : []).map((n) => [id, n])),
      ...summaryItems(composition).map((i) => ["the summary", i.text]),
      ["the overview", composition.overview ?? ""],
    ] : []),
  ].map(([where, text]) => [where, codeTerm(text)]).filter(([, term]) => term);
  if (technical.length) {
    warnings.push(
      `${technical.length} piece${technical.length === 1 ? "" : "s"} of client text read${technical.length === 1 ? "s" : ""} like code ` +
      `(${technical.slice(0, 8).map(([where, term]) => `${where}: ${term}`).join("; ")}${technical.length > 8 ? "; …" : ""}). ` +
      "Write for someone who uses the product and has never seen the code: say what it does for them, and put file names, " +
      "paths and flags in dev_notes.",
    );
  }

  const indexed = new Set(project.index);
  const unindexed = set.features().filter((f) => !indexed.has(f.id));
  if (unindexed.length) {
    warnings.push(
      `${unindexed.length} feature file(s) aren't in index.json, so they sort last within their size: ` +
      `${unindexed.map((f) => f.id).join(", ")}. Any \`ledger\` write heals this.`,
    );
  }

  return warnings;
}

/**
 * Bare `ledger`, inside a project: where things stand, the reasons nobody
 * has vouched for, and the one command to run next, in a few lines. Outside
 * one, the help.
 *
 * The next step is `prepare` while changes are recorded that it hasn't read,
 * and `cut` otherwise, so following it walks a release from open to cut
 * without having to know the workflow.
 */
export async function cmdOverview({ flags, help }) {
  let project;
  try {
    findLedgerDir(process.cwd(), flags.dir ?? null);
    project = openProject(flags);
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    process.stdout.write(help);
    if (!/no \.ledger\/ found/.test(e.message)) process.stderr.write(`\nerror: ${e.message}\n`);
    return;
  }
  const c = color();
  const rel = project.releases.current;
  const release = releaseReport(project);
  const counts = [["added", release.added.length], ["changed", release.changed.length],
    ["removed", release.removed.length], ["product-wide notes", release.other_changes]]
    .filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(", ");

  if (!rel.future) {
    out(`${project.config.product} · v${rel.version} is cut (${rel.date}), and nothing is open.`);
    return;
  }
  out(`${c.bold(project.config.product)} · v${rel.version} open — ${counts || "nothing recorded yet"}`);
  if (!release.nothing) out(`  ${prepareLine(prepareReport(project))}`);
  const unknown = unknownReasons(project, rel.version);
  if (unknown.length) {
    out("");
    out("Reasons nobody has vouched for (`ledger prepare` asks you about them):");
    for (const { feature, event } of unknown.slice(0, 8)) out(`  ${feature.id}: ${eventLine(event)}`);
    if (unknown.length > 8) out(`  … and ${unknown.length - 8} more`);
  }
  const report = cutReport(project);
  out("");
  out(readiness(report));
  if (report.refusals.length || report.warnings.length) out(renderReport(report));
  out("");
  // Agent work that is due comes first: the edition is written from it.
  const { agentPlan } = await import("./agent.mjs");
  const due = agentPlan(project).queue[0];
  out(`Next: ${due && due.task !== "prepare" ? `ledger agent          (${due.task}; spends tokens)` : nextStep(project, report)}`);
  out(c.dim("`ledger preview` shows the edition as it would print, for free · `ledger status` has the full picture"));
}
