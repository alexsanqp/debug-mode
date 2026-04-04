#!/bin/bash
# Run tests after file edits (PostToolUse async hook)
# Uses TEST_CMD from detect-env.sh if available, otherwise auto-detects

set -u

DIR="${CLAUDE_PROJECT_DIR:-.}"
DIR="${DIR//\\//}"

LOCKDIR="/tmp/debug-mode-run-tests.lock"
mkdir "$LOCKDIR" 2>/dev/null || exit 0
trap 'rmdir "$LOCKDIR" 2>/dev/null' EXIT

cd "$DIR" 2>/dev/null || exit 0

# Skip tests if debug instrumentation is active (tests would generate noise in ingest logs)
if grep -rq '#region DEBUG_' . --include='*.js' --include='*.ts' --include='*.py' --include='*.go' --exclude-dir=node_modules --exclude-dir=server --exclude-dir=.git 2>/dev/null; then
  exit 0
fi

# Read tool input to find which file was edited
EDITED_FILE=""
if [ -t 0 ]; then
  : # no stdin
else
  INPUT=$(cat 2>/dev/null || echo "{}")
  EDITED_FILE=$(echo "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | cut -d'"' -f4 2>/dev/null || echo "")
fi

# Use detected test command if available
if [ -n "${TEST_CMD:-}" ]; then
  # Try to run only relevant tests first (faster feedback)
  if [ -n "$EDITED_FILE" ]; then
    case "${TEST_RUNNER:-}" in
      vitest)
        npx vitest run --reporter=verbose "$EDITED_FILE" 2>&1 | tail -20 && exit 0
        ;;
      jest)
        npx jest --findRelatedTests "$EDITED_FILE" 2>&1 | tail -20 && exit 0
        ;;
      pytest)
        # Find matching test file
        base=$(basename "$EDITED_FILE" | sed 's/\.py$//')
        test_file=$(find tests test -name "test_${base}.py" -o -name "${base}_test.py" 2>/dev/null | head -1)
        if [ -n "$test_file" ]; then
          python -m pytest "$test_file" --tb=short -q 2>&1 | tail -20 && exit 0
        fi
        ;;
    esac
  fi

  # Fallback: run full test suite (capped output)
  $TEST_CMD 2>&1 | tail -25
  exit 0
fi

# No TEST_CMD — auto-detect and run
if [ -f package.json ]; then
  npm test --silent < /dev/null 2>&1 | tail -25
elif [ -f pyproject.toml ] || [ -f pytest.ini ] || [ -d tests ]; then
  python -m pytest --tb=short -q 2>&1 | tail -25
elif [ -f Cargo.toml ]; then
  cargo test 2>&1 | tail -25
elif [ -f go.mod ]; then
  go test ./... 2>&1 | tail -25
fi

# Always exit 0 — test failures are informational, not blocking
exit 0
