import os from 'node:os';
import path from 'node:path';

const home = os.homedir();

export const CLAUDE_PROJECTS_DIR = path.join(home, '.claude', 'projects');
export const CODEX_SESSIONS_DIR = path.join(home, '.codex', 'sessions');

// Antigravity IDE's user-data root varies by OS. We probe a short list of
// plausible locations and use the first one that exists.
export function antigravityStateCandidates() {
  const candidates = [];
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    candidates.push(
      path.join(appData, 'Antigravity IDE', 'User', 'globalStorage', 'state.vscdb'),
      path.join(appData, 'Antigravity', 'User', 'globalStorage', 'state.vscdb'),
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      path.join(home, 'Library', 'Application Support', 'Antigravity IDE', 'User', 'globalStorage', 'state.vscdb'),
      path.join(home, 'Library', 'Application Support', 'Antigravity', 'User', 'globalStorage', 'state.vscdb'),
    );
  } else {
    candidates.push(
      path.join(home, '.config', 'Antigravity IDE', 'User', 'globalStorage', 'state.vscdb'),
      path.join(home, '.config', 'Antigravity', 'User', 'globalStorage', 'state.vscdb'),
    );
  }
  return candidates;
}

// The `agy` CLI (Antigravity's terminal client) keeps its own state here,
// separate from the Antigravity IDE's globalStorage.
export const ANTIGRAVITY_CLI_DIR = path.join(home, '.gemini', 'antigravity-cli');

export const PRICING_FILE = path.join(home, '.agent-usage', 'pricing.json');
