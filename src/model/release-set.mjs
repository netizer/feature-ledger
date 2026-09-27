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
 *
 * An `archived` release is one printed from an earlier corpus that `ledger
 * redraft` has since set aside in `.ledger/archive/<label>/`. It stays in the
 * timeline so version numbers carry on across the redraft and the editions
 * already handed over keep their numbers, but nothing in the live corpus may
 * be recorded against it, and its edition is printed from the archive. The
 * archived releases are always the oldest ones: a redraft sets aside
 * everything before the release it opens.
 *
 * `display_version` is the number the client sees printed on an edition, for
 * a ledger started after the client was already counting — earlier reports
 * were handed over some other way, and this edition carries on from them. It
 * changes the label and nothing else: the ledger still counts 1..N, and every
 * `version` in the corpus and every CLI argument is that real number. Set on
 * one release, it carries forward, so later editions follow on from it.
 */
export class ReleaseSet {
  constructor(raw) {
    if (!Array.isArray(raw)) fail("releases.json must be an array of releases");
    this.releases = raw
      .map((r) => ({
        ...r,
        future: r.status === "future",
        released: r.status === "released",
        archived: r.status === "archived",
      }))
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

  /**
   * The number printed on `version`'s edition: its own `display_version`, or
   * the nearest earlier one's carried forward, or the real number when none
   * is set.
   */
  labelOf(version) {
    const anchor = this.releases.findLast((r) => r.version <= version && r.display_version != null);
    return anchor ? anchor.display_version + (version - anchor.version) : version;
  }

  /**
   * The release an edition is compared with, or null when there is nothing
   * it can be compared with entry by entry: before v1, and across a redraft,
   * where the previous edition was written in a structure this corpus no
   * longer shares. Either way the edition prints as an inventory.
   */
  predecessorOf(version) {
    if (version <= 1) return null;
    const previous = this.at(version - 1);
    return previous.archived ? null : previous;
  }

  /** The last archived release when `version` is the first one after a
   *  redraft, else null. What the "reorganized" note in that edition names. */
  archivedBefore(version) {
    if (version <= 1) return null;
    const previous = this.at(version - 1);
    const self = this.at(version);
    return previous.archived && !self.archived ? previous : null;
  }

  get archived() {
    return this.releases.filter((r) => r.archived);
  }

  /** Versions that belong to the live corpus: everything since the last redraft. */
  get liveVersions() {
    return this.releases.filter((r) => !r.archived).map((r) => r.version);
  }

  toJSON() {
    return this.releases.map(({ version, name, date, status, commit, archive, display_version }) => ({
      version, name, date, status, commit: commit ?? null, ...(archive ? { archive } : {}),
      ...(display_version != null ? { display_version } : {}),
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
      if (!["released", "future", "archived"].includes(r.status)) {
        fail(`release ${r.version}: status must be "released", "future" or "archived"`);
      }
      if ((r.released || r.archived) && isBlank(r.date)) fail(`release ${r.version}: released releases need a date`);
      if (r.archived && isBlank(r.archive)) {
        fail(`release ${r.version}: an archived release needs "archive", the directory its corpus was set aside in`);
      }
      // Not required: a project with no repository, and every release cut
      // before commits were recorded, legitimately has none.
      if (r.commit != null && !/^[0-9a-f]{7,40}$/.test(String(r.commit))) {
        fail(`release ${r.version}: "commit" must be a git sha (got ${JSON.stringify(r.commit)})`);
      }
      if (r.display_version != null && !(Number.isInteger(r.display_version) && r.display_version >= 1)) {
        fail(`release ${r.version}: "display_version" must be a whole number of 1 or more (got ${JSON.stringify(r.display_version)})`);
      }
      if ((r.released || r.archived) && isBlank(r.name)) fail(`release ${r.version}: released releases need a name`);
    }
    const firstLive = this.releases.findIndex((r) => !r.archived);
    if (firstLive === -1) fail("releases.json has no release after the archived ones — a redraft always opens one");
    if (this.releases.slice(firstLive).some((r) => r.archived)) {
      fail("archived releases must all come before the live ones: a redraft sets aside everything before the release it opens");
    }
  }
}
