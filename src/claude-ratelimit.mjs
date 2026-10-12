import { runCli } from './run-cli.mjs';

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

/**
 * Offset (ms) of an IANA timezone from UTC at a given instant, derived by
 * formatting that instant in the zone and diffing against its UTC reading.
 * @param {string} zone
 * @param {Date} at
 */
function zoneOffsetMs(zone, at) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(at).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  // `asUtc` is truncated to whole seconds, so compare against the same.
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * Parses a "/usage" reset stamp like "Aug 26, 2:09am" + zone "Asia/Tokyo"
 * into an absolute ISO timestamp. The text has no year, so we assume the
 * current year and roll forward a year if that lands far in the past
 * (resets are always at most ~7 days out).
 * @param {string} text
 * @param {string} zone
 * @returns {string|null}
 */
export function parseResetStamp(text, zone, now = new Date()) {
  const m = text.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{1,2})(?::(\d{2}))?(am|pm)$/i);
  if (!m) return null;
  const month = MONTHS[m[1][0].toUpperCase() + m[1].slice(1, 3).toLowerCase()];
  if (month == null) return null;
  const day = +m[2];
  let hour = (+m[3]) % 12;
  if (/pm/i.test(m[5])) hour += 12;
  const minute = m[4] ? +m[4] : 0;

  let offset;
  try {
    offset = zoneOffsetMs(zone, now);
  } catch {
    return null;
  }

  const tryYear = (year) => new Date(Date.UTC(year, month, day, hour, minute, 0) - offset);
  let d = tryYear(now.getUTCFullYear());
  if (d.getTime() < now.getTime() - 30 * 24 * 3600 * 1000) {
    d = tryYear(now.getUTCFullYear() + 1);
  }
  return d.toISOString();
}

function shortWindowLabel(raw) {
  const t = raw.trim();
  if (/^current session$/i.test(t)) return 'session (5h)';
  const week = t.match(/^current week(?:\s*\(([^)]+)\))?$/i);
  if (week) {
    const model = week[1];
    if (!model || /all models/i.test(model)) return 'weekly';
    return `weekly (${model})`;
  }
  return t;
}

const LINE_RE =
  /^(.+?):\s*(\d+)%\s*used(?:\s*·\s*resets\s+([A-Za-z]{3}\s+\d{1,2},\s*\d{1,2}(?::\d{2})?(?:am|pm))\s*\(([^)]+)\))?/gim;

/**
 * Extracts the quota windows from the plain-text `/usage` report.
 * @param {string} text
 * @param {Date} [now]
 * @returns {Array<{window: string, percent: number, resetsAt: string|null}>}
 */
export function parseUsageText(text, now = new Date()) {
  const windows = [];
  const re = new RegExp(LINE_RE.source, LINE_RE.flags);
  let m;
  while ((m = re.exec(text))) {
    const [, label, pct, resetText, zone] = m;
    windows.push({
      window: shortWindowLabel(label),
      percent: Number(pct),
      resetsAt: resetText && zone ? parseResetStamp(resetText, zone, now) : null,
    });
  }
  return windows;
}

/**
 * Claude Code's `/usage` slash command reports live quota, same as the TUI
 * status line, and (like Antigravity's `agy -p /usage`) is not persisted
 * to disk in a structured form — so this invokes the CLI directly via
 * `claude -p "/usage" --output-format json` and parses the plain-text
 * report out of the `result` field. Running it as a print-mode slash
 * command does not consume a real turn (cost/usage come back 0).
 * @returns {Promise<object>}
 */
export async function readClaudeRateLimit() {
  let stdout;
  try {
    stdout = await runCli(
      'claude',
      ['-p', '/usage', '--output-format', 'json'],
    );
  } catch (err) {
    return { error: err.code === 'ENOENT' ? 'claude not found on PATH' : (err.message || String(err)) };
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { error: 'could not parse claude output as JSON' };
  }

  const text = parsed.result;
  if (typeof text !== 'string') return { error: 'unexpected /usage response shape from claude' };

  const windows = parseUsageText(text);
  if (windows.length === 0) return { error: 'could not find usage lines in /usage output' };

  return { fetchedAt: new Date().toISOString(), windows };
}
