import { app, Tray, Menu, BrowserWindow, nativeImage, ipcMain, screen } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { readClaudeRateLimit } from '../src/claude-ratelimit.mjs';
import { readCodexRateLimit } from '../src/codex-ratelimit.mjs';
import { readAntigravityRateLimit } from '../src/antigravity-ratelimit.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_INTERVAL_MS = 30_000;

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
  win.on('blur', () => {
    if (win && !win.webContents.isDevToolsOpened()) win.hide();
  });
}

function positionWindowNearTray(bounds) {
  if (!win) return;
  const { workArea } = screen.getPrimaryDisplay();
  const [winW, winH] = win.getSize();
  let x = Math.round(bounds.x + bounds.width / 2 - winW / 2);
  let y = Math.round(bounds.y + bounds.height);
  // Windows taskbar is usually at the bottom, so the tray click gives a
  // bounds.y near the bottom of the screen; place the popup above it there.
  if (y + winH > workArea.y + workArea.height) y = bounds.y - winH;
  x = Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - winW);
  win.setPosition(x, y, false);
}

function toggleWindow(bounds) {
  if (!win) return;
  if (win.isVisible()) {
    win.hide();
    return;
  }
  positionWindowNearTray(bounds);
  win.show();
  win.focus();
  void poll();
}

function buildContextMenu() {
  return Menu.buildFromTemplate([
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

function createTray() {
  const icon = nativeImage.createFromPath(join(__dirname, 'assets', 'icon.png'));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('agent-usage — loading…');
  tray.setContextMenu(buildContextMenu());
  tray.on('click', (_event, bounds) => toggleWindow(bounds));
}

ipcMain.handle('limits:request', () => lastResult);
ipcMain.handle('limits:refresh', () => poll());

app.whenReady().then(() => {
  app.setAppUserModelId('dev.agent-usage.gui');
  createWindow();
  createTray();
  schedulePoll();
  void poll();
});

app.on('window-all-closed', (event) => {
  // A tray app has no "closing all windows" quit semantics — the tray icon
  // is the app's only persistent presence.
  event.preventDefault();
});
