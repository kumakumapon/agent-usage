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

This adds a small always-on-top widget (bottom-right corner by default,
draggable by its header) showing gauges and reset times for each enabled
tool, plus a tray icon that:

- shows a per-window usage tooltip on hover
- click toggles the widget's visibility (it stays open otherwise — it does
  not hide itself when it loses focus)
- refreshes every 30s in the background
- right-click for: show/hide the widget, refresh now, toggle
  Claude/Codex/Antigravity, "Start with Windows", and Quit

The widget's own ✕ button hides it (same as clicking the tray icon); use the
tray icon or its right-click menu to bring it back.

Claude Code and Codex are enabled by default (matching the CLI's default);
Antigravity is opt-in from the tray menu since it needs the `agy` CLI logged
in.

## Build a Windows installer

```sh
npm run dist
```

Produces an NSIS installer under `gui/dist/` via `electron-builder`.
