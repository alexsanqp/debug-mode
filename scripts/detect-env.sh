#!/bin/bash
# Detect project test framework and export to CLAUDE_ENV_FILE
# Runs on SessionStart — sets TEST_CMD and TEST_RUNNER for the skill and other hooks

set -euo pipefail

DIR="${CLAUDE_PROJECT_DIR:-.}"
DIR="${DIR//\\//}"
ENV_FILE="${CLAUDE_ENV_FILE:-}"

[ -z "$ENV_FILE" ] && exit 0

# Clear stale entries from previous runs
if [ -f "$ENV_FILE" ]; then
  tmp=$(mktemp)
  grep -v '^TEST_RUNNER=\|^TEST_CMD=' "$ENV_FILE" > "$tmp" 2>/dev/null || true
  mv "$tmp" "$ENV_FILE"
fi

detect() {
  local runner="$1" cmd="$2"
  echo "TEST_RUNNER=\"$runner\"" >> "$ENV_FILE"
  echo "TEST_CMD=\"$cmd\"" >> "$ENV_FILE"
  exit 0
}

cd "$DIR" 2>/dev/null || exit 0

# --- Node.js ecosystem ---
if [ -f package.json ]; then
  # Check devDependencies and dependencies for test runners
  if grep -q '"vitest"' package.json; then
    detect "vitest" "npx vitest run"
  fi
  if grep -q '"jest"' package.json; then
    detect "jest" "npx jest"
  fi
  if grep -q '"mocha"' package.json; then
    detect "mocha" "npx mocha"
  fi
  if grep -q '"playwright"' package.json; then
    detect "playwright" "npx playwright test"
  fi
  # Fallback: has a "test" script that isn't the default error
  if grep -q '"test"' package.json && ! grep -q 'no test specified' package.json; then
    detect "npm" "npm test --silent"
  fi
fi

# --- Python ---
if [ -f pytest.ini ] || [ -f pyproject.toml ] || [ -f setup.cfg ] || [ -d tests ] || [ -d test ]; then
  if [ -f pyproject.toml ] && grep -q 'pytest' pyproject.toml 2>/dev/null; then
    detect "pytest" "python -m pytest --tb=short -q"
  fi
  if [ -f pytest.ini ]; then
    detect "pytest" "python -m pytest --tb=short -q"
  fi
  if command -v pytest >/dev/null 2>&1; then
    detect "pytest" "python -m pytest --tb=short -q"
  fi
  # unittest fallback
  if [ -d tests ] || [ -d test ]; then
    detect "pytest" "python -m pytest --tb=short -q"
  fi
fi

# --- Rust ---
if [ -f Cargo.toml ]; then
  detect "cargo" "cargo test"
fi

# --- Go ---
if [ -f go.mod ]; then
  detect "go" "go test ./..."
fi

# --- Ruby ---
if [ -f Gemfile ] && grep -q 'rspec' Gemfile 2>/dev/null; then
  detect "rspec" "bundle exec rspec"
fi

# --- Elixir ---
if [ -f mix.exs ]; then
  detect "mix" "mix test"
fi

# --- Makefile fallback ---
if [ -f Makefile ] && grep -q '^test:' Makefile 2>/dev/null; then
  detect "make" "make test"
fi

# No test framework detected — that's fine
exit 0
