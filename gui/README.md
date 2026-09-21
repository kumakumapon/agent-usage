# agent-usage GUI

A Windows system-tray app showing live rate-limit usage for Claude Code CLI,
Codex CLI, and (opt-in) Antigravity — built directly on the same readers as
the `agent-usage limits` command (`../src/claude-ratelimit.mjs`,
`../src/codex-ratelimit.mjs`, `../src/antigravity-ratelimit.mjs`). No data
leaves your machine; the tray app just polls the same local CLIs on an
interval instead of you running `agent-usage --watch` by hand.

## Run

```sh
cd gui
npm install
npm start
```

This adds a tray icon that:

- shows a per-window usage tooltip on hover
- opens a small popup (click) with gauges and reset times for each enabled tool
- refreshes every 30s in the background
- right-click for: refresh now, toggle Claude/Codex/Antigravity, "Start with
  Windows", and Quit

Claude Code and Codex are enabled by default (matching the CLI's default);
Antigravity is opt-in from the tray menu since it needs the `agy` CLI logged
in.

## Build a Windows installer

```sh
npm run dist
```

Produces an NSIS installer under `gui/dist/` via `electron-builder`.
