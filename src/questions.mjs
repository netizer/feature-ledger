import { fail, isBlank, today } from "./util.mjs";

/**
 * What only a person can settle, kept as corpus state in questions.json.
 *
 * Two kinds. A `why` question is opened by a change whose reason came from a
 * commit message (`--why-from commit`) or that nobody knew (`--why-unknown`):
 * the ledger never invents a reason, and it never forgets that one is
 * missing. A `finding` is something a check turned up (`ledger verify`, or
 * an agent's own doubt) that the text may not be true.
 *
 * They outlive the terminal an agent ran in, which is the point: a list
 * printed at the end of a run is gone by the next morning. `ledger status`
 * counts them, `ledger cut` asks them one at a time, and an open one on the
 * release being cut holds the cut until it is answered or `--skip questions`.
 */

export function openQuestions(project, { version = null } = {}) {
  return project.questions.filter((q) => q.status === "open" && (version === null || q.version === version));
}

function nextId(project) {
  return project.questions.reduce((n, q) => Math.max(n, q.id), 0) + 1;
}

/** The event a `why` question is about, found by position and checked by its words. */
export function eventOf(project, q) {
  if (!project.featureSet.has(q.feature)) return null;
  const f = project.featureSet.find(q.feature);
  const e = f.events[q.event];
  return e && e.what === q.what ? { feature: f, event: e } : null;
}

/** Opens the question a reason nobody vouched for needs. Returns it, or null when none is needed. */
export function askWhy(project, feature, index) {
  const e = feature.events[index];
  if (e.why_from === "person") return null;
  const q = {
    id: nextId(project),
    kind: "why",
    feature: feature.id,
    version: e.version,
    event: index,
    what: e.what,
    text: e.combined
      ? `Is the reason in this note on ${feature.currentName} right? It was read off a commit message: ${e.what}`
      : e.why_from === "commit"
        ? `Is this why ${feature.currentName} ${e.kind === "remove" ? "went" : "changed"}? “${e.why}” — read off a commit message, for: ${e.what}`
        : `Why did ${feature.currentName} change? Nobody recorded a reason for: ${e.what}`,
    status: "open",
    opened: today(),
  };
  project.questions.push(q);
  return q;
}

export function addFinding(project, featureId, text, version) {
  if (featureId && !project.featureSet.has(featureId)) project.featureSet.find(featureId);
  if (isBlank(text)) fail("a finding needs its text: what may not be true, and where");
  const q = { id: nextId(project), kind: "finding", feature: featureId ?? null, version, text: String(text).trim(), status: "open", opened: today() };
  project.questions.push(q);
  return q;
}

function find(project, id) {
  const q = project.questions.find((x) => x.id === Number(id));
  if (!q) fail(`no question #${id} — \`ledger questions\` lists the open ones`);
  if (q.status !== "open") fail(`question #${q.id} is already ${q.status}`);
  return q;
}

/**
 * Settles one question. For a `why`:
 *   answer  — the reason, in the person's words; the event now says it, and
 *             says it came from a person.
 *   accept  — the reason stands as read off the commit, now vouched for; or,
 *             where none was known, that it stays unknown.
 * For a finding, an answer is a note on how it was settled. Either kind can
 * be dismissed: nothing to do.
 *
 * Returns the feature whose events changed, for the caller to save, or null.
 */
export function settle(project, id, action, answer = null) {
  const q = find(project, id);
  let touched = null;
  // A legacy question is about a note an edition already printed: settling it
  // records that someone stands by it, and changes nothing that was handed over.
  if (q.kind === "why" && action !== "dismiss" && !q.legacy) {
    const found = eventOf(project, q);
    if (!found) fail(`question #${q.id} is about a change that is no longer in ${q.feature}'s events; dismiss it`);
    const { feature, event } = found;
    if (action === "answer") {
      if (isBlank(answer)) fail("an answer needs the reason, in a sentence");
      event.why = String(answer).trim();
      event.why_from = "person";
      // A removal's reason is what the edition prints for it.
      if (event.kind === "remove") {
        const h = feature.entryAt(event.version);
        if (h?.removed) h.reason = event.why;
      }
    } else if (event.why_from === "commit") {
      event.why_from = "person";
    }
    touched = feature;
  }
  q.status = { answer: "answered", accept: "accepted", dismiss: "dismissed" }[action];
  if (answer && !isBlank(answer)) q.answer = String(answer).trim();
  q.closed = today();
  return touched;
}
