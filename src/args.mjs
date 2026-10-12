import { parseArgs } from 'node:util';

export const COMMANDS = ['limits', 'usage'];
export const TOOLS = ['claude', 'codex', 'antigravity'];

/** A mistake in the command line: reported briefly, exit code 2, nothing else runs. */
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

/** Levenshtein distance, for "did you mean …?" hints. */
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = row[j];
      row[j] = next;
    }
  }
  return row[b.length];
}

function didYouMean(input, candidates) {
  const lowered = input.toLowerCase();
  const best = candidates
    .map((c) => ({ c, d: distance(lowered, c) }))
    .sort((x, y) => x.d - y.d)[0];
  return best && best.d <= 2 ? ` — did you mean "${best.c}"?` : '';
}

/**
 * Validates `--tool`: a comma-separated list of known tools, or `all` on its
 * own. Returns the tools to query, in the order given, without duplicates.
 * antigravity is opt-in: with no `--tool` only claude and codex run.
 * @param {string|undefined} toolArg
 * @returns {string[]}
 */
export function resolveTools(toolArg) {
  if (toolArg === undefined) return ['claude', 'codex'];
  if (toolArg === 'all') return [...TOOLS];

  const names = toolArg.split(',');
  const valid = `${TOOLS.join(', ')}, all`;
  if (names.some((name) => name.trim() === '')) {
    throw new UsageError(`empty tool name in --tool "${toolArg}" (valid tools: ${valid})`);
  }
  for (const name of names) {
    if (name === 'all') throw new UsageError('--tool all cannot be combined with other tools');
    if (!TOOLS.includes(name)) {
      throw new UsageError(`unknown tool "${name}"${didYouMean(name, TOOLS)} (valid tools: ${valid})`);
    }
  }
  return [...new Set(names)];
}

/**
 * Parses and validates the command line. Anything wrong throws a
 * UsageError, so callers can bail out before touching a provider, the
 * session logs, or the pricing file. `--help` always wins, so a mistyped
 * command next to it still shows the help.
 * @param {string[]} argv
 */
export function parseCliArgs(argv) {
  // util.parseArgs has no built-in --no-x negation for booleans, so handle
  // --no-limits / --no-cache manually before parsing.
  const noLimits = argv.includes('--no-limits');
  const noCache = argv.includes('--no-cache');
  const filtered = argv.filter((a) => a !== '--no-limits' && a !== '--no-cache');
  const wantsHelp = argv.includes('--help') || argv.includes('-h');

  let parsed;
  try {
    parsed = parseArgs({
      args: filtered,
      allowPositionals: true,
      options: {
        tool: { type: 'string' },
        by: { type: 'string', default: 'model' },
        since: { type: 'string' },
        until: { type: 'string' },
        chart: { type: 'boolean', default: false },
        watch: { type: 'boolean', default: false },
        interval: { type: 'string' },
        json: { type: 'boolean', default: false },
        pricing: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (err) {
    if (wantsHelp) return { help: true, command: 'limits', tools: [], limits: true, cache: true };
    // e.g. unknown option, or an option that needs a value
    throw new UsageError(String(err.message).replace(/\. To specify a positional argument.*$/s, ''));
  }

  const { values, positionals } = parsed;
  if (wantsHelp) return { ...values, command: 'limits', tools: [], limits: !noLimits, cache: !noCache };

  const [command = 'limits', ...extra] = positionals;
  if (!COMMANDS.includes(command)) {
    throw new UsageError(`unknown command "${command}"${didYouMean(command, COMMANDS)} (valid commands: ${COMMANDS.join(', ')})`);
  }
  if (extra.length) {
    throw new UsageError(`unexpected extra argument${extra.length > 1 ? 's' : ''}: ${extra.map((e) => `"${e}"`).join(' ')}`);
  }

  return { ...values, command, tools: resolveTools(values.tool), limits: !noLimits, cache: !noCache };
}
