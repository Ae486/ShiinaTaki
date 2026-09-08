# Implementation and verification plan

Status: engineering implementation, independent source review, final frozen-build native verification and owner visual acceptance complete. The owner confirmed the normal-window checklist and authorized local closeout on 2026-09-08; code is committed as `d6ddf2e`. Permission-system improvements are separately deferred as D78. See `implementation-evidence-2026-09-08.md` for the evidence and acceptance boundary.

## 1. Shared presentation foundation (root)

- [x] Add a bounded, geometry-stable `PendingIndicator`; cover fast/slow/retired presentation with meaningful renderer checks. Final corrected-build geometry passed.
- [x] Replace immediate PageHeader text and shared busy button text patterns with the common primitive and stable labels.
- [x] Keep Perception sampling/Privacy Pause status truthful in stable header slots; preserve real row identity. Final corrected-build geometry passed.
- [x] Apply the same behavior to extension convergence and Skill inspection while preserving actual errors/results.

## 2. Monitor selection continuity (Monitor implementer)

- [x] Regress loaded A -> deferred B, latest-of-A/B/C, Inspector replacement and unavailable/closed/retired cases before fixing.
- [x] Implement independent candidate requests and coherent committed snapshots without cross-Run warm merges.
- [x] Stabilize Run/Inspector presentation keys and loading controls; preserve cursor, subscription and scroll contracts.
- [x] Run all Monitor tests, Desktop typecheck and scoped lint; report exact evidence and any runtime-only concern.

## 3. Action feedback continuity (feedback implementer)

- [x] Extend the current Toast queue/host with tones and attempt-key deduplication; preserve intentional reading/dismissal behavior and verify automatic expiry.
- [x] Move true transient outcomes to the action-owned notification seam, consuming once across StrictMode and repeated reads.
- [x] Cover Settings permission/config, MCP, Costume/import and Operations/media cleanup; remove stale old-success/new-failure combinations.
- [x] Preserve validation/conflict/refusal/partial-commit/retry and meaningful result content; use stable pending labels/slots.
- [x] Run relevant tests, Desktop typecheck and scoped lint; report changed paths and unresolved evidence.

## 4. Full verification (root + independent check)

- [x] Review all task-owned changed paths, update folder indexes and frontend executable guidance.
- [x] Run full Desktop tests, Desktop/workspace typecheck as applicable, root lint and production build.
- [x] Exercise frozen production Home UI with a synthetic independent backend: quick/slow refresh, A/B/C races, Inspector, populated/empty activity, notification expiry/deduplication, layout, focus, scroll and reduced motion. Final-1 passed 14/14 cases.
- [x] Recheck findings and rerun affected gates after fixes; final evidence matches all 95 reviewed files and 375 build inputs.
- [x] Record delivery and remaining owner-only acceptance honestly. No auto-commit, push, archive or manual-test process shutdown was performed.

## Coordination

All implementers work in the T4 worktree and are not alone. They must not revert other edits or change another slice's files without coordination. `PendingIndicator` has the interface in design.md; notification migration may import it while root implements the shared file. The explicit task path is authoritative; the legacy global `.current-task` may point elsewhere.

Each independent agent reads prd.md, design.md, implement.md, its curated context and relevant source/tests before edits. No recursive implementation/check delegation. Current authority and generation rules always outrank cosmetic continuity.
