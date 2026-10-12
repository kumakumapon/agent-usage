// UI strings for the tray app (English and Japanese), shared by the main
// process (tray menu, tooltip, notifications) and the widget page. Pure and
// Electron-free so it can be unit-tested.

export const LANGUAGES = ['en', 'ja'];

export const MESSAGES = {
  en: {
    'app.region': 'Rate-limit usage',
    'app.loading': 'Loading…',
    'app.noTools': 'No tools enabled — right-click the tray icon to pick one.',
    'app.noData': 'no data',
    'app.updated': 'updated {time}',
    'app.refreshing': 'refreshing…',
    'app.refresh': 'Refresh now',
    'app.hide': 'Hide (reopen from the tray icon)',
    'app.stale': 'stale',
    'app.updateFailed': 'Update failed: {error} (last OK {time})',
    'app.windowLabel': '{tool} {window}: {percent}%',
    'reset.soon': 'resets soon',
    'reset.minutes': 'resets in {n}m',
    'reset.hours': 'resets in {n}h',
    'reset.days': 'resets in {n}d',
    'window.session': 'session (5h)',
    'window.weekly': 'weekly',
    'window.weeklyModel': 'weekly ({model})',
    'window.primary': 'primary',
    'window.secondary': 'secondary',
    'tray.loading': 'agent-usage — loading…',
    'tray.noData': 'agent-usage — no data yet',
    'tray.stale': '(stale)',
    'menu.show': 'Show window',
    'menu.refresh': 'Refresh now',
    'menu.layout': 'Layout',
    'menu.alerts': 'Usage alerts ({thresholds})',
    'menu.startup': 'Start with Windows',
    'menu.language': 'Language',
    'menu.theme': 'Theme',
    'menu.quit': 'Quit',
    'layout.normal': 'Normal',
    'layout.compact': 'Compact',
    'layout.mini': 'Mini',
    'tool.claude': 'Claude Code',
    'tool.codex': 'Codex CLI',
    'tool.antigravity': 'Antigravity',
    'tool.antigravityMenu': 'Antigravity (requires agy CLI login)',
    'lang.auto': 'Auto (system)',
    'lang.en': 'English',
    'lang.ja': '日本語',
    'theme.system': 'System',
    'theme.dark': 'Dark',
    'theme.light': 'Light',
    'alert.title': '{tool}: {window} at {percent}%',
    'alert.body': 'Passed {threshold}% of the limit.',
    'update.check': 'Check for updates',
    'update.checking': 'Checking for updates…',
    'update.upToDate': 'Up to date — check again',
    'update.available': 'Download update v{version}',
    'update.downloading': 'Downloading v{version}… {percent}%',
    'update.ready': 'Restart to install v{version}',
    'update.error': 'Update check failed: {error} — retry',
    'update.openReleases': 'Open the releases page (portable build)',
    'update.devDisabled': 'Updates are unavailable in a development run',
    'update.auto': 'Check for updates automatically',
    'update.toastTitle': 'Update available: v{version}',
    'update.toastBody': 'Right-click the tray icon and choose "Download update".',
  },
  ja: {
    'app.region': 'レート制限の使用状況',
    'app.loading': '読み込み中…',
    'app.noTools': '有効なツールがありません。トレイアイコンを右クリックして選んでください。',
    'app.noData': 'データなし',
    'app.updated': '更新 {time}',
    'app.refreshing': '更新中…',
    'app.refresh': '今すぐ更新',
    'app.hide': '隠す（トレイアイコンから再表示）',
    'app.stale': '古いデータ',
    'app.updateFailed': '更新に失敗: {error}（最終成功 {time}）',
    'app.windowLabel': '{tool} {window}: {percent}%',
    'reset.soon': 'まもなくリセット',
    'reset.minutes': '{n}分後にリセット',
    'reset.hours': '{n}時間後にリセット',
    'reset.days': '{n}日後にリセット',
    'window.session': 'セッション (5時間)',
    'window.weekly': '週間',
    'window.weeklyModel': '週間 ({model})',
    'window.primary': 'プライマリ',
    'window.secondary': 'セカンダリ',
    'tray.loading': 'agent-usage — 読み込み中…',
    'tray.noData': 'agent-usage — データなし',
    'tray.stale': '(古いデータ)',
    'menu.show': 'ウィンドウを表示',
    'menu.refresh': '今すぐ更新',
    'menu.layout': 'レイアウト',
    'menu.alerts': '使用率の通知 ({thresholds})',
    'menu.startup': 'Windows 起動時に開始',
    'menu.language': '言語',
    'menu.theme': 'テーマ',
    'menu.quit': '終了',
    'layout.normal': '標準',
    'layout.compact': 'コンパクト',
    'layout.mini': 'ミニ',
    'tool.claude': 'Claude Code',
    'tool.codex': 'Codex CLI',
    'tool.antigravity': 'Antigravity',
    'tool.antigravityMenu': 'Antigravity（agy CLI のログインが必要）',
    'lang.auto': '自動（システム）',
    'lang.en': 'English',
    'lang.ja': '日本語',
    'theme.system': 'システム',
    'theme.dark': 'ダーク',
    'theme.light': 'ライト',
    'alert.title': '{tool}: {window} が {percent}%',
    'alert.body': '上限の {threshold}% を超えました。',
    'update.check': '更新を確認',
    'update.checking': '更新を確認中…',
    'update.upToDate': '最新です — 再確認',
    'update.available': 'v{version} をダウンロード',
    'update.downloading': 'v{version} をダウンロード中… {percent}%',
    'update.ready': '再起動して v{version} をインストール',
    'update.error': '更新の確認に失敗: {error} — 再試行',
    'update.openReleases': 'リリースページを開く（ポータブル版）',
    'update.devDisabled': '開発実行中は更新できません',
    'update.auto': '更新を自動で確認',
    'update.toastTitle': '更新があります: v{version}',
    'update.toastBody': 'トレイアイコンを右クリックして「ダウンロード」を選んでください。',
  },
};

