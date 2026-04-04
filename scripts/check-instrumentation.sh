#!/bin/bash
# PreToolUse hook: blocks manual debug instrumentation in Edit/Write.
# Forces the agent to use debug-ingest MCP tools instead.
# Exit 0 = allow, Exit 2 = block with message.

INPUT=$(cat 2>/dev/null || true)

# No input — allow
[ -z "$INPUT" ] && exit 0

# Check for forbidden manual debug patterns
if echo "$INPUT" | grep -qiE 'appendFileSync.*debug|writeFileSync.*debug|function debugLog|debugLog\(|\.claude/debug\.log'; then
  echo "BLOCKED: Do not write manual debug instrumentation."
  echo "Use the debug-ingest MCP tools instead:"
  echo "  1. Call mcp__debug-ingest__start_debug_session"
  echo "  2. Call mcp__debug-ingest__get_instrumentation_snippet"
  echo "  3. Insert the returned snippet"
  exit 2
fi

if echo "$INPUT" | grep -qiE 'console\.log.*__DBG|console\.log.*DEBUG_H|print.*__DBG|fmt\.Print.*__DBG'; then
  echo "BLOCKED: Do not write manual debug markers."
  echo "Use mcp__debug-ingest__get_instrumentation_snippet instead."
  exit 2
fi

# Check for fs import specifically for debug purposes (not all fs imports)
if echo "$INPUT" | grep -qiE 'import.*appendFileSync.*from.*fs|import.*writeFileSync.*from.*fs'; then
  echo "BLOCKED: Do not import fs for debug logging."
  echo "Use mcp__debug-ingest__get_instrumentation_snippet instead."
  exit 2
fi

# Block manual .claude/debug.log setup (agent should use start_debug_session)
if echo "$INPUT" | grep -qiE 'mkdir.*\.claude|> .*\.claude/debug|touch.*\.claude/debug'; then
  echo "BLOCKED: Do not create .claude/debug.log manually."
  echo "Call mcp__debug-ingest__start_debug_session — it creates the log file automatically."
  exit 2
fi

exit 0
