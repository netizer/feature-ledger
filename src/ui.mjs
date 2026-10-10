/**
 * The few marks the CLI draws for a person: ✓ and ✗ on a checklist, a dim
 * line for an agent's progress, a red "error:". Colour only when the stream
 * is a terminal and NO_COLOR isn't set (https://no-color.org), so a pipe, a
 * log file or an agent reading the output gets plain text.
 */
const wantsColor = (stream) => Boolean(stream?.isTTY) && !("NO_COLOR" in process.env) && process.env.TERM !== "dumb";

const paint = (code, stream) => (s) => (wantsColor(stream) ? `\x1b[${code}m${s}\x1b[0m` : String(s));

export const color = (stream = process.stdout) => ({
  green: paint("32", stream),
  red: paint("31", stream),
  yellow: paint("33", stream),
  dim: paint("2", stream),
  bold: paint("1", stream),
});

/** "✓" or "✗", coloured for the stream it's going to. */
export function mark(ok, stream = process.stdout) {
  const c = color(stream);
  return ok ? c.green("✓") : c.red("✗");
}
