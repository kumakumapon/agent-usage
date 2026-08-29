import { spawn } from 'node:child_process';

/**
 * Unlike the other readers in this project, this one is NOT a local file
 * read: `agy`'s /usage slash command reports live quota, and (per Antigravity's
 * own design) that number is never persisted to disk anywhere — so the only
 * way to get it is to actually invoke the CLI. `agy -p "/usage" --output-format
 * json` runs the built-in /usage command in print mode; it does not consume
 * an LLM turn (num_turns/usage come back 0 in the response) but it does need
 * `agy` on PATH, a logged-in session, and ~5-10s to start the CLI process.
 * @returns {Promise<object|null>}
 */
export async function readAntigravityRateLimit() {
  let stdout;
  try {
    stdout = await runCli(
      'agy',
      ['-p', '/usage', '--output-format', 'json'],
    );
  } catch (err) {
    return { error: err.code === 'ENOENT' ? 'agy not found on PATH' : (err.message || String(err)) };
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { error: 'could not parse agy output as JSON' };
  }

  const groups = parsed.command?.data?.groups;
  if (!groups) return { error: 'unexpected /usage response shape from agy' };

  const shortGroupName = (name) =>
    /claude|gpt/i.test(name) ? 'Claude/GPT' : name.replace(/\s+Models?$/i, '');

  const windows = [];
  for (const group of groups) {
    for (const bucket of group.buckets || []) {
      windows.push({
        window: `${shortGroupName(group.name)} ${bucket.window || bucket.name}`,
        percent:
          typeof bucket.remaining_fraction === 'number'
            ? Math.round((1 - bucket.remaining_fraction) * 100)
            : null,
        resetsAt: bucket.reset_time || null,
      });
    }
  }

  return { fetchedAt: new Date().toISOString(), windows };
}

function runCli(command, args) {
  return new Promise((resolve, reject) => {
    const windows = process.platform === 'win32';
    // See claude-ratelimit.mjs: `detached: true` was tried here but is what
    // was crashing the whole tmux/psmux session on a second `agent-usage`
    // run. Leave it off; taskkill in terminateChildTree still reaps the tree.
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
      void finish(reject, new Error('timed out waiting for agy'), true);
    }, 30_000);

    child.on('error', (err) => { void finish(reject, err, true); });
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => {
      if (code === 0) void finish(resolve, stdout);
      else void finish(reject, new Error(stderr.trim() || `agy exited with code ${code}`));
    });
  });
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
