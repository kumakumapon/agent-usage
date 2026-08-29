import { spawn } from 'node:child_process';

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
  return asUtc - at.getTime();
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
function parseResetStamp(text, zone) {
  const m = text.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{1,2})(?::(\d{2}))?(am|pm)$/i);
  if (!m) return null;
  const month = MONTHS[m[1][0].toUpperCase() + m[1].slice(1, 3).toLowerCase()];
  if (month == null) return null;
  const day = +m[2];
  let hour = (+m[3]) % 12;
  if (/pm/i.test(m[5])) hour += 12;
  const minute = m[4] ? +m[4] : 0;

  const now = new Date();
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

  const windows = [];
  let m;
  LINE_RE.lastIndex = 0;
  while ((m = LINE_RE.exec(text))) {
    const [, label, pct, resetText, zone] = m;
    windows.push({
      window: shortWindowLabel(label),
      percent: Number(pct),
      resetsAt: resetText && zone ? parseResetStamp(resetText, zone) : null,
    });
  }

  if (windows.length === 0) return { error: 'could not find usage lines in /usage output' };

  return { fetchedAt: new Date().toISOString(), windows };
}

function runCli(command, args) {
  return new Promise((resolve, reject) => {
    const windows = process.platform === 'win32';
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: windows,
      detached: windows,
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = async (fn, value, terminate = false) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      if (terminate) await terminateChildTree(child);
      fn(value);
    };
    const timeout = setTimeout(() => {
      void finish(reject, new Error('timed out waiting for claude'), true);
    }, 30_000);

    child.on('error', (err) => { void finish(reject, err, true); });
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => {
      if (code === 0) void finish(resolve, stdout);
      else void finish(reject, new Error(stderr.trim() || `claude exited with code ${code}`));
    });
  });
}

function terminateChildTree(child) {
  if (process.platform !== 'win32' || !child.pid || child.exitCode !== null) {
    child.kill();
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    // This helper is short-lived and is deliberately not detached; only the
    // queried CLI gets an isolated console process group.
    const taskkill = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
      shell: false,
    });
    taskkill.once('error', () => {
      child.kill();
      resolve();
    });
    taskkill.once('close', (code) => {
      if (code !== 0) child.kill();
      resolve();
    });
  });
}
