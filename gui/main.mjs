import { app, Tray, Menu, BrowserWindow, nativeImage, ipcMain, screen } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// The rate-limit readers live in the repo's ../src (shared with the CLI).
// In dev that's a real relative path; once packaged, electron-builder can't
// place files from outside gui/ into app.asar, so they're copied instead to
// resources/src via extraResources and must be found there at runtime.
const srcDir = app.isPackaged ? join(process.resourcesPath, 'src') : join(__dirname, '..', 'src');
const importSrc = (name) => import(pathToFileURL(join(srcDir, name)).href);

const { readClaudeRateLimit } = await importSrc('claude-ratelimit.mjs');
const { readCodexRateLimit } = await importSrc('codex-ratelimit.mjs');
const { readAntigravityRateLimit } = await importSrc('antigravity-ratelimit.mjs');

let tray = null;
let win = null;
let pollTimer = null;
let lastResult = null;

const enabledTools = { claude: true, codex: true, antigravity: false };

// Window size per layout — all portrait (taller than wide) so the widget
// takes less horizontal desktop space than the original 380x420 box.
const LAYOUTS = {
  normal: { label: 'Normal', size: [380, 420] },
  compact: { label: 'Compact', size: [240, 480] },
  mini: { label: 'Mini', size: [140, 560] },
};
let layoutMode = 'normal';
// Last position the user dragged the widget to; null means "use the default
// bottom-right corner".
let savedPosition = null;

// Persisted across restarts: which tools are enabled, the layout, and where
// the widget was last placed.
const settingsPath = () => join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  let raw;
  try {
    raw = JSON.parse(readFileSync(settingsPath(), 'utf8'));
  } catch {
    return; // missing or corrupt: keep defaults
  }
  for (const name of Object.keys(enabledTools)) {
    if (typeof raw.enabledTools?.[name] === 'boolean') enabledTools[name] = raw.enabledTools[name];
  }
  if (LAYOUTS[raw.layoutMode]) layoutMode = raw.layoutMode;
  const pos = raw.position;
  if (Number.isFinite(pos?.x) && Number.isFinite(pos?.y)) savedPosition = { x: pos.x, y: pos.y };
}

let saveTimer = null;
function writeSettings() {
  try {
    writeFileSync(
      settingsPath(),
      JSON.stringify({ enabledTools, layoutMode, position: savedPosition }, null, 2),
    );
  } catch (err) {
    console.error('could not save settings:', err.message);
  }
}

function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeSettings, 300);
}

function toolLabel(name) {
  return { claude: 'Claude Code', codex: 'Codex CLI', antigravity: 'Antigravity' }[name];
}

// Each tool is fetched independently so a slow one (agy takes 5-10s to
// start) never delays the others' updates. Claude and Antigravity spawn a
// CLI process per fetch, so they poll far less often than Codex.
const TOOLS = {
  claude: { read: readClaudeRateLimit, intervalMs: 120_000 },
  codex: { read: readCodexRateLimit, intervalMs: 30_000 },
  antigravity: { read: readAntigravityRateLimit, intervalMs: 300_000 },
};
// While the widget is hidden only the tray tooltip can go stale, so poll
// that many times slower.
const HIDDEN_INTERVAL_FACTOR = 4;
const SCHEDULER_TICK_MS = 5_000;

const toolState = Object.fromEntries(
  Object.keys(TOOLS).map((name) => [
    name,
    // data/lastOkAt: the last *successful* reading; error: the latest
    // failure (cleared by the next success). fetchedAt is the last attempt.
    { data: null, error: null, lastOkAt: 0, fetchedAt: 0, inFlight: false },
  ]),
);

// What the widget sees for one tool. A failed refresh keeps showing the last
// good reading, flagged `stale` with the error and when it was last good,
// rather than blanking the gauges.
function viewOf(state) {
  if (!state.error) return state.data;
  if (!state.data) return { error: state.error };
  return { ...state.data, stale: true, error: state.error, lastOkAt: new Date(state.lastOkAt).toISOString() };
}

