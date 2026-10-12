import test from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from '../src/run-cli.mjs';

const node = process.execPath;

test('resolves with stdout on exit code 0', async () => {
  assert.equal(await runCli(node, ['-e', 'process.stdout.write("hello")']), 'hello');
});

test('rejects with stderr when the CLI exits non-zero', async () => {
  await assert.rejects(
    runCli(node, ['-e', 'console.error("boom"); process.exit(2)']),
    { message: 'boom' },
  );
});

test('falls back to the exit code when stderr is empty', async () => {
  await assert.rejects(runCli(node, ['-e', 'process.exit(3)']), (err) => {
    assert.match(err.message, /exited with code 3/);
    return true;
  });
});

test('rejects with ENOENT when the command does not exist', async () => {
  await assert.rejects(runCli('agent-usage-no-such-command', []), { code: 'ENOENT' });
});

test('times out and kills a hung CLI', async () => {
  const started = Date.now();
  await assert.rejects(
    runCli(node, ['-e', 'setTimeout(() => {}, 60000)'], { timeoutMs: 300 }),
    (err) => {
      assert.match(err.message, /timed out waiting for/);
      return true;
    },
  );
  assert.ok(Date.now() - started < 10_000, 'should not wait for the child to finish');
});
