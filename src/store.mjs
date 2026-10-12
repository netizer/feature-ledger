import fs from "node:fs";
import path from "node:path";
import { fail, readJson, writeJson, exists, isBlank } from "./util.mjs";
import { Feature } from "./model/feature.mjs";
import { FeatureSet } from "./model/feature-set.mjs";
import { ReleaseSet } from "./model/release-set.mjs";

export const LEDGER_DIRNAME = ".ledger";

/**
 * Everything the corpus needs is inside one directory in the host project,
 * so a Python, Go or Rails repo all look identical to this tool:
 *
 *   .ledger/
 *     config.json          what this product is, its categories, its tone, doc wording
 *     brand.json           logo + one accent colour; the client-swap surface
 *     releases.json        the version timeline
 *     subcategories.json   optional sub-section headings
 *     other-changes.json   changes belonging to no single feature
 *     compositions.json    per release, the "What changed" notes, the summary and the
 *                          message its edition goes out with, and what `ledger prepare`
 *                          had seen when it wrote them
 *     redrafts.json        every time the corpus was rewritten from scratch, and whether
 *                          the new one has been checked against the old
 *     archive/<label>/     the corpus a redraft set aside, read-only
 *     index.json           the deliberate corpus order
 *     features/<id>.json   one file per feature
 *     STYLE.md             optional prose tone, when style is "custom"
 *     theme.css            optional CSS appended last to the PDF
 */
export function findLedgerDir(startDir = process.cwd(), explicit = null) {
  if (explicit) {
    const p = path.resolve(explicit);
    if (!exists(p)) fail(`no ledger directory at ${p}`);
    return p;
  }
  if (process.env.LEDGER_DIR) return path.resolve(process.env.LEDGER_DIR);

  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, LEDGER_DIRNAME);
    if (exists(path.join(candidate, "config.json"))) return candidate;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  fail(`no ${LEDGER_DIRNAME}/ found in this directory or any parent — run \`ledger init\` first`);
}

/**
 * The shape of the corpus on disk.
 *
 *   1  the client's "What changed" notes on each feature, written as each
 *      change landed, with summaries.json and reviews.json beside them
 *   2  events and compositions, plus per-entry `paths`, questions.json and
 *      audits.json
 *   3  events and compositions, with `how_to_see` on each entry, and nothing
 *      that maps code to entries
 *
 * `ledger migrate` brings 1 or 2 to 3, and nothing else reads them. A CLI
 * that wrote an older shape over this one would drop what it doesn't know,
 * so an older ledger is refused rather than read.
 */
export const SCHEMA = 3;

export const DEFAULT_CONFIG = {
  schema: SCHEMA,
  product: "The product",
  // The one-line "what is this thing" that opens the generated docs and the
  // PDF's front page. Left empty means the generators fall back to a
  // serviceable generic sentence built from `product`.
  tagline: "",
  prepared_for: "the client",
  categories: [],
  // The area a feature lands in when nobody has said otherwise. A product
  // small enough to have no natural areas has one called "Features", and the
  // generators print it without a heading — the alternative, forcing a
  // taxonomy onto a product with four capabilities, invents a structure the
  // reader then has to hold in their head for nothing.
  default_category: "Features",
  // The tone every entry is written in: one style-guide id, or "custom" for
  // a tone written as prose in .ledger/STYLE.md. See src/style.mjs.
  style: "google",
  output: {
    dir: "docs/generated",
    // Inside `dir`, so the default is that every generated document —
    // Markdown and PDF alike — is build output the corpus can reproduce.
    // `ledger init --commit-pdfs` moves this to COMMITTED_CLIENT_DIR, which
    // sits outside the ignored directory on purpose.
    client_dir: "docs/generated/client",
    pdf_name: "{slug}-Feature-Ledger_{version}.pdf",
    features: "FEATURES.md",
    extended: "FEATURES_EXTENDED.md",
    dev: "DEV_FEATURES.md",
  },
  docs: {},
};