function currentResult() {
  const result = {};
  for (const name of Object.keys(TOOLS)) {
    const state = toolState[name];
    if (enabledTools[name] && (state.data || state.error)) result[name] = viewOf(state);
  }
  return result;
}

function publish() {
  lastResult = currentResult();
  if (tray) tray.setToolTip(tooltipFor(lastResult));
  if (win) {
    // "updated" means the last successful reading, not the last attempt.
    const latest = Math.max(0, ...Object.keys(lastResult).map((n) => toolState[n].lastOkAt));
    win.webContents.send('limits:update', {
      result: lastResult,
      fetchedAt: new Date(latest || Date.now()).toISOString(),
    });
  }
}

async function fetchTool(name) {
  const state = toolState[name];
  if (state.inFlight) return;
  state.inFlight = true;
  try {
    const result = await TOOLS[name].read();
    if (result?.error) {
      state.error = result.error;
    } else {
      state.data = result;
      state.error = null;
      state.lastOkAt = Date.now();
    }
  } catch (err) {
    state.error = err.message || String(err);
  } finally {
    state.inFlight = false;
    state.fetchedAt = Date.now();
  }
  if (enabledTools[name]) publish();
}

// Picks the single highest-utilization window across enabled tools, so the
// tray tooltip/title can show one glanceable number without opening the
// popup.
function summarize(result) {
  let worst = null;
  for (const [tool, data] of Object.entries(result)) {
    for (const w of data?.windows || []) {
      if (typeof w.percent !== 'number') continue;
      if (!worst || w.percent > worst.percent) worst = { tool, ...w };
    }
  }
  return worst;
}

function tooltipFor(result) {
  const worst = summarize(result);
  if (!worst) return 'agent-usage — no data yet';
  const lines = [];
  for (const [tool, data] of Object.entries(result)) {
    if (data?.error && !data.stale) {
      lines.push(`${toolLabel(tool)}: ${data.error}`);
      continue;
    }
    for (const w of data?.windows || []) {
      lines.push(`${toolLabel(tool)} ${w.window}: ${w.percent ?? '?'}%${data.stale ? ' (stale)' : ''}`);
    }
  }
  return lines.join('\n') || 'agent-usage';
}

// Manual refresh: fetches every enabled tool in parallel; each publishes
// as soon as it lands.
async function poll() {
  const names = Object.keys(TOOLS).filter((n) => enabledTools[n]);
  await Promise.allSettled(names.map(fetchTool));
  // Clears the renderer's "refreshing…" even if every fetch was skipped as in-flight.
  publish();
}

// Fetches only the tools whose data is older than their interval.
function tick() {
  const factor = win?.isVisible() ? 1 : HIDDEN_INTERVAL_FACTOR;
  const now = Date.now();
  for (const [name, { intervalMs }] of Object.entries(TOOLS)) {
    if (!enabledTools[name]) continue;
    if (now - toolState[name].fetchedAt >= intervalMs * factor) void fetchTool(name);
  }
}

function schedulePoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(tick, SCHEDULER_TICK_MS);
}

function setToolEnabled(name, enabled) {
  enabledTools[name] = enabled;
  saveSettings();
  if (enabled && !toolState[name].data) void fetchTool(name);
  else publish();
}

function createWindow() {
  win = new BrowserWindow({
    width: LAYOUTS[layoutMode].size[0],
    height: LAYOUTS[layoutMode].size[1],
    show: false,
    frame: false,
    resizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(join(__dirname, 'index.html'));
  // Widget mode: the window stays open once shown (no blur-hide) so it acts
  // as a persistent always-on-top HUD instead of a tray popup that
  // disappears the moment it loses focus.
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.webContents.on('did-finish-load', () => win.webContents.send('layout:update', layoutMode));
  // 'moved' fires once a drag ends (not on every pixel).
  win.on('moved', () => {
    const [x, y] = win.getPosition();
    savedPosition = { x, y };
    saveSettings();
  });
}

function clampToWorkArea() {
  if (!win) return;
  const { workArea } = screen.getDisplayMatching(win.getBounds());
  const [winW, winH] = win.getSize();
  const [x, y] = win.getPosition();
  const clampedX = Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - winW);
  const clampedY = Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - winH);
  win.setPosition(clampedX, clampedY, false);
}

