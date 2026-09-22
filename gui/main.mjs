import { app, Tray, Menu, BrowserWindow, nativeImage, ipcMain, screen } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_INTERVAL_MS = 30_000;

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
let polling = false;
let lastResult = null;

const enabledTools = { claude: true, codex: true, antigravity: false };

function toolLabel(name) {
  return { claude: 'Claude Code', codex: 'Codex CLI', antigravity: 'Antigravity' }[name];
}

async function gatherLimits() {
  const result = {};
  if (enabledTools.claude) result.claude = await readClaudeRateLimit();
  if (enabledTools.codex) result.codex = await readCodexRateLimit();
  if (enabledTools.antigravity) result.antigravity = await readAntigravityRateLimit();
  return result;
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
    if (data?.error) {
      lines.push(`${toolLabel(tool)}: ${data.error}`);
      continue;
    }
    for (const w of data?.windows || []) {
      lines.push(`${toolLabel(tool)} ${w.window}: ${w.percent ?? '?'}%`);
    }
  }
  return lines.join('\n') || 'agent-usage';
}

async function poll() {
  if (polling) return;
  polling = true;
  try {
    lastResult = await gatherLimits();
    if (tray) tray.setToolTip(tooltipFor(lastResult));
    if (win) win.webContents.send('limits:update', { result: lastResult, fetchedAt: new Date().toISOString() });
  } finally {
    polling = false;
  }
}

function schedulePoll(intervalMs = DEFAULT_INTERVAL_MS) {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(poll, intervalMs);
}

function createWindow() {
  win = new BrowserWindow({
    width: 380,
    height: 420,
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
    const { x, y } = defaultWindowPosition();
    win.setPosition(x, y, false);
  }
  win.show();
  syncTrayMenu();
  void poll();
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
      label: 'Claude Code',
      type: 'checkbox',
      checked: enabledTools.claude,
      click: (item) => { enabledTools.claude = item.checked; void poll(); },
    },
    {
      label: 'Codex CLI',
      type: 'checkbox',
      checked: enabledTools.codex,
      click: (item) => { enabledTools.codex = item.checked; void poll(); },
    },
    {
      label: 'Antigravity (requires agy CLI login)',
      type: 'checkbox',
      checked: enabledTools.antigravity,
      click: (item) => { enabledTools.antigravity = item.checked; void poll(); },
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

app.whenReady().then(() => {
  app.setAppUserModelId('dev.agent-usage.gui');
  createWindow();
  createTray();
  schedulePoll();
  showWindow();
});

app.on('window-all-closed', (event) => {
  // A tray app has no "closing all windows" quit semantics — the tray icon
  // is the app's only persistent presence.
  event.preventDefault();
});
