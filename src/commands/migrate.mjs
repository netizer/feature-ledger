import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findLedgerDir, openProject, SCHEMA, ARCHIVE_DIRNAME } from "../store.mjs";
import { readJson, writeJson, exists, isBlank, fail, today } from "../util.mjs";
import { stamped } from "../compose.mjs";
import * as git from "../git.mjs";
import { refreshAgents, ledgerReadmeOutputLine } from "./init.mjs";

const PKG_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = (s) => process.stdout.write(`${s}\n`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * `ledger migrate`: a ledger written by an earlier version of this tool,
 * brought over to the one it reads now. It is the only command that opens the
 * old shapes, which is why it works on the JSON directly rather than through
 * the model. Two came before:
 *
 *   1  "What changed" bullets on each feature, written as each change landed,
 *      with summaries.json and reviews.json beside them;
 *   2  events and compositions, with per-entry `paths`, questions.json and
 *      audits.json.
 *
 * What moves from 1:
 *   - a bullet on a released version goes to compositions.json, verbatim, as
 *     what that edition printed — every edition already handed over reprints
 *     exactly as before;
 *   - a bullet on the open release becomes an event, marked `combined`
 *     because it carries its reason in its own words, and stays the note
 *     until `ledger prepare` writes one;
 *   - a bullet the old tool accepted but never printed (on an entry new in
 *     that release) is listed in the report, word for word, rather than lost;
 *   - `dev_notes` move to the feature, once, from its latest entry;
 *   - summaries.json becomes the summary lists in compositions.json, marked
 *     prepared only if both the old summary and the old review were current;
 *   - `reason_inferred` becomes `why_from: "commit"`.
 *
 * What moves from 2:
 *   - `paths` go: the ledger no longer maps code to entries;
 *   - questions.json goes. A reason nobody vouched for is already on its
 *     event; a finding a check filed is listed in the report, word for word;
 *   - audits.json goes, and so do the composition stamps it no longer reads.
 *     An open release whose composition was up to date is marked prepared.
 *
 * Every feature file is checked on its own, so one recorded on a branch with
 * an older CLI and merged after a migration is converted too. Archived
 * corpora under .ledger/archive/ move the same way, so their editions still
 * print.
 */
export async function cmdMigrate({ flags }) {
  const ledgerDir = findLedgerDir(process.cwd(), flags.dir ?? null);
  const root = path.dirname(ledgerDir);
  const archives = exists(path.join(ledgerDir, ARCHIVE_DIRNAME))
    ? fs.readdirSync(path.join(ledgerDir, ARCHIVE_DIRNAME)).map((d) => path.join(ledgerDir, ARCHIVE_DIRNAME, d))
      .filter((d) => exists(path.join(d, "config.json")))
    : [];
  const dry = Boolean(flags["dry-run"]);

  const results = [ledgerDir, ...archives].map((dir) => migrateDir(dir, { dry }));
  const live = results[0];

  if (results.every((r) => r.skipped)) {
    out(`${path.relative(process.cwd(), ledgerDir) || ledgerDir}/ is already in the current shape; nothing to migrate.`);
    return;
  }
  for (const r of results) {
    if (r.skipped) continue;
    const where = path.relative(process.cwd(), r.dir) || r.dir;
    const from = r.from === SCHEMA ? `${plural(r.converted, "feature file")} in an older shape` : `schema ${r.from}`;
    out(`${dry ? "would migrate" : "migrated"} ${where}/ from ${from}: ${plural(r.features, "entry", "entries")}`);
    if (r.frozen) out(`  ${plural(r.frozen, "\"What changed\" note")} from released editions kept as printed, in compositions.json`);
    if (r.events) out(`  ${plural(r.events, "change")} on the open release (v${r.open}) recorded as events`);
    if (r.devNotes) out(`  dev notes kept once per entry (${plural(r.devNotes, "entry", "entries")})`);
    if (r.paths) out(`  "paths" taken off ${plural(r.paths, "entry", "entries")}: the ledger no longer maps code to entries`);
    if (r.commitReasons) out(`  ${plural(r.commitReasons, "reason")} read off a commit message, kept as one (\`ledger\` lists them)`);
    if (r.summaries) out(`  ${plural(r.summaries, "summary", "summaries")} moved into compositions.json`);
    if (r.dropped.length) out(`  removed ${r.dropped.join(", ")}`);
    if (r.open && r.hadNotes) {
      out(r.current
        ? `  v${r.open} was prepared and nothing moved since, so it is marked prepared`
        : `  v${r.open}'s notes and summary are kept as written; \`ledger prepare\` brings them up to date`);
    }
    if (r.unprinted.length) {
      out("");
      out(`  ${plural(r.unprinted.length, "note")} the old tool accepted and never printed, on entries new in their release. Not`);
      out("  carried over; if one says something the description should, put it there:");
      for (const u of r.unprinted) out(`    ${u.id} (v${u.version}): ${u.text}`);
    }
    if (r.findings.length) {
      out("");
      out(`  ${plural(r.findings.length, "finding")} a check filed and nobody settled. Not carried over; \`ledger prepare\` checks`);
      out("  the text against the code again, and these are where to look:");
      for (const q of r.findings) out(`    ${q.feature ?? "(the summary)"}: ${q.text}`);
    }
  }
  if (dry) {
    out("(--dry-run: nothing written)");
    return;
  }
  if (!live.skipped) finishLive(ledgerDir, root, live);
  out("");
  out("Next: `ledger` says where things stand. Read the diff, then commit .ledger/. Everyone who records into this");
  out("ledger needs this version of feature-ledger from now on.");
}

/* ---- one corpus -------------------------------------------------------- */

const OLD_HISTORY = ["changes", "dev_notes", "reason_inferred"];

/** Whether a feature file is in a shape this version doesn't read. */
const oldShape = (data) => "paths" in data || (data.history ?? []).some((h) => OLD_HISTORY.some((k) => k in h));

function migrateDir(dir, { dry }) {
  const configPath = path.join(dir, "config.json");
  const config = readJson(configPath);
  const from = config.schema ?? 1;
  const featuresDir = path.join(dir, "features");
  const files = exists(featuresDir) ? fs.readdirSync(featuresDir).filter((f) => f.endsWith(".json")).sort() : [];
  const features = files.map((f) => ({ file: path.join(featuresDir, f), data: readJson(path.join(featuresDir, f)) }));
  const stray = features.filter(({ data }) => oldShape(data));
  if (from >= SCHEMA && !stray.length) return { dir, skipped: true };

  const releases = readJson(path.join(dir, "releases.json"));
  const open = releases.find((r) => r.status === "future")?.version ?? null;
  const compositionsPath = path.join(dir, "compositions.json");
  const compositions = new Map((exists(compositionsPath) ? readJson(compositionsPath).compositions ?? [] : []).map((c) => [c.version, c]));
  const composition = (v) => {
    if (!compositions.has(v)) compositions.set(v, { version: v, changes: {} });
    const c = compositions.get(v);
    c.changes ??= {};
    return c;
  };
  const otherChanges = exists(path.join(dir, "other-changes.json")) ? readJson(path.join(dir, "other-changes.json")) : [];
  const summariesPath = path.join(dir, "summaries.json");
  const reviewsPath = path.join(dir, "reviews.json");
  const questionsPath = path.join(dir, "questions.json");
  const auditsPath = path.join(dir, "audits.json");
  const summaries = exists(summariesPath) ? readJson(summariesPath).summaries ?? [] : [];
  const reviews = exists(reviewsPath) ? readJson(reviewsPath).reviews ?? [] : [];
  const questions = exists(questionsPath) ? readJson(questionsPath).questions ?? [] : [];

  // Whether the open release was up to date, read the way the old tool read
  // it, before anything moves.
  const current = open !== null && (from === 1
    ? wasCurrentV1({ open, releases, features, summaries, reviews, otherChanges })
    : wasCurrentV2({ open, releases, features, composition: compositions.get(open) }));

  const stats = {
    dir, from, open, current, features: features.length, converted: stray.length, frozen: 0, events: 0, devNotes: 0, paths: 0,
    commitReasons: 0, summaries: summaries.length, hadNotes: Boolean(compositions.get(open)), unprinted: [], findings: [], dropped: [],
  };

  for (const { data } of features) {
    if ("paths" in data) { delete data.paths; stats.paths++; }
    const history = data.history ?? [];
    if (!history.some((h) => OLD_HISTORY.some((k) => k in h))) continue;

    const first = Math.min(...history.map((h) => h.version));
    const name = [...history].reverse().find((h) => h.name)?.name ?? data.id;
    const notes = [...history].reverse().find((h) => !isBlank(h.dev_notes))?.dev_notes ?? null;
    if (notes && isBlank(data.dev_notes)) { data.dev_notes = notes; stats.devNotes++; }

    data.events ??= [];
    for (const h of history) {
      const bullets = Array.isArray(h.changes) ? h.changes.filter((b) => !isBlank(b)) : [];
      const inferred = h.reason_inferred === true;
      const why_from = inferred ? "commit" : "person";
      if (inferred) stats.commitReasons++;
      if (bullets.length && h.version === first) {
        // The old tool took these and never printed them: the client has
        // never seen an earlier version of a new entry.
        for (const text of bullets) stats.unprinted.push({ id: data.id, version: h.version, text });
      } else if (h.version === open) {
        if (bullets.length) {
          stats.hadNotes = true;
          composition(open).changes[data.id] = bullets;
          for (const b of bullets) {
            data.events.push({ version: open, kind: "change", what: b, why: null, why_from, combined: true,
              ...(h.backfilled ? { backfilled: true } : {}) });
            stats.events++;
          }
        }
        if (h.removed) {
          data.events.push({ version: open, kind: "remove", what: `${name} is no longer part of the product.`, why: h.reason,
            why_from, ...(h.backfilled ? { backfilled: true } : {}) });
          stats.events++;
        }
      } else if (bullets.length) {
        composition(h.version).changes[data.id] = bullets;
        stats.frozen += bullets.length;
      }
      delete h.changes;
      delete h.dev_notes;
      delete h.reason_inferred;
    }
    if (!data.events.length) delete data.events;
  }

  for (const s of summaries) {
    const c = composition(s.version);
    for (const key of ["new", "changed", "in_place", "quiet"]) if (s[key] !== undefined) c[key] = s[key];
    if (s.version === open) stats.hadNotes = true;
  }
  for (const c of compositions.values()) {
    // The stamps the intermediate version wrote, which nothing reads now.
    // A cut edition keeps when it was written; the open one is marked
    // prepared below only if it was current.
    const { date, commit, inputs, verified, ...rest } = c;
    for (const k of Object.keys(c)) delete c[k];
    Object.assign(c, rest);
    if (c.version !== open && (date || commit)) c.prepared = { date: date ?? null, commit: commit ?? null };
  }
  stats.findings = questions.filter((q) => q.status === "open" && q.kind === "finding");

  if (dry) return stats;

  for (const { file, data } of features) writeJson(file, orderedFeature(data));
  if (compositions.size) writeJson(compositionsPath, { compositions: [...compositions.values()].sort((a, b) => a.version - b.version) });
  for (const [p, label] of [[summariesPath, "summaries.json"], [reviewsPath, "reviews.json"], [questionsPath, "questions.json"], [auditsPath, "audits.json"]]) {
    if (exists(p)) { fs.unlinkSync(p); stats.dropped.push(label); }
  }
  const cache = path.join(dir, ".cache");
  if (exists(cache)) fs.rmSync(cache, { recursive: true, force: true });
  delete config.ignore;
  delete config.checks;
  config.schema = SCHEMA;
  writeJson(configPath, config);
  return stats;
}

/** Keys in the order the model writes them, so the first diff after migrating is the last big one. */
function orderedFeature(d) {
  const o = { id: d.id, audience: d.audience, category: d.category };
  if (d.subcategory) o.subcategory = d.subcategory;
  o.size = d.size ?? null;
  if (!isBlank(d.dev_notes)) o.dev_notes = d.dev_notes;
  o.history = d.history;
  if (d.events?.length) o.events = d.events;
  for (const [k, v] of Object.entries(d)) if (!(k in o) && !["events", "dev_notes", "paths"].includes(k)) o[k] = v;
  return o;
}

/* ---- was the open release up to date? --------------------------------- */

const fingerprint = (words) => crypto.createHash("sha256").update(JSON.stringify(words)).digest("hex").slice(0, 16);
const hasPrevious = (releases, open) => releases.some((r) => r.version < open && r.status === "released");

/** An entry's words as schema 1's summary and review fingerprinted them. */
const oldWords = (h) => (h.removed
  ? { removed: true, reason: h.reason, backfilled: Boolean(h.backfilled) }
  : { name: h.name ?? null, description: h.description, changes: h.changes ?? null, backfilled: Boolean(h.backfilled) });

/** Schema 1: the open release's summary and review both still held, every entry they read unchanged since. */
function wasCurrentV1({ open, releases, features, summaries, reviews, otherChanges }) {
  if (!hasPrevious(releases, open)) return false;
  const user = features.map(({ data }) => data).filter((d) => d.audience === "user");
  const at = (d) => (d.history ?? []).find((h) => h.version === open);
  const touched = user.filter(at);
  const targets = touched.filter((d) => !at(d).removed);

  const summary = summaries.find((s) => s.version === open);
  if (targets.length) {
    if (!summary?.entries) return false;
    if (Object.keys(summary.entries).length !== targets.length) return false;
    if (!targets.every((d) => summary.entries[d.id] === fingerprint(oldWords(at(d))))) return false;
  }
  const review = [...reviews].reverse().find((r) => r.version === open);
  if (!review) return !touched.length;
  const seen = review.entries ?? {};
  if (!touched.every((d) => seen[d.id] === fingerprint(oldWords(at(d))))) return false;
  for (const c of otherChanges.filter((x) => x.version === open && x.audience === "user")) {
    const hash = fingerprint({ other: c.description });
    if (seen[`other:${hash}`] !== hash) return false;
  }
  if (summary) {
    const items = ["new", "changed", "in_place"].flatMap((list) => (summary[list] ?? []).map(({ text, covers }) => ({ list, text, covers })));
    if (seen.summary !== fingerprint({ summary: items, quiet: summary.quiet ?? [] })) return false;
  }
  return true;
}

/** An entry's state at a version, from the raw JSON, the way schema 2 fingerprinted it. */
function rawState(data, version) {
  const entries = (data.history ?? []).filter((h) => h.version <= version).sort((a, b) => a.version - b.version);
  if (!entries.length) return null;
  const last = entries[entries.length - 1];
  if (last.removed) return { removed: true, reason: last.reason };
  const names = entries.map((h) => h.name).filter(Boolean);
  return { name: names[names.length - 1], description: last.description, backfilled: last.backfilled === true };
}

/** Schema 2: the open release's composition was stamped, and nothing it was composed from moved since. */
function wasCurrentV2({ open, releases, features, composition }) {
  if (!composition?.inputs || !hasPrevious(releases, open)) return false;
  const previous = open - 1;
  const targets = features.map(({ data }) => data)
    .filter((d) => d.audience === "user" && (d.history ?? []).some((h) => h.version === open && !h.removed));
  if (targets.length !== Object.keys(composition.inputs).length) return false;
  return targets.every((d) => composition.inputs[d.id] === fingerprint({
    before: rawState(d, previous),
    after: rawState(d, open),
    events: (d.events ?? []).filter((e) => e.version === open).map((e) => ({ kind: e.kind ?? "change", what: e.what, why: e.why ?? null })),
  }));
}

/* ---- the live ledger's surroundings ------------------------------------ */

function finishLive(ledgerDir, root, live) {
  const project = openProject({ dir: ledgerDir });
  if (live.current && project.releases.current.future) {
    const c = project.compositionOf(project.releases.current.version);
    if (c) project.saveComposition(stamped(project, c, { date: today(), commit: git.available(root) ? git.head(root) : null }));
  }
  const readme = path.join(ledgerDir, "README.md");
  if (exists(readme)) {
    fs.writeFileSync(readme, fs.readFileSync(path.join(PKG_ROOT, "assets", "ledger-dir-README.md"), "utf8")
      .replaceAll("{output_line}", ledgerReadmeOutputLine(project.config)));
  }
  const { updated } = refreshAgents(root, project.config, ledgerDir);
  for (const f of updated) out(`updated the ledger stanza in ${f}`);
  if (!project.featureSet.features().length) fail("the migrated ledger has no entries; that is unexpected — check .ledger/features/");
}
