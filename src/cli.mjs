import { collectClaudeUsage } from './claude-usage.mjs';
import { collectCodexUsage } from './codex-usage.mjs';
import { collectAntigravityActivity } from './antigravity-usage.mjs';
import { readClaudeRateLimit } from './claude-ratelimit.mjs';
import { readCodexRateLimit } from './codex-ratelimit.mjs';
import { readAntigravityRateLimit } from './antigravity-ratelimit.mjs';
import { loadPricing, estimateCost, PRICING_FILE } from './pricing.mjs';
import { parseCliArgs } from './args.mjs';
import { formatCompact, formatCost, formatUntil, renderTable, renderBarChart, renderGauge } from './format.mjs';

const HELP = `Usage: agent-usage [command] [options]

Commands:
  limits (default)   Current rate-limit / quota utilization: a live query for
                     Claude (\`claude -p /usage\`) and Antigravity
                     (\`agy -p /usage\`), and local session logs for Codex.
  usage               Token usage (by model or by day) for Claude Code CLI and
                     Codex CLI from their session logs, plus Antigravity's
                     local activity; run this explicitly to see it.

Options:
  --tool <name>     Limit to one tool: claude, codex, antigravity, all
                     (default: claude,codex — antigravity is opt-in;
                     pass --tool antigravity or --tool all to include it)
  --watch               [limits only] Redraw like a dashboard, re-fetching on an interval
  --interval <sec>       [limits only] Refresh interval in seconds for --watch (default: 30, minimum: 10)
  --by <mode>        [usage only] Group rows by: model (default) or day
  --since <date>      [usage only] Only include usage on/after this date (YYYY-MM-DD)
  --until <date>       [usage only] Only include usage on/before this date (YYYY-MM-DD)
  --chart               [usage only] Also print a bar chart of totals per row
  --no-limits            [usage only] Skip the rate-limits section (shown by default)
  --no-cache             [usage only] Re-read every session log instead of using ~/.agent-usage/cache
  --json                Print machine-readable JSON instead of tables
  --pricing             Print the path to the editable pricing file and exit
  -h, --help            Show this help

Cost estimates use rates you supply in:
  ${PRICING_FILE}
Models without a configured rate show token counts with no cost column.

Exit codes: 0 success, 1 runtime error, 2 invalid command line (nothing is run).
`;

function inDateRange(timestamp, since, until) {
  if (!timestamp) return true;
  const date = timestamp.slice(0, 10);
  if (since && date < since) return false;
  if (until && date > until) return false;
  return true;
}

function groupClaudeRows(records, by) {
  const groups = new Map();
  const sessionsPerKey = new Map();

  for (const r of records) {
    const key = by === 'day' ? (r.timestamp || 'unknown').slice(0, 10) : r.model;
    if (!groups.has(key)) {
      groups.set(key, { key, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, model: r.model });
      sessionsPerKey.set(key, new Set());
    }
    const g = groups.get(key);
    g.input += r.input;
    g.output += r.output;
    g.cacheWrite += r.cacheWrite;
    g.cacheRead += r.cacheRead;
    if (r.sessionId) sessionsPerKey.get(key).add(r.sessionId);
  }

  return sortRows(
    [...groups.values()]
      .map((g) => ({
        ...g,
        sessions: sessionsPerKey.get(g.key).size,
        total: g.input + g.output + g.cacheWrite + g.cacheRead,
      }))
      .filter((g) => g.total > 0),
    by,
  );
}

function sortRows(rows, by) {
  return by === 'day'
    ? rows.sort((a, b) => a.key.localeCompare(b.key))
    : rows.sort((a, b) => b.total - a.total);
}

function groupCodexRows(records, by) {
  const groups = new Map();
  const sessionsPerKey = new Map();

  for (const r of records) {
    const key = by === 'day' ? (r.timestamp || 'unknown').slice(0, 10) : r.model;
    if (!groups.has(key)) {
      groups.set(key, { key, input: 0, cachedInput: 0, output: 0, model: r.model });
      sessionsPerKey.set(key, new Set());
    }
    const g = groups.get(key);
    g.input += r.input;
    g.cachedInput += r.cachedInput;
    g.output += r.output;
    if (r.sessionId) sessionsPerKey.get(key).add(r.sessionId);
  }

  return sortRows(
    [...groups.values()].map((g) => ({
      ...g,
      sessions: sessionsPerKey.get(g.key).size,
      total: g.input + g.cachedInput + g.output,
    })),
    by,
  );
}

