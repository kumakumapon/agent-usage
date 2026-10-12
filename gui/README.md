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
  Claude/Codex/Antigravity, usage alerts, language, theme, updates,
  "Start with Windows", and Quit

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

## Language, theme and accessibility

- **Language** — English or Japanese (日本語), from the tray menu → **Language**.
  *Auto* follows the system locale. It covers the widget, tray menu, tooltip
  and notifications; window names the CLIs report (e.g. `session (5h)`,
  `weekly`) are translated too, anything else is shown as reported.
- **Theme** — System, Dark or Light, from the tray menu → **Theme**. *System*
  follows the OS light/dark setting.
- **Contrast** — text meets WCAG AA (4.5:1) and the bar colours meet 3:1 in
  both themes; `test/gui-contrast.test.mjs` checks this against the palette in
  `index.html`.
- **Screen readers & keyboard** — each bar is a labelled progress bar
  ("Claude Code session (5h): 8%"), the buttons have labels and visible focus
  rings, **Esc** hides the widget and **F5** / **Ctrl+R** refreshes. Stale data
  is marked with text, not only colour.

Language and theme are saved in `settings.json` (`language`: `auto` | `en` |
`ja`; `theme`: `system` | `dark` | `light`).

## Build a Windows installer

```sh
npm run dist
```

Produces, under `gui/dist/` via `electron-builder`:

- `agent-usage-gui-setup-<version>-x64.exe` — NSIS installer
- `agent-usage-gui-<version>-x64.exe` — portable exe (no install)

The builds are **not code-signed**, so Windows SmartScreen shows an "unknown
publisher" warning on first run (More info → Run anyway). See
[Updates](#updates) for how the installed app upgrades itself.

## Updates

The **installed** app (the NSIS installer) can update itself from this
repository's GitHub Releases. It is deliberately conservative:

- **Nothing is contacted by default.** The app makes no network requests
  until you choose tray menu → **Check for updates**, or switch on **Check for
  updates automatically** (off by default; then once a day, starting a minute
  after launch).
- **Nothing is downloaded or installed without a click.** When a newer release
  is found the menu offers **Download update vX.Y.Z**; after the download it
  offers **Restart to install vX.Y.Z**. (A downloaded update is also applied if
  you simply quit.) An automatic check that finds one shows a notification.
- The download is checked against the SHA-512 in the release's `latest.yml`.
  Because the builds are **not code-signed**, Windows does not verify who
  published the installer — the trust anchor is this repository's Releases
  page. Prefer to update by hand? Leave automatic checks off and download from
  [Releases](https://github.com/kumakumapon/agent-usage/releases).
- The **portable** exe can't replace itself, so its menu item opens the
  Releases page instead. A development run (`npm start`) has no update feed
  and shows the item greyed out.

The update feed (`latest.yml` plus the `.blockmap`) is built by
`electron-builder` and attached to each release by the release workflow, so a
release is only updatable if it was published that way. `settings.json` holds
the choice as `updates.autoCheck`.

## Releasing

Releases are built by GitHub Actions (`.github/workflows/release.yml`):

1. Bump `version` in both `package.json` and `gui/package.json` (they must
   match the tag) and merge to `main`.
2. Tag and push: `git tag v0.2.0 && git push origin v0.2.0`.
3. The workflow runs the tests, builds the installer and portable exe on
   Windows, and attaches them — plus `latest.yml` and the `.blockmap`, which
   installed apps read to find the update — to the tag's GitHub Release
   (creating it with generated notes if it doesn't exist yet).

To sign the builds, add a code-signing certificate as the repository secrets
`CSC_LINK` (the .pfx, as a file path/URL or base64) and `CSC_KEY_PASSWORD`;
`electron-builder` picks them up with no further config.
