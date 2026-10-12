import { spawnSync } from "node:child_process";
import path from "node:path";
import { COPY_RULE, EXIT, UserError, fail, usage } from "./util.mjs";
import { color, mark } from "./ui.mjs";
import { resolveAgent } from "./agents/index.mjs";
import { runAgent, describeCommand } from "./agents/runner.mjs";
import { shortSha } from "./git.mjs";

/**
 * The commands that print a prompt for a coding agent, and what each one is
 * expected to leave behind when an agent has worked it.
 *
 * Every brief prints an explanation for the person first, then COPY_RULE, then
 * the prompt, so delivering one is one mechanism for all of them: printed
 * whole (the default), printed alone (`--print`), put on the clipboard
 * (`--copy`), or handed to an agent (`--run`). The last is the only one that
 * acts, so it is the only one that checks what the agent did — the stamp each
 * task ends by recording — and says so, rather than leaving that for the next
 * `ledger cut` to discover.
 *
 * Keyed by command and subcommand, as the command line names them.
 */
export const TASKS = {
  bootstrap: {
    label: "baseline survey",
    brief: async (flags) => (await import("./commands/init.mjs")).cmdBootstrap({ flags, positional: [] }),
    snapshot: (p) => ({ redraft: Boolean(p?.pendingRedraft), released: p ? released(p) : 0, audits: p?.audits.length ?? 0 }),
    verify(p, before) {
      const n = p.featureSet.features().length;
      if (!n) return [{ ok: false, line: "nothing was recorded — the ledger is still empty" }];
      const checks = [{ ok: true, line: `${n} entr${n === 1 ? "y" : "ies"} recorded` }];
      checks.push(p.audits.length > before.audits
        ? { ok: true, line: "the survey is recorded as a full audit" }
        : { ok: false, line: "the survey wasn't recorded as an audit (`ledger audit complete --full`)" });
      if (!before.redraft) {
        checks.push(released(p) > before.released
          ? { ok: true, line: `the baseline is cut as v${p.releases.releases.filter((r) => r.released).at(-1).version}` }
          : { ok: false, line: "the baseline wasn't cut — `ledger status` shows what is in the way" });
      }
      return checks;
    },
  },
  audit: {
    label: "audit",
    brief: async (flags) => (await import("./commands/audit.mjs")).cmdAudit({ flags, positional: [] }),
    snapshot: (p) => ({ audits: p.audits.length, entries: fingerprints(p), questions: p.questions.length }),
    verify(p, before) {
      if (p.audits.length <= before.audits) {
        return [{ ok: false, line: "no audit was recorded — the agent stopped before `ledger audit complete`" }];
      }
      const a = p.lastAudit;
      const b = a.backfilled ?? { added: 0, changed: 0, removed: 0 };
      const inPlace = b.added + b.changed + b.removed;
      const moved = movedSince(p, before.entries);
      const checks = [{ ok: true, line: `${a.mode} audit recorded${a.commit ? ` at ${shortSha(a.commit)}` : ""}: ` +
        (moved.length
          ? `${moved.length} entr${moved.length === 1 ? "y" : "ies"} recorded or claimed code (${moved.join(", ")})` +
            (inPlace ? `, ${inPlace} of them already in place before the last cut` : "")
          : "nothing was missing from the ledger") }];
      const asked = p.questions.length - before.questions;
      if (asked > 0) {
        checks.push({ ok: true, line: `${asked} reason${asked === 1 ? "" : "s"} read off commit messages, waiting for you — ` +
          "`ledger questions` lists them" });
      }
      return checks;
    },
  },
  compose: {
    label: "composition",
    brief: async (flags) => (await import("./commands/compose.mjs")).cmdCompose({ flags, positional: [] }),
    snapshot: () => ({}),
    async verify(p) {
      const { composeReport, composeLine } = await import("./compose.mjs");
      const r = composeReport(p);
      return [{ ok: r.ok, line: composeLine(r) }];
    },
  },
  verify: {
    label: "check against the code",
    brief: async (flags) => (await import("./commands/verify.mjs")).cmdVerify({ flags, positional: [] }),
    snapshot: (p) => ({ questions: p.questions.length }),
    async verify(p, before) {
      const { verifyFingerprint } = await import("./compose.mjs");
      const version = p.releases.current.version;
      const v = p.compositionOf(version)?.verified;
      const found = p.questions.length - before.questions;
      return [v && v.fingerprint === verifyFingerprint(p, version)
        ? { ok: true, line: `v${version} is verified${found > 0 ? `, with ${found} finding${found === 1 ? "" : "s"} for you (\`ledger questions\`)` : ", nothing found"}` }
        : { ok: false, line: "the check wasn't recorded — the agent stopped before `ledger verify complete`" }];
    },
  },
  "paths brief": {
    label: "ownership survey",
    brief: async (flags) => (await import("./commands/paths.mjs")).cmdPaths({ flags, positional: ["brief"] }),
    snapshot: () => ({}),
    async verify(p) {
      const { coverage } = await import("./commands/paths.mjs");
      const cov = coverage(p);
      if (!cov) return [{ ok: false, line: "no git repository, so ownership can't be checked" }];
      const lines = [cov.unowned.length
        ? { ok: false, line: `${cov.unowned.length} product file${cov.unowned.length === 1 ? " is" : "s are"} still owned by no entry — \`ledger paths\`` }
        : { ok: true, line: `every one of ${cov.product.length} product files is owned by an entry` }];
      if (cov.dead.length) lines.push({ ok: false, line: `${cov.dead.length} entr${cov.dead.length === 1 ? "y has" : "ies have"} a glob that matches no file` });
      return lines;
    },
  },
  "redraft check": {
    label: "redraft check",
    brief: async (flags) => (await import("./commands/redraft.mjs")).cmdRedraft({ flags, positional: ["check"] }),
    snapshot: () => ({}),
    verify(p) {
      return [p.pendingRedraft
        ? { ok: false, line: "the redraft isn't marked complete — the agent stopped before `ledger redraft complete`" }
        : { ok: true, line: "the redraft is checked against the archive and marked complete" }];
    },
  },
  "style rewrite": {
    label: "tone rewrite",
    brief: async (flags) => (await import("./commands/style.mjs")).cmdStyle({ flags, positional: ["rewrite"] }),
    snapshot: () => ({}),
    verify(p) {
      return [{ ok: true, line: `the corpus still loads (${p.featureSet.features().length} entries) — read the diff before you commit it` }];
    },
  },
};

