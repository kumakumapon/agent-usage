import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCodexRateLimits } from '../src/codex-ratelimit.mjs';

const NOW = new Date('2026-08-20T00:00:00.000Z');

test('maps primary and secondary windows', () => {
  const out = normalizeCodexRateLimits(
    {
      rateLimits: {
        planType: 'plus',
        primary: { usedPercent: 2, windowDurationMins: 300, resetsAt: 1787500800 },
        secondary: { usedPercent: 40, windowDurationMins: 10080 },
        credits: { hasCredits: false },
      },
    },
    NOW,
  );
  assert.equal(out.fetchedAt, '2026-08-20T00:00:00.000Z');
  assert.equal(out.planType, 'plus');
  assert.deepEqual(out.windows, [
    { window: 'primary', percent: 2, resetsAt: '2026-08-23T16:00:00.000Z', windowMinutes: 300 },
    { window: 'secondary', percent: 40, resetsAt: null, windowMinutes: 10080 },
  ]);
  assert.deepEqual(out.credits, { hasCredits: false });
});

test('omits absent windows and defaults missing fields to null', () => {
  const out = normalizeCodexRateLimits({ rateLimits: { primary: {} } }, NOW);
  assert.deepEqual(out.windows, [{ window: 'primary', percent: null, resetsAt: null, windowMinutes: null }]);
  assert.equal(out.planType, null);
  assert.equal(out.credits, null);
});

test('reports an error for an unexpected response shape', () => {
  assert.match(normalizeCodexRateLimits({}).error, /unexpected/);
  assert.match(normalizeCodexRateLimits(undefined).error, /unexpected/);
});