function claudeTable(rows, by, pricing) {
  const headers =
    by === 'day'
      ? ['Date', 'Sessions', 'Input', 'Output', 'Cache Write', 'Cache Read', 'Total', 'Cost']
      : ['Model', 'Sessions', 'Input', 'Output', 'Cache Write', 'Cache Read', 'Total', 'Cost'];

  let grandTotal = 0;
  let grandCost = 0;
  let anyCost = false;

  const body = rows.map((r) => {
    const cost = estimateCost(pricing, 'claude', r.model, {
      input: r.input,
      output: r.output,
      cacheWrite: r.cacheWrite,
      cacheRead: r.cacheRead,
    });
    grandTotal += r.total;
    if (cost != null) {
      grandCost += cost;
      anyCost = true;
    }
    return [
      r.key,
      String(r.sessions),
      formatCompact(r.input),
      formatCompact(r.output),
      formatCompact(r.cacheWrite),
      formatCompact(r.cacheRead),
      formatCompact(r.total),
      formatCost(cost),
    ];
  });

  body.push([
    'TOTAL',
    '',
    '',
    '',
    '',
    '',
    formatCompact(grandTotal),
    anyCost ? formatCost(grandCost) : '—',
  ]);

  return renderTable(headers, body, [1, 2, 3, 4, 5, 6, 7]);
}

function codexTable(rows, by, pricing) {
  const headers =
    by === 'day'
      ? ['Date', 'Sessions', 'Input', 'Cached Input', 'Output', 'Total', 'Cost']
      : ['Model', 'Sessions', 'Input', 'Cached Input', 'Output', 'Total', 'Cost'];

  let grandTotal = 0;
  let grandCost = 0;
  let anyCost = false;

  const body = rows.map((r) => {
    const cost = estimateCost(pricing, 'codex', r.model, {
      input: r.input,
      cachedInput: r.cachedInput,
      output: r.output,
    });
    grandTotal += r.total;
    if (cost != null) {
      grandCost += cost;
      anyCost = true;
    }
    return [
      r.key,
      String(r.sessions),
      formatCompact(r.input),
      formatCompact(r.cachedInput),
      formatCompact(r.output),
      formatCompact(r.total),
      formatCost(cost),
    ];
  });

  body.push(['TOTAL', '', '', '', '', formatCompact(grandTotal), anyCost ? formatCost(grandCost) : '—']);

  return renderTable(headers, body, [1, 2, 3, 4, 5, 6]);
}

function limitsTable(windows) {
  const headers = ['Window', 'Usage', 'Resets'];
  const body = windows.map((w) => [w.window, renderGauge(w.percent, 6), formatUntil(w.resetsAt)]);
  return renderTable(headers, body, []);
}

/**
 * Everything run() reaches out to — the session-log readers, the live
 * rate-limit queries and the pricing file — so tests can swap in stubs.
 * @typedef {typeof defaultDeps} Deps
 */
const defaultDeps = {
  collectClaudeUsage,
  collectCodexUsage,
  collectAntigravityActivity,
  readClaudeRateLimit,
  readCodexRateLimit,
  readAntigravityRateLimit,
  loadPricing,
};

/** @param {string[]} tools @param {Deps} deps */
async function gatherLimits(tools, deps) {
  const result = {};
  if (tools.includes('claude')) result.claude = await deps.readClaudeRateLimit();
  if (tools.includes('codex')) result.codex = await deps.readCodexRateLimit();
  if (tools.includes('antigravity')) result.antigravity = await deps.readAntigravityRateLimit();
  return result;
}

function printLimits(result) {
  if ('claude' in result) {
    console.log('\nClaude Code CLI rate limits');
    const cl = result.claude;
    if (cl?.windows) {
      console.log(limitsTable(cl.windows));
      console.log(`  as of: ${cl.fetchedAt} (live query via \`claude -p /usage\`)`);
    } else {
      console.log(`  could not fetch: ${cl?.error || 'unknown error'}`);
    }
  }

  if ('codex' in result) {
    console.log('\nCodex CLI rate limits');
    if (result.codex?.windows) {
      console.log(limitsTable(result.codex.windows));
      console.log(`  plan: ${result.codex.planType || 'unknown'}`);
      console.log(`  as of: ${result.codex.fetchedAt} (live query via \`codex app-server\`)`);
    } else {
      console.log(`  could not fetch: ${result.codex?.error || 'unknown error'}`);
    }
  }

  if ('antigravity' in result) {
    console.log('\nAntigravity (agy) rate limits');
    const ag = result.antigravity;
    if (ag?.windows) {
      console.log(limitsTable(ag.windows));
      console.log(`  as of: ${ag.fetchedAt} (live query via \`agy -p /usage\`)`);
    } else {
      console.log(`  could not fetch: ${ag?.error || 'unknown error'}`);
    }
  }
}

