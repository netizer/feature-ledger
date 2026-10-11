import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { openProject } from "../store.mjs";
import { fail, usage, titleSlug } from "../util.mjs";
import { color, mark } from "../ui.mjs";
import { MarkdownRenderer } from "../render/markdown.mjs";
import { renderLedgerHtml } from "../render/ledger-html.mjs";
import { htmlToPdf } from "../render/pdf.mjs";
import { redraftReport, redraftSteps, rangeLabel } from "./redraft.mjs";
import { summaryReport, summaryLine } from "../summary.mjs";
import { runTask } from "../prompt.mjs";

const out = (s) => process.stdout.write(`${s}\n`);
const warn = (s) => process.stdout.write(`  ! ${s}\n`);
const rel = (p) => path.relative(process.cwd(), p) || p;

/**
 * The three living Markdown docs and the PDF editions.
 *
 * Nothing here judges the shape of the corpus. Loading it has already refused
 * anything that would make a document wrong — an entry with no description, a
 * version that isn't a release, a feature filed under an area that doesn't
 * exist. Everything past that is an editorial call, and a tool that blocked a
 * build over one would only be teaching people to write around it.
 *
 * Two kinds of PDF, and they never share a name or a folder. An edition is a
 * release that was cut: `ledger cut` prints it into the client directory, and
 * that is the only way a file gets there. A draft is the open release as it
 * stands — `<name>_N-draft.pdf`, in the gitignored docs directory — so a draft
 * can't be mistaken for, or committed as, the edition a client was handed.
 *
 * With no edition named, a build brings everything up to date: the Markdown,
 * every cut edition whose PDF isn't on disk (a fresh clone of a project that
 * doesn't commit them gets them all back), and the draft of the open release
 * once it has something in it.
 */
export async function cmdBuild({ flags, positional }) {
  const project = openProject(flags);
  const c = color();

  const redraft = redraftReport(project);
  if (!redraft.ok) {
    out(`! Unfinished redraft: ${redraft.line}.`);
    out("  To finish it:");
    out(redraftSteps(redraft, "    "));
    out("");
  }

  const target = parseTarget(positional[0] ?? flags.version);
  const wantMd = flags.md || (!flags.pdf && target === null);
  const wantPdf = flags.pdf || !flags.md;

  if (wantMd) {
    const outDir = path.resolve(project.root, flags.out ?? project.config.output.dir);
    const docs = new MarkdownRenderer(project).all();
    fs.mkdirSync(outDir, { recursive: true });
    for (const [key, content] of Object.entries(docs)) {
      const name = project.config.output[key];
      if (!name) continue;
      fs.writeFileSync(path.join(outDir, name), content);
      out(`wrote ${rel(path.join(outDir, name))}`);
    }
  }
  if (!wantPdf) return;

  const releases = project.releases;
  const open = releases.current.future ? releases.current : null;
  const openRecorded = open && project.recordedAt(open.version);
  const cut = releases.liveVersions.filter((v) => releases.at(v).released);

  let versions;
  const kept = [];
  if (target === "draft") {
    if (!open) fail(`v${releases.current.version} is already cut, and there is no open release to draft`);
    versions = [open.version];
  } else if (typeof target === "number") {
    if (!releases.versions.includes(target)) fail(`no release v${target} — \`ledger releases\` lists them`);
    versions = [target];
  } else if (target === "all") {
    versions = [...cut, ...(openRecorded ? [open.version] : [])];
    const archived = releases.archived;
    if (archived.length) {
      out(`${rangeLabel(archived.map((r) => r.version))} belong to archived ledgers and are left as they are. ` +
        `\`ledger build v${archived[archived.length - 1].version}\` reprints one from its archive.`);
    }
  } else {
    versions = [];
    for (const v of cut) {
      if (fs.existsSync(editionFile(project, v, flags).target)) kept.push(v);
      else versions.push(v);
    }
    if (openRecorded) versions.push(open.version);
  }

  for (const version of versions) {
    const { target: file, draft } = await printEdition(project, version, flags);
    out(draft
      ? `wrote v${version} ${c.yellow("· DRAFT, not cut")} → ${rel(file)}`
      : `wrote v${version} → ${rel(file)}`);
  }

  if (target === null) {
    if (kept.length) {
      out(`${rangeLabel(kept)} already printed in ${rel(path.dirname(editionFile(project, kept[0], flags).target))}/ — ` +
        "`ledger build all` reprints them with the current wording.");
    }
    if (open && !openRecorded && releases.versions.length > 1) {
      out(`v${open.version} is open with nothing recorded yet, so there's no draft to print. (\`ledger preview\` prints it anyway.)`);
    }
    if (!versions.length && !kept.length && !(open && !openRecorded && releases.versions.length > 1)) {
      out("Nothing to print yet: no release is cut and nothing is recorded. `ledger add` records the first feature.");
    }
  }
}

