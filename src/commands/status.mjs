import path from "node:path";
import { openProject, pdfsAreCommitted } from "../store.mjs";
import { exists } from "../util.mjs";
import { resolveBrand, accentCollides } from "../render/brand.mjs";
import { fontFaceCss } from "../render/fonts.mjs";
import { probeBrowser } from "../render/pdf.mjs";
import { resolveStyle, styleTitle } from "../style.mjs";
import { unauditedReport, unauditedLine, unconfirmedReasons } from "./audit.mjs";
import { shortSha } from "../git.mjs";

const out = (s) => process.stdout.write(`${s}\n`);
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

  if (flags.json) {
    const setup = setupReport(project);
    setup.browser = await browserLine();
    out(JSON.stringify({ ...release, corpus, audit, setup, warnings }, null, 2));
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
  }

  out("");
  out("Corpus");
  field("features", `${corpus.features} (${corpus.user} client-facing, ${corpus.dev} team-only)`);
  field("areas", corpus.areas === 0
    ? "none yet — the first feature opens one"
    : `${corpus.areas}${corpus.largest ? `, largest is “${corpus.largest.category}” with ${corpus.largest.count}` : ""}`);
  field("releases", `${corpus.releases}, \`ledger build\` prints the v${corpus.prints} edition`);
  field("audited", audit.line);
  if (audit.full_line) field("full sweep", audit.full_line);

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
  const pending = unconfirmedReasons(project);

  let line;
  if (!last) line = "never — `ledger audit` prints the brief";
  else {
    const at = last.commit ? ` at ${shortSha(last.commit)}` : "";
    line = `${last.date}${at} (${last.mode})`;
    line += unaudited.ok ? ", nothing unaudited since" : `, then ${unauditedLine(unaudited)}`;
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
    unconfirmed_reasons: pending,
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

  const unaudited = unauditedReport(project);
  if (!unaudited.ok) {
    warnings.push(
      `${unauditedLine(unaudited)}. Until they are swept, an edition cut now may be missing capabilities the ` +
      "client already has. `ledger audit` prints the brief; `ledger release cut --force` overrides.",
    );
  }

  const pending = unconfirmedReasons(project);
  if (pending.length) {
    warnings.push(
      `${pending.length} change reason${pending.length === 1 ? "" : "s"} came from an audit reading a commit ` +
      `message rather than from whoever decided it, and nobody has confirmed ${pending.length === 1 ? "it" : "them"} ` +
      `yet: ${pending.map((x) => `${x.id} v${x.version}`).join(", ")}. ` +
      "`ledger audit confirm <id>` vouches for one as it stands. To rewrite the bullet instead, edit it in " +
      ".ledger/features/<id>.json and delete the \"reason_inferred\" line on that entry — writing the sentence " +
      "yourself is the stronger form of vouching for it.",
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
