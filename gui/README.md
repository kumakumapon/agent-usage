# agent-usage GUI

A Windows system-tray app showing live rate-limit usage for Claude Code CLI,
Codex CLI, and (opt-in) Antigravity — built directly on the same readers as
the `agent-usage limits` command (`../src/claude-ratelimit.mjs`,
`../src/codex-ratelimit.mjs`, `../src/antigravity-ratelimit.mjs`). No data
leaves your machine; the tray app just polls the same local CLIs on an
interval instead of you running `agent-usage --watch` by hand.

## Platform support

**Windows only.** This app is developed and tested on Windows 11. It may start
on macOS or Linux (Electron itself is cross-platform), but that is untested and
unsupported — nothing here is adapted to other platforms:

- the tray/menu wording and the "Start with Windows" option assume Windows
- the installer is built for Windows only (`electron-builder --win`)
- window behaviour (frameless always-on-top widget, layouts, positioning) has
  only been checked against Windows' taskbar and work-area rules

For macOS or Linux, use the cross-platform CLI instead (`agent-usage limits
--watch`, see the [main README](../README.md)). Adding another platform means
a menu-bar/AppIndicator pass plus its own packaging target — contributions
welcome.

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

If a monitor is unplugged or its resolution/scaling changes, the widget is moved
back onto the nearest screen; its saved position is kept, so it returns to the
original monitor once that is back.

Your choices (enabled tools, layout, and window position) are saved to
`settings.json` in the app's user-data folder and restored on the next launch.

Claude Code and Codex are enabled by default (matching the CLI's default);
Antigravity is opt-in from the tray menu since it needs the `agy` CLI logged
in.

## Build a Windows installer

```sh
npm run dist
```

Produces, under `gui/dist/` via `electron-builder`:

- `agent-usage-gui-setup-<version>-x64.exe` — NSIS installer
- `agent-usage-gui-<version>-x64.exe` — portable exe (no install)

The builds are **not code-signed**, so Windows SmartScreen shows an "unknown
publisher" warning on first run (More info → Run anyway). There is also no
auto-update yet: to upgrade, install or run the newer release.

## Releasing

Releases are built by GitHub Actions (`.github/workflows/release.yml`):

1. Bump `version` in both `package.json` and `gui/package.json` (they must
   match the tag) and merge to `main`.
2. Tag and push: `git tag v0.2.0 && git push origin v0.2.0`.
3. The workflow runs the tests, builds the installer and portable exe on
   Windows, and attaches them to the tag's GitHub Release (creating it with
   generated notes if it doesn't exist yet).

To sign the builds, add a code-signing certificate as the repository secrets
`CSC_LINK` (the .pfx, as a file path/URL or base64) and `CSC_KEY_PASSWORD`;
`electron-builder` picks them up with no further config.