const released = (p) => p.releases.releases.filter((r) => r.released).length;

/** Every entry's file contents, to tell afterwards which ones an agent wrote. */
const fingerprints = (p) => Object.fromEntries(p.featureSet.features().map((f) => [f.id, JSON.stringify(f.toJSON())]));
const movedSince = (p, before) => p.featureSet.features()
  .filter((f) => before[f.id] !== JSON.stringify(f.toJSON())).map((f) => f.id);

/** The task a command line names, or null when it doesn't print a prompt. */
export function taskFor(command, sub) {
  if (TASKS[command] && ["bootstrap", "audit", "compose", "verify"].includes(command) &&
      (sub === undefined || sub === "brief")) return command;
  const key = `${command} ${sub}`;
  return TASKS[key] ? key : null;
}

/** Every command line that prints a prompt, for messages that list them. */
export const PROMPT_COMMANDS = ["ledger bootstrap", "ledger audit", "ledger compose", "ledger verify", "ledger redraft check",
  "ledger style rewrite", "ledger paths brief"];

/**
 * Runs a brief with stdout held back, and splits what it printed at the rule.
 * Lines in the explanation that start with "!" are warnings that matter to
 * the person whatever happens to the prompt.
 */
export async function capturePrompt(run) {
  const chunks = [];
  const write = process.stdout.write;
  process.stdout.write = (chunk, ...rest) => {
    chunks.push(String(chunk));
    const cb = rest.find((x) => typeof x === "function");
    if (cb) cb();
    return true;
  };
  try {
    await run();
  } finally {
    process.stdout.write = write;
  }
  const text = chunks.join("");
  const at = text.indexOf(COPY_RULE);
  if (at === -1) fail("this command printed no prompt, so there is nothing to deliver");

  const warnings = [];
  let warning = false;
  for (const line of text.slice(0, at).split("\n")) {
    if (line.startsWith("!")) warning = true;
    else if (!line.startsWith("  ")) warning = false;
    if (warning) warnings.push(line);
  }
  return { warnings, prompt: text.slice(at + COPY_RULE.length).replace(/^\s*\n/, "") };
}

/** The delivery a command line asked for, refusing two at once. */
export function deliveryMode(flags) {
  const asked = [["print", flags.print || flags["prompt-only"]], ["copy", flags.copy], ["run", flags.run]]
    .filter(([, v]) => v !== undefined && v !== false);
  if (asked.length > 1) usage(`--${asked[0][0]} and --${asked[1][0]} are two ways to deliver the same prompt; pick one`);
  return asked[0]?.[0] ?? null;
}

/**
 * `--print`, `--copy` or `--run` on a command that prints a prompt. Returns
 * the exit code: an agent that exits badly is an error, and one that exits
 * cleanly without leaving the stamp its task asks for is a refusal, the same
 * code a `ledger cut` with open checks returns.
 */