/** Where the client editions go when a project chooses to keep them. Outside
 *  `output.dir`, so the one .gitignore line `ledger init` writes covers the
 *  Markdown docs and leaves the PDFs alone. */
export const COMMITTED_CLIENT_DIR = "docs/client";

/** Which of the two shapes a project is in, read back off the paths rather
 *  than stored as a second flag that could disagree with them: the editions
 *  are kept if their directory sits outside the one line `init` gitignores.
 *  The wording in the agent stanza, in `.ledger/README.md` and in
 *  `ledger status` all comes from this, so a project that edits the paths by
 *  hand still gets told the truth. */
export function pdfsAreCommitted(config) {
  const trim = (p) => String(p).replace(/\/+$/, "");
  const dir = trim(config.output.dir);
  const clientDir = trim(config.output.client_dir);
  return clientDir !== dir && !clientDir.startsWith(`${dir}/`);
}

export const DEFAULT_BRAND = {
  name: null,          // falls back to config.product
  logo: null,          // path relative to the project root; PNG, JPG or SVG
  logo_height: 32,     // in px, as printed on the front page
  accent: "#8e2a58",   // the one hue to re-tune per client — see brand.mjs
  fonts: { display: "Source Serif 4", body: "Inter" },
};

function deepMerge(base, over) {
  if (over === null || over === undefined) return base;
  if (Array.isArray(base) || typeof base !== "object" || typeof over !== "object" || Array.isArray(over)) return over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? deepMerge(base[k], v) : v;
  return out;
}

function readOptional(file, fallback) {
  return exists(file) ? readJson(file) : fallback;
}

/** The directory a redraft sets the old corpus aside in, inside `.ledger/`. */
export const ARCHIVE_DIRNAME = "archive";

/** The file that marks a directory as an archived corpus rather than a live one. */
export const ARCHIVED_MARKER = "archived.json";

export class Project {
  constructor(ledgerDir) {
    this.ledgerDir = ledgerDir;
    // An archived corpus lives at <root>/.ledger/archive/<label>/, and still
    // belongs to that project: its logo path, its git history and its output
    // directories are all the project's.
    this.archivedAs = readOptional(path.join(ledgerDir, ARCHIVED_MARKER), null);
    this.root = this.archivedAs ? path.resolve(ledgerDir, "..", "..", "..") : path.dirname(ledgerDir);
    this.configPath = path.join(ledgerDir, "config.json");
    this.brandPath = path.join(ledgerDir, "brand.json");
    this.releasesPath = path.join(ledgerDir, "releases.json");
    this.subcategoriesPath = path.join(ledgerDir, "subcategories.json");
    this.otherChangesPath = path.join(ledgerDir, "other-changes.json");
    this.indexPath = path.join(ledgerDir, "index.json");
    this.compositionsPath = path.join(ledgerDir, "compositions.json");
    this.redraftsPath = path.join(ledgerDir, "redrafts.json");
    this.archiveDir = path.join(ledgerDir, ARCHIVE_DIRNAME);
    this.featuresDir = path.join(ledgerDir, "features");
    this.themeCssPath = path.join(ledgerDir, "theme.css");
    this.load();
  }

