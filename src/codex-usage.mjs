import fs from 'node:fs';
import path from 'node:path';
import { CODEX_SESSIONS_DIR } from './paths.mjs';
import { collectIncremental } from './incremental.mjs';

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

/**
 * Reads every Codex CLI rollout file and returns one record per token_count
 * event, attributed to whichever model was active in the turn_context that
 * preceded it. Uses last_token_usage (the per-turn delta) so records sum
 * cleanly across a session instead of double-counting the cumulative total.
 * Rollouts are append-only, so only the part added since the last run is
 * re-parsed (see incremental.mjs); pass `{ cache: false }` to force a full
 * re-read.
 * @param {{cache?: boolean}} [opts]
 * @returns {Promise<Array<object>>}
 */
export async function collectCodexUsage({ cache = true } = {}) {
  const files = [...walkJsonlRecursive(CODEX_SESSIONS_DIR)].map((filePath) => ({ filePath }));

  const perFile = await collectIncremental({
    cacheName: 'codex-usage.json',
    files,
    useCache: cache,
    // Carried across runs: the session header and latest turn_context come
    // earlier in the file than the token_count events appended later.
    newState: () => ({ cwd: null, sessionId: null, currentModel: 'unknown' }),
    parseEntry(entry, state, emit) {
      if (entry.type === 'session_meta') {
        state.sessionId = entry.payload?.id || entry.payload?.session_id || null;
        state.cwd = entry.payload?.cwd || state.cwd;
        return;
      }
      if (entry.type === 'turn_context') {
        state.currentModel = entry.payload?.model || state.currentModel;
        return;
      }
      if (entry.type === 'event_msg' && entry.payload?.type === 'token_count') {
        const usage = entry.payload.info?.last_token_usage;
        if (!usage) return;
        emit({
          project: state.cwd,
          sessionId: state.sessionId,
          model: state.currentModel,
          timestamp: entry.timestamp || null,
          input: usage.input_tokens || 0,
          cachedInput: usage.cached_input_tokens || 0,
          output: usage.output_tokens || 0,
          reasoningOutput: usage.reasoning_output_tokens || 0,
        });
      }
    },
  });

  return perFile.flatMap(({ records }) => records);
}
