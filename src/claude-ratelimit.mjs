import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CLAUDE_JSON = path.join(os.homedir(), '.claude.json');

/**
 * Claude Code CLI periodically caches the account's rate-limit utilization
 * (the same numbers the TUI status line shows) into ~/.claude.json under
 * `cachedUsageUtilization`. There is no live API call here — this is
 * whatever the CLI itself last fetched, so it can be a little stale.
 * @returns {object|null}
 */
export function readClaudeRateLimit() {
  let raw;
  try {
    raw = fs.readFileSync(CLAUDE_JSON, 'utf8');
  } catch {
    return null;
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }

  const cached = json.cachedUsageUtilization;
  if (!cached?.utilization) return null;

  const u = cached.utilization;
  const windows = [];
  if (u.five_hour) windows.push({ window: 'session (5h)', ...u.five_hour });
  if (u.seven_day) windows.push({ window: 'weekly', ...u.seven_day });
  if (u.seven_day_opus) windows.push({ window: 'weekly (Opus)', ...u.seven_day_opus });
  if (u.seven_day_sonnet) windows.push({ window: 'weekly (Sonnet)', ...u.seven_day_sonnet });

  return {
    fetchedAt: cached.fetchedAtMs ? new Date(cached.fetchedAtMs).toISOString() : null,
    windows: windows.map((w) => ({
      window: w.window,
      percent: w.utilization ?? null,
      resetsAt: w.resets_at ?? null,
    })),
  };
}
