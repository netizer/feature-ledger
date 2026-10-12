import { spawnSync } from "node:child_process";
import path from "node:path";
import { COPY_RULE, EXIT, UserError, fail, usage } from "./util.mjs";
import { color, mark } from "./ui.mjs";
import { resolveAgent } from "./agents/index.mjs";
import { runAgent, describeCommand } from "./agents/runner.mjs";

/**
 * The commands that print a prompt for a coding agent, and what each one is
 * expected to leave behind when an agent has worked it.
 *
 * Every brief prints an explanation for the person first, then COPY_RULE, then
 * the prompt, so delivering one is one mechanism for all of them: printed
 * whole (the default), printed alone (`--print`), put on the clipboard
 * (`--copy`), or handed to an agent (`--run`). The last is the only one that
 * acts, so it is the only one that checks what the agent did and says so. It
 * only ever happens when someone typed `--run`: tokens are spent on purpose.
 *
 * Keyed by command and subcommand, as the command line names them.
 */
export const TASKS = {
  prepare: {
    label: "preparation of the edition",
    brief: async (flags) => (await import("./commands/prepare.mjs")).cmdPrepare({ flags, positional: [] }),
    snapshot: () => ({}),
    async verify(p) {
      const { prepareReport, prepareLine, unknownReasons } = await import("./compose.mjs");
      const r = prepareReport(p);
      const checks = [{ ok: r.ok, line: r.ok ? prepareLine(r) : `${prepareLine(r)} — the agent stopped before \`ledger prepare complete\`` }];
      const unknown = unknownReasons(p, p.releases.current.version).length;
      if (unknown) checks.push({ ok: true, line: `${unknown} reason${unknown === 1 ? "" : "s"} still not vouched for — \`ledger\` lists them` });
      return checks;
    },
  },
  bootstrap: {
    label: "baseline survey",
    brief: async (flags) => (await import("./commands/init.mjs")).cmdBootstrap({ flags, positional: [] }),
    snapshot: () => ({}),
    verify(p) {
      const n = p.featureSet.features().length;
      if (!n) return [{ ok: false, line: "nothing was recorded — the ledger is still empty" }];
      return [{ ok: true, line: `${n} entr${n === 1 ? "y" : "ies"} recorded — read it with \`ledger preview\`, edit it, commit it, ` +
        (p.pendingRedraft ? "then run `ledger redraft check`" : "then `ledger cut --name \"Baseline\"`") }];
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

/** The task a command line names, or null when it doesn't print a prompt. */
export function taskFor(command, sub) {
  if (["bootstrap", "prepare"].includes(command) && (sub === undefined || sub === "brief")) return command;
  const key = `${command} ${sub}`;
  return TASKS[key] ? key : null;
}

/** Every command line that prints a prompt, for messages that list them. */
export const PROMPT_COMMANDS = ["ledger prepare", "ledger bootstrap", "ledger redraft check", "ledger style rewrite"];

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
