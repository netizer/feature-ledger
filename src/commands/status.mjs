import path from "node:path";
import { openProject, pdfsAreCommitted } from "../store.mjs";
import { exists } from "../util.mjs";
import { resolveBrand, accentCollides } from "../render/brand.mjs";
import { fontFaceCss } from "../render/fonts.mjs";
import { probeBrowser } from "../render/pdf.mjs";
import { resolveStyle, styleTitle } from "../style.mjs";
import { unauditedReport, unauditedSince } from "./audit.mjs";
import { composeReport, composeLine, textProblems } from "../compose.mjs";
import { openQuestions } from "../questions.mjs";
import { coverage } from "./paths.mjs";
import { shortSha } from "../git.mjs";
import { redraftReport, redraftSteps, rangeLabel } from "./redraft.mjs";
import { cutChecks, renderChecks } from "./release.mjs";
import { findLedgerDir } from "../store.mjs";
import { UserError } from "../util.mjs";
import { color } from "../ui.mjs";

const out = (s) => process.stdout.write(`${s}\n`);

/** About how many words a description has before it stops being two or three sentences. */
const DESCRIPTION_WORDS = { Big: 120, Medium: 90, Small: 60 };
const field = (k, v) => out(`  ${k.padEnd(11)} ${v}`);

/**
 * One command for "is this ledger in good shape, and what is it about to
 * print?".
 *
 * It used to be three — `status` for the open release, `check` for the
 * corpus, `doctor` for the setup — and in practice nobody ran all three, so
 * the one thing they hadn't run was where the problem was. They are one
 * question asked from three angles, and the answers are cheap, so this asks
 * all three every time.
 *
 * A corpus that would make a document wrong — an entry with no description, a
 * version that isn't a release, an area that doesn't exist — fails on load,
 * before any of this runs, and takes the exit code to 1 with it. That's what
 * makes `ledger status --quiet` usable in a commit hook. Everything reported
 * here is a warning, because everything left is a judgement call.
 */