function setLayout(mode) {
  if (!LAYOUTS[mode] || !win) return;
  layoutMode = mode;
  // Some Windows/driver combinations ignore setSize() on a window created
  // with resizable:false; toggling it around the resize is a cheap,
  // harmless guard against that. The window still can't be manually
  // resized since it's frameless (no border to drag).
  win.setResizable(true);
  win.setSize(...LAYOUTS[mode].size);
  win.setResizable(false);
  clampToWorkArea();
  win.webContents.send('layout:update', layoutMode);
  syncTrayMenu();
  saveSettings();
}

function defaultWindowPosition() {
  const { workArea } = screen.getPrimaryDisplay();
  const [winW, winH] = win.getSize();
  const margin = 16;
  return {
    x: workArea.x + workArea.width - winW - margin,
    y: workArea.y + workArea.height - winH - margin,
  };
}

function showWindow() {
  if (!win) return;
  if (!win.isVisible()) {
    const { x, y } = savedPosition ?? defaultWindowPosition();
    win.setPosition(x, y, false);
    clampToWorkArea();
  }
  win.show();
  syncTrayMenu();
  publish();
  tick();
}

function hideWindow() {
  if (!win) return;
  win.hide();
  syncTrayMenu();
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible()) {
    hideWindow();
  } else {
    showWindow();
  }
}

function buildContextMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'Show window',
      type: 'checkbox',
      checked: win?.isVisible() ?? false,
      click: () => toggleWindow(),
    },
    { label: 'Refresh now', click: () => void poll() },
    { type: 'separator' },
    {
      label: 'Layout',
      submenu: Object.entries(LAYOUTS).map(([mode, { label }]) => ({
        label,
        type: 'radio',
        checked: layoutMode === mode,
        click: () => setLayout(mode),
      })),
    },
    { type: 'separator' },
    {
      label: 'Claude Code',
      type: 'checkbox',
      checked: enabledTools.claude,
      click: (item) => setToolEnabled('claude', item.checked),
    },
    {
      label: 'Codex CLI',
      type: 'checkbox',
      checked: enabledTools.codex,
      click: (item) => setToolEnabled('codex', item.checked),
    },
    {
      label: 'Antigravity (requires agy CLI login)',
      type: 'checkbox',
      checked: enabledTools.antigravity,
      click: (item) => setToolEnabled('antigravity', item.checked),
    },
    { type: 'separator' },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

function syncTrayMenu() {
  if (tray) tray.setContextMenu(buildContextMenu());
}

function createTray() {
  const icon = nativeImage.createFromPath(join(__dirname, 'assets', 'icon.png'));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('agent-usage — loading…');
  syncTrayMenu();
  tray.on('click', () => toggleWindow());
}

ipcMain.handle('limits:request', () => lastResult);
ipcMain.handle('limits:refresh', () => poll());
ipcMain.handle('window:hide', () => hideWindow());

// Without this, running `npm start` (or launching the built exe) while an
// older instance is still in the tray silently leaves two apps running —
// easy to end up right-clicking a stale tray icon from a previous run while
// believing you're testing the latest code.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(() => {
    app.setAppUserModelId('dev.agent-usage.gui');
    loadSettings();
    createWindow();
    createTray();
    schedulePoll();
    showWindow();
  });
}

// Flush a debounced save that hasn't fired yet.
app.on('before-quit', () => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    writeSettings();
  }
});

app.on('window-all-closed', (event) => {
  // A tray app has no "closing all windows" quit semantics — the tray icon
  // is the app's only persistent presence.
  event.preventDefault();
});