  load() {
    const raw = readJson(this.configPath);
    const where = path.relative(process.cwd(), this.ledgerDir) || this.ledgerDir;
    if ((raw.schema ?? 1) < SCHEMA) {
      fail(`${where} was written by an earlier version of feature-ledger. Run \`ledger migrate\` to bring it ` +
        "over; nothing printed so far changes. Everyone who records into this ledger needs the same version: " +
        "merge any branch with ledger changes first, then migrate once.");
    }
    if (raw.schema > SCHEMA) {
      fail(`${where} was written by a newer version of feature-ledger (schema ${raw.schema}); this one reads ` +
        `schema ${SCHEMA}. Upgrade feature-ledger: an older CLI would drop what it doesn't know when it writes.`);
    }
    this.config = deepMerge(DEFAULT_CONFIG, raw);
    this.brand = deepMerge(DEFAULT_BRAND, readOptional(this.brandPath, {}));
    if (!this.brand.name) this.brand.name = this.config.product;

    this.releases = new ReleaseSet(readJson(this.releasesPath));
    this.subcategories = readOptional(this.subcategoriesPath, []);
    this.otherChangesList = readOptional(this.otherChangesPath, []);
    this.index = readOptional(this.indexPath, { order: [] }).order ?? [];
    this.compositions = readOptional(this.compositionsPath, { compositions: [] }).compositions ?? [];
    this.redrafts = readOptional(this.redraftsPath, { redrafts: [] }).redrafts ?? [];

    const files = exists(this.featuresDir)
      ? fs.readdirSync(this.featuresDir).filter((f) => f.endsWith(".json")).sort()
      : [];
    const features = files.map((file) => {
      const data = readJson(path.join(this.featuresDir, file));
      const expected = `${data.id}.json`;
      if (data.id && file !== expected) {
        fail(`features/${file} declares id "${data.id}" — a feature file must be named <id>.json (${expected})`);
      }
      return new Feature(data, { file: `features/${file}`, ...this.bulletsFor(data) });
    });

    this.featureSet = new FeatureSet({
      features,
      subcategories: this.subcategories,
      otherChanges: this.otherChangesList,
      order: this.index,
      config: this.config,
      releaseSet: this.releases,
    });
  }

  /**
   * A feature's "What changed" notes by version, from compositions.json, and
   * for the open release, until a note is prepared for it, its events as
   * recorded. Only an updated entry gets either: a new one has no "before".
   */
  bulletsFor(data) {
    const bullets = {};
    for (const c of this.compositions) {
      const list = c.changes?.[data.id];
      if (Array.isArray(list) && list.length) bullets[c.version] = list;
    }
    const drafts = {};
    const open = this.releases.current.future ? this.releases.current.version : null;
    const first = Math.min(...(data.history ?? []).map((h) => h.version));
    if (open !== null && !bullets[open] && first < open) {
      const lines = recordedLines((data.events ?? []).filter((e) => e.version === open));
      if (lines.length) drafts[open] = lines;
    }
    return { bullets, drafts };
  }

  /** The version everything an agent writes lands on. */
  get workingVersion() {
    const current = this.releases.current;
    if (!current.future) {
      fail(
        `the latest release (v${current.version}) is already shipped, so there's nowhere to record a change — ` +
        "run `ledger cut` to open the next one",
      );
    }
    return current.version;
  }

  /**
   * The versions that are real editions. The in-progress release is one only
   * once something has been recorded against it: a release opened by
   * `ledger cut` and not yet written to would print an edition identical to
   * the one just shipped, which is not a document anybody wants handed to a
   * client. The very first release is always an edition, empty or not —
   * there is nothing behind it to fall back to. After a redraft the same is
   * true of the first release the new corpus opened.
   */
  get editionVersions() {
    // Archived editions are printed from the archive, not from this corpus.
    const all = this.releases.liveVersions;
    const current = this.releases.current;
    if (all.length > 1 && current.future && !this.recordedAt(current.version)) return all.slice(0, -1);
    return all;
  }

  /** The edition `ledger build` prints when no `--version` says otherwise. */
  get editionVersion() {
    const versions = this.editionVersions;
    return versions[versions.length - 1];
  }

  /** Whether anything at all was written against a version. */
  recordedAt(version) {
    return this.featureSet.features().some((f) => f.touchedAt(version))
      || this.featureSet.otherChanges({ version }).length > 0;
  }

  /**
   * The redraft that opened `version`, or null. The first edition after a
   * redraft is the one that tells the client the ledger was reorganized.
   */
  redraftOpening(version) {
    return this.redrafts.find((r) => r.opens === version) ?? null;
  }

  /** The latest redraft whose new corpus hasn't been checked against the old
   *  one yet, or null. `ledger build` warns and `ledger cut` refuses on it. */
  get pendingRedraft() {
    const last = this.redrafts.length ? this.redrafts[this.redrafts.length - 1] : null;
    return last && !last.reconciled ? last : null;
  }

