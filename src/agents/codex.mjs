/**
 * OpenAI Codex CLI, run headless: `codex exec -` reads the prompt from stdin,
 * and `--json` prints one event per line. The sandbox is `workspace-write`:
 * the agent can run commands and edit files inside the project, and nothing
 * outside it. `codex exec` never stops to ask, so that boundary is the whole
 * of what it is allowed.
 */
export default {
  id: "codex",
  title: "Codex CLI",
  install: "npm install -g @openai/codex",

  command({ cwd }) {
    return { cmd: "codex", args: ["exec", "--json", "--sandbox", "workspace-write", "--cd", cwd, "-"] };
  },

  parse(event) {
    if (event.type === "thread.started") return [{ type: "session", id: event.thread_id }];
    const item = event.item;
    if (event.type === "item.completed" && item) {
      if (item.type === "agent_message" && item.text?.trim()) return [{ type: "text", text: item.text }];
      if (item.type === "command_execution") return [{ type: "tool", name: "shell", detail: item.command ?? "" }];
      if (item.type === "file_change") {
        return [{ type: "tool", name: "edit", detail: (item.changes ?? []).map((c) => c.path).join(", ") }];
      }
    }
    if (event.type === "turn.failed" || event.type === "error") {
      return [{ type: "error", text: event.error?.message ?? event.message ?? "the run failed" }];
    }
    return [];
  },

  resume({ session }) {
    return session ? `codex resume ${session}` : "codex resume --last";
  },
};
