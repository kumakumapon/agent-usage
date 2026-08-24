import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { CLAUDE_PROJECTS_DIR } from './paths.mjs';

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

async function forEachLine(filePath, onLine) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    onLine(entry);
  }
}

/**
 * Reads every Claude Code project transcript and returns one record per
 * assistant message that carries a usage block.
 * @returns {Promise<Array<object>>}
 */
export async function collectClaudeUsage() {
  const records = [];
  const seen = new Set();

  for (const { project, filePath } of walkJsonl(CLAUDE_PROJECTS_DIR)) {
    await forEachLine(filePath, (entry) => {
      if (entry.type !== 'assistant' || !entry.message?.usage) return;
      const msgId = entry.message.id;
      const requestId = entry.requestId || '';
      const dedupeKey = `${msgId}:${requestId}`;
      if (msgId && seen.has(dedupeKey)) return;
      if (msgId) seen.add(dedupeKey);

      const usage = entry.message.usage;
      const cacheWrite =
        usage.cache_creation_input_tokens ??
        Object.values(usage.cache_creation || {}).reduce((a, b) => a + b, 0) ??
        0;

      records.push({
        project,
        sessionId: entry.sessionId || entry.session_id || null,
        model: entry.message.model || 'unknown',
        timestamp: entry.timestamp || null,
        input: usage.input_tokens || 0,
        output: usage.output_tokens || 0,
        cacheWrite,
        cacheRead: usage.cache_read_input_tokens || 0,
      });
    });
  }

  return records;
}
