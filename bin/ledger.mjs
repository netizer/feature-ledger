#!/usr/bin/env node
import { main } from "../src/cli.mjs";

// `ledger list | head` closes the pipe early. That is a normal way to read a
// long listing, not a crash, so it exits quietly instead of printing a stack.
process.stdout.on("error", (e) => {
  if (e.code === "EPIPE") process.exit(0);
  throw e;
});

main(process.argv.slice(2)).catch((err) => {
  // Errors thrown anywhere in here are meant to be read by a person (or an
  // agent) and acted on, so they print as one plain line — no stack, unless
  // something genuinely unexpected blew up.
  const msg = err?.message ?? String(err);
  process.stderr.write(`ledger: ${msg}\n`);
  if (process.env.LEDGER_DEBUG) process.stderr.write(`${err?.stack ?? ""}\n`);
  process.exit(err?.exitCode ?? 1);
});
