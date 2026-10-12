import fs from 'node:fs';
import path from 'node:path';
import { CACHE_DIR } from './paths.mjs';

// Bump when the shape of cached entries (or what parsers emit) changes, so
// stale caches are discarded instead of misread.
const CACHE_VERSION = 1;

/**
 * Reads the complete lines of `filePath` from byte `offset` and calls
 * `onLine` with each non-empty one. Returns the new offset: just past the
 * last newline, or the end of file when the unterminated tail is itself a
 * complete JSON document. An unfinished tail (a line still being written)
 * is left unconsumed so the next run picks it up whole.
 * @returns {Promise<number>}
 */
async function readNewLines(filePath, offset, size, onLine) {
  if (size <= offset) return offset;
  let pending = Buffer.alloc(0);
  let consumed = offset;
  const stream = fs.createReadStream(filePath, { start: offset, end: size - 1 });
  for await (const chunk of stream) {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    let start = 0;
    let nl;
    while ((nl = pending.indexOf(0x0a, start)) !== -1) {
      const line = pending.toString('utf8', start, nl).trim();
      if (line) onLine(line);
      start = nl + 1;
    }
    consumed += start;
    pending = pending.subarray(start);
  }
  const tail = pending.toString('utf8').trim();
  if (tail) {
    try {
      JSON.parse(tail);
    } catch {
      return consumed; // still being written
    }
    onLine(tail);
    consumed += pending.length;
  }
  return consumed;
}

function loadCache(cachePath) {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (raw?.version === CACHE_VERSION && raw.files && typeof raw.files === 'object') return raw.files;
  } catch {
    // missing or corrupt: start fresh
  }
  return {};
}

function saveCache(cachePath, files) {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const tmp = `${cachePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: CACHE_VERSION, files }));
    fs.renameSync(tmp, cachePath);
  } catch {
    // best effort: the cache is only an optimisation
  }
}

/**
 * Parses append-only JSONL files, re-reading only what was added since the
 * previous run.
 *
 * For every file the cache keeps the records already extracted, the byte
 * offset consumed so far, and a small JSON `state` the parser carries
 * between lines (e.g. Codex's current model). A file that is unchanged is
 * reused as is; one that grew is read from its saved offset; one that
 * shrank is parsed from scratch. Files that disappeared drop out of the
 * cache.
 *
 * @param {object} opts
 * @param {string} opts.cacheName   file name under the cache dir
 * @param {Iterable<{filePath: string, meta?: any}>} opts.files
 * @param {(meta: any) => any} opts.newState  initial parser state for a file
 * @param {(entry: any, state: any, emit: (record: any) => void) => void} opts.parseEntry
 * @param {boolean} [opts.useCache=true]
 * @param {string} [opts.cacheDir]
 * @returns {Promise<Array<{filePath: string, records: any[]}>>} per-file records, in input order
 */
export async function collectIncremental({
  cacheName,
  files,
  newState,
  parseEntry,
  useCache = true,
  cacheDir = CACHE_DIR,
}) {
  const cachePath = path.join(cacheDir, cacheName);
  const cached = useCache ? loadCache(cachePath) : {};
  const next = {};
  const out = [];
  let changed = false;

  for (const { filePath, meta = {} } of files) {
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      continue; // vanished between listing and reading
    }

    let entry = cached[filePath];
    if (!entry || stat.size < entry.offset) {
      entry = { size: 0, mtimeMs: 0, offset: 0, state: newState(meta), records: [] };
    }

    if (stat.size !== entry.size || stat.mtimeMs !== entry.mtimeMs) {
      const emit = (record) => entry.records.push(record);
      entry.offset = await readNewLines(filePath, entry.offset, stat.size, (line) => {
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          return; // malformed line
        }
        parseEntry(parsed, entry.state, emit);
      });
      entry.size = stat.size;
      entry.mtimeMs = stat.mtimeMs;
      changed = true;
    }

    next[filePath] = entry;
    out.push({ filePath, records: entry.records });
  }

  if (useCache && (changed || Object.keys(cached).length !== Object.keys(next).length)) {
    saveCache(cachePath, next);
  }
  return out;
}
