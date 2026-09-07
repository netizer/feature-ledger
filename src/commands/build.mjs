import fs from "node:fs";
import path from "node:path";
import { openProject } from "../store.mjs";
import { fail, titleSlug, exists } from "../util.mjs";
import { MarkdownRenderer } from "../render/markdown.mjs";
import { renderLedgerHtml } from "../render/ledger-html.mjs";
import { htmlToPdf, probeBrowser } from "../render/pdf.mjs";
import { resolveBrand, accentCollides } from "../render/brand.mjs";
import { fontFaceCss } from "../render/fonts.mjs";

const out = (s) => process.stdout.write(`${s}\n`);
const warn = (s) => process.stdout.write(`  ! ${s}\n`);

/**
 * Loading the project runs every structural validation there is, so `check`
 * is mostly about the things that are worth a warning rather than a failure:
 * a corpus can be perfectly valid and still be about to print badly.
 */
export async function cmdCheck({ flags }) {
  const project = openProject(flags); // throws on anything structurally wrong
  const warnings = [];

  // Shape rules are checked here rather than at load time, so a sub-section
  // can be declared and then filled — but they're errors, not warnings: a
  // corpus that breaks them prints badly.
  const problems = project.featureSet.shapeProblems();
  if (problems.length) {
    fail(problems.join("\n"));
  }

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

  const unsized = project.featureSet.features().filter((f) => !f.size);
  if (unsized.length) warnings.push(`${unsized.length} feature(s) have no size and will print without a chip: ${unsized.map((f) => f.id).join(", ")}`);

  const empty = project.config.categories.filter(
    (c) => !project.featureSet.features().some((f) => f.category === c),
  );
  if (empty.length) warnings.push(`${empty.length} categor${empty.length === 1 ? "y has" : "ies have"} no features and won't render: ${empty.join(", ")}`);

  const indexed = new Set(project.index);
  const unindexed = project.featureSet.features().filter((f) => !indexed.has(f.id));
  if (unindexed.length) {
    warnings.push(
      `${unindexed.length} feature file(s) aren't in index.json, so they sort last within their size: ` +
      `${unindexed.map((f) => f.id).join(", ")}. Any \`ledger\` write heals this.`,
    );
  }

  const n = project.featureSet.features().length;
  out(`OK — ${n} feature${n === 1 ? "" : "s"}, ${project.featureSet.categories().length} categories, ` +
      `${project.releases.releases.length} releases, working version v${project.releases.latestVersion}, ` +
      `\`build\` prints v${project.editionVersion}`);
  for (const w of warnings) warn(w);
}

export async function cmdBuild({ flags }) {
  const project = openProject(flags);
  const problems = project.featureSet.shapeProblems();
  if (problems.length) fail(`${problems.join("\n")}\n(run \`ledger check\` for the full picture)`);

  const wantMd = flags.md || !flags.pdf;
  const wantPdf = flags.pdf || !flags.md;

  const outDir = path.resolve(project.root, flags.out ?? project.config.output.dir);
  const clientDir = flags.out
    ? outDir
    : path.resolve(project.root, project.config.output.client_dir);

  if (wantMd) {
    const docs = new MarkdownRenderer(project).all();
    fs.mkdirSync(outDir, { recursive: true });
    for (const [key, content] of Object.entries(docs)) {
      const name = project.config.output[key];
      if (!name) continue;
      fs.writeFileSync(path.join(outDir, name), content);
      out(`wrote ${path.relative(process.cwd(), path.join(outDir, name))}`);
    }
  }

  if (wantPdf) {
    const arg = flags.version;
    const asked = arg !== undefined && arg !== true;
    // Editions, not releases: a release opened by `release cut` and not yet
    // written to isn't one, so the default straight after a cut is the
    // edition that was just shipped rather than an empty reprint of it.
    // Asking for it by number still prints it — that's the in-progress proof.
    const versions = String(arg ?? "").toLowerCase() === "all"
      ? project.editionVersions
      : [asked ? Number(arg) : project.editionVersion];

    if (!asked && project.editionVersion !== project.releases.latestVersion) {
      const working = project.releases.latestVersion;
      out(`v${working} is open with nothing recorded against it yet — printing the v${project.editionVersion} edition. ` +
          `(\`ledger build --version ${working}\` prints it anyway, as a draft.)`);
    }

    for (const version of versions) {
      if (!project.releases.versions.includes(version)) fail(`no release v${version}`);
      const { html, warnings } = renderLedgerHtml({ project, version });
      for (const w of warnings) warn(w);

      const file = project.config.output.pdf_name
        .replace("{slug}", titleSlug(project.brand.name ?? project.config.product))
        .replace("{version}", String(version));
      const target = path.join(clientDir, file);
      if (flags.html) {
        // Handy when tuning the theme: the same document, openable in a
        // browser with devtools, without waiting on a print.
        const htmlTarget = target.replace(/\.pdf$/, ".html");
        fs.mkdirSync(path.dirname(htmlTarget), { recursive: true });
        fs.writeFileSync(htmlTarget, html);
        out(`wrote ${path.relative(process.cwd(), htmlTarget)}`);
        continue;
      }
      await htmlToPdf(html, target);
      out(`wrote ${path.relative(process.cwd(), target)}`);
    }
  }
}

export async function cmdDoctor({ flags }) {
  const project = openProject(flags);
  const brand = resolveBrand(project.brand);

  out(`project      ${project.root}`);
  out(`ledger dir   ${path.relative(project.root, project.ledgerDir)}/`);
  out(`product      ${project.config.product}`);
  out(`features     ${project.featureSet.features().length} (${project.featureSet.features({ audience: "user" }).length} user, ${project.featureSet.features({ audience: "dev" }).length} dev)`);
  out(`releases     ${project.releases.releases.length}, working version v${project.releases.latestVersion}, build prints v${project.editionVersion}`);
  out(`accent       ${brand.accent} → deep ${brand.accent_deep} · quiet ${brand.accent_quiet} · mid ${brand.accent_mid} · pale ${brand.accent_pale}`);
  out(`masthead     ${brand.logo ?? `wordmark “${brand.name}”`}`);
  out(`fonts        ${brand.fonts.display} / ${brand.fonts.body} — ${fontFaceCss(brand).embedded ? "embedded" : "NOT bundled, will fall back"}`);
  out(`theme.css    ${exists(project.themeCssPath) ? "present" : "none"}`);

  try {
    out(`browser      ${await probeBrowser()}`);
  } catch (e) {
    out(`browser      unavailable — ${e.message.split("\n")[0]}`);
  }
}
