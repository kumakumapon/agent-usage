import { spawn } from 'node:child_process';

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
    const command = windows ? 'cmd.exe' : 'codex';
    const args = windows ? ['/d', '/s', '/c', 'codex app-server --stdio'] : ['app-server', '--stdio'];
    // detached on Windows creates a new console process group, so this
    // child (and the codex app-server it spawns) doesn't share the parent
    // console's Ctrl+C/close broadcast with whatever is hosting that
    // console, e.g. a terminal multiplexer.
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: windows });
    let buffered = '';
    let stderr = '';
    let done = false;
    const timeout = setTimeout(() => finish(reject, new Error('timed out waiting for Codex app-server')), TIMEOUT_MS);
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      child.kill();
      fn(value);
    };
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    child.on('error', (err) => finish(reject, new Error(err.code === 'ENOENT' ? 'codex not found on PATH' : err.message)));
    child.on('exit', (code) => { if (!done) finish(reject, new Error(stderr.trim() || `codex app-server exited with code ${code}`)); });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.on('data', (chunk) => {
      buffered += chunk;
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop();
      for (const line of lines) {
        try {
          const message = JSON.parse(line);
          if (message.id === 1) send({ id: 2, method: 'account/rateLimits/read' });
          if (message.id === 2) message.error ? finish(reject, new Error(message.error.message)) : finish(resolve, message.result);
        } catch { /* Ignore notifications. */ }
      }
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'agent-usage', version: '0.1.0' }, capabilities: {} } });
  });
}
