import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Reads the palette straight out of gui/index.html so the CSS can't drift
// below WCAG AA unnoticed.
const html = fs.readFileSync(new URL('../gui/index.html', import.meta.url), 'utf8');

function parseVars(block) {
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2]]));
}

const lightBlock = /@media \(prefers-color-scheme: light\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(html);
const darkBlock = /:root\s*\{([^}]*)\}/.exec(html);
assert.ok(darkBlock && lightBlock, 'palette blocks not found in gui/index.html');

const THEMES = { dark: parseVars(darkBlock[1]), light: { ...parseVars(darkBlock[1]), ...parseVars(lightBlock[1]) } };

function luminance(hex) {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Text that sits on the page background: WCAG AA for normal text is 4.5:1.
const TEXT = ['fg', 'fg-strong', 'muted', 'error', 'warn-text'];
// Bar fills sit on the bar track: WCAG non-text contrast is 3:1.
const BARS = ['ok', 'warn', 'crit'];

for (const [theme, vars] of Object.entries(THEMES)) {
  test(`${theme}: text colours meet 4.5:1 on the background`, () => {
    for (const name of TEXT) {
      assert.ok(vars[name], `--${name} missing`);
      const ratio = contrast(vars[name], vars.bg);
      assert.ok(ratio >= 4.5, `--${name} ${vars[name]} on ${vars.bg} is ${ratio.toFixed(2)}:1`);
    }
  });

  test(`${theme}: bar fills meet 3:1 on the track`, () => {
    for (const name of BARS) {
      const ratio = contrast(vars[name], vars.track);
      assert.ok(ratio >= 3, `--${name} ${vars[name]} on ${vars.track} is ${ratio.toFixed(2)}:1`);
    }
  });

  test(`${theme}: focus ring meets 3:1 on the background`, () => {
    const ratio = contrast(vars.focus, vars.bg);
    assert.ok(ratio >= 3, `--focus is ${ratio.toFixed(2)}:1`);
  });
}

test('every light-theme variable overrides a dark one (no stray names)', () => {
  const dark = Object.keys(THEMES.dark);
  for (const name of Object.keys(parseVars(lightBlock[1]))) assert.ok(dark.includes(name), `--${name}`);
});
