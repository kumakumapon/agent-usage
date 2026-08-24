import fs from 'node:fs';
import path from 'node:path';
import { PRICING_FILE } from './paths.mjs';

const TEMPLATE = {
  _comment: [
    'Model prices in USD per 1,000,000 tokens. Left empty on purpose: prices change often',
    'and vary by plan, so this tool never guesses them. Fill in the models you use from',
    'your provider\'s current pricing page; costs then appear automatically.',
    'Unknown/unfilled models simply show token counts with no cost column.',
  ],
  claude: {
    // "claude-opus-5": { "input": 15, "output": 75, "cacheWrite": 18.75, "cacheRead": 1.5 }
  },
  codex: {
    // "gpt-5.6-luna": { "input": 5, "cachedInput": 1.25, "output": 15 }
  },
};

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
