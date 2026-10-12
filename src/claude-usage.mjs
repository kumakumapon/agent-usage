import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_PROJECTS_DIR } from './paths.mjs';
import { collectIncremental } from './incremental.mjs';

function* walkJsonl(dir) {
  let projectDirs;
  try {
    projectDirs = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  for (const entry of projectDirs) {
    if (!entry.isDirectory()) continue;
    const projectDir = path.join(dir, entry.name);
    let files;
    try {
      files = fs.readdirSync(projectDir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (file.endsWith('.jsonl')) {
        yield { project: entry.name, filePath: path.join(projectDir, file) };
      }
    }
  }
}

/**
 * Reads every Claude Code project transcript and returns one record per
 * assistant message that carries a usage block. Transcripts are append-only,
 * so only the part added since the last run is re-parsed (see
 * incremental.mjs); pass `{ cache: false }` to force a full re-read.
 * @param {{cache?: boolean}} [opts]
 * @returns {Promise<Array<object>>}
 */
export async function collectClaudeUsage({ cache = true } = {}) {
  const files = [...walkJsonl(CLAUDE_PROJECTS_DIR)].map(({ project, filePath }) => ({ filePath, meta: { project } }));

  const perFile = await collectIncremental({
    cacheName: 'claude-usage.json',
    files,
    useCache: cache,
    newState: ({ project }) => ({ project }),
    parseEntry(entry, state, emit) {
      if (entry.type !== 'assistant' || !entry.message?.usage) return;
      const msgId = entry.message.id;
      const requestId = entry.requestId || '';
      const usage = entry.message.usage;
      const cacheWrite =
        usage.cache_creation_input_tokens ??
        Object.values(usage.cache_creation || {}).reduce((a, b) => a + b, 0) ??
        0;

      emit({
        // Dropped before returning; a message can be logged in several files
        // (resumed sessions), so de-duplication has to span all of them.
        dedupeKey: msgId ? `${msgId}:${requestId}` : null,
        project: state.project,
        sessionId: entry.sessionId || entry.session_id || null,
        model: entry.message.model || 'unknown',
        timestamp: entry.timestamp || null,
        input: usage.input_tokens || 0,
        output: usage.output_tokens || 0,
        cacheWrite,
        cacheRead: usage.cache_read_input_tokens || 0,
      });
    },
  });

  const records = [];
  const seen = new Set();
  for (const { records: fileRecords } of perFile) {
    for (const { dedupeKey, ...record } of fileRecords) {
      if (dedupeKey) {
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
      }
      records.push(record);
    }
  }
  return records;
}
