import test from 'node:test';
import assert from 'node:assert/strict';
import { MESSAGES, createTranslator, formatResets, resolveLanguage, windowLabel } from '../gui/i18n.mjs';

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('every language has exactly the same keys as English', () => {
  const english = Object.keys(MESSAGES.en).sort();
  for (const [lang, table] of Object.entries(MESSAGES)) {
    assert.deepEqual(Object.keys(table).sort(), english, `${lang} keys differ from en`);
  }
});

test('translations use the same {placeholders} as English', () => {
  for (const [key, english] of Object.entries(MESSAGES.en)) {
    for (const [lang, table] of Object.entries(MESSAGES)) {
      assert.deepEqual(placeholders(table[key]), placeholders(english), `${lang}:${key}`);
    }
  }
});

test('resolveLanguage honours an explicit choice, else follows the system locale', () => {
  assert.equal(resolveLanguage('en', 'ja-JP'), 'en');
  assert.equal(resolveLanguage('ja', 'en-US'), 'ja');
  assert.equal(resolveLanguage('auto', 'ja'), 'ja');
  assert.equal(resolveLanguage('auto', 'ja-JP'), 'ja');
  assert.equal(resolveLanguage('auto', 'en-US'), 'en');
  assert.equal(resolveLanguage('auto', 'fr'), 'en');
  assert.equal(resolveLanguage('auto'), 'en');
  assert.equal(resolveLanguage('bogus', 'ja'), 'ja');
});

test('createTranslator fills placeholders and falls back sensibly', () => {
  const en = createTranslator('en');
  assert.equal(en('app.updated', { time: '10:00' }), 'updated 10:00');
  assert.equal(createTranslator('ja')('app.updated', { time: '10:00' }), '更新 10:00');
  assert.equal(en('app.updated'), 'updated {time}'); // missing param left visible
  assert.equal(en('no.such.key'), 'no.such.key');
  assert.equal(createTranslator('xx')('menu.quit'), 'Quit'); // unknown language → English
});

test('formatResets in both languages', () => {
  const now = Date.parse('2026-08-20T00:00:00Z');
  const en = createTranslator('en');
  const ja = createTranslator('ja');
  assert.equal(formatResets(en, '2026-08-20T02:00:00Z', now), 'resets in 2h');
  assert.equal(formatResets(ja, '2026-08-20T02:00:00Z', now), '2時間後にリセット');
  assert.equal(formatResets(en, '2026-08-20T00:30:00Z', now), 'resets in 30m');
  assert.equal(formatResets(en, '2026-08-27T00:00:00Z', now), 'resets in 7d');
  assert.equal(formatResets(ja, '2026-08-19T00:00:00Z', now), 'まもなくリセット');
  assert.equal(formatResets(en, null, now), '');
  assert.equal(formatResets(en, 'not a date', now), '');
});

test('windowLabel translates known names and passes others through', () => {
  const ja = createTranslator('ja');
  assert.equal(windowLabel(ja, 'session (5h)'), 'セッション (5時間)');
  assert.equal(windowLabel(ja, 'weekly'), '週間');
  assert.equal(windowLabel(ja, 'weekly (Opus)'), '週間 (Opus)');
  assert.equal(windowLabel(ja, 'primary'), 'プライマリ');
  assert.equal(windowLabel(ja, 'Gemini daily'), 'Gemini daily');
  assert.equal(windowLabel(createTranslator('en'), 'weekly (Opus)'), 'weekly (Opus)');
});
