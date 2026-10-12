import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findLedgerDir, openProject, SCHEMA, ARCHIVE_DIRNAME } from "../store.mjs";
import { readJson, writeJson, exists, isBlank, today, fail } from "../util.mjs";
import { DEFAULT_IGNORE } from "../paths.mjs";
import { fingerprint, stamped } from "../compose.mjs";
import { refreshAgents, ledgerReadmeOutputLine } from "./init.mjs";
import { runTask } from "../prompt.mjs";
import * as git from "../git.mjs";

const PKG_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = (s) => process.stdout.write(`${s}\n`);

/**
 * `ledger migrate`: a ledger written by an earlier version of this tool,
 * brought over to the one it reads now. It is the only command that opens
 * the old shape, which is why it works on the JSON directly rather than
 * through the model.
 *
 * What moves:
 *   - a "What changed" bullet on a released version goes to compositions.json,
 *     verbatim, as what that edition printed — every edition already handed
 *     over reprints exactly as before;
 *   - a bullet on the open release becomes an event, marked `combined`
 *     because it carries its reason in its own words, and is kept as the
 *     composition's draft;
 *   - `dev_notes` move to the feature, once, from its latest entry, and the
 *     file paths named in them become the entry's first `paths`;
 *   - summaries.json becomes the summary lists in compositions.json, and is
 *     stamped as composed only if both the old summary and the old review
 *     were up to date; reviews.json goes, since compose and verify replace it;
 *   - a reason marked `reason_inferred` becomes an open question.
 *
 * Archived corpora under .ledger/archive/ move the same way, so their
 * editions still print. `--run <agent>` then hands over `ledger paths brief`,
 * to say which code every entry lives in.
 */
export async function cmdMigrate({ flags }) {
  const ledgerDir = findLedgerDir(process.cwd(), flags.dir ?? null);
  const root = path.dirname(ledgerDir);
  const archives = exists(path.join(ledgerDir, ARCHIVE_DIRNAME))
    ? fs.readdirSync(path.join(ledgerDir, ARCHIVE_DIRNAME)).map((d) => path.join(ledgerDir, ARCHIVE_DIRNAME, d))
      .filter((d) => exists(path.join(d, "config.json")))
    : [];
  const dry = Boolean(flags["dry-run"]);
  const tracked = git.available(root) ? git.tracked(root) : [];

  const results = [];
  for (const dir of [ledgerDir, ...archives]) results.push(migrateDir(dir, { live: dir === ledgerDir, tracked, dry }));
  const live = results[0];

  if (live.skipped && results.every((r) => r.skipped)) {
    out(`${path.relative(process.cwd(), ledgerDir) || ledgerDir}/ is already in the current shape; nothing to migrate.`);
  } else {
    for (const r of results) {
      if (r.skipped) continue;
      const where = path.relative(process.cwd(), r.dir) || r.dir;
      out(`${dry ? "would migrate" : "migrated"} ${where}/: ${r.features} entries`);
      if (r.frozen) out(`  ${r.frozen} "What changed" note${r.frozen === 1 ? "" : "s"} from released editions kept as printed, in compositions.json`);
      if (r.events) out(`  ${r.events} change${r.events === 1 ? "" : "s"} on the open release (v${r.open}) recorded as events`);
      if (r.devNotes) out(`  dev notes kept once per entry (${r.devNotes} entr${r.devNotes === 1 ? "y" : "ies"})`);
      if (r.paths) out(`  ${r.paths} entr${r.paths === 1 ? "y" : "ies"} given paths from the files their dev notes name`);
      if (r.questions) out(`  ${r.questions} reason${r.questions === 1 ? "" : "s"} read off a commit message, now open questions (\`ledger questions\`)`);
      if (r.summaries) out(`  ${r.summaries} summar${r.summaries === 1 ? "y" : "ies"} moved into compositions.json`);
      if (r.open && r.hadNotes) {
        out(r.current
          ? `  v${r.open}'s summary and review were up to date, so its composition is stamped as current`
          : `  v${r.open}'s notes and summary are kept as a draft; \`ledger compose\` brings them up to date`);
      }
    }
    if (dry) {
      out("(--dry-run: nothing written)");
      return;
    }
    if (!live.skipped) finishLive(ledgerDir, root, live);
  }

  if (flags.run !== undefined && flags.run !== false) {
    out("");
    process.exitCode = await runTask("paths brief", flags, { openProject });
    return;
  }
  if (!live.skipped) {
    out("");
    out("Next: `ledger paths` shows which code each entry lives in, and what no entry owns. `ledger migrate --run claude`");
    out("(or `ledger paths brief --run claude`) has an agent settle it. Then commit .ledger/.");
  }
}

