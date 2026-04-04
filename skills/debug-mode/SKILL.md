---
description: "Cursor-style hypothesis-driven debugging. 7-phase methodology: understand, hypothesize, evidence, verdict, fix, verify, postmortem. Never guesses — investigates."
---

# Debug Mode

Activate when: user says "debug", "/debug", or pastes an error message / stack trace with file:line references.

Suggest activation when: user says something is "broken", "not working", "crashing", or "failing" — respond: "This sounds like a bug. Want me to enter debug mode? Say /debug to start." Do NOT auto-activate on these soft triggers.

Exit: user can say "exit debug", "/stop", or "cancel" to leave debug mode at any phase.

**New bug = new cycle.** If the user reports a new/different bug after a fix, restart from Phase 1. Do NOT skip to a fix based on code knowledge from the previous cycle. Every bug gets the full 7-phase treatment with fresh instrumentation and user reproduction.

**Session management on new bug:** Do NOT call `start_debug_session` again if the session is still active. Instead:
1. Call `clear_debug_logs` to reset
2. Increment `runId` (if previous cycle ended on "run2", start new cycle with "run3")
3. Proceed to Phase 1 with the existing session
If the session was stopped in Phase 6 cleanup, call `start_debug_session` as normal.

You are a senior debugging engineer. You never guess. You investigate.

## The Rule

**DO NOT propose or attempt a fix until Phase 4 is complete.** If you catch yourself writing a fix before confirming a root cause with evidence — stop, go back.

Hard rules:
1. You MUST instrument code and collect runtime logs via `debug-ingest` MCP tools before any verdict. Reading code is not evidence. Test output alone is not evidence. You need runtime data from the ingest server.
2. You MUST ask the user to reproduce the bug and WAIT for their confirmation before reading logs.
3. You are NOT permitted to output any code edits (fixes) until Phase 4's Root Cause Verdict block has been written with evidence from `read_debug_logs`.
4. You MUST call `clear_debug_logs` both at the start of each Phase 3 iteration AND immediately after inserting all instrumentation snippets (before asking the user to reproduce). Two clears per cycle, no exceptions.
5. You MUST NOT run tests while instrumentation is in the code. Run tests BEFORE inserting instrumentation snippets. If a PostToolUse hook runs tests automatically, the mandatory `clear_debug_logs` in rule 4 handles the pollution — but be aware of it.

**FORBIDDEN — these will be blocked by a PreToolUse hook:**
- `import { appendFileSync } from "fs"` or any `fs` import for logging
- Creating `debugLog()` or any custom logging function
- Writing to `.claude/debug.log` manually
- `console.log('__DBG...')` or any manual debug prefix
- ANY hand-written instrumentation code

**The ONLY way to instrument** is through `mcp__debug-ingest__get_instrumentation_snippet`. It returns a `fetch()` snippet that sends data to the HTTP ingest server. That's it. No other method is allowed.

## Phase 1 · Understand

Gather raw facts. No thinking about causes yet.

1. Read the error message / stack trace **word by word**
2. Open every file mentioned in the trace — show ±20 lines around the error line
3. Check recent changes: `git log --oneline -5 -- <files>` and `git diff -- <files>`
4. Run existing tests: use `$TEST_CMD` if set, otherwise auto-detect (see Test Detection below)
5. If this is a browser/UI bug, check for Chrome DevTools MCP tools (names starting with `mcp__chrome-devtools__`). Use them for console logs, network requests, DOM snapshots, screenshots, and JS evaluation. Tool names vary by version — check available tools at runtime.
   If Chrome DevTools MCP is not available, rely on server-side logs and test output.

**Output:** a short "Situation" summary — what's broken, what files are involved, what changed recently.

## Phase 2 · Hypothesize

Form exactly **3 hypotheses** with different root cause mechanisms.

```
H1: [name]
 → Mechanism: why this could cause the bug
 → Test: specific command/check that proves or disproves it
 → If true I expect to see: [concrete output]

H2: [name]
 → Mechanism: ...
 → Test: ...
 → If true I expect to see: ...

H3: [name]
 → ...
```

Rules:
- Each hypothesis must target a **different mechanism** (not 3 variations of the same idea)
- Each "Test" must be a concrete action you can execute right now
- If you can't think of 3, you don't understand the code well enough — go back to Phase 1
- At least one hypothesis should consider non-code causes: environment variables, dependency versions, configuration, resource limits, network/DNS, or permissions

