import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectIncremental } from '../src/incremental.mjs';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-usage-inc-'));
  const file = path.join(dir, 'a.jsonl');
  const cacheDir = path.join(dir, 'cache');
  let parsed = 0;
  // Emits {n, model} per {"n":..} line; {"model":..} lines only update state.
  const run = (files = [{ filePath: file }], extra = {}) =>
    collectIncremental({
      cacheName: 't.json',
      cacheDir,
      files,
      newState: () => ({ model: 'unknown' }),
      parseEntry(entry, state, emit) {
        parsed++;
        if (entry.model) state.model = entry.model;
        if (entry.n !== undefined) emit({ n: entry.n, model: state.model });
      },
      ...extra,
    });
  return { dir, file, cacheDir, run, parsedCount: () => parsed, reset: () => { parsed = 0; } };
}

const lines = (...objs) => objs.map((o) => JSON.stringify(o)).join('\n') + '\n';
const flat = (res) => res.flatMap((f) => f.records);

test('parses a file, then reuses the cache without re-parsing when unchanged', async () => {
  const t = setup();
  fs.writeFileSync(t.file, lines({ model: 'm1' }, { n: 1 }, { n: 2 }));
  assert.deepEqual(flat(await t.run()), [{ n: 1, model: 'm1' }, { n: 2, model: 'm1' }]);
  assert.equal(t.parsedCount(), 3);

  t.reset();
  assert.deepEqual(flat(await t.run()), [{ n: 1, model: 'm1' }, { n: 2, model: 'm1' }]);
  assert.equal(t.parsedCount(), 0);
});

test('reads only appended lines and carries parser state across runs', async () => {
  const t = setup();
  fs.writeFileSync(t.file, lines({ model: 'm1' }, { n: 1 }));
  await t.run();

  fs.appendFileSync(t.file, lines({ n: 2 }, { model: 'm2' }, { n: 3 }));
  t.reset();
  assert.deepEqual(flat(await t.run()), [
    { n: 1, model: 'm1' },
    { n: 2, model: 'm1' },
    { n: 3, model: 'm2' },
  ]);
  assert.equal(t.parsedCount(), 3); // only the 3 new lines
});

test('leaves a half-written last line for the next run', async () => {
  const t = setup();
  fs.writeFileSync(t.file, lines({ n: 1 }) + '{"n":');
  assert.deepEqual(flat(await t.run()), [{ n: 1, model: 'unknown' }]);

  fs.appendFileSync(t.file, '2}\n');
  assert.deepEqual(flat(await t.run()), [
    { n: 1, model: 'unknown' },
    { n: 2, model: 'unknown' },
  ]);
});

test('counts a complete last line that has no trailing newline exactly once', async () => {
  const t = setup();
  fs.writeFileSync(t.file, lines({ n: 1 }) + '{"n":2}');
  assert.equal(flat(await t.run()).length, 2);
  assert.equal(flat(await t.run()).length, 2);
  fs.appendFileSync(t.file, '\n' + lines({ n: 3 }));
  assert.deepEqual(flat(await t.run()).map((r) => r.n), [1, 2, 3]);
});

test('handles CRLF line endings and skips malformed lines', async () => {
  const t = setup();
  fs.writeFileSync(t.file, '{"n":1}\r\nnot json\r\n{"n":2}\r\n');
  assert.deepEqual(flat(await t.run()).map((r) => r.n), [1, 2]);
});

test('re-parses from scratch when the file shrinks', async () => {
  const t = setup();
  fs.writeFileSync(t.file, lines({ n: 1 }, { n: 2 }, { n: 3 }));
  await t.run();
  fs.writeFileSync(t.file, lines({ n: 9 }));
  assert.deepEqual(flat(await t.run()), [{ n: 9, model: 'unknown' }]);
});

test('drops cache entries for files that no longer exist', async () => {
  const t = setup();
  const second = path.join(t.dir, 'b.jsonl');
  fs.writeFileSync(t.file, lines({ n: 1 }));
  fs.writeFileSync(second, lines({ n: 2 }));
  await t.run([{ filePath: t.file }, { filePath: second }]);
  await t.run([{ filePath: t.file }]);
  const cache = JSON.parse(fs.readFileSync(path.join(t.cacheDir, 't.json'), 'utf8'));
  assert.deepEqual(Object.keys(cache.files), [t.file]);
});

test('useCache:false neither reads nor writes the cache', async () => {
  const t = setup();
  fs.writeFileSync(t.file, lines({ n: 1 }));
  await t.run(undefined, { useCache: false });
  t.reset();
  await t.run(undefined, { useCache: false });
  assert.equal(t.parsedCount(), 1);
  assert.equal(fs.existsSync(path.join(t.cacheDir, 't.json')), false);
});

test('ignores a corrupt or wrong-version cache', async () => {
  const t = setup();
  fs.writeFileSync(t.file, lines({ n: 1 }));
  fs.mkdirSync(t.cacheDir, { recursive: true });
  fs.writeFileSync(path.join(t.cacheDir, 't.json'), '{ nope');
  assert.deepEqual(flat(await t.run()), [{ n: 1, model: 'unknown' }]);
  fs.writeFileSync(path.join(t.cacheDir, 't.json'), JSON.stringify({ version: 999, files: {} }));
  assert.deepEqual(flat(await t.run()), [{ n: 1, model: 'unknown' }]);
});
