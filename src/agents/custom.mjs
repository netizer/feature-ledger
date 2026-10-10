/**
 * Any other agent: a command line, run through the shell with the prompt on
 * stdin and its output shown as it comes. Nothing is parsed, so there is no
 * session to name afterwards — the agent's own resume command applies.
 */
export function customAgent(commandLine) {
  return {
    id: "custom",
    title: commandLine,
    custom: true,
    command() {
      return { cmd: commandLine, args: [], shell: true };
    },
    parse: null,
    resume() {
      return null;
    },
  };
}
