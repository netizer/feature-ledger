import { spawn } from "node:child_process";
import readline from "node:readline";
import { UserError } from "../util.mjs";
import { color } from "../ui.mjs";

/**
 * Runs one agent on one prompt, in the project root, and reports back what it
 * said last and which session it left behind.
 *
 * Progress shows as it happens: what the agent says along the way, and one
 * dim line per tool it uses. Its last message is held back and returned
 * instead of printed, because that is the one that usually says what is left
 * to do, and it belongs next to the result and the resume command rather than
 * scrolled away above them.
 *
 * Ctrl-C goes to the agent, which stops; this process carries on long enough
 * to say how to resume what was interrupted.
 */
export function runAgent(agent, prompt, { cwd }) {
  const { cmd, args, shell = false } = agent.command({ cwd });
  const c = color();
  const say = (s = "") => process.stdout.write(`${s}\n`);

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, shell, stdio: ["pipe", agent.parse ? "pipe" : "inherit", "inherit"] });
    const state = { session: null, final: null, error: null, denied: [], summary: "", pending: "" };
    const flush = () => {
      if (state.pending.trim()) say(state.pending.trimEnd());
      state.pending = "";
    };

    const ignore = () => {};
    process.on("SIGINT", ignore);
    const done = (fn) => { process.off("SIGINT", ignore); fn(); };

    child.on("error", (e) => done(() => reject(e.code === "ENOENT"
      ? new UserError(`${cmd} isn't installed, or isn't on PATH.${agent.install ? ` Install it with: ${agent.install}` : ""}`)
      : e)));
    child.stdin.on("error", () => {}); // an agent that exits early closes its stdin; the exit code says why
    child.stdin.end(prompt);

    if (agent.parse) {
      const lines = readline.createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        let event;
        try { event = JSON.parse(line); } catch { if (line.trim()) say(c.dim(line)); return; }
        for (const e of agent.parse(event) ?? []) {
          if (e.type === "session") state.session = e.id ?? state.session;
          else if (e.type === "text") {
            if (e.delta) state.pending += e.text;
            else { flush(); state.pending = e.text; }
          } else if (e.type === "tool") {
            flush();
            say(c.dim(`  › ${e.name}${e.detail ? `  ${clip(String(e.detail).replace(/\s+/g, " "), 100)}` : ""}`));
          } else if (e.type === "error") {
            state.error = e.text;
          } else if (e.type === "final") {
            state.final = e.text || state.pending;
            state.pending = "";
            state.error = e.error ?? state.error;
            state.denied = e.denied ?? [];
            state.summary = e.summary ?? "";
            state.session = e.session ?? state.session;
          }
        }
      });
    }

    child.on("close", (code, signal) => done(() => {
      if (state.final === null && state.pending) state.final = state.pending;
      resolve({ code, signal, session: state.session, final: state.final, error: state.error,
        denied: state.denied, summary: state.summary });
    }));
  });
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** How the command reads when it is shown before it runs. */
export function describeCommand(agent, cwd) {
  const { cmd, args } = agent.command({ cwd });
  return [cmd, ...args.map((a) => (/[\s"'()*]/.test(a) ? JSON.stringify(a) : a))].join(" ");
}
