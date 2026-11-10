# Implementation and verification

> Frozen by the owner on 2026-11-10 pending main-stage completion and later integration.
> Follow [the freeze handoff](../../../docs/T4-FREEZE-HANDOFF.md) before resuming;
> unchecked acceptance remains open and earlier restart instructions are historical.

## Order and ownership

1. [x] Restore source context, inspect live data read-only, reproduce correction and coverage gaps.
2. [x] Review design against original owner requirements and mature-source research; resolve advisor concerns.
3. [x] Activate the approved task and freeze Shared contract/ownership.
4. [x] Local producer: corrective completion, fresh views, candidate checkpoints, timeout and bounded retry; own focused regression tests.
5. [x] Operation integration: Shared tidy kind/progress/result, durable owner join/wait, runtime dispatch and compatibility RPC.
6. [x] Home integration: existing operation subscription/read flow, readable progress and next actions, candidate wording.
7. [x] Exercise full Local runtime -> operation owner -> RPC/WS -> Home behavior with isolated data and controlled models/transports.
8. [x] Run independent full-change review; fix evidence-backed findings.
9. [x] Run project checks, update canonical specs and record exact evidence/limits. Do not commit/archive without owner request.

## Failure-oriented acceptance matrix

- Bad reference/invalid schema -> meaningful correction -> explicit finish; unchanged and duplicate receipts count zero.
- Rejected operation intentionally not needed versus unresolved/unknown write; no silent failure erasure.
- More than one report page, cap exit, later-batch failure, new write during review, subsequent retry and database reopen.
- Manual/automatic and cross-Character overlap over shared Global memory; fresh capture after queued work.
- Live concurrent revision change; corrected review preserves newer content; authority switch fences old work.
- API failure after some edits, cooperative HTTP timeout, repeated failed auto triggers, explicit retry, stopped queue.
- Process restart with open operation; queryable interrupted state and committed-effect evidence.
- Lost submit response, push/reconnect/remount/hide-show; no duplicate mutation, proper baseline subscription ordering.
- Existing Legacy/Hindsight completion, source ingestion and compaction regressions.

## Commands

Focused commands are recorded with each implementation result. Final required gates from the repository:

```powershell
pnpm -r --workspace-concurrency=1 typecheck
pnpm lint --ignore-pattern 'artifacts/**'
pnpm -r --workspace-concurrency=1 test --maxWorkers=4
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
```

The artifacts lint exclusion is the documented pre-existing snapshot tree; do not add new exclusions to hide active code. Record pre-existing failures separately, with exact reproduction. Include a real Node strip-only Core boot with isolated storage and no real credentials, and a rendered UI check. Real-model observations, isolated transport/model checks and owner acceptance are distinct.

## Delivery state

The owner-authorized backlog optimization is implemented and verified: independent review, required project checks,
real Legacy/Local startup, browser scenarios and a complete real-model backlog observation on an isolated copy. See
[delivery.md](delivery.md) and [research/backlog-optimization.md](research/backlog-optimization.md). Owner manual
acceptance remains pending; no commit/archive was requested.

## Background Monitor follow-up execution

- [x] Independent challenge of producer ownership, cache baseline migration and lifecycle notifications.
- [x] Shared bounded contracts, additive migration068, explicit SDK call associations and independent read model/RPC.
- [x] Normal cache excludes only Utility tidy/compact; latest-primary input remains on its original source.
- [x] Normal/background Monitor tabs, actual call/progress coverage, query-generation guards and lifecycle cleanup.
- [x] Independent final review; automatic Legacy owner and unknown reviewed-count findings corrected.
- [x] Focused failure/migration/association/controller tests and actual Core/WS/MonitorPage browser verification.
- [x] Final stable-snapshot full gates and delivery record: Core 4675 passed / 6 skipped; typecheck, source lint, Clippy, Desktop regression and seven actual Core/browser cases passed.

A concurrent workspace task added migration069 during the first full regression run. Its production code and version
assertions are preserved. Final verification reloads the current registry and corrects only the stale exact migration
receipt count. Monitor's own additive migration remains068. Tests are run with bounded workers to avoid local resource
starvation; no timeout/behavior assertion is relaxed.
