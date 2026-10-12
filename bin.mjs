#!/usr/bin/env node
import { run } from './src/cli.mjs';
import { UsageError } from './src/args.mjs';

run(process.argv.slice(2)).catch((err) => {
  if (err instanceof UsageError) {
    // A mistake in the command line: say what is wrong, briefly.
    console.error(`agent-usage: ${err.message}`);
    console.error('Run `agent-usage --help` for usage.');
    process.exitCode = 2;
    return;
  }
  console.error(err.stack || err.message || err);
  process.exitCode = 1;
});
