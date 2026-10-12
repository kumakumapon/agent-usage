import test from 'node:test';
import assert from 'node:assert/strict';
import { alertText, createAlertTracker, formatReset, normalizeThresholds } from '../gui/alerts.mjs';

const T = [80, 95];
const res = (percent, extra = {}) => ({ claude: { windows: [{ window: 'weekly', percent, resetsAt: null }], ...extra } });

test('first reading is a silent baseline, even above a threshold', () => {
  const tracker = createAlertTracker();
  assert.deepEqual(tracker.evaluate(res(90), T), []);
});

test('alerts once per threshold crossing, not on every poll', () => {
  const tracker = createAlertTracker();
  tracker.evaluate(res(50), T);
  assert.equal(tracker.evaluate(res(81), T).length, 1);
  assert.equal(tracker.evaluate(res(83), T).length, 0);
  const second = tracker.evaluate(res(96), T);
  assert.equal(second.length, 1);
  assert.equal(second[0].threshold, 95);
});

test('jumping past both thresholds alerts once, at the highest', () => {
  const tracker = createAlertTracker();
  tracker.evaluate(res(10), T);
  const alerts = tracker.evaluate(res(97), T);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].threshold, 95);
});

test('re-arms after the window resets', () => {
  const tracker = createAlertTracker();
  tracker.evaluate(res(10), T);
  tracker.evaluate(res(85), T);
  tracker.evaluate(res(2), T); // reset
  assert.equal(tracker.evaluate(res(82), T).length, 1);
});

test('windows are tracked independently per tool and window', () => {
  const tracker = createAlertTracker();
  const at = (a, b) => ({
    claude: { windows: [{ window: 'weekly', percent: a }] },
    codex: { windows: [{ window: 'weekly', percent: b }] },
  });
  tracker.evaluate(at(10, 10), T);
  const alerts = tracker.evaluate(at(85, 10), T);
  assert.deepEqual(alerts.map((a) => a.tool), ['claude']);
});

test('ignores stale data, errors and null percentages', () => {
  const tracker = createAlertTracker();
  tracker.evaluate(res(10), T);
  assert.deepEqual(tracker.evaluate(res(99, { stale: true }), T), []);
  assert.deepEqual(tracker.evaluate({ claude: { error: 'x' } }, T), []);
  assert.deepEqual(tracker.evaluate(res(null), T), []);
});

test('normalizeThresholds keeps valid numbers, sorted and unique', () => {
  assert.deepEqual(normalizeThresholds([95, 80, 80, 'x', 0, 101, 50]), [50, 80, 95]);
  assert.equal(normalizeThresholds([]), null);
  assert.equal(normalizeThresholds('80'), null);
  assert.equal(normalizeThresholds([0, 'a']), null);
});

test('alertText and formatReset', () => {
  const now = Date.parse('2026-08-20T00:00:00Z');
  assert.equal(formatReset('2026-08-20T02:00:00Z', now), 'resets in 2h');
  assert.equal(formatReset('2026-08-20T00:30:00Z', now), 'resets in 30m');
  assert.equal(formatReset('2026-08-27T00:00:00Z', now), 'resets in 7d');
  assert.equal(formatReset('2026-08-19T00:00:00Z', now), 'resets soon');
  assert.equal(formatReset(null, now), '');
  const text = alertText(
    { window: 'session (5h)', percent: 82, threshold: 80, resetsAt: '2026-08-20T02:00:00Z' },
    'Claude Code',
    now,
  );
  assert.deepEqual(text, { title: 'Claude Code: session (5h) at 82%', body: 'Passed 80% of the limit. resets in 2h' });
});