/**
 * @param {string} setting 'auto' | 'en' | 'ja'
 * @param {string} [systemLocale] e.g. app.getLocale() → 'ja', 'en-US'
 * @returns {'en'|'ja'}
 */
export function resolveLanguage(setting, systemLocale = '') {
  if (setting === 'en' || setting === 'ja') return setting;
  return /^ja\b/i.test(systemLocale) ? 'ja' : 'en';
}

/**
 * Returns `t(key, params)`: the message in `lang` (falling back to English,
 * then to the key itself), with `{name}` placeholders filled from `params`.
 * @param {string} lang
 */
export function createTranslator(lang) {
  const table = MESSAGES[lang] ?? MESSAGES.en;
  return function t(key, params = {}) {
    const template = table[key] ?? MESSAGES.en[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
  };
}

/** "resets in 2h" / "2時間後にリセット" for an ISO timestamp; '' if there isn't one. */
export function formatResets(t, iso, now = Date.now()) {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - now;
  if (!Number.isFinite(ms)) return '';
  if (ms <= 0) return t('reset.soon');
  const mins = Math.round(ms / 60000);
  if (mins < 60) return t('reset.minutes', { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 48) return t('reset.hours', { n: hours });
  return t('reset.days', { n: Math.round(hours / 24) });
}

/**
 * Translates the window names the CLIs report ("session (5h)", "weekly",
 * "weekly (Opus)", "primary", …). Anything unrecognised — e.g. Antigravity's
 * "Gemini daily" — is shown as reported.
 */
export function windowLabel(t, name) {
  switch (name) {
    case 'session (5h)':
      return t('window.session');
    case 'weekly':
      return t('window.weekly');
    case 'primary':
      return t('window.primary');
    case 'secondary':
      return t('window.secondary');
    default: {
      const model = /^weekly \((.+)\)$/.exec(name);
      return model ? t('window.weeklyModel', { model: model[1] }) : name;
    }
  }
}