/* ---- one corpus -------------------------------------------------------- */

/** An entry's words as the old summary and review fingerprinted them. */
const oldWords = (h) => (h.removed
  ? { removed: true, reason: h.reason, backfilled: Boolean(h.backfilled) }
  : { name: h.name ?? null, description: h.description, changes: h.changes ?? null, backfilled: Boolean(h.backfilled) });

function migrateDir(dir, { live, tracked, dry }) {
  const configPath = path.join(dir, "config.json");
  const config = readJson(configPath);
  if ((config.schema ?? 1) >= SCHEMA) return { dir, skipped: true };

  const releases = readJson(path.join(dir, "releases.json"));
  const openRelease = releases.find((r) => r.status === "future");
  const open = openRelease?.version ?? null;
  const featuresDir = path.join(dir, "features");
  const files = exists(featuresDir) ? fs.readdirSync(featuresDir).filter((f) => f.endsWith(".json")).sort() : [];
  const features = files.map((f) => ({ file: path.join(featuresDir, f), data: readJson(path.join(featuresDir, f)) }));
  const summariesPath = path.join(dir, "summaries.json");
  const reviewsPath = path.join(dir, "reviews.json");
  const summaries = exists(summariesPath) ? readJson(summariesPath).summaries ?? [] : [];
  const reviews = exists(reviewsPath) ? readJson(reviewsPath).reviews ?? [] : [];
  const otherChanges = exists(path.join(dir, "other-changes.json")) ? readJson(path.join(dir, "other-changes.json")) : [];
  const compositionsPath = path.join(dir, "compositions.json");
  const compositions = new Map((exists(compositionsPath) ? readJson(compositionsPath).compositions ?? [] : []).map((c) => [c.version, c]));
  const questionsPath = path.join(dir, "questions.json");
  const questions = exists(questionsPath) ? readJson(questionsPath).questions ?? [] : [];
  const composition = (v) => {
    if (!compositions.has(v)) compositions.set(v, { version: v, changes: {} });
    const c = compositions.get(v);
    c.changes ??= {};
    return c;
  };

  // Whether the open release's summary and review were up to date, read the
  // way the old tool read them, before anything moves.
  const current = open !== null && wasCurrent({ open, releases, features, summaries, reviews, otherChanges });

  const stats = { dir, open, features: features.length, frozen: 0, events: 0, devNotes: 0, paths: 0, questions: 0, summaries: summaries.length, hadNotes: false, current };
  let qid = questions.reduce((n, q) => Math.max(n, q.id), 0);

  for (const { data } of features) {
    const history = data.history ?? [];
    const first = Math.min(...history.map((h) => h.version));
    const name = [...history].reverse().find((h) => h.name)?.name ?? data.id;

    const notes = [...history].reverse().find((h) => !isBlank(h.dev_notes))?.dev_notes ?? null;
    if (notes && isBlank(data.dev_notes)) { data.dev_notes = notes; stats.devNotes++; }
    if (!data.paths) {
      data.paths = live ? pathsFrom(data.dev_notes, tracked) : [];
      if (data.paths.length) stats.paths++;
    }

    data.events ??= [];
    for (const h of history) {
      const bullets = Array.isArray(h.changes) ? h.changes.filter((b) => !isBlank(b)) : [];
      const inferred = h.reason_inferred === true;
      if (h.version === open) {
        if (bullets.length && first < open) {
          stats.hadNotes = true;
          composition(open).changes[data.id] = bullets;
          for (const b of bullets) {
            data.events.push({ version: open, kind: "change", what: b, why: null, why_from: inferred ? "commit" : "person", combined: true,
              ...(h.backfilled ? { backfilled: true } : {}) });
            stats.events++;
            if (inferred) {
              questions.push({ id: ++qid, kind: "why", feature: data.id, version: open, event: data.events.length - 1, what: b,
                text: `Is the reason in this note on ${name} right? It was read off a commit message: ${b}`, status: "open", opened: today() });
              stats.questions++;
            }
          }
        }
        if (h.removed) {
          data.events.push({ version: open, kind: "remove", what: `${name} is no longer part of the product.`, why: h.reason,
            why_from: inferred ? "commit" : "person", ...(h.backfilled ? { backfilled: true } : {}) });
          stats.events++;
          if (inferred) {
            questions.push({ id: ++qid, kind: "why", feature: data.id, version: open, event: data.events.length - 1,
              what: data.events.at(-1).what, text: `Is this why ${name} went? “${h.reason}” — read off a commit message`, status: "open", opened: today() });
            stats.questions++;
          }
        }
      } else {
        if (bullets.length) { composition(h.version).changes[data.id] = bullets; stats.frozen += bullets.length; }
        if (inferred) {
          // Printed already: the question is whether the team stands by it,
          // and nothing the answer says reaches an edition already handed over.
          questions.push({ id: ++qid, kind: "why", legacy: true, feature: data.id, version: h.version,
            text: `v${h.version}'s note on ${name} took its reason from a commit message, and nobody has vouched for it yet.`,
            status: "open", opened: today() });
          stats.questions++;
        }
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
    // An edition already cut printed this summary; an open release's is only
    // a composition if it was current, and `finishLive` stamps it then.
    if (s.version !== open || current) {
      if (s.date) c.date = s.date;
      if (s.commit) c.commit = s.commit;
    }
    if (s.version === open) stats.hadNotes = true;
  }

  if (dry) return stats;

  for (const { file, data } of features) writeJson(file, orderedFeature(data));
  if (compositions.size) {
    writeJson(compositionsPath, { compositions: [...compositions.values()].sort((a, b) => a.version - b.version) });
  }
  if (questions.length) writeJson(questionsPath, { questions });
  if (exists(summariesPath)) fs.unlinkSync(summariesPath);
  if (exists(reviewsPath)) fs.unlinkSync(reviewsPath);
  config.schema = SCHEMA;
  if (live && !config.ignore) config.ignore = DEFAULT_IGNORE;
  writeJson(configPath, config);
  return stats;
}

/** Keys in the order the model writes them, so the first diff after migrating is the last big one. */
function orderedFeature(d) {
  const out = { id: d.id, audience: d.audience, category: d.category };
  if (d.subcategory) out.subcategory = d.subcategory;
  out.size = d.size ?? null;
  out.paths = d.paths ?? [];
  if (!isBlank(d.dev_notes)) out.dev_notes = d.dev_notes;
  out.history = d.history;
  if (d.events?.length) out.events = d.events;
  for (const [k, v] of Object.entries(d)) if (!(k in out) && !["events", "dev_notes"].includes(k)) out[k] = v;
  return out;
}

/** File paths a dev note names that the repository tracks: an entry's first paths. */
function pathsFrom(notes, tracked) {
  if (isBlank(notes) || !tracked.length) return [];
  const set = new Set(tracked);
  const dirs = new Set(tracked.flatMap((f) => f.split("/").slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join("/"))));
  const found = new Set();
  for (const m of String(notes).matchAll(/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.*-]+)+\/?/g)) {
    const token = m[0].replace(/[.,;:)]+$/, "").replace(/\/$/, "");
    if (token.startsWith(".ledger/") || token === ".ledger") continue;
    if (set.has(token)) found.add(token);
    else if (dirs.has(token)) found.add(`${token}/**`);
  }
  return [...found].sort();
}

/**
 * Whether the open release's old summary and review both still held: every
 * entry they read unchanged since. Only then is the migrated composition
 * stamped as current; otherwise it is a draft for `ledger compose`.
 */
function wasCurrent({ open, releases, features, summaries, reviews, otherChanges }) {
  const hasPrevious = releases.some((r) => r.version < open && r.status === "released");
  if (!hasPrevious) return false;
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

/* ---- the live ledger's surroundings ------------------------------------ */

function finishLive(ledgerDir, root, live) {
  const project = openProject({ dir: ledgerDir });
  if (live.current && project.releases.current.future) {
    const c = project.compositionOf(project.releases.current.version);
    if (c) project.saveComposition(stamped(project, c, { date: c.date ?? today(), commit: c.commit ?? null }));
  }

  // What the last preview saw is the person's, not the project's.
  const gitignore = path.join(root, ".gitignore");
  const line = `${path.relative(root, project.cacheDir).split(path.sep).join("/")}/`;
  const existing = exists(gitignore) ? fs.readFileSync(gitignore, "utf8") : "";
  if (git.available(root) && !existing.split("\n").some((l) => l.trim() === line)) {
    fs.writeFileSync(gitignore, `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${line}\n`);
    out(`added ${line} to .gitignore`);
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