  saveRedrafts() {
    this.assertWritable();
    writeJson(this.redraftsPath, { redrafts: this.redrafts });
  }

  /** The corpus an archived release was printed from, opened read-only. */
  openArchive(release) {
    const dir = path.join(this.ledgerDir, release.archive);
    if (!exists(path.join(dir, "config.json"))) {
      fail(`v${release.version} was archived to .ledger/${release.archive}/, but there is no corpus there any more`);
    }
    return new Project(dir);
  }

  /**
   * An archive is a record of what an earlier corpus said, and the editions
   * printed from it depend on it staying that way. `ledger show --dir` and
   * `ledger list --dir` read it freely; nothing writes to it.
   */
  assertWritable() {
    if (this.archivedAs) {
      fail(`${path.relative(process.cwd(), this.ledgerDir) || this.ledgerDir} is an archived ledger, set aside by ` +
        "`ledger redraft`. It is read-only: record changes in the live .ledger/ instead.");
    }
  }

  featurePath(id) {
    return path.join(this.featuresDir, `${id}.json`);
  }

  saveFeature(feature) {
    this.assertWritable();
    writeJson(this.featurePath(feature.id), feature.toJSON());
    if (!this.index.includes(feature.id)) {
      // Insertion order is the deliberate order; the index is what keeps it
      // once features live in separate files.
      this.index.push(feature.id);
    }
    this.saveIndex();
  }

  deleteFeatureFile(id) {
    this.assertWritable();
    const p = this.featurePath(id);
    if (exists(p)) fs.unlinkSync(p);
    this.index = this.index.filter((x) => x !== id);
    this.saveIndex();
  }

  /**
   * What was written for one release: its "What changed" notes, the summary
   * lists its edition opens with, the message it goes out with, and what
   * `ledger prepare` had seen when it wrote them. One per release; an edition
   * prints the one it was cut with, and a cut one is never rewritten.
   */
  compositionOf(version) {
    return this.compositions.find((c) => c.version === version) ?? null;
  }

  saveComposition(composition) {
    this.assertWritable();
    this.compositions = [...this.compositions.filter((c) => c.version !== composition.version), composition]
      .sort((a, b) => a.version - b.version);
    writeJson(this.compositionsPath, { compositions: this.compositions });
  }

  saveIndex() {
    this.assertWritable();
    // Prune ids whose files are gone, so the index can't quietly rot.
    const live = new Set(
      exists(this.featuresDir)
        ? fs.readdirSync(this.featuresDir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5))
        : [],
    );
    const order = this.index.filter((id) => live.has(id));
    for (const id of [...live].sort()) if (!order.includes(id)) order.push(id);
    this.index = order;
    writeJson(this.indexPath, { order });
  }

  saveReleases() {
    this.assertWritable();
    writeJson(this.releasesPath, this.releases.toJSON());
  }

  saveSubcategories() {
    this.assertWritable();
    writeJson(this.subcategoriesPath, this.subcategories);
  }

  saveOtherChanges() {
    this.assertWritable();
    writeJson(this.otherChangesPath, this.otherChangesList);
  }

  saveConfig() {
    this.assertWritable();
    writeJson(this.configPath, this.config);
  }

  themeCss() {
    return exists(this.themeCssPath) ? fs.readFileSync(this.themeCssPath, "utf8") : "";
  }
}

/**
 * A release's events as the edition prints them until a note is prepared:
 * what changed, then why, one line each. A removal prints under its own
 * heading with its reason, so it is not a line here.
 */
export function recordedLines(events) {
  return events
    .filter((e) => (e.kind ?? "change") === "change")
    .map((e) => (isBlank(e.why) || e.combined ? e.what : `${e.what.replace(/\s*$/, "")} ${e.why}`));
}

export function openProject(flags = {}) {
  return new Project(findLedgerDir(process.cwd(), flags.dir ?? null));
}
