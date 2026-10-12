import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, parseCliArgs, resolveTools } from '../src/args.mjs';
import { run } from '../src/cli.mjs';

const BIN = fileURLToPath(new URL('../bin.mjs', import.meta.url));

// ---- parsing -------------------------------------------------------------

test('no arguments, or an explicit command, still works', () => {
  assert.equal(parseCliArgs([]).command, 'limits');
  assert.equal(parseCliArgs(['limits']).command, 'limits');
  assert.equal(parseCliArgs(['usage']).command, 'usage');
  assert.equal(parseCliArgs(['usage', '--no-limits']).limits, false);
  assert.equal(parseCliArgs(['--no-cache']).cache, false);
});

test('tool selection: default, list, single, all', () => {
  assert.deepEqual(parseCliArgs([]).tools, ['claude', 'codex']);
  assert.deepEqual(resolveTools('codex'), ['codex']);
  assert.deepEqual(resolveTools('codex,claude'), ['codex', 'claude']);
  assert.deepEqual(resolveTools('claude,claude'), ['claude']);
  assert.deepEqual(resolveTools('all'), ['claude', 'codex', 'antigravity']);
  assert.deepEqual(parseCliArgs(['--tool', 'antigravity']).tools, ['antigravity']);
});

const BAD = [
  [['usgae'], /unknown command "usgae".*did you mean "usage"/],
  [['limits', 'extra'], /unexpected extra argument: "extra"/],
  [['usage', 'limits'], /unexpected extra argument: "limits"/],
  [['limits', '--tool', 'cdoex', '--json'], /unknown tool "cdoex".*did you mean "codex".*valid tools: claude, codex, antigravity, all/],
  [['limits', '--tool', 'claude,,codex'], /empty tool name/],
  [['--tool', ''], /empty tool name/],
  [['--tool', 'all,claude'], /cannot be combined/],
  [['--tool', 'claude,all'], /cannot be combined/],
  [['--bogus'], /Unknown option '--bogus'/],
  [['--tool'], /argument missing/],
];

for (const [argv, message] of BAD) {
  test(`rejects: agent-usage ${argv.join(' ')}`, () => {
    assert.throws(() => parseCliArgs(argv), (err) => {
      assert.ok(err instanceof UsageError, `expected UsageError, got ${err}`);
      assert.match(err.message, message);
      return true;
    });
  });
}

test('--help wins over a bad command or option', () => {
  assert.equal(parseCliArgs(['usgae', '--help']).help, true);
  assert.equal(parseCliArgs(['--bogus', '-h']).help, true);
});

// ---- run(): nothing is touched on bad input ------------------------------

function stubs() {
  const calls = [];
  const spy = (name, value) => async (...args) => {
    calls.push(name);
    return typeof value === 'function' ? value(...args) : value;
  };
  const windows = { fetchedAt: '2026-08-20T00:00:00.000Z', windows: [{ window: 'weekly', percent: 5, resetsAt: null }] };
  return {
    calls,
    deps: {
      collectClaudeUsage: spy('collectClaudeUsage', []),
      collectCodexUsage: spy('collectCodexUsage', []),
      collectAntigravityActivity: () => {
        calls.push('collectAntigravityActivity');
        return { available: false, note: 'stub' };
      },
      readClaudeRateLimit: spy('readClaudeRateLimit', windows),
      readCodexRateLimit: spy('readCodexRateLimit', windows),
      readAntigravityRateLimit: spy('readAntigravityRateLimit', windows),
      loadPricing: () => {
        calls.push('loadPricing');
        return {};
      },
    },
  };
}

const quiet = (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
};

for (const [argv] of BAD) {
  test(`run() rejects "${argv.join(' ')}" before any reader, live query or pricing file`, async (t) => {
    quiet(t);
    const { calls, deps } = stubs();
    await assert.rejects(run(argv, deps), UsageError);
    assert.deepEqual(calls, []);
  });
}

test('run() with no arguments queries claude and codex rate limits only', async (t) => {
  quiet(t);
  const { calls, deps } = stubs();
  await run([], deps);
  assert.deepEqual(calls.sort(), ['readClaudeRateLimit', 'readCodexRateLimit']);
});

test('run() limits --tool all includes antigravity', async (t) => {
  quiet(t);
  const { calls, deps } = stubs();
  await run(['limits', '--tool', 'all'], deps);
  assert.deepEqual(calls.sort(), ['readAntigravityRateLimit', 'readClaudeRateLimit', 'readCodexRateLimit']);
});

test('run() usage --no-limits stays local: no live rate-limit queries', async (t) => {
  quiet(t);
  const { calls, deps } = stubs();
  await run(['usage', '--no-limits'], deps);
  assert.deepEqual(calls.sort(), ['collectClaudeUsage', 'collectCodexUsage', 'loadPricing']);
});

test('run() usage --tool codex,claude --no-limits reads only those', async (t) => {
  quiet(t);
  const { calls, deps } = stubs();
  await run(['usage', '--tool', 'codex', '--no-limits'], deps);
  assert.deepEqual(calls.sort(), ['collectCodexUsage', 'loadPricing']);
});

test('run() --help prints help and touches nothing', async (t) => {
  const printed = [];
  t.mock.method(console, 'log', (text) => printed.push(text));
  const { calls, deps } = stubs();
  await run(['usgae', '--help'], deps);
  assert.match(printed.join('\n'), /Usage: agent-usage/);
  assert.deepEqual(calls, []);
});

// ---- the real binary -----------------------------------------------------

function runBin(args) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-usage-bin-'));
  const result = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    // An empty HOME keeps this away from real logs, and any file the CLI
    // creates (pricing.json, cache) would show up in it.
    env: { ...process.env, HOME: home, USERPROFILE: home, PATH: '' },
  });
  return { ...result, home };
}

for (const args of [['usgae'], ['limits', '--tool', 'cdoex', '--json'], ['limits', '--tool', 'claude,,codex']]) {
  test(`bin: "${args.join(' ')}" exits 2 with the reason on stderr and nothing on stdout`, () => {
    const { status, stdout, stderr, home } = runBin(args);
    assert.equal(status, 2);
    assert.equal(stdout, '', 'must not print an empty JSON result as if it succeeded');
    assert.match(stderr, /^agent-usage: /);
    assert.deepEqual(fs.readdirSync(home), [], 'must not create ~/.agent-usage');
  });
}

test('bin: --help exits 0', () => {
  const { status, stdout } = runBin(['--help']);
  assert.equal(status, 0);
  assert.match(stdout, /Usage: agent-usage/);
});
