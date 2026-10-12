import { spawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Runs a CLI to completion and resolves with its stdout. Rejects with the
 * CLI's stderr (or its exit code) on failure, the spawn error (e.g. ENOENT)
 * if it can't start, or a timeout error after `timeoutMs` — in which case
 * the whole process tree is killed.
 * @param {string} command
 * @param {string[]} args
 * @param {{timeoutMs?: number}} [opts]
 * @returns {Promise<string>}
 */
export function runCli(command, args, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const windows = process.platform === 'win32';
    // `detached: true` (CREATE_NEW_PROCESS_GROUP on Windows) was tried here
    // to isolate this child from the parent console group, but it's what
    // was crashing the whole tmux/psmux session on a second `agent-usage`
    // run - confirmed by bisection. Leave it off; taskkill in
    // terminateChildTree still reaps the process tree.
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: windows,
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = async (fn, value, terminate = false) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      if (terminate) await terminateChildTree(child);
      fn(value);
    };
    const timeout = setTimeout(() => {
      void finish(reject, new Error(`timed out waiting for ${command}`), true);
    }, timeoutMs);

    child.on('error', (err) => { void finish(reject, err, true); });
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => {
      if (code === 0) void finish(resolve, stdout);
      else void finish(reject, new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

/**
 * Kills a child and, on Windows, its whole process tree (`taskkill /t`) —
 * npm shims and wrappers leave grandchildren that `child.kill()` misses.
 * @param {import('node:child_process').ChildProcess} child
 * @returns {Promise<void>}
 */
export function terminateChildTree(child) {
  if (process.platform !== 'win32' || !child.pid || child.exitCode !== null) {
    child.kill();
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    // This helper is short-lived and is deliberately not detached; only the
    // queried CLI gets an isolated console process group.
    const taskkill = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
      shell: false,
    });
    taskkill.once('error', () => {
      child.kill();
      resolve();
    });
    taskkill.once('close', (code) => {
      if (code !== 0) child.kill();
      resolve();
    });
  });
}
