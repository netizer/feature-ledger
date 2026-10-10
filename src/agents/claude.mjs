/**
 * Claude Code, run headless: `claude -p`, the prompt on stdin, events as
 * stream-json so progress can be shown while it works and the session id
 * caught for resuming it afterwards.
 *
 * Permissions are the narrowest set a ledger task needs: the ledger CLI, git
 * read commands for an audit's range, reading the codebase, and editing files
 * (a review and a redraft check reword entries in place). Anything else the
 * agent tries is refused rather than asked about, since nobody is at a prompt
 * to answer — and the refusals are reported at the end, with the resume
 * command, so the session can be picked up and finished by hand.
 */
const ALLOWED_TOOLS = [
  "Bash(ledger:*)", "Bash(npx ledger:*)", "Bash(npx feature-ledger:*)", "Bash(./tools/ledger:*)",
  "Bash(git log:*)", "Bash(git show:*)", "Bash(git diff:*)", "Bash(git status:*)", "Bash(git ls-files:*)",
  "Read", "Grep", "Glob", "Edit", "Write",
];

/** Said to the agent on top of the task: the shape a pre-approved command has
 *  to take. A chained command (`ledger add … ; ledger status`) doesn't match
 *  `Bash(ledger:*)` and is refused, with nobody there to approve it. */
const HEADLESS_NOTE = "You are running unattended: nobody can approve a tool call. Only `ledger`, `git log/show/diff/status/ls-files`, " +
  "reading files and editing files inside the project are pre-approved. Run each shell command on its own — never chain " +
  "commands with `;`, `&&` or `|` — and pass a JSON payload to `ledger` as a heredoc on that one command " +
  "(`ledger add <id> <<'JSON' … JSON`). Keep any file you write inside the project directory.";

export default {
  id: "claude",
  title: "Claude Code",
  install: "npm install -g @anthropic-ai/claude-code",

  command() {
    return {
      cmd: "claude",
      args: ["-p", "--output-format", "stream-json", "--verbose",
        "--permission-mode", "acceptEdits", "--allowedTools", ALLOWED_TOOLS.join(" "),
        "--append-system-prompt", HEADLESS_NOTE],
    };
  },

  parse(event) {
    if (event.type === "system" && event.subtype === "init") return [{ type: "session", id: event.session_id }];
    if (event.type === "assistant") {
      return (event.message?.content ?? []).flatMap((block) => {
        if (block.type === "text" && block.text?.trim()) return [{ type: "text", text: block.text }];
        if (block.type === "tool_use") return [{ type: "tool", name: block.name, detail: toolDetail(block) }];
        return [];
      });
    }
    if (event.type === "result") {
      const denied = (event.permission_denials ?? []).map((d) => `${d.tool_name}${d.tool_input?.command ? ` ${d.tool_input.command}` : ""}`);
      return [{
        type: "final",
        text: event.result ?? "",
        error: event.is_error ? (event.result || event.subtype) : null,
        session: event.session_id,
        denied,
        summary: [event.num_turns ? `${event.num_turns} turns` : null,
          event.total_cost_usd ? `$${event.total_cost_usd.toFixed(2)}` : null].filter(Boolean).join(" · "),
      }];
    }
    return [];
  },

  resume({ session }) {
    return session ? `claude --resume ${session}` : "claude --continue";
  },
};

function toolDetail(block) {
  const i = block.input ?? {};
  return i.command ?? i.file_path ?? i.pattern ?? i.path ?? "";
}
