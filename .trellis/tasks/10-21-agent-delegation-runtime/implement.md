# Delegation execution plan

Status: S1 passed independent review. The recovered S2/S3 implementation and evidence are recorded in [the S2/S3 report](research/s2-implementation.md); final independent/integration checks remain coordinator-owned. SDK upgrade evidence and the independently challenged joint contract are accepted. Real-model E2E testing is explicitly authorized; bounded R1 and repaired R3 results are recorded separately from manual acceptance.

1. Load the reviewed joint contract and capture the exact current working preimages for S1. Implement shared schemas, four durable record families and canonical atomic admission/terminal participants, including every terminal entry path. Verify with real SQLite before handing these owners to S2/S3. Do not enable a production dispatcher from a schema-only checkpoint.
2. Implement a minimal vertical path: delegate -> shared child execution -> private retained outcome -> record-only completion. Verify before enabling parent continuation.
3. Add addressed input/reuse and independent execution targeting. Verify no parent-history auto-sync, no cancellation-controller replacement and no terminal Run restart.
4. Add captured completion policy and deduplicated parent admission. Test parent stopped/busy, late/duplicate outcomes, record-only work and no implicit publication.
5. Add child conversation navigation, readable transcript/progress, targeted input and independent stop/continue using Shared schemas and existing UI patterns.
6. Integrate with source-aware result/publication projection and run lifecycle/recovery plus relevant Core/Shared/Desktop checks. Hand actual UI acceptance to the parent.

## Parallel work limits

Core lifecycle, Shared schemas and UI may be assigned separate workers only after contracts are stable and ownership is explicit. The source child must not concurrently edit ChatAgent/publication/DB contracts without parent coordination.

## Completion checklist

- [x] Owner start instruction and dependency gates satisfied; existing child activated for S1 on 2026-10-22.
- [x] Contract/package mapping recorded, independently challenged and corrected.
- [x] G1-G4 targeted deterministic checks pass; see the S2/S3 report and retained regression evidence.
- [ ] Real shared execution and conversation UI checked.
- [ ] Restart/stale/uncertain behavior and rollback documented.
- [ ] Owner acceptance remains accurately recorded.

Validation commands and precise tests are selected from the runtime report and actual changes; no unrun gate is labelled passed.

## Sequenced slice ownership

- S1: Shared schemas, additive migration, repositories and RunRepo/RunService transaction participation. Preserve the existing cancellation policy, mutation authority, migration lineage and unrelated dirty-tree work. Capture exact file preimages first.
- S2-S3: After S1 review, shared Agent execution/private history, task/role instructions, effective-tool selection and child Memory exclusions, input targeting, independent controls, completion/reporting and recovery. Main/source-owned files stay single-writer.
- S7: After stable S1/S3 protocol, child conversation UI and reconnect-safe controls. Source S4-S6 can proceed only under the joint contract's explicit file handoffs.
- Final child check: real shared execution, readonly Memory, control/recovery and actual UI evidence. Keep live model and owner acceptance separate; no commit, push or archive is implied.

## Current handoff (2026-10-22)

- `delegation_persistence` and `delegation_persistence_review` completed S1 and released ownership. [Independent review](research/s1/independent-review.md) passes; [verification](research/s1/review/verification.json) records root lint/typecheck, the full TS run plus six repaired migration files, 6,017 combined passes and two unchanged skips. It does not claim a second full run. Isolated boot evidence remains applicable because production source hashes did not change after that boot.
- `delegation_execution` now owns the section 13 S2/S3 files plus `agents/run-observability-telemetry.ts` for actual Effect identity forwarding and the exact existing governance registry/adapter/presentation entries needed for the new tools. Narrow necessary S1 interface follow-ups are transferred to this sole writer; preserve the verified foundation. Capture current preimages and retain unknown-tool refusal. Shared barrel, ChatAgent, RunService and `main.ts` remain exclusively Runtime-owned until explicit transfer.
- The execution cut is WorkContext/private replay and actual input receipts, child lane/Run controls, immutable effective tool selection and read-only Memory, then child/completion pumps, authenticated read/control methods, recovery and the direct-request publication adapter. Source/Co-Watching and desktop owners still await their stable protocol handoffs.
- S1 inputs retain the full sender/material payload separately from intent receipt rows; replay/history must join by `inputId`. Result publication references must join canonical delivery truth. The real-model route baseline is ready in the acceptance child's [preparation report](../10-21-agent-context-acceptance/research/live-e2e-preparation.md); reuse it and run full feature cases only after the relevant wiring exists.
