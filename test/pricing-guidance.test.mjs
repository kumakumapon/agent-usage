import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasUnpricedRows, pricingHelp } from '../src/pricing.mjs';
import { run } from '../src/cli.mjs';

const BIN = fileURLToPath(new URL('../bin.mjs', import.meta.url));
const FILE = '/home/me/.agent-usage/pricing.json';

// ---- the helpers ---------------------------------------------------------

test('hasUnpricedRows: true until every row has a rate', () => {
  const rows = [{ model: 'm1', input: 5, output: 5, cacheWrite: 0, cacheRead: 0 }];
  assert.equal(hasUnpricedRows({}, 'claude', rows), true);
  assert.equal(hasUnpricedRows({ claude: { m1: { input: 1, output: 1 } } }, 'claude', rows), false);
  assert.equal(hasUnpricedRows({ claude: { other: { input: 1 } } }, 'claude', rows), true);
  assert.equal(hasUnpricedRows({}, 'claude', []), false);
});

test('hasUnpricedRows knows codex rate names', () => {
  const rows = [{ model: 'c1', input: 5, cachedInput: 2, output: 1 }];
  assert.equal(hasUnpricedRows({ codex: { c1: { cachedInput: 1 } } }, 'codex', rows), false);
  assert.equal(hasUnpricedRows({ codex: {} }, 'codex', rows), true);
});

test('hasUnpricedRows flags any single unpriced row', () => {
  const rows = [
    { model: 'priced', input: 1, output: 1, cacheWrite: 0, cacheRead: 0 },
    { model: 'unpriced', input: 1, output: 1, cacheWrite: 0, cacheRead: 0 },
  ];
  assert.equal(hasUnpricedRows({ claude: { priced: { input: 1 } } }, 'claude', rows), true);
});

test('pricingHelp: path, format, where model names come from, update advice, pricing pages', () => {
  const text = pricingHelp(FILE);
  assert.ok(text.includes(FILE));
  assert.match(text, /"claude": \{ "<model>": \{ "input": <usd>, "output": <usd>, "cacheWrite": <usd>, "cacheRead": <usd> \}/);
  assert.match(text, /"codex": +\{ "<model>": \{ "input": <usd>, "cachedInput": <usd>, "output": <usd> \}/);
  assert.match(text, /first column of `agent-usage usage`/);
  assert.match(text, /edit the numbers in that file/);
  assert.match(text, /https:\/\/claude\.com\/pricing/);
  assert.match(text, /https:\/\/openai\.com\/api\/pricing\//);
});

test('pricingHelp contains no prices', () => {
  const text = pricingHelp(FILE);
  assert.doesNotMatch(text, /\$\s?\d/, 'no dollar amounts');
  assert.doesNotMatch(text, /"(input|output|cacheWrite|cacheRead|cachedInput)":\s*\d/, 'no numeric rates');
});

// ---- run() ---------------------------------------------------------------

function capture(t) {
  const out = [];
  const err = [];
  t.mock.method(console, 'log', (...args) => out.push(args.join(' ')));
  t.mock.method(console, 'error', (...args) => err.push(args.join(' ')));
  return { out, err };
}

const record = (model) => ({
  project: 'p',
  sessionId: 's1',
  model,
  timestamp: '2026-08-01T00:00:00.000Z',
  input: 100,
  output: 50,
  cacheWrite: 0,
  cacheRead: 0,
  cachedInput: 0,
  reasoningOutput: 0,
});

const base = (pricing, models = ['m1']) => ({
  loadPricing: () => pricing,
  collectClaudeUsage: async () => models.map(record),
  collectCodexUsage: async () => [],
  isInteractive: () => true,
});

test('--pricing in a terminal: path on stdout, guidance on stderr', async (t) => {
  const { out, err } = capture(t);
  await run(['--pricing'], base({}));
  assert.equal(out.length, 1, 'stdout is just the path');
  assert.match(out[0], /pricing\.json$/);
  assert.match(err.join('\n'), /Cost estimates use rates you provide/);
  assert.match(err.join('\n'), /"<model>"/);
});

test('--pricing piped or scripted: only the path, nothing on stderr', async (t) => {
  const { out, err } = capture(t);
  await run(['--pricing'], { ...base({}), isInteractive: () => false });
  assert.equal(out.length, 1);
  assert.deepEqual(err, []);
});

test('usage with an unpriced model prints the one-line reminder', async (t) => {
  const { out } = capture(t);
  await run(['usage', '--no-limits', '--tool', 'claude'], base({}));
  const text = out.join('\n');
  assert.match(text, /Cost shows "—" for models with no rate set/);
  assert.match(text, /agent-usage --pricing/);
  assert.equal(out.filter((line) => /Cost shows "—"/.test(line)).length, 1, 'once');
});

test('usage with every model priced prints no reminder', async (t) => {
  const { out } = capture(t);
  await run(['usage', '--no-limits', '--tool', 'claude'], base({ claude: { m1: { input: 1, output: 1 } } }));
  assert.doesNotMatch(out.join('\n'), /Cost shows "—"/);
});

test('one unpriced model among priced ones still prints it', async (t) => {
  const { out } = capture(t);
  await run(
    ['usage', '--no-limits', '--tool', 'claude'],
    base({ claude: { m1: { input: 1, output: 1 } } }, ['m1', 'm2']),
  );
  assert.match(out.join('\n'), /Cost shows "—"/);
});

test('--json output is unchanged: no reminder', async (t) => {
  const { out } = capture(t);
  await run(['usage', '--no-limits', '--tool', 'claude', '--json'], base({}));
  const text = out.join('\n');
  assert.doesNotMatch(text, /Cost shows/);
  assert.doesNotThrow(() => JSON.parse(text));
});

// ---- the real binary and the file it creates -----------------------------

test('bin --pricing creates a template that holds no prices', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-usage-pricing-'));
  const result = spawnSync(process.execPath, [BIN, '--pricing'], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  assert.equal(result.status, 0);
  const file = path.join(home, '.agent-usage', 'pricing.json');
  assert.equal(result.stdout.trim(), file, 'stdout stays just the path');

  const template = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(template.claude, {});
  assert.deepEqual(template.codex, {});
  const comment = template._comment.join('\n');
  assert.match(comment, /first column of\s+`agent-usage usage`/);
  assert.match(comment, /"claude": \{ "<model>"/);
  assert.doesNotMatch(comment, /opus|gpt-|sonnet|haiku/i, 'no model names that look like real entries');
});
