# core/memory/operations/
The durable memory operation owner (Hindsight closure Stage 1, D-S1-1; Stage 2a local kinds): one Core-owned table + service
over the existing B3 setup service, B5 replica scheduler and the Local onboarding service. Outcomes are classified from what
those producers persisted; nothing here runs a second scheduler, recovery loop, or authority write.
- memory-operation-contract.ts — handler contract per kind (family/admit/execute/observe/observeBoot/cancel), settlement (completed/failed/outcome_unknown) + observation shapes, the execution seam (running/tryClaim/checkpoint), the narrow live runtime view, the owner's row lookup and the closed MemoryOperationRefusal
- memory-operation-kinds.ts — MEMORY_OPERATION_KINDS, the closed registry (one row per kind) and the dispatch-boundary erasure helper
- memory-operation-kind-setup.ts — setup.validate / setup.apply: wrap HindsightSetupService, settle from the returned snapshot (failed phase => producer_failed; thrown refusal => producer_refused)
- memory-operation-kind-replica.ts — replica.sync: durable manual request + one awaited scheduler tick; classification from the persisted Bank state (lastSuccessAt/lastAttemptAt vs admittedAt); cancel only before claim
- memory-operation-kind-local.ts — local.onboard.prepare (new/resume/retry) and local.onboard.activate: cheap synchronous admission, macrotask-deferred tryClaim CAS, producer checkpoints, settlement from run/receipt evidence, pre-claim cancel, read-only boot observation; an already-committed exact run repairs the binding only
- memory-operation-local-evidence.ts — local producer-ref constructors, closed MemoryLocalErrorCode mapping (never a replica code), and the prepared/committed/unknown/interrupted settlement builders
- memory-operation-service.ts — createMemoryOperationService: per-kind boot observation, then reconcile remaining foreign boot rows to outcome_unknown; admit (single flight via the repo index), detached execute, observe-on-read, CAS settle/claim/checkpoint, cancel, latest-in-family read, onChanged fan-out, bounded stop
- memory-authority-status.ts — readMemoryAuthorityStatus: the composite memory.authority.status read (authority marker, runtime availability with closed reason from the Hindsight probe or the Local binding snapshot, setup, per-Bank replica + Pending/parent-write counts, active/recent operations, derivedFreshness "unknown")
- memory-operation-fixtures.ts — test support (not in the production path): fake scheduler/runtime/setup doubles and the legal Hindsight authority marker seed