/** `v3`, `3`, `all`, `draft`, or nothing: which editions a build prints. */
function parseTarget(arg) {
  if (arg === undefined || arg === true) return null;
  const s = String(arg).toLowerCase();
  if (s === "all" || s === "draft") return s;
  const m = /^v?(\d+)$/.exec(s);
  if (m) return Number(m[1]);
  return usage(`usage: ledger build [v3 | all | draft]  — "${arg}" isn't an edition`);
}

/**
 * Where one edition's file goes. A cut edition goes to the client directory
 * under the name the client sees; the open release is a draft, and goes to
 * the docs directory with "-draft" in its name. `--out` puts either where it
 * says, and `--html` swaps the extension.
 */
export function editionFile(project, version, flags = {}) {
  const release = project.releases.at(version);
  const source = release.archived ? project.openArchive(release) : project;
  const draft = Boolean(release.future);
  let name = source.config.output.pdf_name
    .replace("{slug}", titleSlug(source.brand.name ?? source.config.product))
    .replace("{version}", project.releases.fileLabel(version));
  if (draft) name = /\.pdf$/i.test(name) ? name.replace(/\.pdf$/i, "-draft.pdf") : `${name}-draft`;
  const dir = flags.out
    ? path.resolve(project.root, String(flags.out))
    : path.resolve(project.root, draft ? project.config.output.dir : project.config.output.client_dir);
  let target = path.join(dir, name);
  if (flags.html) target = target.replace(/\.pdf$/i, ".html");
  return { target, source, release, draft };
}

/**
 * Prints one edition. `--html` writes the same document as HTML instead —
 * openable in a browser with devtools, which is the fast loop when tuning
 * theme.css.
 */
export async function printEdition(project, version, flags = {}) {
  const { target, source, release, draft } = editionFile(project, version, flags);
  if (release.archived) out(`v${version} is archived — printing it from .ledger/${release.archive}/`);
  const label = project.releases.printedAs(version);
  const { html, warnings, fontsEmbedded } = renderLedgerHtml({ project: source, version, label });
  for (const w of warnings) warn(w);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (flags.html) fs.writeFileSync(target, html);
  else await htmlToPdf(html, target, { checkFonts: fontsEmbedded });
  return { target, draft };
}

/**
 * The open release as a draft PDF: the document as it would print if it were
 * cut now, never in the client directory. `--open` hands it to the system
 * viewer.
 *
 * `--run <agent>` has the agent write the summary first when it is out of
 * date, and only that. A preview is for seeing, day to day, what the release
 * says so far; an audit or a review costs a read of the code or of the whole
 * release, and belongs to the cut. Without the flag the draft still prints,
 * and says on its summary page that the summary hasn't caught up.
 */
export async function cmdPreview({ flags }) {
  let project = openProject(flags);
  const open = project.releases.current;
  if (!open.future) fail(`v${open.version} is already cut, and there is no open release to preview`);
  if (!project.recordedAt(open.version) && project.releases.versions.length > 1) {
    out(`v${open.version} has nothing recorded yet, so this draft reads the same as the v${open.version - 1} edition.`);
  }
  const summary = summaryReport(project);
  if (!summary.ok && flags.run !== undefined && flags.run !== false) {
    out(`${mark(false)} summary: ${summaryLine(summary)}`);
    out("");
    const code = await runTask("summary", flags, { openProject });
    out("");
    if (code) out(`${color().yellow("!")} the summary didn't finish (see above); printing the draft with it as it stands.`);
    project = openProject(flags);
  } else if (!summary.ok) {
    out(`${color().yellow("!")} ${summaryLine(summary)}. \`ledger preview --run\` has an agent write it first.`);
  }
  const { target } = await printEdition(project, open.version, flags);
  out(`wrote v${open.version} ${color().yellow("· DRAFT, not cut")} → ${rel(target)}`);
  if (flags.open) {
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    spawn(opener, [target], { detached: true, stdio: "ignore", shell: process.platform === "win32" }).unref();
  }
}
