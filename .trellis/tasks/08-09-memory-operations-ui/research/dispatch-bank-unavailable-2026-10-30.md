Active task: .trellis/tasks/08-09-memory-operations-ui

# Task: diagnose and fix first `chat.send` failing with HINDSIGHT_APPLICATION_BANK_UNAVAILABLE

## Problem (one problem only)
Retained run `research/first-use-runtime/results/2026-10-29T14-28-36.047Z` reached activation in the isolated
Home/Core/Native journey, then the first `chat.send` failed with `HINDSIGHT_APPLICATION_BANK_UNAVAILABLE`.
Evidence: that directory's `result.json`, `core-1.log`, `native.log`, `provider-requests.json`.
Raising sites: `packages/core/src/memory/hindsight/` (application-binding-runner, provider-context,
write-context, write-mutation, runtime-view).

## Deliverable
1. Root cause, traced through the full control/data flow from activation to the first chat-time Bank
   resolution. Tag every claim [source file:line] or [log line] or [inference]. If unknown, write UNKNOWN.
2. Decide: product defect, or fixture/journey defect (e.g. the journey skips a required supported step such
   as the explicit v2 template action, or Bank provisioning). Fixture defects are fixed in the fixture, not
   by loosening Core.
3. If a product defect: the smallest correct fix at the root cause, plus ONE regression test that reproduces
   the observed failure first. Report as a unified diff; you may edit only the files the fix needs.
4. Write the report to `research/first-use-bank-unavailable-2026-10-30.md` (findings, fix, files touched,
   checks run with actual output, every trade-off you made).

## Hard constraints
- Read first: CLAUDE.md, CONTEXT.md, this task's prd.md/implement.md, research/continuation-2026-10-30-01a18ad8.md.
- Fix the root cause. Do not patch symptoms at multiple call sites, do not add fallbacks, retries, extra
  validation layers, new abstractions or "defensive" branches for unreachable cases. This is a single-user
  local app; do not invent attackers or threat models.
- Do not weaken admission, authentication, single-authority or durable-write semantics to make the error go
  away. Do not make the error silently disappear (no swallowing, no fake success).
- Scope: only this failure. Do not touch the key UI, per-Bank sync settings, or `first-use-source-review`
  files (another reviewer owns them). Do not refactor neighbouring code. No UI design work.
- Tests: one focused regression only if a product fix is made. No test batches, no tests that pin current
  behaviour. Run only the affected test file plus `pnpm -C packages/core exec tsc --noEmit`; max 2 Vitest workers.
- Do NOT start PG/Native/Core/browser runtimes; the leader owns runtime lifecycle and will rerun the journey.
- No git commit/push/reset/rebase/stash. No original user data, real keys, or paid model calls.
- Do not stop early: the task is done only when deliverables 1-4 exist or a concrete blocker is written down.
