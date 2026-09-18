# Authority Transitions and Operator Reachability

Date: 2026-09-15. Root source audit, building on the [grounded B7 grill](../../08-09-memory-operations-ui/grill.md).
Parent R1/R4/R5/R6/R9, ADR 0009 and the later B6 preservation ruling define the required behavior. This report makes
no authority mutation, live-runtime acceptance or product implementation claim.

2026-09-18: [current-code recheck](source-recheck-2026-09-18.md) confirms the missing production workflows and narrows
O02/O05: the existing promotion wrapper does not establish complete Canonical Local writer drain or a transition queue.

Source shorthand: db/, boot/, server/ and memory/ are relative to packages/core/src/; bare hindsight-*.ts filenames
are under packages/core/src/memory/hindsight/. The accepted B6 grill is in the sibling memory-runtime-integration task.

| ID / original owner | Implemented foundation and reachable entrypoint | Remaining work and impact | Exact evidence |
| --- | --- | --- | --- |
| O01 - B2 Legacy to Canonical Local | Full operator migration method family exists and is registered on demand: dry-run, stage, resume, status, verify, exceptions, explicit exclusion and activate. The activation selects Canonical Local and retires legacy use. | No complete guided migration UI. New/legacy workspace acceptance must use this real path rather than seeded canonical tables. Original owner/manual conversion remains separate from code/test evidence. | `packages/core/src/server/methods/memory-migration.ts:36-47`; `packages/core/src/main.ts:448`; `memory/legacy-migration/legacy-migration-runner.ts:33-49`; `memory/runtime-selector.ts:51-65`. |
| O02 - B4 current-state first import/proof | Current Local capture/preparation, complete native transfer, independent maintenance certificate, replica verification and atomic promotion are implemented primitives. A fence wrapper exists but is not production-wired; its quiescence claim depends on which writers enter that fence. Post-B2 Local changes are included in the source-coverage design. | No production operation starts/resumes that entire Hindsight preparation/import/proof/promotion flow. An isolated import/proof test or readiness query is not an executable first-enable journey. Basic Hindsight onboarding remains blocked at this operation boundary. | `db/hindsight-current-preparation-repo.ts:21`; `memory/hindsight/hindsight-current-orchestrator.ts:21`, `:43`, `:76`; `hindsight-authority-promotion-service.ts:10`; bounded production caller search below. |
| O03 - B3/B4 setup and status | Setup RPCs and B4 cutover status/verify are registered. Persistent setup revisions, cutover runs, coverage/proofs and leases already exist. | Complete operation discovery, admitted stable identity, stage-aware cancellation, restart recovery and second-client observation are missing. B4 status requires a known run ID. Setup busy recovery is separately missing (N05). | `boot/hindsight-setup-boot.ts:30-41`; `server/methods/hindsight-cutover-methods.ts:21-33`; `server/methods/hindsight-setup-methods.ts:27-46`. |
| O04 - B5/B6 producer status and manual controls | The live scheduler/Bank service provides sync/recovery with durable checkpoints, scheduling, backoff and parent-write advancement. | No operator facade for live schedule/status, manual incremental/full sync and Pending retry/inspection. No truthful composite status of authority, native/application/parent work, unknown outcomes and required cutover maintenance. | `memory/hindsight/hindsight-replica-scheduler.ts:19-24`, `:92-108`; `hindsight-runtime-bank-service.ts:59-63`, `:139-156`; `server/methods/memory-status.ts:24-33`. |
| O05 - B7 healthy Hindsight to Local | Full-fidelity logical state, selected-runtime lifetime guards and a Legacy admission fence exist as separate foundations. The fence is not injected into the Canonical Local subsystem and rejects new calls rather than journaling them. Accepted design requires final synchronization, required maintenance/integrity, zero unresolved writes, queued fenced mutations and new Local epoch. | Missing production reverse authority transaction/orchestration, final native source handoff, conversion/publication to new Local epoch, transition queue/replay and complete runtime replacement. Planned healthy return cannot currently be executed as the accepted workflow. | `db/canonical-memory-authority-repo.ts:37` only creates initial Local; `db/hindsight-authority-repo.ts:222-243` only promotes Hindsight; `memory/runtime-selector.ts:26-65`; `memory/runtime-composition.ts:81-100`; `memory/canonical-local-subsystem.ts:22-48`; `memory/legacy-migration/memory-authority-fence.ts:17-33`. Provider-side source fencing remains separate design work. |
| O06 - B7 current-Local re-entry and repeated switching | Local revision history/receipts and import mappings exist. The accepted rule reuses verified common baseline, stable identities and subsequent Local changes while preserving/reconstructing agreed state. | Missing current-Local-epoch change coverage/application, generalized source proof, repeatable epoch commit and runtime handoff. Existing first-promotion guards require initial-local and the original B2 source receipt. Never forge a receipt or substitute new-Bank/full-copy defaults for this work. | `db/hindsight-authority-repo.ts:79-96`; `db/hindsight-cutover-run-repo.ts:111-124`; `db/canonical-memory-maintenance-journal.ts:54-64`; accepted B6 `grill.md:22-24`. |
| O07 - B7 emergency takeover | Replica, outbox and checkpoints provide a last verified boundary. The emergency design is explicit and distinct from ordinary return or setup disable. | Missing admitted takeover operation, uncertainty/backup capture, guarded Local epoch publication and recovered-foreign-branch disposition. No automatic failover is authorized. | ADR 0009 `:49-51`; production authority writers above; `hindsight-setup-service.ts:153-160` only changes setup state on disable. |
| O08 - B7 Home operations | Current Home Operations supports memory tidy, legacy maintenance counters and media usage through the shared authenticated Home connection. | No Hindsight setup/sync/switch/backup/upgrade operation UI or observer restoring real progress after window closure. Loading/error/partial/conflict/unknown outcomes must reflect actual producers and independent operation lifetime. | `apps/desktop/src/windows/home/pages/operations/use-operations.ts:30-60`; `operations-page.tsx:17-55`; completed multi-endpoint report ME-07..ME-10. |
| O09 - integration and user acceptance | Extensive scoped source/provider/migration/recovery tests and real copied-data/model checks exist. | Required cross-feature journeys remain unverified or structurally blocked: fresh install/onboarding, repeated switching after real Local changes, new Characters while Hindsight is active, reopened/second-client operations, managed deployment/restore/upgrade and original-environment acceptance. | Parent PRD acceptance and batch definitions; B4/D78/B6 validation limits; D59 manual checklist; source-fingerprint check. |

