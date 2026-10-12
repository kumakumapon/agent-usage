import test from 'node:test';
import assert from 'node:assert/strict';
import { clampToArea, cornerPosition, pickArea } from '../gui/placement.mjs';

const main = { x: 0, y: 0, width: 1920, height: 1040 };
const right = { x: 1920, y: 0, width: 1280, height: 1024 };
const left = { x: -1280, y: 100, width: 1280, height: 900 }; // negative coordinates
const size = { width: 380, height: 420 };

test('clampToArea leaves an in-bounds position alone', () => {
  assert.deepEqual(clampToArea({ x: 100, y: 100 }, size, main), { x: 100, y: 100 });
});

test('clampToArea pulls an overhanging window back inside', () => {
  assert.deepEqual(clampToArea({ x: 1800, y: 900 }, size, main), { x: 1540, y: 620 });
  assert.deepEqual(clampToArea({ x: -50, y: -50 }, size, main), { x: 0, y: 0 });
});

test('clampToArea handles work areas with an offset origin', () => {
  assert.deepEqual(clampToArea({ x: -2000, y: 0 }, size, left), { x: -1280, y: 100 });
});

test('clampToArea pins a window larger than the area to its top-left', () => {
  const tiny = { x: 10, y: 20, width: 100, height: 100 };
  assert.deepEqual(clampToArea({ x: 500, y: 500 }, size, tiny), { x: 10, y: 20 });
});

test('cornerPosition is the bottom-right corner with a margin', () => {
  assert.deepEqual(cornerPosition(size, main), { x: 1920 - 380 - 16, y: 1040 - 420 - 16 });
});

test('pickArea chooses the display with the largest overlap', () => {
  const rect = { x: 1800, y: 100, width: 380, height: 420 }; // 120px on main, 260px on right
  assert.equal(pickArea(rect, [main, right]), right);
  assert.equal(pickArea({ x: 100, y: 100, ...size }, [main, right]), main);
});

test('pickArea falls back to the nearest display when the window is off every screen', () => {
  // The monitor it was on (far right) is gone.
  const gone = { x: 6000, y: 200, ...size };
  assert.equal(pickArea(gone, [main, right]), right);
  const farLeft = { x: -9000, y: 200, ...size };
  assert.equal(pickArea(farLeft, [main, left]), left);
});

test('pickArea returns null with no displays', () => {
  assert.equal(pickArea({ x: 0, y: 0, ...size }, []), null);
});

test('a window stranded on a removed monitor ends up fully visible on the nearest one', () => {
  const stranded = { x: 6000, y: 200, ...size };
  const area = pickArea(stranded, [main, right]);
  assert.deepEqual(clampToArea(stranded, size, area), { x: 1920 + 1280 - 380, y: 200 });
});
