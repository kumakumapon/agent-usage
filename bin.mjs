#!/usr/bin/env node
import { run } from './src/cli.mjs';

run(process.argv.slice(2)).catch((err) => {
  console.error(err.stack || err.message || err);
  process.exitCode = 1;
});
