# Shared initiative runtime and delivery foundation — design

## Normative design and reading order

Read the curated context entries, this child PRD, this design and its implementation plan, then the [parent design](../09-11-companion-initiative-implementation/design.md). The parent owns shared contracts; this child narrows execution ownership and does not define an alternative architecture.

Parent implementation section 3 supplies the matching ordered scope. Reviewed parent design and a verified incoming Memory/schema baseline; no preceding implementation child.

Before production work, read the [September 19 snapshot contract](../09-11-companion-initiative-implementation/research/baseline-snapshot-contract-2026-09-19.md) and the parent's combined-baseline validation. Pinned main `516e151` includes committed B6 immutable Memory snapshot/tool/recall/assembly binding and durable Memory operations through migration 048. Extend the verified combined interfaces; do not recreate them from the September 11 planning assumptions or allocate a migration against the old 040/047 ceilings. Operator Memory operations do not replace Run/Attempt delivery continuations. Future authority switching remains with its Memory task owner, and inherited visibility/attribution limitations stay explicit.

## Owned modules and boundaries

Paths below name existing module areas or explicitly proposed additions. Confirm precise filenames against live source before editing; new paths are not evidence of installed features.

| Owner area | Responsibility |
| --- | --- |
| Shared | Existing harness/run-event/observability/timeline/connect/time contracts and exports; focused new initiative execution/decision/delivery schemas. |
| Core execution | agents/turn-queue.ts, agents/chat-agent.ts, agents/request-preparation.ts, server/methods/chat-send.ts, scheduler/scheduled-run-adapter.ts, harness/run-service.ts and snapshot/recovery modules. |
| Core delivery and storage | Proposed delivery/ coordinator and db/run-delivery-repo.ts; existing run/timeline repositories, publication/sender and governed avatar seams. |
| Core time and Monitor | Existing time/, User Timezone/schedule resolver, observability query/projector/Inspector and method registration. |
| Integration | main.ts, migration registry and source/index/spec updates; serialize these files within the child. |

## Required contracts

1. Register primary intent before asynchronous Run admission; background reservation must observe that intent and remain atomic with acquisition.
2. Every initiative Run supplies its explicit thin context and immutable source/authority manifest; never fall back to full relationship replay or advance primary pressure/auto-memory.
3. Advertised and executable tool sets both obey the captured stricter-only profile. An accepted structural decision stops reasoning; failed/missing/conflicting decisions do not become success.
4. Pure text may be a post-execution ordinary Timeline projection. Any governed expression/tool/Host work retains the same active Attempt and explicit waiting/resume CAS; release the Character slot while held.
5. Recovery considers required decision and continuation state before inferring completion from the last terminal Effect. No model rerun or new delivery Run resolves a held expression.
6. Commit output identity, Timeline row, quota transition and required fact before fan-out. Quota charge, transport acceptance and actual presentation remain distinct.
7. Legacy Monitor clients must receive schema-valid truthful projections or a clean unsupported-view result. New events must not break persisted v1 replay or cursor progress.
8. Timezone uses the existing singleton. Fixed/follow-primary-device input is authenticated and revision-bound; offline keeps the last confirmed zone, and VPS time is never authority.

The [current Memory delta](../09-11-companion-initiative-implementation/research/memory-baseline-delta-2026-09-19.md) refines lifecycle integration: invocation drain is not a durable lease for an idle/held Run; changed authority or a retired consumer requires refusal/expiry, never reacquisition through the live operator accessor. Preserve actual producer-before-operation-owner shutdown. Operator Memory outcomes do not establish Run completion or derived freshness; retain D81/D84 limits and leave transition source custody with its Memory owner.

## Concurrency and integration

One implementation owner serializes shared exports, `main.ts`, migrations and registry edits. Other agents may own non-overlapping bounded work after explicit assignment. Preserve existing changes; do not reset, rebase, overwrite another task or run the main worktree.

All new persistent/protocol fields are strict and bounded. Core remains the single writer. State plus required evidence commits atomically; publication follows commit. Context, generation and source identity remain internal binding facts rather than visible metadata.

## Validation design

- Real SDK request is thin and authority-captured; non-primary control remains ephemeral and ordinary primary behavior is unchanged.
- Primary admission gap/races, FIFO per priority, cross-Character work, background refusal and cancellation do not leak reservations or create spurious Runs.
- All three outcomes, invalid/conflicting/duplicate terminal calls and observer settlement failures behave truthfully.
- Held expression releases the slot, resumes the same Attempt without the model, and is refused after expiry/revocation/terminal state; crash cuts do not auto-complete it.
- Same-identity publication is idempotent; quotas/gap are atomic; pre-publish cancellation releases only unused capacity, uncertainty does not refund.
- Existing Monitor shows the same Run and factual events after reopen; old-client projection and mixed event decoding retain cursor correctness.
- Supported migration lineages retain Memory/Timeline state; unsupported/unmappable history refuses atomically.
- Fixed and designated-device timezone changes preserve absolute/fixed schedules and recompute only future user-zone work.

Use real owning services and meaningful failure/negative cases. Mocked UI or pure builder tests alone do not establish lifecycle, transport, source or native presentation contracts. Source tests cited in research were read, not run for this child.

## Sources

- [Research: runtime-contracts.md](../09-11-companion-initiative-implementation/research/runtime-contracts.md).
- [Research: observability-contracts.md](../09-11-companion-initiative-implementation/research/observability-contracts.md).
- [Research: decision-register.md](../09-11-companion-initiative-implementation/research/decision-register.md).
- [Effective parent decisions](../09-11-companion-initiative-implementation/research/decision-register.md).
- [Current baseline integration contract](../09-11-companion-initiative-implementation/research/baseline-snapshot-contract-2026-09-19.md) and [Memory delta](../09-11-companion-initiative-implementation/research/memory-baseline-delta-2026-09-19.md).