export async function deliver(mode, taskKey, flags, { openProject }) {
  const task = TASKS[taskKey];
  const { warnings, prompt } = await capturePrompt(() => task.brief(flags));

  if (mode === "print") {
    for (const w of warnings) process.stderr.write(`${w}\n`);
    process.stdout.write(prompt);
    return 0;
  }
  if (mode === "copy") {
    for (const w of warnings) process.stdout.write(`${w}\n`);
    const tool = copyToClipboard(prompt);
    const lines = prompt.split("\n").length;
    process.stdout.write(`${mark(true)} copied the ${task.label} prompt (${lines} lines) to the clipboard with ${tool}.\n` +
      "  Paste it into a fresh agent session in the project root.\n");
    return 0;
  }
  return runTask(taskKey, flags, { openProject, prompt, warnings });
}

/**
 * Hands one task to the agent `--run` named, then reports: the agent's last
 * message, what it left behind, and how to resume its session — the last
 * message often says what is left to do, and the session is where to do it.
 */
export async function runTask(taskKey, flags, { openProject, prompt = null, warnings = [] }) {
  const task = TASKS[taskKey];
  const project = tryOpen(openProject, flags);
  const agent = resolveAgent(flags.run, project?.config);
  if (prompt === null) ({ prompt, warnings } = await capturePrompt(() => task.brief(flags)));
  const cwd = project?.root ?? process.cwd();
  const c = color();
  const say = (s = "") => process.stdout.write(`${s}\n`);

  for (const w of warnings) say(w);
  say(c.bold(`Handing the ${task.label} to ${agent.title}`) + c.dim(` in ${cwd}`));
  say(c.dim(`  ${describeCommand(agent, cwd)}`));
  say(c.dim("  Ctrl-C stops it; you'll still get the command to resume the session."));
  say("");

  const before = task.snapshot(project);
  const result = await runAgent(agent, prompt, { cwd });

  say("");
  const how = result.signal || result.code === 130 ? "was interrupted"
    : result.code ? `exited with code ${result.code}` : "finished";
  say(c.bold(`── ${agent.title} ${how}${result.summary ? ` · ${result.summary}` : ""} ──`));
  if (result.final?.trim()) { say(""); say(result.final.trim()); }
  if (result.error) { say(""); say(c.red(`The agent reported an error: ${result.error}`)); }

  say("");
  let checks;
  try {
    const after = openProject(flags);
    checks = await task.verify(after, before);
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    checks = [{ ok: false, line: `the ledger doesn't load any more: ${e.message}` }];
  }
  for (const ch of checks) say(`${mark(ch.ok)} ${ch.line}`);
  if (result.denied?.length) {
    const shown = [...new Set(result.denied.map((d) => clip(d.split("\n")[0], 60)))].slice(0, 4).join("; ");
    say(`${c.yellow("!")} the agent was refused ${result.denied.length} tool call${result.denied.length === 1 ? "" : "s"} (${shown}). ` +
      "Resume the session to finish by hand, or allow them in the agent's settings.");
  }

  const resume = agent.resume({ session: result.session });
  const here = path.resolve(process.cwd()) === path.resolve(cwd) ? "" : `cd ${JSON.stringify(cwd)} && `;
  say("");
  say(resume
    ? `Resume the session:  ${c.bold(`${here}${resume}`)}`
    : "Resume the session with your agent's own command; ledger can't see a custom agent's session.");

  if (result.code || result.signal) return EXIT.error;
  return checks.every((ch) => ch.ok) ? 0 : EXIT.refused;
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function tryOpen(openProject, flags) {
  try { return openProject(flags); } catch (e) { if (e instanceof UserError) return null; throw e; }
}

/**
 * The first clipboard tool this machine has. There is no portable clipboard
 * in Node, and every platform ships a different command for it.
 */
function copyToClipboard(text) {
  const candidates = process.platform === "darwin" ? [["pbcopy"]]
    : process.platform === "win32" ? [["clip"]]
    : [
      ...(process.env.WAYLAND_DISPLAY ? [["wl-copy"]] : []),
      ["xclip", "-selection", "clipboard"], ["xsel", "--clipboard", "--input"], ["wl-copy"],
    ];
  for (const [cmd, ...args] of candidates) {
    const r = spawnSync(cmd, args, { input: text });
    if (r.error?.code === "ENOENT") continue;
    if (r.status === 0) return cmd;
  }
  return fail(`no clipboard tool found (tried ${candidates.map(([c]) => c).join(", ")}). ` +
    "Use --print and pipe the prompt wherever it needs to go.");
}
