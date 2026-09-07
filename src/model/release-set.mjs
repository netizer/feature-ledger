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
    return this.releases.map(({ version, name, date, status }) => ({ version, name, date, status }));
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
      if (r.released && isBlank(r.name)) fail(`release ${r.version}: released releases need a name`);
    }
  }
}
