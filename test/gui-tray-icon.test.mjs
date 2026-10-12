import test from 'node:test';
import assert from 'node:assert/strict';
import { levelOf, renderTrayIcon } from '../gui/tray-icon.mjs';

// BGRA pixel at (x, y)
const px = (icon, x, y) => [...icon.buffer.subarray((y * icon.width + x) * 4, (y * icon.width + x) * 4 + 4)];
const rgbAt = (icon, x, y) => {
  const [b, g, r] = px(icon, x, y);
  return [r, g, b];
};
const MID = 16;
const filledRows = (icon, color) => {
  let n = 0;
  for (let y = 0; y < icon.height; y++) {
    if (rgbAt(icon, MID, y).every((v, i) => v === color[i])) n++;
  }
  return n;
};

test('levelOf matches the widget cut-offs', () => {
  assert.equal(levelOf(0), 'ok');
  assert.equal(levelOf(69), 'ok');
  assert.equal(levelOf(70), 'warn');
  assert.equal(levelOf(89), 'warn');
  assert.equal(levelOf(90), 'crit');
});

test('buffer is size*size BGRA and the corners are transparent', () => {
  const icon = renderTrayIcon(50);
  assert.equal(icon.buffer.length, 32 * 32 * 4);
  assert.equal(px(icon, 0, 0)[3], 0);
  assert.equal(px(icon, MID, MID)[3], 255);
});

test('fill height grows with percent', () => {
  const green = [0x4c, 0xaf, 0x50];
  const a = filledRows(renderTrayIcon(25), green);
  const b = filledRows(renderTrayIcon(50), green);
  assert.ok(a > 0 && b > a);
  assert.equal(filledRows(renderTrayIcon(0), green), 0);
});

test('colour follows the level', () => {
  const bottom = (p) => rgbAt(renderTrayIcon(p), MID, 27);
  assert.deepEqual(bottom(30), [0x4c, 0xaf, 0x50]);
  assert.deepEqual(bottom(75), [0xf5, 0xa6, 0x23]);
  assert.deepEqual(bottom(95), [0xe5, 0x48, 0x4d]);
});

test('no data draws an empty grey track, and out-of-range values clamp', () => {
  assert.deepEqual(rgbAt(renderTrayIcon(null), MID, 27), [0x3a, 0x3f, 0x4b]);
  assert.deepEqual(renderTrayIcon(250).buffer, renderTrayIcon(100).buffer);
  assert.deepEqual(renderTrayIcon(-5).buffer, renderTrayIcon(0).buffer);
});
