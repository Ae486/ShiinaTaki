Active task: .trellis/tasks/08-09-memory-operations-ui

# Task: diagnose why the explicit v2 template preview is refused with a directive identity conflict

## Problem (one problem only)
Isolated journey `research/first-use-runtime/native-smoke.mjs` now passes steps 1-9 (incl. settings, pending, drift,
Core restart, Home reopen). Step 10 (`home-check.py` action "template": click 预览模板变更 then 确认应用模板变更)
fails because the preview is `refused`. Retained run: `results/2026-10-30T07-02-30.062Z` (core-1.log, core-2.log,
native.log, result.json). Browser capture: `G:/taki-first-use-sLPLk0/home-template/page-error.json` (and failure.png);
the temp root's Core data dir/SQLite is also retained there (read-only only).
The page shows, for a Character Bank: "原有指令：taki-character-memory-policy-v1（d0047d81-5057-43c3-b6b6-cbb00d605e99）
此标识原先不存在。 指令：taki-character-memory-policy-v1 · 同名候选 1 个 d252ec07-554f-4b3b-b04c-dc13ff3110fb".
So Core's recorded directive id is absent on Native while one same-name directive with another id exists.

## Questions, each tagged [source file:line] / [log line] / [db query] / [inference], or UNKNOWN
1. Which Bank, and which operation created each of the two directive ids (setup.apply v1, activation, step 6 new
   Character provisioning, step 7 revalidate, step 8 restart)? Did a Taki path create the directive twice, or record
   the wrong id, or did Native reassign ids?
2. Per the spec/PRD for template lifecycle, is this refusal expected for this journey (i.e. the operator is supposed
   to choose "核对后接管 / 重新协调" first), or is it a product defect in the earlier step that produced the mismatch?
3. The correct fix: smallest root-cause product fix plus ONE regression test that fails first; or, if the refusal is
   the documented contract for this state, the fixture change that performs the documented operator step. Unified diff.
Write the report to `research/first-use-template-conflict-2026-10-30.md` (findings, fix, files, checks with actual
output, every trade-off).

## Hard constraints
- Read first: CLAUDE.md, CONTEXT.md, this task's prd.md/implement.md, the template lifecycle spec in .trellis/spec/backend/.
- Fix the root cause only. No retries, fallbacks, new abstractions, or defensive branches for unreachable cases.
  Single-user local app: no invented threat models.
- Do not weaken the template preview/consent gates, identity checks, admission, authentication or durable-write
  semantics; never auto-adopt or auto-delete resources to make the refusal disappear.
- Scope: this failure only. No UI design changes, no refactors, no edits to unrelated files.
- Tests: at most one regression test, only for a product fix. Run only the affected test file (vitest --maxWorkers=2)
  and the affected package's `tsc --noEmit`.
- Do NOT start PG/Native/Core/browser runtimes; the leader reruns the journey.
- No git commit/push/reset/rebase/stash. No real keys/data/paid models.
- Do not stop early: done only when the report answers 1-3 or names a concrete blocker.
