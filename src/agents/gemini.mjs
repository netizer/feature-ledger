/**
 * Gemini CLI, run headless. The task goes in on stdin, which Gemini appends
 * to the `-p` prompt, and `--output-format stream-json` prints one event per
 * line. Edits are approved automatically; shell commands only for the ledger
 * CLI and git, which is all a ledger task needs.
 *
 * Written against the Gemini CLI's documented headless mode and not yet run
 * against a live install, so the parser takes what it recognises and passes
 * everything else through.
 */
export default {
  id: "gemini",
  title: "Gemini CLI",
  install: "npm install -g @google/gemini-cli",

  command() {
    return {
      cmd: "gemini",
      args: ["--output-format", "stream-json", "--approval-mode", "auto_edit",
        "--allowed-tools", "run_shell_command(ledger)", "--allowed-tools", "run_shell_command(git)",
        "-p", "Carry out the task given on stdin, from start to finish."],
    };
  },

  parse(event) {
    if (event.type === "init" && event.session_id) return [{ type: "session", id: event.session_id }];
    if (event.type === "message" && event.role === "assistant" && event.content?.trim()) {
      return [{ type: "text", text: event.content, delta: Boolean(event.delta) }];
    }
    if (event.type === "tool_use") {
      const p = event.parameters ?? {};
      return [{ type: "tool", name: event.tool_name ?? "tool", detail: p.command ?? p.file_path ?? p.path ?? "" }];
    }
    if (event.type === "error") return [{ type: "error", text: event.message ?? "the run failed" }];
    if (event.type === "result") {
      return [{ type: "final", text: event.response ?? null, error: event.status === "error" ? (event.error?.message ?? "the run failed") : null }];
    }
    return [];
  },

  resume({ session }) {
    return `gemini --resume ${session ?? "latest"}`;
  },
};
