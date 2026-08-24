import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Unlike the other readers in this project, this one is NOT a local file
 * read: `agy`'s /usage slash command reports live quota, and (per Antigravity's
 * own design) that number is never persisted to disk anywhere — so the only
 * way to get it is to actually invoke the CLI. `agy -p "/usage" --output-format
 * json` runs the built-in /usage command in print mode; it does not consume
 * an LLM turn (num_turns/usage come back 0 in the response) but it does need
 * `agy` on PATH, a logged-in session, and ~5-10s to start the CLI process.
 * @returns {Promise<object|null>}
 */
export async function readAntigravityRateLimit() {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      'agy',
      ['-p', '/usage', '--output-format', 'json'],
      { timeout: 30_000, windowsHide: true },
    ));
  } catch (err) {
    return { error: err.code === 'ENOENT' ? 'agy not found on PATH' : (err.message || String(err)) };
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { error: 'could not parse agy output as JSON' };
  }

  const groups = parsed.command?.data?.groups;
  if (!groups) return { error: 'unexpected /usage response shape from agy' };

  const windows = [];
  for (const group of groups) {
    for (const bucket of group.buckets || []) {
      windows.push({
        window: `${group.name} — ${bucket.name}`,
        percent:
          typeof bucket.remaining_fraction === 'number'
            ? Math.round((1 - bucket.remaining_fraction) * 100)
            : null,
        resetsAt: bucket.reset_time || null,
      });
    }
  }

  return { fetchedAt: new Date().toISOString(), windows };
}
