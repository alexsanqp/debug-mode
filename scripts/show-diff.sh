#!/bin/bash
# Show git diff summary on Stop — so Claude sees what it changed

set -u

DIR="${CLAUDE_PROJECT_DIR:-.}"
DIR="${DIR//\\//}"
cd "$DIR" 2>/dev/null || exit 0

# Not a git repo — skip
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# Check for leftover debug instrumentation
LEFTOVER=$(grep -rn -e '__DBG_H' -e '#region DEBUG_' . \
  --include='*.ts' --include='*.tsx' \
  --include='*.js' --include='*.jsx' \
  --include='*.py' --include='*.go' --include='*.rs' \
  --include='*.rb' --include='*.ex' --include='*.exs' \
  --include='*.java' --include='*.kt' \
  --exclude-dir=node_modules \
  --exclude-dir=.git \
  --exclude-dir=vendor \
  --exclude-dir=dist \
  --exclude-dir=build \
  --exclude-dir=target \
  --exclude-dir=__pycache__ \
  --exclude-dir=server \
  2>/dev/null | head -5)

if [ -n "$LEFTOVER" ]; then
  echo "WARNING: LEFTOVER DEBUG INSTRUMENTATION FOUND:"
  echo "$LEFTOVER"
  echo ""
  echo "Run cleanup before committing!"
  echo ""
fi

# Show change summary
STAGED=$(git diff --cached --stat 2>/dev/null)
UNSTAGED=$(git diff --stat 2>/dev/null)

if [ -n "$STAGED" ] || [ -n "$UNSTAGED" ]; then
  echo "=== Changes ==="
  if [ -n "$UNSTAGED" ]; then
    echo "$UNSTAGED" | tail -10
  fi
  if [ -n "$STAGED" ]; then
    echo ""
    echo "=== Staged ==="
    echo "$STAGED" | tail -5
  fi
fi

exit 0
