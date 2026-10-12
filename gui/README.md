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

- draws the icon as a gauge of your single highest-usage window — the bar
  fills with the percentage and turns amber at 70% and red at 90%
- shows a per-window usage tooltip on hover
- raises a desktop notification when a usage window passes 80% and again at
  95% (once per crossing; it re-arms when the window resets). The first
  reading after launch is only a baseline, so starting the app while usage is
  already high doesn't pop alerts. Turn this off with **Usage alerts** in the
  tray menu; to change the percentages edit `notifications.thresholds` in
  `settings.json`
- if a refresh fails, the last good reading stays on screen dimmed with a
  "⚠ stale" badge, the error, and when it was last good (the header's
  "updated" time is the last successful reading, not the last attempt)
- click toggles the widget's visibility (it stays open otherwise — it does
  not hide itself when it loses focus)
- refreshes in the background (Codex every 30s, Claude every 2min, Antigravity every 5min; 4× slower while the widget is hidden)
- right-click for: show/hide the widget, refresh now, toggle
  Claude/Codex/Antigravity, "Start with Windows", and Quit

The widget's own ✕ button hides it (same as clicking the tray icon); use the
tray icon or its right-click menu to bring it back.

### Layout

Right-click the tray icon → **Layout** to pick how much space the widget
takes, from the same screen's bottom-right corner. All three are portrait
(taller than wide):

- **Normal** (380×420) — full gauges, labels, and reset times
- **Compact** (240×480) — same content, tighter spacing, no "last updated" line
- **Mini** (140×560) — a thin vertical strip: just window names, percentages,
  and bars (no reset times)

Your choices (enabled tools, layout, and window position) are saved to
`settings.json` in the app's user-data folder and restored on the next launch.

Claude Code and Codex are enabled by default (matching the CLI's default);
Antigravity is opt-in from the tray menu since it needs the `agy` CLI logged
in.

## Build a Windows installer

```sh
npm run dist
```

Produces an NSIS installer under `gui/dist/` via `electron-builder`.
