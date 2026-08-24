import { parseArgs } from 'node:util';
import { collectClaudeUsage } from './claude-usage.mjs';
import { collectCodexUsage } from './codex-usage.mjs';
import { collectAntigravityActivity } from './antigravity-usage.mjs';
import { readClaudeRateLimit } from './claude-ratelimit.mjs';
import { readCodexRateLimit } from './codex-ratelimit.mjs';
import { readAntigravityRateLimit } from './antigravity-ratelimit.mjs';
import { loadPricing, estimateCost, PRICING_FILE } from './pricing.mjs';
import { formatInt, formatCost, renderTable, renderBarChart, renderGauge } from './format.mjs';

const HELP = `Usage: agent-usage [command] [options]

Commands:
  usage (default)   Token usage for Claude Code CLI and Codex CLI from their
                     session logs; Antigravity's local status is reported
                     separately since it exposes no token counts on disk.
  limits             Current rate-limit / quota utilization: read from local
                     cache for Claude/Codex, and via a live \`agy -p /usage\`
                     call for Antigravity (its quota is never written to disk).

Options:
  --tool <name>     Limit to one tool: claude, codex, antigravity, all (default: all)
  --by <mode>        [usage only] Group rows by: model (default) or day
  --since <date>      [usage only] Only include usage on/after this date (YYYY-MM-DD)
  --until <date>       [usage only] Only include usage on/before this date (YYYY-MM-DD)
  --chart               [usage only] Also print a bar chart of totals per row
  --json                Print machine-readable JSON instead of tables
  --pricing             Print the path to the editable pricing file and exit
  -h, --help            Show this help

Cost estimates use rates you supply in:
  ${PRICING_FILE}
Models without a configured rate show token counts with no cost column.
`;

function parseCliArgs(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      tool: { type: 'string', default: 'all' },
      by: { type: 'string', default: 'model' },
      since: { type: 'string' },
      until: { type: 'string' },
      chart: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      pricing: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const command = positionals[0] === 'limits' ? 'limits' : 'usage';
  return { ...values, command };
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
      formatInt(r.input),
      formatInt(r.output),
      formatInt(r.cacheWrite),
      formatInt(r.cacheRead),
      formatInt(r.total),
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
    formatInt(grandTotal),
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
      formatInt(r.input),
      formatInt(r.cachedInput),
      formatInt(r.output),
      formatInt(r.total),
      formatCost(cost),
    ];
  });

  body.push(['TOTAL', '', '', '', '', formatInt(grandTotal), anyCost ? formatCost(grandCost) : '—']);

  return renderTable(headers, body, [1, 2, 3, 4, 5, 6]);
}

function limitsTable(windows) {
  const headers = ['Window', 'Usage', 'Resets At'];
  const body = windows.map((w) => [w.window, renderGauge(w.percent), w.resetsAt || '—']);
  return renderTable(headers, body, []);
}

async function runLimits(args) {
  const tools = args.tool === 'all' ? ['claude', 'codex', 'antigravity'] : args.tool.split(',');
  const result = {};

  if (tools.includes('claude')) result.claude = readClaudeRateLimit();
  if (tools.includes('codex')) result.codex = await readCodexRateLimit();
  if (tools.includes('antigravity')) result.antigravity = await readAntigravityRateLimit();

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if ('claude' in result) {
    console.log('\nClaude Code CLI rate limits');
    if (result.claude) {
      console.log(limitsTable(result.claude.windows));
      console.log(`  as of: ${result.claude.fetchedAt} (last time Claude Code refreshed this locally)`);
    } else {
      console.log('  no cached rate-limit data found (run Claude Code at least once)');
    }
  }

  if ('codex' in result) {
    console.log('\nCodex CLI rate limits');
    if (result.codex) {
      console.log(limitsTable(result.codex.windows));
      console.log(`  plan: ${result.codex.planType || 'unknown'}`);
      console.log(`  as of: ${result.codex.fetchedAt} (last recorded API response)`);
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

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
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
      console.log(`  all-time: ${ag.totalConversations} conversations, ${formatInt(ag.totalSteps)} agent steps`);
      if (args.chart && ag.byDay.length) {
        console.log();
        console.log(renderBarChart(ag.byDay.map((r) => ({ label: r.day, value: r.turns }))));
      }
    }
    console.log(`  ${ag.note}`);
  }
  console.log('');
}
