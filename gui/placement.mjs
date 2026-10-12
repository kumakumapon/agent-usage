// Window-placement maths, kept free of Electron so it can be unit-tested.
// Rects are { x, y, width, height } in screen coordinates.

/** @typedef {{x: number, y: number, width: number, height: number}} Rect */

/**
 * Moves a window of `size` so it lies fully inside `area`, changing it as
 * little as possible. A window larger than the area is pinned to the top-left.
 * @param {{x: number, y: number}} pos
 * @param {{width: number, height: number}} size
 * @param {{x: number, y: number, width: number, height: number}} area
 */
export function clampToArea(pos, size, area) {
  const maxX = Math.max(area.x, area.x + area.width - size.width);
  const maxY = Math.max(area.y, area.y + area.height - size.height);
  return {
    x: Math.min(Math.max(pos.x, area.x), maxX),
    y: Math.min(Math.max(pos.y, area.y), maxY),
  };
}

/** Default spot: the bottom-right corner of `area`, inset by `margin`. */
export function cornerPosition(size, area, margin = 16) {
  return clampToArea(
    { x: area.x + area.width - size.width - margin, y: area.y + area.height - size.height - margin },
    size,
    area,
  );
}

/**
 * Picks the work area a window at `rect` should live on: the display it
 * overlaps most, or — when it overlaps none (its monitor was unplugged) —
 * the nearest one. `areas` is the list of displays' work areas.
 * @param {Rect} rect
 * @param {Rect[]} areas
 * @returns {Rect|null}
 */
export function pickArea(rect, areas) {
  /** @type {{area: Rect, overlap: number, distance: number}|null} */
  let best = null;
  for (const area of areas) {
    const w = Math.min(rect.x + rect.width, area.x + area.width) - Math.max(rect.x, area.x);
    const h = Math.min(rect.y + rect.height, area.y + area.height) - Math.max(rect.y, area.y);
    const overlap = w > 0 && h > 0 ? w * h : 0;
    const dx = Math.max(area.x - (rect.x + rect.width), 0, rect.x - (area.x + area.width));
    const dy = Math.max(area.y - (rect.y + rect.height), 0, rect.y - (area.y + area.height));
    const candidate = { area, overlap, distance: Math.hypot(dx, dy) };
    if (
      !best ||
      candidate.overlap > best.overlap ||
      (candidate.overlap === best.overlap && candidate.distance < best.distance)
    ) {
      best = candidate;
    }
  }
  return best?.area ?? null;
}
