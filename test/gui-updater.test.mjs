import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createUpdater, shortError, updateSupport } from '../gui/updater.mjs';

/** A stand-in for electron-updater's autoUpdater that records calls. */
function fakeAutoUpdater({ onCheck, onDownload } = {}) {
  const au = new EventEmitter();
  au.calls = [];
  au.checkForUpdates = async () => {
    au.calls.push('check');
    au.emit('checking-for-update');
    await onCheck?.(au);
  };
  au.downloadUpdate = async () => {
    au.calls.push('download');
    await onDownload?.(au);
  };
  au.quitAndInstall = () => au.calls.push('install');
  return au;
}

const OK = { ok: true };
const statuses = () => {
  const seen = [];
  return { seen, onChange: (s) => seen.push(s.status) };
};

test('updateSupport: only an installed Windows build can update itself', () => {
  assert.deepEqual(updateSupport({ isPackaged: true, portable: false, platform: 'win32' }), { ok: true });
  assert.deepEqual(updateSupport({ isPackaged: false, portable: false, platform: 'win32' }), { ok: false, reason: 'dev' });
  assert.deepEqual(updateSupport({ isPackaged: true, portable: true, platform: 'win32' }), { ok: false, reason: 'portable' });
  assert.deepEqual(updateSupport({ isPackaged: true, portable: false, platform: 'linux' }), { ok: false, reason: 'platform' });
});

test('shortError keeps the first line and caps the length', () => {
  assert.equal(shortError(new Error('boom\nstack line 1\nstack line 2')), 'boom');
  assert.equal(shortError(new Error('\n\nreal reason\nmore')), 'real reason');
  assert.equal(shortError('plain string'), 'plain string');
  assert.equal(shortError(undefined), 'unknown error');
  const long = shortError(new Error('x'.repeat(500)));
  assert.equal(long.length, 158);
  assert.ok(long.endsWith('…'));
});

test('configures electron-updater to ask before downloading', () => {
  const au = fakeAutoUpdater();
  createUpdater({ autoUpdater: au, support: OK });
  assert.equal(au.autoDownload, false);
  assert.equal(au.autoInstallOnAppQuit, true);
});

test('an unsupported build never touches electron-updater', async () => {
  const au = fakeAutoUpdater();
  const updater = createUpdater({ autoUpdater: au, support: { ok: false, reason: 'portable' } });
  assert.deepEqual(updater.state, { status: 'unsupported', reason: 'portable' });
  await updater.check({ manual: true });
  await updater.download();
  updater.install();
  assert.deepEqual(au.calls, []);
  assert.equal(au.autoDownload, undefined, 'must not even configure it');
  assert.equal(au.listenerCount('error'), 0);
});

test('nothing is checked until check() is called', () => {
  const au = fakeAutoUpdater();
  createUpdater({ autoUpdater: au, support: OK });
  assert.deepEqual(au.calls, []);
});

test('check → available → download → ready → install', async () => {
  const au = fakeAutoUpdater({
    onCheck: (a) => a.emit('update-available', { version: '0.2.0' }),
    onDownload: (a) => {
      a.emit('download-progress', { percent: 41.6 });
      a.emit('update-downloaded', { version: '0.2.0' });
    },
  });
  const { seen, onChange } = statuses();
  const updater = createUpdater({ autoUpdater: au, support: OK, onChange });

  await updater.check({ manual: true });
  assert.deepEqual(updater.state, { status: 'available', version: '0.2.0', manual: true });

  await updater.download();
  assert.deepEqual(updater.state, { status: 'ready', version: '0.2.0' });
  assert.deepEqual(seen, ['checking', 'available', 'downloading', 'downloading', 'ready']);

  updater.install();
  assert.deepEqual(au.calls, ['check', 'download', 'install']);
});

test('download progress is rounded and keeps the version', async () => {
  const au = fakeAutoUpdater({
    onCheck: (a) => a.emit('update-available', { version: '0.2.0' }),
    onDownload: (a) => a.emit('download-progress', { percent: 41.6 }),
  });
  const updater = createUpdater({ autoUpdater: au, support: OK });
  await updater.check();
  await updater.download();
  assert.deepEqual(updater.state, { status: 'downloading', version: '0.2.0', percent: 42, manual: false });
});

test('up to date', async () => {
  const au = fakeAutoUpdater({ onCheck: (a) => a.emit('update-not-available', { version: '0.1.0' }) });
  const updater = createUpdater({ autoUpdater: au, support: OK });
  await updater.check({ manual: true });
  assert.deepEqual(updater.state, { status: 'upToDate', manual: true });
});

test('the manual flag tells a scheduled check from a clicked one', async () => {
  const au = fakeAutoUpdater({ onCheck: (a) => a.emit('update-available', { version: '0.2.0' }) });
  const updater = createUpdater({ autoUpdater: au, support: OK });
  await updater.check(); // scheduled
  assert.equal(updater.state.manual, false);
});

test('errors are reported briefly, whether emitted or thrown', async () => {
  const emitted = createUpdater({
    autoUpdater: fakeAutoUpdater({ onCheck: (a) => a.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED\nat long stack')) }),
    support: OK,
  });
  await emitted.check({ manual: true });
  assert.deepEqual(emitted.state, { status: 'error', error: 'net::ERR_INTERNET_DISCONNECTED', manual: true });

  const thrown = createUpdater({
    autoUpdater: fakeAutoUpdater({
      onCheck: () => {
        throw new Error('feed unreachable');
      },
    }),
    support: OK,
  });
  await thrown.check();
  assert.equal(thrown.state.status, 'error');
  assert.equal(thrown.state.error, 'feed unreachable');
});

test('a failed check can be retried', async () => {
  let attempt = 0;
  const au = fakeAutoUpdater({
    onCheck: (a) => {
      attempt++;
      if (attempt === 1) a.emit('error', new Error('offline'));
      else a.emit('update-not-available', {});
    },
  });
  const updater = createUpdater({ autoUpdater: au, support: OK });
  await updater.check();
  assert.equal(updater.state.status, 'error');
  await updater.check();
  assert.equal(updater.state.status, 'upToDate');
});

test('no overlapping checks, and nothing re-checked once an update is found', async () => {
  let release;
  const au = fakeAutoUpdater({ onCheck: () => new Promise((resolve) => (release = resolve)) });
  const updater = createUpdater({ autoUpdater: au, support: OK });
  const first = updater.check();
  await updater.check(); // checking → ignored
  assert.deepEqual(au.calls, ['check']);
  au.emit('update-available', { version: '0.2.0' });
  release();
  await first;
  await updater.check(); // available → ignored
  assert.deepEqual(au.calls, ['check']);
});

test('download and install are ignored in the wrong state', async () => {
  const au = fakeAutoUpdater();
  const updater = createUpdater({ autoUpdater: au, support: OK });
  await updater.download(); // nothing found yet
  updater.install(); // nothing downloaded yet
  assert.deepEqual(au.calls, []);
});

test('a failed download reports the error', async () => {
  const au = fakeAutoUpdater({
    onCheck: (a) => a.emit('update-available', { version: '0.2.0' }),
    onDownload: () => {
      throw new Error('checksum mismatch');
    },
  });
  const updater = createUpdater({ autoUpdater: au, support: OK });
  await updater.check();
  await updater.download();
  assert.equal(updater.state.status, 'error');
  assert.equal(updater.state.error, 'checksum mismatch');
});
