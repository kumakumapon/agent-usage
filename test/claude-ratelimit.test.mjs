import test from 'node:test';
import assert from 'node:assert/strict';
import { parseResetStamp, parseUsageText } from '../src/claude-ratelimit.mjs';

const NOW = new Date('2026-08-20T00:00:00.000Z');

test('parseResetStamp converts a Tokyo wall-clock time to UTC', () => {
  assert.equal(parseResetStamp('Aug 26, 2:09am', 'Asia/Tokyo', NOW), '2026-08-25T17:09:00.000Z');
});

test('parseResetStamp has no stray milliseconds when now has them', () => {
  const now = new Date('2026-08-20T00:00:00.962Z');
  assert.equal(parseResetStamp('Aug 26, 2:09am', 'Asia/Tokyo', now), '2026-08-25T17:09:00.000Z');
});

test('parseResetStamp handles pm, 12am and 12pm', () => {
  assert.equal(parseResetStamp('Aug 26, 3pm', 'UTC', NOW), '2026-08-26T15:00:00.000Z');
  assert.equal(parseResetStamp('Aug 26, 12am', 'UTC', NOW), '2026-08-26T00:00:00.000Z');
  assert.equal(parseResetStamp('Aug 26, 12pm', 'UTC', NOW), '2026-08-26T12:00:00.000Z');
});

test('parseResetStamp honours DST (America/New_York)', () => {
  assert.equal(parseResetStamp('Aug 26, 9am', 'America/New_York', NOW), '2026-08-26T13:00:00.000Z');
  const winter = new Date('2026-12-01T00:00:00.000Z');
  assert.equal(parseResetStamp('Dec 5, 9am', 'America/New_York', winter), '2026-12-05T14:00:00.000Z');
});

test('parseResetStamp rolls over to next year for a date long past', () => {
  const now = new Date('2026-12-30T00:00:00.000Z');
  assert.equal(parseResetStamp('Jan 2, 1am', 'UTC', now), '2027-01-02T01:00:00.000Z');
});

test('parseResetStamp returns null for unparseable text or bad zone', () => {
  assert.equal(parseResetStamp('tomorrow', 'UTC', NOW), null);
  assert.equal(parseResetStamp('Foo 26, 2am', 'UTC', NOW), null);
  assert.equal(parseResetStamp('Aug 26, 2am', 'Not/AZone', NOW), null);
});

test('parseUsageText extracts session and weekly windows', () => {
  const text = [
    'Current session: 8% used · resets Aug 26, 2:09am (Asia/Tokyo)',
    'Current week (all models): 4% used · resets Aug 30, 12am (Asia/Tokyo)',
    'Current week (Opus): 1% used',
  ].join('\n');
  assert.deepEqual(parseUsageText(text, NOW), [
    { window: 'session (5h)', percent: 8, resetsAt: '2026-08-25T17:09:00.000Z' },
    { window: 'weekly', percent: 4, resetsAt: '2026-08-29T15:00:00.000Z' },
    { window: 'weekly (Opus)', percent: 1, resetsAt: null },
  ]);
});

test('parseUsageText is repeatable (no regex lastIndex leakage)', () => {
  const text = 'Current session: 10% used';
  assert.equal(parseUsageText(text, NOW).length, 1);
  assert.equal(parseUsageText(text, NOW).length, 1);
});

test('parseUsageText returns [] when there are no usage lines', () => {
  assert.deepEqual(parseUsageText('nothing to see here', NOW), []);
});
