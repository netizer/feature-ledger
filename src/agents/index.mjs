import { usage, nearest } from "../util.mjs";
import claude from "./claude.mjs";
import codex from "./codex.mjs";
import gemini from "./gemini.mjs";
import { customAgent } from "./custom.mjs";

/**
 * The coding agents `--run` knows how to drive. Each one is a module of its
 * own, with the same four parts: the command line that runs it headless with
 * the prompt on stdin, a parser for its event stream, how to resume the
 * session it leaves behind, and how to install it. Adding an agent is adding
 * a file here; nothing outside this directory knows one from another.
 */
export const AGENTS = { claude, codex, gemini };

/**
 * The agent a `--run` asked for. Never a default: a bare `--run` uses
 * $LEDGER_AGENT or the project's "agent" setting, and refuses when neither is
 * set, so nothing is handed to an agent unless someone typed --run.
 *
 * Anything that isn't a known name is a command line of its own, run with the
 * prompt on stdin. Except a single word within two letters of a known name,
 * which is far more likely a typo than an agent called "cluade".
 */
export function resolveAgent(spec, config = {}) {
  let name = spec === true ? (process.env.LEDGER_AGENT || config.agent || null) : String(spec).trim();
  if (!name) {
    usage(`--run needs an agent: ${Object.keys(AGENTS).join(", ")}, or a command line in quotes that reads ` +
      "the prompt on stdin.\n  To make a bare --run pick one, set $LEDGER_AGENT or \"agent\" in .ledger/config.json.");
  }
  name = String(name).trim();
  if (AGENTS[name]) return AGENTS[name];
  if (!/\s/.test(name)) {
    const near = nearest(name, Object.keys(AGENTS));
    if (near) usage(`unknown agent "${name}" — did you mean ${near}? (known: ${Object.keys(AGENTS).join(", ")})`);
  }
  return customAgent(name);
}
