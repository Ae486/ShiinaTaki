# Completion Plan Review and Owner Direction

Date: 2026-09-18. Scope: the existing Hindsight completion roadmap and B7 prerequisites.
Three independent `explorer` agents using `gpt-6-astra` reviewed transition/runtime feasibility,
setup/administration dependencies, and requirement/acceptance coverage against the current working tree.
This was read-only source and design review. The failure scenarios below were not reproduced in running systems.

## Verdict and owner direction

The roadmap is coherent and retains the accepted architecture. Five plan/acceptance amendments and three
clarifications are required; they do not reopen the settled preservation rules or expand deferred features.

The owner accepted the review, requested that it be recorded first, and directed the leader to read HANDOFF,
development standards and leader guidance before organizing, advancing and dispatching this work. The leader owns
scope, contracts, dependency order, dispatch boundaries, independent review and integrated acceptance. Specific
slices still follow the existing design/readiness gates. This direction does not answer U1, establish manual
acceptance, or authorize incidental original-data operations, publication, commit or archival.

## Accepted plan amendments

| ID | Priority | Required amendment | Source evidence and acceptance consequence |
| --- | --- | --- | --- |
| PR01 | P1 | Define one recoverable capture boundary across native PostgreSQL and Core SQLite. Bind artifact pairs to compatible authority, Banks, configuration and native/application checkpoints; reject mismatched pairs before workers start. A coordinated pause is sufficient if it proves the required cut. | `H:/hindsight/hindsight-api-slim/hindsight_api/admin/cli.py:305`; `packages/core/src/db/hindsight-memory-write-repo.ts:83`; `packages/core/src/memory/hindsight/hindsight-memory-write-result.ts:32`. Native capture, then a successful write, then Core capture can restore a missing native effect with a terminal-success Core journal. Add an inter-capture-write case to C10. |
| PR02 | P1 | Give the backup/restore slice its own minimal administration execution or external-artifact admission path, independent of later managed-local provisioning. Define supported permission/custody routes and verification of externally produced artifacts. | Native backup requires database access at `H:/hindsight/hindsight-api-slim/hindsight_api/admin/cli.py:440`; the parent PRD requires existing-instance independence at `../prd.md` R10. An HTTP API key is not remote database/OS permission. Preserve Core OS neutrality. |
| PR03 | P1 | Define custody of exact committed primary-conversation spans during drain, authority COMMIT, failed target binding and restart. Prevent new source commitments during the interval or durably preserve them for the resulting epoch; verify no lost or duplicate ingestion. | `packages/core/src/memory/runtime-composition.ts:66`; `packages/core/src/memory/hindsight/hindsight-memory-subsystem.ts:72`; `packages/core/src/memory/canonical-local-ingestion.ts:62`; `packages/core/src/memory/hindsight/hindsight-ingestion.ts:65`; `packages/core/src/db/canonical-ingestion-source-repo.ts:169`. Add late-chat-commit plus constructor-failure/restart cases to C03 and C07. First activation must include this gate. |
| PR04 | P2 | Define transition-queue admission, cutoff, intent ownership, source-to-target identity/revision proof, replay identity and original-caller results before implementing replay. Distinguish admitted intents from stale invocations arriving after COMMIT; cover conflicting queued mutations. | `packages/core/src/memory/canonical-memory-run.ts:29`; `packages/core/src/memory/canonical-tools/memory-effect-tool.ts:13`; `packages/core/src/memory/memory-coordinator.ts:99`. Do not retain old executable closures for cross-epoch replay or silently rebind old Run/Effect references. C07 must verify both admitted and refused requests. |
| PR05 | P2 | Assign an explicit Local-only onboarding slice before or alongside existing-instance first enablement. Cover empty and supported legacy workspaces, preview/exclusions/resume/verify/activate, and Local chat/retain/recall/maintenance without Hindsight or vectors. | J1/C01 and A03/A09 in the existing audit. B7 owns operator integration and reuses B2/B6 producers; merely listing C01 in final testing does not assign implementation. |

PR02's parent requirement is in [R10 of the parent PRD](../../08-09-hindsight-memory-provider/prd.md).
All five amendments must be allocated before implementation planning is approved. Their executable details and
tests are completed in the corresponding slice; they do not require implementing every later feature up front.

## Required clarifications

1. **Final frozen state:** every promoted native/application checkpoint and required-maintenance proof must refer
   to the final state frozen by the provider-side fence. Post-fence catch-up/reconciliation or an equivalent verified
   snapshot can establish this. C07 inserts a write or maintenance completion immediately before the fence. The current
   post-fence snapshot wording can support this; the review did not demonstrate an already implemented data-loss race.
2. **Emergency recovery:** validate the recovery capability before releasing real takeover. During permanent provider
   loss, seal surviving Core, replica, Pending and checkpoint evidence and reference the last verified full backup when
   available. Expose backup age and the missing interval. A fresh backup call to the unavailable provider cannot gate
   emergency admission, and incident-local evidence is not described as a fresh complete native backup.
3. **Acceptance scope:** C02/C09/C12/C16 span several slices. Record subcase evidence without closing an entire case
   prematurely. C14/C15 still require accurate disclosure of current limitations and supported topology; their deferred
   implementations remain deferred.

## Revised delivery allocation

| Stage | Deliverable and added gate |
| --- | --- |
| Planning | Resolve operation ownership, all-writer/source custody, final provider proof, re-entry coverage, queue semantics and common backup recovery point. Define the administration custody path. |
| 1 | Durable operations, setup recovery/current compatibility fixes and basic manual synchronization/control. |
| 2 | Explicit Local-only onboarding plus existing-instance activation and active Bank/configuration lifecycle. Include first-activation source/runtime handoff recovery. Use isolated data for initial acceptance. |
| 3 | Independently executable backup/restore and common-recovery-point validation. May proceed beside Stage 2; gates real-data authority replacement. Apply the separate incident-time emergency rule above. |
| 4 | Repeated healthy transitions, transition-owned queued intents, final frozen-state proof and separate emergency takeover. |
| 5 | Managed provisioning, complete model/template-overlay lifecycle, candidate upgrade and full Home operations. Minimal truthful Home slices accompany earlier stages. |
| 6 | Scoped package/build/environment checks and complete integrated/manual acceptance. |

This is an allocation proposal within the existing task family, not creation or activation of additional tasks.
Shared runtime composition, authority transactions and schema ownership must be assigned before parallel implementation.

## Preserved decisions and evidence limits

- One explicit authority; ordinary outage/Pending recovery retains Hindsight authority.
- Re-entry reuses verified baselines, mappings and all current-Local changes. No mandatory fresh Bank/full-copy default.
- Existing producer journals, scheduler, leases and recovery remain the foundation; no duplicate synchronization engine.
- D79-D83 remain after B7. D81 remains an unresolved derived-visibility result, separate from original field preservation.
- Same-Core observation is included. D23 remote-Core selection and independent-Core merging remain outside this scope.
- Optional Local vectors/export and differential projection repair retain their recorded status.
- U1 remains unanswered. The review does not mark any runtime, original-environment or owner/manual acceptance passed.

Related records: [source recheck](source-recheck-2026-09-18.md), [coverage matrix](completeness-matrix.md),
[closure cases](closure-plan.md), and [B7 design](../../08-09-memory-operations-ui/design.md).
