import fs from "node:fs";
import path from "node:path";
import { fail, readJson, writeJson, exists } from "./util.mjs";
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
 *     audits.json          every audit so far, and the commit each was run against
 *     reviews.json         every review of a release before it was cut, and what it read
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

export const DEFAULT_CONFIG = {
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

export class Project {
  constructor(ledgerDir) {
    this.ledgerDir = ledgerDir;
    this.root = path.dirname(ledgerDir);
    this.configPath = path.join(ledgerDir, "config.json");
    this.brandPath = path.join(ledgerDir, "brand.json");
    this.releasesPath = path.join(ledgerDir, "releases.json");
    this.subcategoriesPath = path.join(ledgerDir, "subcategories.json");
    this.otherChangesPath = path.join(ledgerDir, "other-changes.json");
    this.indexPath = path.join(ledgerDir, "index.json");
    this.auditsPath = path.join(ledgerDir, "audits.json");
    this.reviewsPath = path.join(ledgerDir, "reviews.json");
    this.featuresDir = path.join(ledgerDir, "features");
    this.themeCssPath = path.join(ledgerDir, "theme.css");
    this.load();
  }

  load() {
    this.config = deepMerge(DEFAULT_CONFIG, readJson(this.configPath));
    this.brand = deepMerge(DEFAULT_BRAND, readOptional(this.brandPath, {}));
    if (!this.brand.name) this.brand.name = this.config.product;

    this.releases = new ReleaseSet(readJson(this.releasesPath));
    this.subcategories = readOptional(this.subcategoriesPath, []);
    this.otherChangesList = readOptional(this.otherChangesPath, []);
    this.index = readOptional(this.indexPath, { order: [] }).order ?? [];
    this.audits = readOptional(this.auditsPath, { audits: [] }).audits ?? [];
    this.reviews = readOptional(this.reviewsPath, { reviews: [] }).reviews ?? [];

    const files = exists(this.featuresDir)
      ? fs.readdirSync(this.featuresDir).filter((f) => f.endsWith(".json")).sort()
      : [];
    const features = files.map((file) => {
      const data = readJson(path.join(this.featuresDir, file));
      const expected = `${data.id}.json`;
      if (data.id && file !== expected) {
        fail(`features/${file} declares id "${data.id}" — a feature file must be named <id>.json (${expected})`);
      }
      return new Feature(data, { file: `features/${file}` });
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

  /** The version everything an agent writes lands on. */
  get workingVersion() {
    const current = this.releases.current;
    if (!current.future) {
      fail(
        `the latest release (v${current.version}) is already shipped, so there's nowhere to record a change — ` +
        "run `ledger release cut` to open the next one",
      );
    }
    return current.version;
  }

  /**
   * The versions that are real editions. The in-progress release is one only
   * once something has been recorded against it: a release opened by
   * `release cut` and not yet written to would print an edition identical to
   * the one just shipped, which is not a document anybody wants handed to a
   * client. The very first release is always an edition, empty or not —
   * there is nothing behind it to fall back to.
   */
  get editionVersions() {
    const all = this.releases.versions;
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

  featurePath(id) {
    return path.join(this.featuresDir, `${id}.json`);
  }

  saveFeature(feature) {
    writeJson(this.featurePath(feature.id), feature.toJSON());
    if (!this.index.includes(feature.id)) {
      // Insertion order is the deliberate order; the index is what keeps it
      // once features live in separate files.
      this.index.push(feature.id);
    }
    this.saveIndex();
  }

  deleteFeatureFile(id) {
    const p = this.featurePath(id);
    if (exists(p)) fs.unlinkSync(p);
    this.index = this.index.filter((x) => x !== id);
    this.saveIndex();
  }

  /**
   * The last audit, or null. Every audit is kept rather than one scalar
   * being overwritten: a scalar answers "is the record stale" and nothing
   * else, where the log also answers "when was the last FULL sweep" — which
   * matters, because only a full sweep can correct a capability the baseline
   * survey missed. It is also what lets an edition carry an audit stamp.
   */
  get lastAudit() {
    return this.audits.length ? this.audits[this.audits.length - 1] : null;
  }

  get lastFullAudit() {
    return [...this.audits].reverse().find((a) => a.mode === "full") ?? null;
  }

  recordAudit(entry) {
    this.audits.push(entry);
    this.saveAudits();
  }

  saveAudits() {
    writeJson(this.auditsPath, { audits: this.audits });
  }

  /** The latest review recorded against one release, or null. */
  lastReviewOf(version) {
    return [...this.reviews].reverse().find((r) => r.version === version) ?? null;
  }

  recordReview(entry) {
    this.reviews.push(entry);
    writeJson(this.reviewsPath, { reviews: this.reviews });
  }

  saveIndex() {
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
    writeJson(this.releasesPath, this.releases.toJSON());
  }

  saveSubcategories() {
    writeJson(this.subcategoriesPath, this.subcategories);
  }

  saveOtherChanges() {
    writeJson(this.otherChangesPath, this.otherChangesList);
  }

  saveConfig() {
    writeJson(this.configPath, this.config);
  }

  themeCss() {
    return exists(this.themeCssPath) ? fs.readFileSync(this.themeCssPath, "utf8") : "";
  }
}

export function openProject(flags = {}) {
  return new Project(findLedgerDir(process.cwd(), flags.dir ?? null));
}
