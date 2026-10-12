import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAgyUsage } from '../src/antigravity-ratelimit.mjs';

const NOW = new Date('2026-08-20T00:00:00.000Z');

test('maps groups and buckets, shortening group names', () => {
  const out = normalizeAgyUsage(
    {
      command: {
        data: {
          groups: [
            {
              name: 'Claude and GPT Models',
              buckets: [{ window: '5h', remaining_fraction: 0.75, reset_time: '2026-08-20T05:00:00Z' }],
            },
            { name: 'Gemini Models', buckets: [{ name: 'daily', remaining_fraction: 1 }] },
          ],
        },
      },
    },
    NOW,
  );
  assert.equal(out.fetchedAt, '2026-08-20T00:00:00.000Z');
  assert.deepEqual(out.windows, [
    { window: 'Claude/GPT 5h', percent: 25, resetsAt: '2026-08-20T05:00:00Z' },
    { window: 'Gemini daily', percent: 0, resetsAt: null },
  ]);
});

test('percent is null when remaining_fraction is missing', () => {
  const out = normalizeAgyUsage({ command: { data: { groups: [{ name: 'X', buckets: [{ window: 'w' }] }] } } }, NOW);
  assert.equal(out.windows[0].percent, null);
});

test('reports an error for an unexpected response shape', () => {
  assert.match(normalizeAgyUsage({}).error, /unexpected/);
  assert.match(normalizeAgyUsage(null).error, /unexpected/);
});
