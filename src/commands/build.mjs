import fs from "node:fs";
import path from "node:path";
import { openProject } from "../store.mjs";
import { fail, titleSlug } from "../util.mjs";
import { MarkdownRenderer } from "../render/markdown.mjs";
import { renderLedgerHtml } from "../render/ledger-html.mjs";
import { htmlToPdf } from "../render/pdf.mjs";

const out = (s) => process.stdout.write(`${s}\n`);
const warn = (s) => process.stdout.write(`  ! ${s}\n`);

/**
 * The three living Markdown docs and the archival PDF edition.
 *
 * Nothing here judges the shape of the corpus. Loading it has already refused
 * anything that would make a document wrong — an entry with no description, a
 * version that isn't a release, a feature filed under an area that doesn't
 * exist. Everything past that is an editorial call, and a tool that blocked a
 * build over one would only be teaching people to write around it.
 */
export async function cmdBuild({ flags }) {
  const project = openProject(flags);

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
      const { html, warnings, fontsEmbedded } = renderLedgerHtml({ project, version });
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
      await htmlToPdf(html, target, { checkFonts: fontsEmbedded });
      out(`wrote ${path.relative(process.cwd(), target)}`);
    }
  }
}
