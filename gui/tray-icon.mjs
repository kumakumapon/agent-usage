// Draws the tray icon as a raw bitmap so it can show the current worst usage
// at a glance (no image files or canvas dependency). Pure and Electron-free
// so it can be unit-tested.

export const ICON_SIZE = 32; // drawn at 2x; shown as 16 DIP

const BACKGROUND = [0x1e, 0x22, 0x2a];
const TRACK = [0x3a, 0x3f, 0x4b];
const NO_DATA = [0x6b, 0x71, 0x80];
const LEVELS = { ok: [0x4c, 0xaf, 0x50], warn: [0xf5, 0xa6, 0x23], crit: [0xe5, 0x48, 0x4d] };

// Same cut-offs as the widget's bars (renderer.mjs levelClass).
export function levelOf(percent) {
  if (percent >= 90) return 'crit';
  if (percent >= 70) return 'warn';
  return 'ok';
}

/**
 * A vertical gauge: the bar fills from the bottom in proportion to
 * `percent`, coloured by level. `null`/non-numeric draws an empty grey track.
 * @param {number|null} percent
 * @param {number} [size]
 * @returns {{width: number, height: number, buffer: Buffer}} BGRA pixels
 */
export function renderTrayIcon(percent, size = ICON_SIZE) {
  const hasData = typeof percent === 'number' && Number.isFinite(percent);
  const clamped = hasData ? Math.min(100, Math.max(0, percent)) : 0;
  const color = hasData ? LEVELS[levelOf(clamped)] : NO_DATA;

  const radius = Math.round(size / 8);
  const barLeft = Math.round(size * 0.1875);
  const barRight = size - barLeft;
  const barTop = Math.round(size * 0.09);
  const barBottom = size - barTop;
  const barHeight = barBottom - barTop;
  const fillTop = barBottom - Math.round((clamped / 100) * barHeight);

  const buffer = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (isOutsideRoundedCorner(x, y, size, radius)) continue; // stays transparent
      let rgb = BACKGROUND;
      if (x >= barLeft && x < barRight && y >= barTop && y < barBottom) {
        rgb = hasData && clamped > 0 && y >= fillTop ? color : TRACK;
      }
      buffer[i] = rgb[2]; // B
      buffer[i + 1] = rgb[1]; // G
      buffer[i + 2] = rgb[0]; // R
      buffer[i + 3] = 255;
    }
  }
  return { width: size, height: size, buffer };
}

function isOutsideRoundedCorner(x, y, size, r) {
  const cx = x < r ? r : x >= size - r ? size - r - 1 : null;
  const cy = y < r ? r : y >= size - r ? size - r - 1 : null;
  if (cx === null || cy === null) return false;
  return (x - cx) ** 2 + (y - cy) ** 2 > r * r;
}
