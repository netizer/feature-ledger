import { fail, isBlank } from "../util.mjs";

/**
 * The release timeline behind every version number in the corpus.
 *
 * Each release is a real, named moment the product was shown to (or updated
 * for) whoever reads the ledger. `status: "released"` ones have already
 * happened (name + date set); at most one trailing `status: "future"` release
 * stands for work in progress and carries no date yet. Everything an agent
 * writes lands on that future release; `ledger release cut` is what turns it
 * into a real one and opens the next.
 *
 * A released one also records the commit it was cut at, wherever the project
 * is in git. The date alone can't identify an edition — two demos in one day
 * are ordinary — so the commit is what says which state of the product an
 * edition was printed from, and what makes two same-day releases tellable
 * apart. It is null for a release cut outside a repository, and for every
 * release cut before this was recorded.
 */
export class ReleaseSet {
  constructor(raw) {
    if (!Array.isArray(raw)) fail("releases.json must be an array of releases");
    this.releases = raw
      .map((r) => ({ ...r, future: r.status === "future", released: r.status === "released" }))
      .sort((a, b) => a.version - b.version);
    this.validate();
  }

  get versions() {
    return this.releases.map((r) => r.version);
  }

  /**
   * The version everything generates for by default — the highest one
   * defined, released or not. Today that's the in-progress "future" release;
   * once it's cut, a new one is appended and this simply moves on.
   */
  get latestVersion() {
    return this.releases[this.releases.length - 1].version;
  }

  get current() {
    return this.releases[this.releases.length - 1];
  }

  at(version) {
    const r = this.releases.find((x) => x.version === version);
    if (!r) fail(`no release numbered ${version} in releases.json`);
    return r;
  }

  predecessorOf(version) {
    return version > 1 ? this.at(version - 1) : null;
  }

  toJSON() {
    return this.releases.map(({ version, name, date, status, commit }) => ({
      version, name, date, status, commit: commit ?? null,
    }));
  }

  validate() {
    if (this.releases.length === 0) fail("releases.json is empty");
    const expected = this.releases.map((_, i) => i + 1);
    if (JSON.stringify(this.versions) !== JSON.stringify(expected)) {
      fail(`releases.json version numbers must be 1..N with no gaps (found ${this.versions.join(", ")})`);
    }
    const future = this.releases.filter((r) => r.future);
    if (future.length > 1) fail(`releases.json must have at most one future release, found ${future.length}`);
    if (future.length && future[0].version !== this.latestVersion) fail("a future release must be the last one");
    for (const r of this.releases) {
      if (!["released", "future"].includes(r.status)) {
        fail(`release ${r.version}: status must be "released" or "future"`);
      }
      if (r.released && isBlank(r.date)) fail(`release ${r.version}: released releases need a date`);
      // Not required: a project with no repository, and every release cut
      // before commits were recorded, legitimately has none.
      if (r.commit != null && !/^[0-9a-f]{7,40}$/.test(String(r.commit))) {
        fail(`release ${r.version}: "commit" must be a git sha (got ${JSON.stringify(r.commit)})`);
      }
      if (r.released && isBlank(r.name)) fail(`release ${r.version}: released releases need a name`);
    }
  }
}
