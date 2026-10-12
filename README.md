# agent-usage

A local, dependency-free CLI that lists token usage and rate-limit status for
[Claude Code CLI](https://claude.com/claude-code), [Codex CLI](https://github.com/openai/codex),
and [Antigravity](https://antigravity.google/) (the `agy` CLI / IDE), by reading each
tool's own local session logs and caches.

Everything runs on your machine against files that already exist on disk. There
is no telemetry, no bundled API keys, and no network access — with one
explicit exception, noted below.

## Requirements

- Node.js 22+ (uses the built-in `node:sqlite` and `node:util.parseArgs`)
- Windows, macOS, or Linux for the CLI (the [tray GUI](#windows-gui) is Windows-only)
- For Antigravity rate limits: the `agy` CLI installed and logged in

## Install

No dependencies to install. Run directly:

```sh
node bin.mjs [command] [options]
```

Or link it as a global command:

```sh
npm link
agent-usage [command] [options]
```

## Commands

### `usage` — token usage

```sh
agent-usage usage                        # summary for Claude Code and Codex, by model (plus the rate limits; --no-limits skips them)
agent-usage usage --tool all             # include Antigravity
agent-usage usage --tool claude --by day # Claude Code, grouped by day
agent-usage usage --tool codex --chart   # Codex, with a bar chart under the table
agent-usage usage --since 2026-08-01 --until 2026-08-31
agent-usage usage --json                 # machine-readable output
```

With no command, `agent-usage` runs `limits` (below), not `usage`.

Reads:

- **Claude Code**: `~/.claude/projects/**/*.jsonl` — the `usage` block Claude Code
  writes into every assistant message it logs (input/output/cache tokens, model).
- **Codex CLI**: `~/.codex/sessions/**/*.jsonl` — the `token_count` events Codex
  writes per turn (input/cached-input/output tokens, model).
- **Antigravity (`agy`)**: `~/.gemini/antigravity-cli/history.jsonl` and
  `cache/conversation_metadata.json`. Antigravity does **not** persist token
  counts anywhere on disk (see [Antigravity limitations](#antigravity-limitations)),
  so this reports activity volume instead — sessions/turns per day and total
  agent steps — clearly labeled as not token data.

Cost estimates are opt-in: fill in per-model USD/1M-token rates in
`~/.agent-usage/pricing.json` (created empty on first run — run
`agent-usage --pricing` to print its path). Models with no configured rate
show a `—` in the Cost column instead of a guessed number.

Parsed results are cached per session file in `~/.agent-usage/cache/`, so repeat
runs only read what was appended since the last one (a warm run is several times
faster). Pass `--no-cache` to re-read everything; the cache is safe to delete.

### `limits` (default) — current rate-limit / quota utilization

```sh
agent-usage limits
agent-usage limits --tool antigravity
agent-usage limits --json
agent-usage limits --watch                  # dashboard mode, refreshes every 30s
agent-usage limits --watch --interval 60     # custom refresh interval (seconds, min 10)
```

Reads:

- **Claude Code**: **a live query.** Claude Code never writes its quota
  percentage to disk in a structured form, so this runs
  `claude -p "/usage" --output-format json` as a child process — the same
  `/usage` slash command the TUI exposes — and parses the plain-text report
  out of its reply. That command is a built-in Claude Code feature, not an
  LLM turn (it reports `num_turns: 0` and `total_cost_usd: 0`), that itself
  talks to Anthropic's backend to fetch your quota. It requires `claude` on
  PATH and an active login.
- **Codex CLI**: **a live query.** This starts `codex app-server --stdio` and
  sends its structured, read-only `account/rateLimits/read` request. It uses
  your existing Codex login and fetches current quota without creating an
  agent turn or sending a prompt. It requires `codex` on PATH and an active login.
- **Antigravity (`agy`)**: **also a live query.** Antigravity never writes
  its quota percentage to disk, so there is no file to read. Instead this
  runs `agy -p "/usage" --output-format json` as a child process and parses
  its structured response. That command is a built-in Antigravity feature
  (not an LLM call — it reports `num_turns: 0` and zero token usage) that
  itself talks to Google's Cloud Code backend to fetch your quota. It
  requires `agy` on PATH and an active login; it takes roughly 5-10 seconds
  to start the CLI process.

### Command-line errors

A mistake on the command line is caught before anything runs — no live query,
no log reading, no pricing file — with a short message and **exit code 2**:

```text
$ agent-usage usgae
agent-usage: unknown command "usgae" — did you mean "usage"? (valid commands: limits, usage)
$ agent-usage limits --tool cdoex --json
agent-usage: unknown tool "cdoex" — did you mean "codex"? (valid tools: claude, codex, antigravity, all)
```

This covers unknown commands, extra positional arguments, unknown options, and
`--tool` values that are not `claude`, `codex`, `antigravity`, a comma-separated
list of those, or `all` on its own. Scripts that relied on such input being
ignored will now fail with exit code 2. Exit codes: 0 success, 1 runtime error,
2 invalid command line. `--help` always works.

## Windows GUI

A system-tray app (Electron) is available under [`gui/`](gui/) for Windows —
shows live rate-limit gauges in a tray popup instead of a terminal, built on
the same local readers as `limits`/`--watch`. See [`gui/README.md`](gui/README.md).

The GUI is **Windows-only**: it is developed and tested on Windows 11 only,
and macOS/Linux builds are neither provided nor tested. The CLI above is the
cross-platform part.

## Privacy notes

- **No data leaves your machine** except the `claude -p /usage` and
  `agy -p /usage` calls described above, which are each tool's own CLI
  talking to its own backend — this tool only invokes them and parses the
  reply.
- Session logs can contain your actual prompts, file paths, and code. This
  tool only ever extracts token counts, model names, and timestamps from
  them — project directories, working-directory paths, and conversation text
  are read where present (needed to group by session) but are **never**
  included in any table, chart, or `--json` output.
- The usage cache in `~/.agent-usage/cache/` holds the same extracted fields
  (token counts, model, timestamp, session id, project path) as local JSON —
  never prompt or conversation text.
- The editable pricing file lives at `~/.agent-usage/pricing.json`, outside
  this repository, so your configured rates never end up in version control.

## Antigravity limitations

Both the Antigravity IDE and the `agy` CLI store per-turn data (token counts,
generation metadata) as **undocumented protobuf blobs** in SQLite (`state.vscdb`
for the IDE, `conversations/*.db` for the CLI) with no published schema — they
cannot be decoded into real token counts locally. Quota percentages are
fetched live and never cached to disk either. This tool works around that by:

- reporting real local *activity* (sessions, turns, agent steps) for `usage`
  instead of tokens, and
- making a live `agy -p /usage` call for `limits` instead of reading a file.

If Antigravity ever documents its local storage format or adds a usage-export
command, the token-based path can be filled in.

## Development

Running the CLI needs no install. Contributing does — the checks use a few dev
dependencies (ESLint and TypeScript, the latter only to type-check the JSDoc
annotations; nothing is compiled):

```sh
npm ci
npm run check   # lint + typecheck + tests (also what CI runs)
```

Or individually: `npm run lint`, `npm run typecheck`, `npm test`.

## License

MIT — see [LICENSE](./LICENSE).
