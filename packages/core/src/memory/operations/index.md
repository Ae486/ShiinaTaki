# core/memory/operations/
The durable memory operation owner (Hindsight closure Stage 1, D-S1-1): one Core-owned table + service over the existing B3
setup service and B5 replica scheduler. Outcomes are classified from what those producers persisted; nothing here runs a
second scheduler, recovery loop, or authority write.
- memory-operation-contract.ts — handler contract per kind (family/admit/execute/observe/cancel), settlement + observation shapes, the narrow live runtime view, and the closed MemoryOperationRefusal
- memory-operation-kinds.ts — MEMORY_OPERATION_KINDS, the closed registry (one row per kind) and the dispatch-boundary erasure helper
- memory-operation-kind-setup.ts — setup.validate / setup.apply: wrap HindsightSetupService, settle from the returned snapshot (failed phase => producer_failed; thrown refusal => producer_refused)
- memory-operation-kind-replica.ts — replica.sync: durable manual request + one awaited scheduler tick; classification from the persisted Bank state (lastSuccessAt/lastAttemptAt vs admittedAt); cancel only before claim
- memory-operation-kind-tidy.ts — selected tidy producer, shared Global single flight, transaction-bound committed progress, and full settled outcome
- tidy-operation-adapter.ts — automatic and legacy-RPC submit-or-join bridge; waits for the same operation without replay
- memory-operation-service.ts — createMemoryOperationService: restart reconciliation, family single flight, execute/wait, filtered reads, transaction-bound progress, CAS settlement and after-commit fan-out
- memory-authority-status.ts — readMemoryAuthorityStatus: the composite memory.authority.status read (authority marker, runtime availability with closed reason, setup, per-Bank replica + Pending/parent-write counts, active/recent operations, derivedFreshness "unknown")
- memory-operation-fixtures.ts — test support (not in the production path): fake scheduler/runtime/setup doubles and the legal Hindsight authority marker seed
