import fs from 'node:fs';
import readline from 'node:readline';
import { CODEX_SESSIONS_DIR } from './paths.mjs';
import { walkJsonlRecursive } from './codex-usage.mjs';

async function lastLines(filePath, n) {
  // Session files are small (one per conversation), so reading fully and
  // keeping a ring buffer of the tail is simpler than seeking from the end.
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  const buf = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    buf.push(line);
    if (buf.length > n) buf.shift();
  }
  return buf;
}

/**
 * Codex CLI embeds a `rate_limits` snapshot in every token_count event,
 * reflecting the server's response to the most recent API call. We only
 * need the freshest one, so we check the most-recently-modified session
 * files (newest first) until we find a token_count event with rate_limits.
 * @returns {Promise<object|null>}
 */
export async function readCodexRateLimit() {
  const files = [...walkJsonlRecursive(CODEX_SESSIONS_DIR)]
    .map((f) => ({ f, mtime: fs.statSync(f).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 20)
    .map((x) => x.f);

  for (const filePath of files) {
    const lines = await lastLines(filePath, 50);
    for (let i = lines.length - 1; i >= 0; i--) {
      let entry;
      try {
        entry = JSON.parse(lines[i]);
      } catch {
        continue;
      }
      if (entry.type !== 'event_msg' || entry.payload?.type !== 'token_count') continue;
      const rl = entry.payload.rate_limits;
      if (!rl) continue;

      const windows = [];
      if (rl.primary) windows.push({ window: 'primary', ...rl.primary });
      if (rl.secondary) windows.push({ window: 'secondary', ...rl.secondary });

      return {
        fetchedAt: entry.timestamp || null,
        planType: rl.plan_type || null,
        windows: windows.map((w) => ({
          window: w.window,
          percent: w.used_percent ?? null,
          resetsAt: w.resets_at ? new Date(w.resets_at * 1000).toISOString() : null,
          windowMinutes: w.window_minutes ?? null,
        })),
        credits: rl.credits || null,
      };
    }
  }
  return null;
}
