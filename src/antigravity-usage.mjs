import fs from 'node:fs';
import path from 'node:path';
import { antigravityStateCandidates, ANTIGRAVITY_CLI_DIR } from './paths.mjs';

/**
 * Neither the Antigravity IDE nor its `agy` CLI write token counts to disk
 * anywhere we can find: per-turn data lives in SQLite blob columns
 * (gen_metadata, executor_metadata, step_payload) that are opaque protobuf
 * with no published schema, and quota percentages are fetched live from
 * Google's Cloud Code backend and only ever shown in-session (the `/usage`
 * slash command) — never persisted. What IS readable in plain JSON/JSONL is
 * activity volume: `agy`'s history.jsonl logs every prompt/command with a
 * timestamp, workspace and conversation id, and conversation_metadata.json
 * tracks a step count per conversation. That's a real, if token-less, usage
 * signal, so we report it instead of nothing.
 */

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readHistoryEntries() {
  const historyPath = path.join(ANTIGRAVITY_CLI_DIR, 'history.jsonl');
  let raw;
  try {
    raw = fs.readFileSync(historyPath, 'utf8');
  } catch {
    return [];
  }
  const entries = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // skip malformed line
    }
  }
  return entries;
}

/**
 * @param {{since?: string, until?: string}} [range] inclusive YYYY-MM-DD bounds
 * @returns {{available: boolean, byDay?: Array<object>, totalSteps?: number,
 *   totalConversations?: number, note: string}}
 */
export function collectAntigravityActivity(range = {}) {
  const { since, until } = range;
  let entries = readHistoryEntries();
  if (since || until) {
    entries = entries.filter((e) => {
      if (!e.timestamp) return true;
      const day = new Date(e.timestamp).toISOString().slice(0, 10);
      if (since && day < since) return false;
      if (until && day > until) return false;
      return true;
    });
  }
  if (entries.length === 0) {
    return {
      available: false,
      note: 'No agy CLI history found (~/.gemini/antigravity-cli/history.jsonl) — token/usage data is not available for Antigravity.',
    };
  }

  const byDay = new Map();
  const sessionsByDay = new Map();
  for (const e of entries) {
    if (!e.timestamp) continue;
    const day = new Date(e.timestamp).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) || 0) + 1);
    if (e.conversationId) {
      if (!sessionsByDay.has(day)) sessionsByDay.set(day, new Set());
      sessionsByDay.get(day).add(e.conversationId);
    }
  }

  const rows = [...byDay.keys()]
    .sort()
    .map((day) => ({
      day,
      turns: byDay.get(day),
      sessions: sessionsByDay.get(day)?.size || 0,
    }));

  const metadata = readJsonSafe(path.join(ANTIGRAVITY_CLI_DIR, 'cache', 'conversation_metadata.json'));
  let totalSteps = 0;
  let totalConversations = 0;
  if (metadata?.conversations) {
    for (const conv of Object.values(metadata.conversations)) {
      totalSteps += conv.summary?.NumSteps || 0;
      totalConversations += 1;
    }
  }

  return {
    available: true,
    byDay: rows,
    totalSteps,
    totalConversations,
    note:
      'Token counts are not available: agy stores per-turn data as undocumented protobuf blobs, ' +
      'and quota % is fetched live, never written to disk. Figures above are turn/session counts ' +
      'from history.jsonl and step counts from conversation_metadata.json instead.',
  };
}

/**
 * Antigravity IDE status (separate product surface from the agy CLI) — kept
 * for the case where only the desktop app is installed.
 * @returns {Promise<object>}
 */
export async function collectAntigravityIdeStatus() {
  for (const dbPath of antigravityStateCandidates()) {
    if (fs.existsSync(dbPath)) {
      const stat = fs.statSync(dbPath);
      return {
        found: true,
        dbPath,
        lastActive: stat.mtime.toISOString(),
      };
    }
  }
  return { found: false, dbPath: null, lastActive: null };
}
