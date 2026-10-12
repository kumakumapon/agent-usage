// Update flow for the installed tray app, as a small state machine around
// electron-updater's `autoUpdater`. The updater is injected, so this stays
// Electron-free and unit-testable; main.mjs wires it to the tray menu.
//
// Nothing here runs on its own: a check happens only when the user asks for
// one (tray menu) or has switched on automatic checks, and an update is
// downloaded and installed only after an explicit click — the app promises
// "no network access" by default, and its builds are not code-signed, so it
// never updates silently.

/**
 * @typedef {object} UpdateState
 * @property {'idle'|'checking'|'available'|'downloading'|'ready'|'upToDate'|'error'|'unsupported'} status
 * @property {string} [version]  the newer version (available / downloading / ready)
 * @property {number} [percent]  download progress, 0-100
 * @property {string} [error]    short reason (error)
 * @property {'dev'|'portable'|'platform'} [reason]  why updating isn't possible (unsupported)
 * @property {boolean} [manual]  the check was started by the user, not by the schedule
 */

/**
 * Whether this build can update itself in place. Only the installed (NSIS)
 * Windows app can: a portable exe has nothing to replace, and an unpackaged
 * dev run has no update feed.
 * @param {{isPackaged: boolean, portable: boolean, platform: string}} env
 * @returns {{ok: true}|{ok: false, reason: 'dev'|'portable'|'platform'}}
 */
export function updateSupport({ isPackaged, portable, platform }) {
  if (!isPackaged) return { ok: false, reason: 'dev' };
  if (platform !== 'win32') return { ok: false, reason: 'platform' };
  if (portable) return { ok: false, reason: 'portable' };
  return { ok: true };
}

/** First line only, capped: electron-updater's network errors run to many lines. */
export function shortError(err) {
  const text = String(err?.message ?? err ?? 'unknown error');
  const line = text.split(/\r?\n/).find((l) => l.trim()) ?? text;
  return line.length > 160 ? `${line.slice(0, 157)}…` : line;
}

/**
 * @param {object} opts
 * @param {import('node:events').EventEmitter & {
 *   autoDownload: boolean, autoInstallOnAppQuit: boolean,
 *   checkForUpdates: () => Promise<unknown>, downloadUpdate: () => Promise<unknown>, quitAndInstall: () => void,
 * }} opts.autoUpdater
 * @param {{ok: true}|{ok: false, reason: 'dev'|'portable'|'platform'}} opts.support
 * @param {(state: UpdateState, previous: UpdateState) => void} [opts.onChange]
 */
export function createUpdater({ autoUpdater, support, onChange = () => {} }) {
  /** @type {UpdateState} */
  let state = support.ok ? { status: 'idle' } : { status: 'unsupported', reason: support.reason };

  /** @param {UpdateState} next */
  function set(next) {
    const previous = state;
    state = next;
    onChange(state, previous);
  }

  // The 'error' event normally reports a failure; this covers a throw that
  // arrived without one, without reporting it twice.
  function fail(err, manual) {
    if (state.status !== 'error') set({ status: 'error', error: shortError(err), manual });
  }

  if (support.ok) {
    // Ask first, download on request; a downloaded update is still applied
    // if the user just quits.
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => set({ status: 'checking', manual: state.manual }));
    autoUpdater.on('update-available', (info) => set({ status: 'available', version: info?.version, manual: state.manual }));
    autoUpdater.on('update-not-available', () => set({ status: 'upToDate', manual: state.manual }));
    autoUpdater.on('download-progress', (p) =>
      set({ status: 'downloading', version: state.version, percent: Math.round(p?.percent ?? 0), manual: state.manual }),
    );
    autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', version: info?.version ?? state.version }));
    autoUpdater.on('error', (err) => set({ status: 'error', error: shortError(err), manual: state.manual }));
  }

  return {
    get state() {
      return state;
    },

    /** Look for a newer release. No-op while busy, once one is found, or when unsupported. */
    async check({ manual = false } = {}) {
      if (!support.ok) return;
      if (['checking', 'downloading', 'available', 'ready'].includes(state.status)) return;
      state = { ...state, manual };
      try {
        await autoUpdater.checkForUpdates();
      } catch (err) {
        fail(err, manual);
      }
    },

    /** Download the update found by check(). */
    async download() {
      if (state.status !== 'available') return;
      set({ status: 'downloading', version: state.version, percent: 0, manual: state.manual });
      try {
        await autoUpdater.downloadUpdate();
      } catch (err) {
        fail(err, state.manual);
      }
    },

    /** Quit and run the installer for the downloaded update. */
    install() {
      if (state.status === 'ready') autoUpdater.quitAndInstall();
    },
  };
}
