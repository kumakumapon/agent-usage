import fs from 'node:fs';
import path from 'node:path';
import { PRICING_FILE } from './paths.mjs';

const TEMPLATE = {
  _comment: [
    'Model prices in USD per 1,000,000 tokens. Left empty on purpose: prices change often',
    'and vary by plan, so this tool never guesses them. Fill in the models you use from',
    'your provider\'s current pricing page; costs then appear automatically.',
    'Shape:  "claude": { "<model>": { "input": 0, "output": 0, "cacheWrite": 0, "cacheRead": 0 } }',
    '        "codex":  { "<model>": { "input": 0, "cachedInput": 0, "output": 0 } }',
    '(replace the zeros with the real rates). <model> is the name in the first column of',
    '`agent-usage usage`. Unknown/unfilled models simply show token counts with no cost.',
  ],
  claude: {},
  codex: {},
};

// Which token counts each provider's rates apply to.
const RATE_KEYS = {
  claude: ['input', 'output', 'cacheWrite', 'cacheRead'],
  codex: ['input', 'cachedInput', 'output'],
};

/**
 * True when at least one row has no configured rate — i.e. its Cost column
 * shows "—". Rows are the grouped rows the usage tables are built from.
 * @param {object} pricing
 * @param {'claude'|'codex'} provider
 * @param {Array<Record<string, any>>} rows
 */
export function hasUnpricedRows(pricing, provider, rows) {
  return rows.some((row) => {
    const tokens = Object.fromEntries(RATE_KEYS[provider].map((key) => [key, row[key]]));
    return estimateCost(pricing, provider, row.model, tokens) == null;
  });
}

/**
 * How to set up cost estimates. Contains no prices — they change and differ
 * by plan, so the tool never supplies any.
 * @param {string} file path of the pricing file
 */
export function pricingHelp(file) {
  return [
    `Cost estimates use rates you provide, in USD per 1,000,000 tokens. Edit:`,
    `  ${file}`,
    '',
    'Add each model you use, with the current rates from your provider\'s pricing page:',
    '  {',
    '    "claude": { "<model>": { "input": <usd>, "output": <usd>, "cacheWrite": <usd>, "cacheRead": <usd> } },',
    '    "codex":  { "<model>": { "input": <usd>, "cachedInput": <usd>, "output": <usd> } }',
    '  }',
    '',
    '<model> is the name in the first column of `agent-usage usage`. Models without',
    'a rate show "—" in the Cost column rather than a guess.',
    '',
    'When your provider changes its prices, edit the numbers in that file — nothing',
    'else needs updating. Pricing pages:',
    '  Claude   https://claude.com/pricing',
    '  OpenAI   https://openai.com/api/pricing/',
  ].join('\n');
}

export function loadPricing() {
  try {
    const raw = fs.readFileSync(PRICING_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      try {
        fs.mkdirSync(path.dirname(PRICING_FILE), { recursive: true });
        fs.writeFileSync(PRICING_FILE, JSON.stringify(TEMPLATE, null, 2) + '\n');
      } catch {
        // best effort; fall through with in-memory template
      }
      return TEMPLATE;
    }
    throw err;
  }
}

/**
 * @param {object} pricing loaded pricing config
 * @param {'claude'|'codex'} provider
 * @param {string} model
 * @param {Record<string, number>} tokens token counts keyed by rate name (input/output/cacheWrite/cacheRead/cachedInput)
 * @returns {number|null} cost in USD, or null if the model has no configured rates
 */
export function estimateCost(pricing, provider, model, tokens) {
  const rates = pricing?.[provider]?.[model];
  if (!rates) return null;
  let total = 0;
  let matched = false;
  for (const [key, count] of Object.entries(tokens)) {
    const rate = rates[key];
    if (typeof rate === 'number' && count > 0) {
      total += (count / 1_000_000) * rate;
      matched = true;
    }
  }
  return matched ? total : null;
}

export { PRICING_FILE };