## Phase 3 · Collect Evidence

Execute the test plan for **every** hypothesis. No skipping.

**At the start of every Phase 3 iteration**, call `clear_debug_logs` immediately. This is mandatory even on run1 — it guarantees a clean slate and prevents stale data from prior cycles or auto-test side effects.

For each hypothesis:
1. Run the test command from Phase 2 **BEFORE inserting any instrumentation**. Tests can trigger instrumented code paths, sending garbage data to the ingest server. Always: test first, instrument second.
2. **ALWAYS add instrumentation** — even if tests give you clues, you MUST collect runtime evidence before declaring a verdict. Never skip this step. Never go straight to a fix based on reading code alone.

   **You MUST use the debug-ingest MCP tools.** Do NOT write your own logging code. Do NOT append to files manually. Do NOT use console.log with custom prefixes. Always use the tools below.

   Full MCP tool names are prefixed `mcp__debug-ingest__` (e.g. `mcp__debug-ingest__start_debug_session`).

   Step by step:
   a. Call `start_debug_session` to get sessionId and the HTTP endpoint URL
      - If it errors about an existing session, call `stop_debug_session` first, then retry
   b. For each hypothesis, call `get_instrumentation_snippet` with:
      - `language`: "javascript", "typescript", "python", "go", "rust", "java", or "ruby"
      - `hypothesisId`: "H1", "H2", "H3"
      - `location`: "file:line" (e.g. "src/cart.js:27")
      - `message`: what you're logging (e.g. "total calculation")
      - `expression`: the code expression to capture (e.g. "{ price: item.price, qty: item.quantity }")
      - `runId`: use "run1", "run2", "run3" for each iteration
   c. The tool returns a ready-to-paste code snippet — insert it into the code using the Edit tool
   d. After all snippets are inserted, **MUST call `clear_debug_logs`** to wipe any logs generated by auto-tests or file-save triggers during editing. This call is non-negotiable — never skip it.
   e. Ask the user to reproduce using the **structured format below**:

      ```
      ## Steps to Reproduce
      1. Restart the server: `<exact command>`
      2. Open <URL>
      3. <specific user action with concrete values>
      4. <specific user action>
      5. <what to observe / where the bug should appear>

      Say **"done"** when finished.
      ```

      Rules for the reproduce block:
      - Every step must be concrete and copy-pasteable (exact commands, URLs, values)
      - Include the server restart step if instrumentation changed server-side code
      - Include specific test data (item names, prices, quantities — not "add an item")
      - End with what the user should observe, so they know the reproduction worked
      - **WAIT for the user to respond.** Do NOT proceed until the user says "done" or confirms reproduction.
      - Do NOT read logs, do NOT evaluate hypotheses, do NOT propose fixes until the user confirms.
   f. ONLY after user confirms reproduction, call `read_debug_logs` filtered by `hypothesisId` to get structured evidence
   g. If no logs appeared or logs are noisy, call `clear_debug_logs` and ask the user to reproduce again (using the same structured format)
   h. Repeat the reproduce→read cycle until you have clear evidence for each hypothesis

   **Never** instrument expressions that may contain secrets, tokens, passwords, or PII. Log types, shapes, or lengths instead.
3. Record the result:

```
H1: ❌ disproved — [what you actually saw]
H2: ✅ confirmed — [the evidence]
H3: ❌ disproved — [what you actually saw]
```

If **all 3 disproved**: you learned something. Reformulate with new information → back to Phase 2.

**Iteration cap:** If you have completed 3 rounds of Phase 2→3 without confirming a root cause, STOP. Output a "Stuck" report: what was tested, what was eliminated, what remains unknown. Ask the user whether to (a) expand scope to infrastructure/environment, (b) gather more context, or (c) try a different approach.

When reformulating, list what each disproved hypothesis eliminated. New hypotheses MUST target mechanisms not yet tested.

## Phase 4 · Root Cause Verdict

Declare the root cause. Be specific.

```
Root Cause: [H<N> confirmed]
What: [exact mechanism in 1-2 sentences]
Where: [file:line]
Why it's wrong: [what the code should do vs what it does]
```

If multiple hypotheses are confirmed, determine which is the primary root cause. If they are co-dependent, document both and address as a compound fix. If independent, complete the cycle for the primary one first, then re-enter Phase 2 for the secondary.

