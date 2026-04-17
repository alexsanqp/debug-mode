# Debug Mode

Hypothesis-driven debugging for Claude Code with a built-in log server.

Claude doesn't guess — it investigates: forms hypotheses, instruments your code, collects runtime evidence, then fixes only what's proven broken.

## Install

```
claude plugin install github:alexsanqp/debug-mode
```

Works out of the box — no `npm install`, no setup. The MCP server ships pre-bundled.

Requires: **Node.js 18+**, **bash** (macOS/Linux built-in, Windows via Git Bash).

### Optional: Browser Debugging MCP

For frontend/UI bugs, the skill can use any browser MCP if installed separately (e.g. `chrome-devtools-mcp`, `playwright-mcp`). Install whichever you prefer — the skill auto-detects available tools.

## How It Works

Paste an error or say `/debug`:

```
/debug TypeError: Cannot read property 'map' of undefined at UserList.tsx:42
```

Claude enters a strict 7-phase cycle:

```
 1. Understand     Read error, files, git history, run tests
 2. Hypothesize    Form 3 hypotheses with different mechanisms
 3. Evidence       Instrument code → you reproduce → agent reads logs
 4. Verdict        Declare root cause with file:line proof
 5. Fix            Minimal change, nothing extra
 6. Verify         Remove instrumentation, run ALL tests
 7. Postmortem     One-line summary + prevention action
```

**No fix before Phase 4.** This is the core rule.

## The Log Feedback Loop

The agent doesn't just add `console.log` — it starts an HTTP server that receives structured, hypothesis-tagged logs from your running code.

```
Agent                        Your Code                     Ingest Server
  │                              │                              │
  │  start_debug_session         │                              │
  ├─────────────────────────────────────────────────────────────>│ starts :7242
  │                              │                              │
  │  get_instrumentation_snippet │                              │
  ├─────────────────────────────────────────────────────────────>│
  │<── fetch() code ─────────────────────────────────────────────│
  │                              │                              │
  │  inserts into your code      │                              │
  ├─────────────────>            │                              │
  │                              │                              │
  │  "reproduce the bug"         │                              │
  │──> you ──────────>           │  POST /ingest/ {H1, data}   │
  │                              │─────────────────────────────>│ appends NDJSON
  │                              │                              │
  │  read_debug_logs             │                              │
  ├─────────────────────────────────────────────────────────────>│
  │<── structured evidence ──────────────────────────────────────│
```

Each log entry is tagged with a hypothesis ID so the agent evaluates H1, H2, H3 independently.

### Ingest Tools

| Tool | What it does |
|------|-------------|
| `start_debug_session` | Start HTTP server on :7242, get sessionId |
| `get_instrumentation_snippet` | Get ready-to-paste code for JS/TS, Python, Go, Rust, Java, Ruby |
| `read_debug_logs` | Read logs, filter by hypothesisId or runId |
| `clear_debug_logs` | Clear logs for a fresh reproduction attempt |
| `stop_debug_session` | Stop server, optionally delete log file |

### Log Format

Each line in `.claude/debug.log` (NDJSON):

```json
{"sessionId":"...","runId":"run1","hypothesisId":"H1","location":"src/api.ts:55","message":"user object","data":{"id":5},"timestamp":1712170000000}
```

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `DEBUG_INGEST_PORT` | `7242` | Override the HTTP ingest port |

## What's in the Box

| Component | Purpose |
|-----------|---------|
| **Skill** `debug-mode` | 7-phase methodology prompt |
| **Agent** `debugger` | Subagent for complex multi-file bugs (40 turns, Sonnet) |
| **Ingest MCP** | HTTP log server on :7242 + 5 tools (bundled, zero-install) |
| **Hooks** | Auto-test on Edit/Write, detect test framework, warn on leftover markers |

## Hooks

| Event | Script | What it does |
|-------|--------|-------------|
| `SessionStart` | `detect-env.sh` | Detects vitest/jest/pytest/cargo/go/rspec/mix/make, sets `$TEST_CMD` |
| `PostToolUse` (Write\|Edit) | `run-tests.sh` | Runs relevant tests after every file change (async, non-blocking) |
| `Stop` | `show-diff.sh` | Shows git diff + warns if debug markers are left behind |

## Supported Test Frameworks

Auto-detected in priority order: vitest, jest, mocha, playwright, npm test, pytest, cargo test, go test, rspec, mix test, Makefile.

Override with `$TEST_CMD` environment variable.

## For Complex Bugs

Dispatch the debug agent for multi-file investigations:

```
This is a race condition in the payment flow. Use the debugger agent.
```

The agent runs in isolation with up to 40 turns, follows the same 7-phase methodology, and has access to all ingest tools.

## Project Structure

```
debug-mode/
├── .claude-plugin/plugin.json
├── skills/debug-mode/SKILL.md    # 7-phase methodology
├── agents/debugger.md            # Debug subagent
├── server/
│   ├── index.js                  # Ingest MCP source (HTTP + 5 tools)
│   ├── dist/index.mjs            # Pre-bundled server (committed, zero-install)
│   └── package.json
├── hooks/hooks.json
├── scripts/
│   ├── detect-env.sh             # Test framework detection
│   ├── run-tests.sh              # Auto-test on file changes
│   └── show-diff.sh              # Diff + leftover marker warning
├── .mcp.json                     # Points to pre-bundled server
├── LICENSE
└── README.md
```

## Development

If you're contributing to this plugin:

```bash
cd server
npm install        # Install SDK + esbuild dev dependency
npm run build      # Rebuild server/dist/index.mjs
```

The bundle is checked into git so end-users don't need any install step.

## License

MIT
