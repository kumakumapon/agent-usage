export function formatInt(n) {
  return Math.round(n).toLocaleString('en-US');
}

export function formatCost(n) {
  if (n == null) return '—';
  return '$' + n.toFixed(2);
}

/**
 * Renders a simple fixed-width text table.
 * @param {string[]} headers
 * @param {Array<Array<string>>} rows
 * @param {number[]} [rightAlignCols] column indexes to right-align
 */
export function renderTable(headers, rows, rightAlignCols = []) {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)),
  );

  const pad = (str, i) => {
    const s = String(str ?? '');
    const w = widths[i];
    return rightAlignCols.includes(i) ? s.padStart(w) : s.padEnd(w);
  };

  const line = (cells) => cells.map((c, i) => pad(c, i)).join('  ');
  const separator = widths.map((w) => '-'.repeat(w)).join('  ');

  const out = [line(headers), separator];
  for (const row of rows) out.push(line(row));
  return out.join('\n');
}

const BLOCK_FULL = '█';
const BLOCK_EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];

/**
 * Renders a horizontal bar for one value against a shared max, using
 * eighth-block characters for sub-character precision.
 * @param {number} value
 * @param {number} max
 * @param {number} width bar width in characters
 */
function bar(value, max, width) {
  if (max <= 0) return ' '.repeat(width);
  const eighths = Math.round((Math.max(value, 0) / max) * width * 8);
  const full = Math.floor(eighths / 8);
  const rem = eighths % 8;
  let s = BLOCK_FULL.repeat(Math.min(full, width));
  if (full < width && rem > 0) s += BLOCK_EIGHTHS[rem];
  return s.padEnd(width, ' ');
}

/**
 * Renders a horizontal bar chart: one row per entry, label left-aligned,
 * bar scaled to the largest value, formatted value on the right.
 * @param {Array<{label: string, value: number}>} rows
 * @param {{width?: number, formatValue?: (n: number) => string}} [opts]
 */
export function renderBarChart(rows, opts = {}) {
  const width = opts.width ?? 30;
  const formatValue = opts.formatValue ?? ((n) => formatInt(n));
  if (rows.length === 0) return '  (no data)';

  const labelWidth = Math.max(...rows.map((r) => r.label.length));
  const max = Math.max(...rows.map((r) => r.value), 0);
  const valueStrs = rows.map((r) => formatValue(r.value));
  const valueWidth = Math.max(...valueStrs.map((v) => v.length));

  return rows
    .map((r, i) => `${r.label.padEnd(labelWidth)}  ${bar(r.value, max, width)}  ${valueStrs[i].padStart(valueWidth)}`)
    .join('\n');
}

/**
 * Renders a single "[####------] 42%" quota/limit gauge.
 * @param {number|null} percent 0-100, or null for unknown
 * @param {number} [width]
 */
export function renderGauge(percent, width = 10) {
  if (percent == null) return `[${' '.repeat(width)}] —`;
  const clamped = Math.max(0, Math.min(100, percent));
  return `[${bar(clamped, 100, width)}] ${Math.round(clamped)}%`;
}