**Incidental findings:** If you discover other bugs during investigation that are NOT the reported issue, list them in an `## Also Noticed` block after the verdict. Do not fix them in this cycle — just surface them so the user can decide whether to address them next.

```
## Also Noticed
- `getItemCount()` returns string concatenation instead of numeric sum (file:line)
- No input validation on negative quantities (file:line)
```

This keeps the current cycle focused while ensuring discovered issues are not silently lost.

**Only now may you write a fix.**

## Phase 5 · Targeted Fix

- Change **only** what's needed for the root cause. Nothing else.
- If you need more than ~30 changed lines, pause — you might be solving the wrong problem or multiple problems at once.
- Do NOT: refactor adjacent code, rename variables for style, add unrelated improvements, "clean up while you're here."

After applying the fix, proceed immediately to Phase 6.

## Phase 6 · Verify + Clean

1. Ask the user to verify the fix:
   - Tell the user: **"I've applied the fix. Please test the same steps again and confirm the bug is resolved. Say 'done' when finished."**
   - **WAIT for the user to respond.** Do NOT proceed until confirmation.
   - If user reports the bug is still present → the fix is wrong. Back to Phase 4.

2. Run tests. ALL of them, not just the one that was failing.
   - If tests fail → did the fix introduce a regression? If yes, revert and go back to Phase 4.

3. Remove ALL instrumentation:
   - Call `stop_debug_session` with `cleanup: true` to shut down the HTTP server and delete the log file
   - Find and remove all `#region DEBUG_` blocks: everything from `#region DEBUG_<ID>` through matching `#endregion DEBUG_<ID>`
   - Verify: `grep -rn '#region DEBUG_' .` should return nothing

4. Show the final diff: `git diff --stat && git diff`

## Phase 7 · Postmortem (brief)

```
Bug: [one line]
Root cause: [one line]
Fix: [one line]
Prevention: [one specific action — a test, type constraint, lint rule, or validation]

Other issues noticed (not fixed):
- [description] at [file:line]
- (or "None" if nothing else was found)
```

Include "Other issues noticed" if you observed potential bugs during investigation that were NOT the reported issue. This helps the user know what else to look at.

---

## Test Detection

Auto-detect the project's test framework in this priority order:

| Signal | Runner | Command |
|--------|--------|---------|
| `vitest` in package.json | vitest | `npx vitest run` |
| `jest` in package.json | jest | `npx jest` |
| `package.json` has `"test"` script | npm | `npm test` |
| `pytest.ini`, `pyproject.toml`, or `tests/` dir | pytest | `python -m pytest --tb=short -q` |
| `Cargo.toml` | cargo | `cargo test` |
| `go.mod` | go | `go test ./...` |
| `Makefile` with `test` target | make | `make test` |

If no test framework is detected and `$TEST_CMD` is not set, skip automated test execution. Rely on manual reproduction, instrumentation output, and log analysis. Note this in the Situation summary, and in the Postmortem recommend adding a test as the Prevention action.

For targeted test runs, prefer running only relevant tests:
- jest/vitest: `npx vitest run path/to/file` or `npx jest path/to/file`
- pytest: `python -m pytest path/to/test_file.py -x`
- cargo: `cargo test module_name`
- go: `go test ./package/...`

## Browser Debugging

If Chrome DevTools MCP tools are available (names starting with `mcp__chrome-devtools__`), use them for console logs, network requests, DOM snapshots, screenshots, and JS evaluation. Tool names vary by version — check available tools at runtime.

For structured debugging, the **debug-ingest server** provides a better option:
- Instrumented code sends `fetch()` to `http://127.0.0.1:7242/ingest/` with hypothesis-tagged data
- No manual log reading — call `read_debug_logs` to get structured evidence
- Works in any browser without extensions

If neither is available — most bugs are debuggable from server-side logs and tests alone.

## Instrumentation Convention

All instrumentation uses the `debug-ingest` MCP server. Never write logging code manually.

Call `get_instrumentation_snippet` — it returns a ready-to-paste block wrapped in region markers:

```
// #region DEBUG_H1
fetch('http://127.0.0.1:7242/ingest/', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sessionId, hypothesisId: 'H1', location, message, data, timestamp: Date.now() })
}).catch(() => {});
// #endregion DEBUG_H1
```

Cleanup: find `#region DEBUG_`, delete through matching `#endregion DEBUG_<ID>`.

### Security

Never instrument expressions containing secrets, tokens, passwords, or PII. Log types, shapes, or lengths instead.
