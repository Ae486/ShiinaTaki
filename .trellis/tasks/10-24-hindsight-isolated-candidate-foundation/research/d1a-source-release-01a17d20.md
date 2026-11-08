# D1-A source release and interruption checkpoint

## Current checkpoint

Status: focused source completion in progress; no final current-source validation or independent acceptance claimed.
Owner: `/root/d1a_resume`, continuing root session `01a17d20-f141-7f31-b9f8-c161431c935d`.
Workspace verified as `H:/TakiAgent`, `main`, HEAD `e260ff4` on 2026-10-27.
The empty legacy `.trellis/.current-task` is not the session binding; Root explicitly assigned the existing D1 task.

Recovery checkpoint, `research/leader-now.md`, PRD/design/implementation plan, curated specs and the complete oversized source study were read. Source inspection confirmed inherited pre/post-template restored snapshots. One direct-admission input-mutation regression was reproduced and narrowly fixed: capture paths synchronously and copy the observed target schema before archive I/O. The inherited 7-file/35-test result predates later source edits and is historical only.

Scope is D1-A only: candidate-specific Core modules and tests, Shared candidate schema and test, this report and dedicated evidence. Central exports/index changes remain inherited and Root-owned. Preserve all other work. D1-A has no production Memory Operation, Host/runtime integration, schema migration, restore/startup or D1 PASS.

Next: inspect the existing two restored-snapshot checks and source/archive binding, finish meaningful missing regressions, run scoped Shared/Core typecheck, ESLint and candidate/unchanged Stage 3/v2 regressions with at most two Vitest workers, then release exact source and evidence for independent review. This agent owns the single heavy validation slot until release.

No Docker/Native/model execution, real data/credential access, dependency changes, Git lifecycle changes, task-state changes or deletion of unknown output. Material temporary test output will use G:.

## Checks and recovery notes

- Read-only workspace checks: main/worktree inventory verified; inherited dirty files retained.
- `python3 ./.trellis/scripts/get_context.py --mode packages` could not launch because Windows resolves `python3` to its Store alias. Retried the same script with installed `python`; it completed and reported backend/frontend spec layers. No environment change was needed.
- Initial lookup of task-root `leader-now.md` was corrected to the existing `research/leader-now.md`; no file was created at the missing location.
- Red regression: `pnpm --filter @taki/core test src/memory/hindsight-candidates/hindsight-candidate-admission.test.ts --maxWorkers=2 -t 'binds direct admission'` failed as expected with `HINDSIGHT_CANDIDATE_OMITTED_REQUIRED_DATA` after caller mutation changed the schema during archive reads. Evidence: `d1a-validation-01a17d20/01-admission-mutation-red.log`. The test keeps the original paths/schema/manifest as the required input identity; it does not weaken archive equality.
- Material test output is under `G:/TakiAgent-staging/d1a-01a17d20-b4ccc92f-d174-4910-b481-c54048907cdd`; its owner marker and `d1a-validation-01a17d20/environment.json` record the scope. No final check has run yet.
- Shared typecheck passed (exit 0), `02-shared-typecheck.log`.
- First Core typecheck failed (exit 2), `03-core-typecheck.log`: the new drift test called the optional `HindsightClient.observeTemplateBackup` without narrowing. Added an explicit fixture assertion before wrapping the method; no production behavior changed for this correction. Core rerun, lint and final regressions remain next. The original failed log is retained.
- Added deterministic regressions for missing restored snapshots, exact capture request/Core/archive binding with a historical source identity distinct from current source exclusions, and archive/WAL mutation during authenticated-template substitute observation. These are not actual installed-observer evidence.

## Remaining acceptance boundaries

D1-B/C/D, independently archive-bound source schema observation, real restored PostgreSQL snapshot producer, actual Host-derived physical identity and authenticated no-effects template observation remain later integration gates. A trusted interface or deterministic fixture is not those production proofs. Exact original version and unchanged Stage 3 Native-ahead pair semantics remain required.