## Bounded negative searches

- Production callers of `prepareHindsightCurrentBank`, `importHindsightCurrentBank`, `verifyHindsightCurrentBank`,
  `fetchHindsightCurrentBaseline` and `promoteHindsightWithFence` were searched under Core, desktop and scripts, excluding
  tests, testing helpers, fixtures and Markdown. Only their declarations were found in those boundaries.
- Searches for authority-epoch writes and authority-selection updates found initial Local creation, B2 Legacy activation
  and first Hindsight promotion, not a reverse/takeover/re-entry transaction. This is supported by the positive guards
  in the named repositories, not merely by a guessed function name.
- Actual registered Hindsight methods are B3 status/validate/setup/disable/LLM-health and B4 status/verify. The existing
  `memory.status` handler exposes window/summary/auto fields, not provider/runtime/sync/operation readiness.
- Desktop Hindsight references in the inspected operator surfaces identify generic configuration grouping, not a
  Hindsight operation controller. The completed multi-endpoint report records its exact negative-search boundaries.
- These searches do not assert that the lower-level storage is absent or that an external custom script is impossible.
  They establish the missing shipped operation path required by the accepted product journeys.

## Acceptance rule

Every transition must be exercised through its real operator/service entrypoint against an independently prepared
source, without manually editing the authority marker or manufacturing B2 receipts. Cover both sides of the commit,
lost responses, restart, stale callers and complete Bank sets. Compare identity/lifecycle/policy/provenance/Blocks and
new Local changes after a full round trip. Prove admission/drain coverage for the actual Canonical Local writers and
persist incoming transition intents before promising queue/replay; passing a fence object to a promotion helper is not
that proof. Passing record reconstruction alone must never mark this gate complete.
