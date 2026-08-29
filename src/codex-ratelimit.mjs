import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

const TIMEOUT_MS = 30_000;

/** Fetch current quota through Codex's read-only app-server protocol. */
export async function readCodexRateLimit() {
  try {
    const result = await requestRateLimits();
    const limits = result.rateLimits;
    if (!limits) return { error: 'unexpected rate-limit response from codex app-server' };
    const windows = [];
    if (limits.primary) windows.push({ window: 'primary', ...limits.primary });
    if (limits.secondary) windows.push({ window: 'secondary', ...limits.secondary });
    return {
      fetchedAt: new Date().toISOString(),
      planType: limits.planType || null,
      windows: windows.map((w) => ({
        window: w.window,
        percent: w.usedPercent ?? null,
        resetsAt: w.resetsAt ? new Date(w.resetsAt * 1000).toISOString() : null,
        windowMinutes: w.windowDurationMins ?? null,
      })),
      credits: limits.credits || null,
    };
  } catch (err) {
    return { error: err.message || String(err) };
  }
}

function requestRateLimits() {
  return new Promise((resolve, reject) => {
    const windows = process.platform === 'win32';
    const command = windows ? findWindowsCodexExecutable() : 'codex';
    const args = ['app-server', '--stdio'];
    // Do not launch the npm `codex.cmd` shim through cmd.exe here: it adds a
    // shell process and was the source of a visible-console regression.
    //
    // `detached: true` (CREATE_NEW_PROCESS_GROUP) was tried to isolate this
    // child from the parent console group, but it's what was crashing the
    // whole tmux/psmux session on a second `agent-usage` run - confirmed by
    // bisection. Leave it off; taskkill below still reaps the process tree.
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: windows,
      shell: false,
    });
    let buffered = '';
    let stderr = '';
    let done = false;
    const timeout = setTimeout(() => { void finish(reject, new Error('timed out waiting for Codex app-server')); }, TIMEOUT_MS);
    const finish = async (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      await terminateChildTree(child);
      fn(value);
    };
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    child.on('error', (err) => { void finish(reject, new Error(err.code === 'ENOENT' ? 'codex not found on PATH' : err.message)); });
    child.on('exit', (code) => { if (!done) void finish(reject, new Error(stderr.trim() || `codex app-server exited with code ${code}`)); });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.on('data', (chunk) => {
      buffered += chunk;
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop();
      for (const line of lines) {
        try {
          const message = JSON.parse(line);
          if (message.id === 1) send({ id: 2, method: 'account/rateLimits/read' });
          if (message.id === 2) {
            if (message.error) void finish(reject, new Error(message.error.message));
            else void finish(resolve, message.result);
          }
        } catch { /* Ignore notifications. */ }
      }
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'agent-usage', version: '0.1.0' }, capabilities: {} } });
  });
}

/**
 * Prefer Codex's native executable over the npm .cmd shim on Windows.
 * `CODEX_CLI_PATH` permits an explicit standalone/custom installation; the
 * remaining candidates cover the standalone installer and npm's optional
 * platform package layout.
 */
function findWindowsCodexExecutable() {
  if (process.env.CODEX_CLI_PATH) return process.env.CODEX_CLI_PATH;

  const platform = process.arch === 'arm64' ? 'win32-arm64' : 'win32-x64';
  const target = process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
  const pathEntries = (process.env.Path || process.env.PATH || '').split(delimiter).filter(Boolean);

  for (const directory of pathEntries) {
    const candidates = [
      join(directory, 'codex.exe'),
      join(directory, 'node_modules', '@openai', `codex-${platform}`, 'vendor', target, 'codex.exe'),
      join(directory, 'node_modules', '@openai', `codex-${platform}`, 'vendor', target, 'bin', 'codex.exe'),
      join(directory, 'node_modules', '@openai', 'codex', 'node_modules', '@openai', `codex-${platform}`, 'vendor', target, 'codex.exe'),
      join(directory, 'node_modules', '@openai', 'codex', 'node_modules', '@openai', `codex-${platform}`, 'vendor', target, 'bin', 'codex.exe'),
    ];
    const executable = candidates.find(existsSync);
    if (executable) return executable;
  }

  // Let spawn produce the usual ENOENT error when Codex is not installed.
  return 'codex.exe';
}

function terminateChildTree(child) {
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
