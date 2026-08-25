import { parseArgs } from 'node:util';
import { collectClaudeUsage } from './claude-usage.mjs';
import { collectCodexUsage } from './codex-usage.mjs';
import { collectAntigravityActivity } from './antigravity-usage.mjs';
import { readClaudeRateLimit } from './claude-ratelimit.mjs';
import { readCodexRateLimit } from './codex-ratelimit.mjs';
import { readAntigravityRateLimit } from './antigravity-ratelimit.mjs';
import { loadPricing, estimateCost, PRICING_FILE } from './pricing.mjs';
import { formatInt, formatCompact, formatCost, formatAge, formatUntil, renderTable, renderBarChart, renderGauge } from './format.mjs';

const HELP = `Usage: agent-usage [command] [options]

Commands:
  limits (default)   Current rate-limit / quota utilization: a live query for
                     Claude (\`claude -p /usage\`) and Antigravity
                     (\`agy -p /usage\`), and local session logs for Codex.
  usage               Token usage (by model or by day) for Claude Code CLI and
                     Codex CLI from their session logs, plus Antigravity's
                     local activity; run this explicitly to see it.

Options:
  --tool <name>     Limit to one tool: claude, codex, antigravity, all (default: all)
  --watch               [limits only] Redraw like a dashboard, re-fetching on an interval
  --interval <sec>       [limits only] Refresh interval in seconds for --watch (default: 30)
  --by <mode>        [usage only] Group rows by: model (default) or day
  --since <date>      [usage only] Only include usage on/after this date (YYYY-MM-DD)
  --until <date>       [usage only] Only include usage on/before this date (YYYY-MM-DD)
  --chart               [usage only] Also print a bar chart of totals per row
  --no-limits            [usage only] Skip the rate-limits section (shown by default)
  --json                Print machine-readable JSON instead of tables
  --pricing             Print the path to the editable pricing file and exit
  -h, --help            Show this help

Cost estimates use rates you supply in:
  ${PRICING_FILE}
Models without a configured rate show token counts with no cost column.
`;

function parseCliArgs(argv) {
  // util.parseArgs has no built-in --no-x negation for booleans, so handle
  // --no-limits manually before parsing.
  const noLimits = argv.includes('--no-limits');
  const filtered = argv.filter((a) => a !== '--no-limits');

  const { values, positionals } = parseArgs({
    args: filtered,
    allowPositionals: true,
    options: {
      tool: { type: 'string', default: 'all' },
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
  const command = positionals[0] === 'usage' ? 'usage' : 'limits';
  return { ...values, command, limits: !noLimits };
}

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

async function gatherLimits(tools) {
  const result = {};
  if (tools.includes('claude')) result.claude = await readClaudeRateLimit();
  if (tools.includes('codex')) result.codex = await readCodexRateLimit();
  if (tools.includes('antigravity')) result.antigravity = await readAntigravityRateLimit();
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
    if (result.codex) {
      console.log(limitsTable(result.codex.windows));
      console.log(`  plan: ${result.codex.planType || 'unknown'}`);
      console.log(`  as of: ${result.codex.fetchedAt} (${formatAge(result.codex.fetchedAt)}, last recorded API response)`);
      const now = Date.now();
      if (result.codex.windows.some((w) => w.resetsAt && new Date(w.resetsAt).getTime() < now)) {
        console.log('  WARNING: at least one reset time above is already in the past — Codex hasn\'t made an');
        console.log('  API call since then, so this is stale. Run Codex once to refresh, then re-run this command.');
      }
    } else {
      console.log('  no rate-limit data found in recent session logs');
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function watchLimits(tools, intervalSec) {
  let stopped = false;
  process.on('SIGINT', () => {
    stopped = true;
    console.log('\n\nStopped watching.');
    process.exit(0);
  });

  while (!stopped) {
    const result = await gatherLimits(tools);
    console.clear();
    console.log(`agent-usage limits — watching (refresh every ${intervalSec}s, Ctrl+C to stop)`);
    console.log(`last updated: ${new Date().toLocaleString()}`);
    printLimits(result);
    console.log('');
    await sleep(intervalSec * 1000);
  }
}

async function runLimits(args) {
  const tools = args.tool === 'all' ? ['claude', 'codex', 'antigravity'] : args.tool.split(',');

  if (args.watch) {
    if (args.json) {
      console.error('--watch cannot be combined with --json');
      process.exitCode = 1;
      return;
    }
    const intervalSec = Math.max(10, Number(args.interval) || 30);
    await watchLimits(tools, intervalSec);
    return;
  }

  const result = await gatherLimits(tools);

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printLimits(result);
  console.log('');
}

export async function run(argv) {
  const args = parseCliArgs(argv);

  if (args.help) {
    console.log(HELP);
    return;
  }
  if (args.pricing) {
    loadPricing(); // ensures the file exists
    console.log(PRICING_FILE);
    return;
  }

  if (args.command === 'limits') {
    await runLimits(args);
    return;
  }

  const tools = args.tool === 'all' ? ['claude', 'codex', 'antigravity'] : args.tool.split(',');
  const by = args.by === 'day' ? 'day' : 'model';
  const pricing = loadPricing();

  const result = {};

  if (tools.includes('claude')) {
    const records = (await collectClaudeUsage()).filter((r) => inDateRange(r.timestamp, args.since, args.until));
    result.claude = groupClaudeRows(records, by);
  }
  if (tools.includes('codex')) {
    const records = (await collectCodexUsage()).filter((r) => inDateRange(r.timestamp, args.since, args.until));
    result.codex = groupCodexRows(records, by);
  }
  if (tools.includes('antigravity')) {
    result.antigravity = collectAntigravityActivity({ since: args.since, until: args.until });
  }

  const limits = args.limits ? await gatherLimits(tools) : null;

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
    if (ag.available) {
      const headers = ['Date', 'Sessions', 'Turns'];
      const body = ag.byDay.map((r) => [r.day, String(r.sessions), String(r.turns)]);
      console.log(renderTable(headers, body, [1, 2]));
      console.log(`  all-time: ${ag.totalConversations} conversations, ${formatCompact(ag.totalSteps)} agent steps`);
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
