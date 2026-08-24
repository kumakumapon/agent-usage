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
- Windows, macOS, or Linux
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

### `usage` (default) — token usage

```sh
agent-usage                              # summary for all three tools, by model
agent-usage --tool claude --by day       # Claude Code, grouped by day
agent-usage --tool codex --chart         # Codex, with a bar chart under the table
agent-usage --since 2026-08-01 --until 2026-08-31
agent-usage --json                       # machine-readable output
```

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

### `limits` — current rate-limit / quota utilization

```sh
agent-usage limits
agent-usage limits --tool antigravity
agent-usage limits --json
```

Reads:

- **Claude Code**: `~/.claude.json` → `cachedUsageUtilization`, the same
  numbers the Claude Code TUI status line shows. This is a local cache, so
  it's only as fresh as the last time you ran Claude Code.
- **Codex CLI**: the `rate_limits` snapshot embedded in the most recent
  `token_count` event across your session logs (checks the ~20
  most-recently-modified session files).
- **Antigravity (`agy`)**: **the one place this tool makes a network call.**
  Antigravity never writes its quota percentage to disk, so there is no file
  to read. Instead this runs `agy -p "/usage" --output-format json` as a
  child process and parses its structured response. That command is a
  built-in Antigravity feature (not an LLM call — it reports `num_turns: 0`
  and zero token usage) that itself talks to Google's Cloud Code backend to
  fetch your quota. It requires `agy` on PATH and an active login; it takes
  roughly 5-10 seconds to start the CLI process.

## Privacy notes

- **No data leaves your machine** except the one `agy -p /usage` call
  described above, which is Antigravity's own CLI talking to its own backend
  — this tool only invokes it and parses the reply.
- Session logs can contain your actual prompts, file paths, and code. This
  tool only ever extracts token counts, model names, and timestamps from
  them — project directories, working-directory paths, and conversation text
  are read where present (needed to group by session) but are **never**
  included in any table, chart, or `--json` output.
- `~/.claude.json` also contains OAuth-adjacent account fields (e.g. an
  account UUID); only the `cachedUsageUtilization` numbers are read out of it.
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

## License

MIT — see [LICENSE](./LICENSE).
