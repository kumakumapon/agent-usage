// Decides when a usage window has crossed an alert threshold. Pure and
// Electron-free so it can be unit-tested; main.mjs turns the results into
// desktop notifications.

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

export function formatReset(iso, now = Date.now()) {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - now;
  if (!Number.isFinite(ms)) return '';
  if (ms <= 0) return 'resets soon';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `resets in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `resets in ${hours}h`;
  return `resets in ${Math.round(hours / 24)}d`;
}

/** Notification title/body for an alert from `evaluate`. */
export function alertText(alert, toolLabel, now = Date.now()) {
  const reset = formatReset(alert.resetsAt, now);
  return {
    title: `${toolLabel}: ${alert.window} at ${alert.percent}%`,
    body: [`Passed ${alert.threshold}% of the limit.`, reset].filter(Boolean).join(' '),
  };
}