async function watchLimits(tools, intervalSec, deps) {
  let stopped = false;
  /** @type {((value?: unknown) => void)|null} */
  let wake = null;

  // Stop by letting the loop below unwind on its own, instead of
  // process.exit()-ing immediately: a hard exit mid-fetch would skip the
  // taskkill cleanup in the claude/codex/agy readers and leave their child
  // processes running.
  process.on('SIGINT', () => {
    if (stopped) return;
    stopped = true;
    console.log('\n\nStopped watching.');
    if (wake) wake();
  });

  while (!stopped) {
    const result = await gatherLimits(tools, deps);
    if (stopped) break;
    console.clear();
    console.log(`agent-usage limits — watching (refresh every ${intervalSec}s, Ctrl+C to stop)`);
    console.log(`last updated: ${new Date().toLocaleString()}`);
    printLimits(result);
    console.log('');
    await new Promise((resolve) => {
      wake = resolve;
      setTimeout(resolve, intervalSec * 1000);
    });
    wake = null;
  }
}

async function runLimits(args, deps) {
  const { tools } = args;

  if (args.watch) {
    if (args.json) {
      console.error('--watch cannot be combined with --json');
      process.exitCode = 1;
      return;
    }
    const intervalSec = Math.max(10, Number(args.interval) || 30);
    await watchLimits(tools, intervalSec, deps);
    return;
  }

  const result = await gatherLimits(tools, deps);

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printLimits(result);
  console.log('');
}

/**
 * @param {string[]} argv
 * @param {Partial<Deps>} [overrides] stubs for tests
 */
export async function run(argv, overrides = {}) {
  // Validate before anything else: a bad command line must not start a
  // provider, read the session logs or create the pricing file.
  const args = parseCliArgs(argv);
  const deps = { ...defaultDeps, ...overrides };

  if (args.help) {
    console.log(HELP);
    return;
  }
  if (args.pricing) {
    deps.loadPricing(); // ensures the file exists
    console.log(PRICING_FILE);
    return;
  }

  if (args.command === 'limits') {
    await runLimits(args, deps);
    return;
  }

  const { tools } = args;
  const by = args.by === 'day' ? 'day' : 'model';
  const pricing = deps.loadPricing();

  const result = {};

  if (tools.includes('claude')) {
    const records = (await deps.collectClaudeUsage({ cache: args.cache })).filter((r) => inDateRange(r.timestamp, args.since, args.until));
    result.claude = groupClaudeRows(records, by);
  }
  if (tools.includes('codex')) {
    const records = (await deps.collectCodexUsage({ cache: args.cache })).filter((r) => inDateRange(r.timestamp, args.since, args.until));
    result.codex = groupCodexRows(records, by);
  }
  if (tools.includes('antigravity')) {
    result.antigravity = deps.collectAntigravityActivity({ since: args.since, until: args.until });
  }

  const limits = args.limits ? await gatherLimits(tools, deps) : null;

  if (args.json) {
    console.log(JSON.stringify(limits ? { ...result, limits } : result, null, 2));
    return;
  }

  if (result.claude) {
    console.log(`\nClaude Code CLI (${by === 'day' ? 'by day' : 'by model'})`);
    console.log(result.claude.length ? claudeTable(result.claude, by, pricing) : '  (no usage found)');
    if (args.chart && result.claude.length) {
      console.log();
      console.log(renderBarChart(result.claude.map((r) => ({ label: r.key, value: r.total }))));
    }
  }
  if (result.codex) {
    console.log(`\nCodex CLI (${by === 'day' ? 'by day' : 'by model'})`);
    console.log(result.codex.length ? codexTable(result.codex, by, pricing) : '  (no usage found)');
    if (args.chart && result.codex.length) {
      console.log();
      console.log(renderBarChart(result.codex.map((r) => ({ label: r.key, value: r.total }))));
    }
  }
  if (result.antigravity) {
    console.log('\nAntigravity CLI (agy) — activity, not tokens (see note)');
    const ag = result.antigravity;
    if (ag.available && ag.byDay) {
      const headers = ['Date', 'Sessions', 'Turns'];
      const body = ag.byDay.map((r) => [r.day, String(r.sessions), String(r.turns)]);
      console.log(renderTable(headers, body, [1, 2]));
      console.log(`  all-time: ${ag.totalConversations} conversations, ${formatCompact(ag.totalSteps ?? 0)} agent steps`);
      if (args.chart && ag.byDay.length) {
        console.log();
        console.log(renderBarChart(ag.byDay.map((r) => ({ label: r.day, value: r.turns }))));
      }
    }
    console.log(`  ${ag.note}`);
  }

  if (limits) {
    console.log('\n--- Rate limits ---');
    printLimits(limits);
  }

  console.log('');
}