export async function cmdStatus({ flags }) {
  const project = openProject(flags); // throws on anything structurally wrong
  const quiet = Boolean(flags.quiet);

  const warnings = collectWarnings(project);
  const release = releaseReport(project);
  const corpus = corpusReport(project);
  const audit = auditReport(project);
  const compose = composeReport(project);
  const redraft = redraftReport(project);
  const questions = openQuestions(project);
  const cov = coverage(project);
  const checks = project.releases.current.future ? cutChecks(project) : [];

  if (flags.json) {
    const setup = setupReport(project);
    setup.browser = await browserLine();
    const ready = checks.map(({ id, ok, line, fix }) => ({ id, ok, line, fix }));
    const owned = cov ? { product_files: cov.product.length, unowned: cov.unowned.length, ignored: cov.ignored } : null;
    out(JSON.stringify({ ...release, corpus, audit, compose, questions, ownership: owned, redraft, checks: ready, setup, warnings }, null, 2));
    return;
  }

  // --quiet is the hook and CI shape: say nothing when there's nothing to
  // say, and don't pay for a browser launch to find that out.
  if (quiet) {
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
    out(`  composed    ${composedLine(compose)}`);
  }

  if (checks.length) {
    out("");
    out(`Ready to cut?  ${checks.every((ch) => ch.ok) ? "yes — `ledger cut --name \"…\"`" : "not yet"}`);
    out(renderChecks(checks));
  }

  out("");
  out("Corpus");
  field("features", `${corpus.features} (${corpus.user} client-facing, ${corpus.dev} team-only)`);
  field("areas", corpus.areas === 0
    ? "none yet — the first feature opens one"
    : `${corpus.areas}${corpus.largest ? `, largest is “${corpus.largest.category}” with ${corpus.largest.count}` : ""}`);
  field("releases", `${corpus.releases} (\`ledger releases\` lists them)`);
  field("audited", audit.line);
  if (cov) {
    field("owned", `${cov.product.length - cov.unowned.length} of ${cov.product.length} product files belong to an entry` +
      (cov.unowned.length ? ` — \`ledger paths\` lists the ${cov.unowned.length} that don't` : ""));
  }
  if (questions.length) field("questions", `${questions.length} open — \`ledger questions\``);
  if (audit.full_line) field("full sweep", audit.full_line);
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

function composedLine(report) {
  if (report.ok) return report.reason ? `not needed — ${report.reason}` : `${report.composition.date}, nothing moved since`;
  if (report.missing) return "not yet — `ledger compose` prints the brief";
  if (report.incomplete) return "a draft, never marked complete — `ledger compose` finishes it";
  return `${report.composition.date ?? "never stamped"}, then ${report.stale.length} entr${report.stale.length === 1 ? "y" : "ies"} moved`;
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

/**
 * When the codebase was last checked against the record, and how much has
 * landed since.
 *
 * The last FULL sweep is reported separately because only a full one can find a
 * capability the baseline survey missed — an incremental range moves past it
 * permanently — so "we audit every sprint" and "we have never swept the whole
 * thing" are different facts, and a single date would hide the second.
 */
function auditReport(project) {
  const last = project.lastAudit;
  const full = project.lastFullAudit;
  const unaudited = unauditedReport(project);
  let line;
  if (!last) line = "never — `ledger audit` prints the brief";
  else {
    const at = last.commit ? ` at ${shortSha(last.commit)}` : "";
    line = `${last.date}${at} (${last.mode})`;
    line += unaudited.ok ? ", nothing unaudited since" : `, then ${unauditedSince(unaudited)}`;
  }

  // Only worth its own line when it says something the line above didn't: the
  // last audit already names its own mode.
  let fullLine = null;
  if (last && !full) fullLine = "never — only a full sweep corrects a baseline the survey got wrong";
  else if (full && full !== last) fullLine = `${full.date}${full.commit ? ` at ${shortSha(full.commit)}` : ""}`;

  return {
    last,
    last_full: full,
    unaudited,
    line,
    full_line: fullLine,
  };
}

function corpusReport(project) {
  const all = project.featureSet.features();
  const largest = project.featureSet.largestArea();
  return {
    features: all.length,
    user: all.filter((f) => f.audience === "user").length,
    dev: all.filter((f) => f.audience === "dev").length,
    areas: project.featureSet.categories().length,
    largest,
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

  // Nothing here counts entries per area, or per sub-section. How many capabilities an area holds
  // is a fact about the product: an editor with twenty distinct features has
  // an area with twenty entries in it, and an area opened today for work
  // starting tomorrow has one. Neither is a defect, and a warning that says
  // otherwise just teaches people to even out a shape that was already true.

  const redraft = redraftReport(project);
  if (!redraft.ok) {
    warnings.push(`unfinished redraft: ${redraft.line}. \`ledger cut\` refuses until it's finished:\n${redraftSteps(redraft)}`);
  }

  // Work landing since the last audit is not a warning: the audit is periodic,
  // so that is the normal state between sweeps. The "audited" line above says
  // how much has landed, and `ledger cut` is where it gates.

  const composed = composeReport(project);
  if (!composed.ok) {
    warnings.push(`${composeLine(composed)}. \`ledger compose\` prints the brief; \`ledger cut\` refuses until then.`);
  }
  // An edition's opening page prints these exactly as written, and nothing
  // about them puts the composition out of date, so they are only ever said here.
  if (composed.composition) {
    const faulty = textProblems(composed.composition);
    if (faulty.length) {
      warnings.push(
        `${faulty.length} item${faulty.length === 1 ? "" : "s"} in the summary of v${composed.version} won't read as a sentence ` +
        `of ${faulty.length === 1 ? "its" : "their"} own: ${faulty.map(([text, problems]) => `“${text.slice(0, 50)}${text.length > 50 ? "…" : ""}” ` +
        `(${problems.join(", ")})`).join("; ")}. Reword one that opens on a command or a file name, in .ledger/compositions.json.`,
      );
    }
  }

  // Two or three sentences is what a description has to work with; past this
  // it is usually describing how, or carrying detail that belongs in dev notes.
  const long = set.features({ audience: "user" }).map((f) => {
    const st = f.stateAt(project.releases.latestVersion);
    return st && !st.removed ? [f, st.description.split(/\s+/).length] : null;
  }).filter((x) => x && x[1] > (DESCRIPTION_WORDS[x[0].size] ?? DESCRIPTION_WORDS.Medium));
  if (long.length) {
    warnings.push(
      `${long.length} description${long.length === 1 ? " runs" : "s run"} long for ${long.length === 1 ? "its" : "their"} size ` +
      `(${long.map(([f, n]) => `${f.id} ${n} words`).join(", ")}). A description says what the product does in two or three ` +
      `sentences — about ${DESCRIPTION_WORDS.Big} words for a Big entry, ${DESCRIPTION_WORDS.Medium} for a Medium, ${DESCRIPTION_WORDS.Small} for a Small; ` +
      "the mechanics go in dev_notes. Shortening one is wording: edit it in .ledger/features/<id>.json.",
    );
  }

  const cov = coverage(project);
  for (const d of cov?.dead ?? []) {
    warnings.push(`${d.feature.id}'s paths ${d.globs.join(", ")} match no tracked file: its code moved or went. ` +
      `\`ledger own ${d.feature.id} '<glob>'\` points it at the code again, or \`ledger remove\` if the capability is gone.`);
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
 * Bare `ledger`, inside a project: where things stand and the one command to
 * run next, in a few lines. Outside one, the help.
 *
 * The next step is picked in the order the cut checks run, so following it
 * repeatedly walks a release from open to cut without having to know the
 * workflow — the same thing a person who does know it would do.
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
  out("");
  const checks = cutChecks(project);
  out("Ready to cut?");
  out(renderChecks(checks));
  out("");

  const open = checks.find((ch) => !ch.ok);
  let next;
  if (!open) next = 'ledger cut --name "…"      (prints the edition; `ledger preview` shows the draft first)';
  else if (open.id === "questions") next = "ledger questions    (or `ledger cut`, which asks them one at a time)";
  else if (open.id === "redraft") next = redraftReport(project).steps[0];
  else if (open.id === "content") next = "record work as it lands: `ledger add` / `ledger change` (an agent that read the stanza does this itself)";
  else next = open.fix;
  out(`Next: ${next}`);
  out(c.dim("`ledger status` has the full picture · `ledger help` lists every command"));
}
