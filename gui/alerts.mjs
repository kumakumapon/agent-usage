// Decides when a usage window has crossed an alert threshold. Pure and
// Electron-free so it can be unit-tested; main.mjs turns the results into
// desktop notifications.

import { formatResets, windowLabel } from './i18n.mjs';

export const DEFAULT_THRESHOLDS = [80, 95];

/**
 * Validates a user-supplied threshold list: finite numbers in 1..100,
 * de-duplicated and ascending. Returns null if nothing usable is left.
 * @param {unknown} value
 * @returns {number[]|null}
 */
export function normalizeThresholds(value) {
  if (!Array.isArray(value)) return null;
  const list = [...new Set(value.filter((n) => Number.isFinite(n) && n >= 1 && n <= 100))].sort((a, b) => a - b);
  return list.length ? list : null;
}

/**
 * Tracks, per usage window, the highest threshold already announced, so each
 * crossing alerts once. A window that drops back below a threshold (it
 * reset) re-arms. The first reading of a window only sets the baseline, so
 * starting the app while usage is already high doesn't fire a burst of
 * alerts for things the user can see.
 */
export function createAlertTracker() {
  const announced = new Map();

  /**
   * @param {Record<string, {stale?: boolean, windows?: Array<{window: string, percent: number|null, resetsAt?: string|null}>}>} result
   * @param {number[]} thresholds ascending
   * @returns {Array<{tool: string, window: string, percent: number, threshold: number, resetsAt: string|null}>}
   */
  function evaluate(result, thresholds) {
    const alerts = [];
    for (const [tool, data] of Object.entries(result || {})) {
      if (data?.stale) continue; // an old reading can't have newly crossed anything
      for (const w of data?.windows || []) {
        const percent = w.percent;
        if (typeof percent !== 'number') continue;
        const key = `${tool}|${w.window}`;
        const level = Math.max(0, ...thresholds.filter((t) => percent >= t));
        const before = announced.get(key);
        announced.set(key, level);
        if (before === undefined) continue; // baseline
        if (level > before) {
          alerts.push({ tool, window: w.window, percent, threshold: level, resetsAt: w.resetsAt || null });
        }
      }
    }
    return alerts;
  }

  return { evaluate };
}

/**
 * Notification title/body for an alert from `evaluate`.
 * @param {{window: string, percent: number, threshold: number, resetsAt: string|null}} alert
 * @param {string} toolLabel
 * @param {(key: string, params?: Record<string, string|number>) => string} t translator (see i18n.mjs)
 * @param {number} [now]
 */
export function alertText(alert, toolLabel, t, now = Date.now()) {
  const reset = formatResets(t, alert.resetsAt, now);
  return {
    title: t('alert.title', { tool: toolLabel, window: windowLabel(t, alert.window), percent: alert.percent }),
    body: [t('alert.body', { threshold: alert.threshold }), reset].filter(Boolean).join(' '),
  };
}
