import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { CODEX_SESSIONS_DIR } from './paths.mjs';

export function* walkJsonlRecursive(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkJsonlRecursive(full);
    } else if (entry.name.endsWith('.jsonl')) {
      yield full;
    }
  }
}

async function readLines(filePath) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  const lines = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      lines.push(JSON.parse(line));
    } catch {
      // skip malformed line
    }
  }
  return lines;
}

/**
 * Reads every Codex CLI rollout file and returns one record per token_count
 * event, attributed to whichever model was active in the turn_context that
 * preceded it. Uses last_token_usage (the per-turn delta) so records sum
 * cleanly across a session instead of double-counting the cumulative total.
 * @returns {Promise<Array<object>>}
 */
export async function collectCodexUsage() {
  const records = [];

  for (const filePath of walkJsonlRecursive(CODEX_SESSIONS_DIR)) {
    const lines = await readLines(filePath);
    let cwd = null;
    let sessionId = null;
    let currentModel = 'unknown';

    for (const entry of lines) {
      if (entry.type === 'session_meta') {
        sessionId = entry.payload?.id || entry.payload?.session_id || null;
        cwd = entry.payload?.cwd || cwd;
        continue;
      }
      if (entry.type === 'turn_context') {
        currentModel = entry.payload?.model || currentModel;
        continue;
      }
      if (entry.type === 'event_msg' && entry.payload?.type === 'token_count') {
        const usage = entry.payload.info?.last_token_usage;
        if (!usage) continue;
        records.push({
          project: cwd,
          sessionId,
          model: currentModel,
          timestamp: entry.timestamp || null,
          input: usage.input_tokens || 0,
          cachedInput: usage.cached_input_tokens || 0,
          output: usage.output_tokens || 0,
          reasoningOutput: usage.reasoning_output_tokens || 0,
        });
      }
    }
  }

  return records;
}
