# Stage 4 prerequisites: runtime, emergency and verification

Continuation of [source prerequisites](stage-4-prerequisites.md), split for complete context injection. The same source baseline and evidence boundaries apply.

### 6. Runtime retirement, rebind and restart

- `packages/core/src/memory/runtime-selector.ts:107`: `bindCanonical` was built for Legacy -> Local; once `state.canonical` is already true it returns the existing engine. It cannot implement Hindsight -> Local. `recoverCanonical` similarly needs the correct publication/epoch, not merely a non-null engine.
- `packages/core/src/memory/runtime-composition.ts:166` composes one publication per provider; `current()` prefers Hindsight. Reverse transition must withdraw old Hindsight publication before routing Local. Add symmetric marker-proven retirement/rebind; preserve the Utility Slot and Core-owned Compaction.
- `packages/core/src/memory/local-runtime-binding.ts:43` supplies draft -> install -> publish/start and unavailable-on-failure; `:65` withdraws a retired Local runtime. `hindsight-runtime-binding.ts:77` provides same-epoch replacement, while `:90` permanently stops the binding lifetime. Introduce epoch retirement distinct from whole-Core shutdown so a subsequent healthy re-entry can start a fresh Hindsight runtime.
- `packages/core/src/memory/hindsight/hindsight-memory-subsystem.ts:172` aborts/settles foreground, scheduler, curator, ingestion, provider, writes, application writer, service and sync. Reuse all these owners; do not only swap an engine pointer.
- `packages/core/src/memory/canonical-memory-run.ts:29` captures immutable routes/authority; `canonical-tools/memory-effect-tool.ts:13` binds Effects to epoch/provider/lineage/capabilities. Retire held references; never rewrite them to the new authority.

Boot must validate the appropriate transition receipt before any writer/scheduler starts. Pre-COMMIT failure retains the source but reopens it only on positive unchanged authority/fence proof. After COMMIT, construction/start/reply failure means the committed target is unavailable and repairable; it never means automatic rollback. Reconcile source custody and unfinished queue/remote-finalization obligations from durable identities; do not redispatch the parent Run or promotion.

### 7. Durable transition intents and original callers

No inspected current fence implements the accepted PR04 queue: `canonical-local-write-fence.ts:24` counts in-process calls and refuses while closed; `hindsight-writer-fence.ts:27` returns a structured retryable refusal. Existing Pending/parent journals remain scoped to the original Hindsight authority, and therefore cannot be relabeled as a cross-epoch queue.

Proposed transition queue stores data, not executable closures: transition ID, monotonically ordered admission ID/cutoff, captured source authority/Bank/caller provenance, normalized typed command and hash, logical target and expected revision, replay identity, target mapping/proof, lifecycle and eventual result. Persist admission before acknowledging it. The caller receives a queued identity, not successful retain/mutation; Shared memory results and the existing Effect adapter must represent that difference without later rewriting an old Run's authority.

At replay, create a fresh internal target context only after exact mapping/revision validation; persist its target request ID before dispatch and reconcile historical receipts after reply loss. Concurrent edits to the same captured revision cannot both silently win: use stable admission order and explicit conflict unless a later intent deliberately references a prior queued result. Define a bounded queue policy and refusal before admission. Old invocations arriving after cutoff/COMMIT refuse stale authority; they are not retroactively accepted.

On a proven pre-COMMIT abort, valid admitted intents may execute against the unchanged source or receive an explicit terminal conflict/cancellation. Unknown release/effect outcomes stay unresolved. On target binding failure or restart, admitted intents retain custody until a proven context is available. Switch completion, runtime readiness and individual queued results are separate status facts; never infer every mutation succeeded from the switch receipt.

### 8. Emergency evidence and authority separation

`packages/core/src/memory/hindsight-backup/hindsight-backup-emergency.ts:23` already makes a Core copy and `incident-local` manifest without a native route. It generates its own incident ID and reads status before the asynchronous copy; it does not own quiescence, transition identity, replay lookup or authority COMMIT. `hindsight-backup-store.ts:87` is the existing artifact store. Extend this hook with a pre-persisted transition/incident identity and recoverable seal lookup rather than adding a second backup system.

The transition must stop old dispatch/publication, obtain a consistent surviving Core/replica/Pending/checkpoint/custody boundary, seal evidence, and only then publish Local. Specify the relationship between captured metadata and the copied database; late primary appends remain durably owned at COMMIT. A seal failure leaves takeover uncommitted. Crash after seal but before its acknowledgement must discover the same artifact, not create another incident or skip sealing.

Keep last verified backup ID/age independent from comparable coverage (confirmed Stage 3 F1). Preserve both native/application coordinates and exact namespace. Even compatible local cursor numbers cannot bound remote-only writes unseen during an outage. No native head or mismatched history means unknown missing memory, not zero. The incident is surviving local evidence, never a fresh full native backup.

Construct Local only from verified consumable state and evidence with a proven disposition. Preserve Pending, parent/application/native unknowns and incomplete source spans separately; do not label them confirmed or replay an old native mutation into Local merely because takeover occurred. Carry exact primary evidence once. Old Hindsight's recovered epoch becomes a quarantined foreign branch; automatic recovery and healthy re-entry cannot overwrite the new Local epoch. A future explicit branch-resolution workflow is outside this slice.

### 9. Operation, status and Home integration

`packages/core/src/memory/operations/memory-operation-service.ts:60` owns durable admission/execution/restart observation; `memory-operation-kinds.ts:24` is the closed registry. Extend it with explicit healthy-return, healthy-re-entry and emergency kinds in one exclusive family. Keep durable transition state separate from the mutable operation projection. Per-claim cancel, post-effect reconciliation and receipt-derived `observeBoot` belong to the new handler/producer; a lost UI reply must never resubmit a mutation automatically.

`packages/core/src/memory/operations/memory-authority-status.ts:52` is the existing composition seam; it currently exposes Hindsight-specific operations through a live runtime accessor that is null under Local. Transition history/readiness must remain readable under Local or an unbound target, so do not hide it inside the Hindsight-only subtree.

`packages/core/src/server/methods/memory-operation-methods.ts:23` already provides operator-only Shared-validated methods and connection-scoped pushes. `apps/desktop/src/windows/home/pages/operations/memory-operations-controller.ts:61`, `:145` provide subscribe-before-read and client-generation guards; `operations-page.tsx:23` is the page integration. `memory-authority-state.ts:98` currently offers cancellation only for admitted `replica.sync`; transition cancellation must come from the actual Core stage/action projection.

The minimum Home addition shows source/target authority, true per-Bank phase/proof progress, backup age/unknown interval, admitted queue outcomes, committed-but-unavailable binding, conflict/unknown/resume actions and capability absence. Reuse one healthy confirmation (U1); emergency has a separate confirmation. Normal users need actionable state rather than lease/hash details. Same-Core multi-client observation is included; D23 remote-Core selection and independent-Core merging are not.

### 10. Ownership and dependency groups

These are dependency groups for the parent's wave plan, not a replacement implementation manifest. Only the research file is written in this assignment.

| Owner group | Deliverable / shared files | Depends on |
| --- | --- | --- |
| Foundation repair / Shared owner | Exact manual request/outcome and D84, backup namespace projection, D93 classification/hold, strict transition/queue wire states and error arms. Own schema public exports and migration allocation serially. | Independent reports; no real-data operations. |
| Native transition owner (W2 gate) | Prove complete writer fence, persistent retirement/quarantine, maintenance/snapshot, exact lookup/release and changed-record reconciliation using existing native locks/producers. | Reviewed frozen protocol and supported-writer inventory. No healthy transition release before real native boundary tests. |
| Core evidence/storage owner | Transition receipts, neutral descriptor capture, D86 scope mappings, candidate reconstruction, queue and bidirectional custody. Own authority readers/transactions and migration registration. | Foundation schema; native proof contract for healthy paths. |
| Core runtime/orchestration owner | Both healthy directions, offline emergency seal ordering, quiescence/replay/rebind/restart, operation kinds and D91 runbook. Serial ownership of `main.ts`, runtime composition, selector and binding modules. | Evidence/storage plus native proof for healthy paths; offline emergency does not require a live native service. |
| Home/operator owner | Preview, U1/separate emergency confirmation, Core-derived actions, truthful progress/unknown/caller results and two observers. | Stable Shared/status/producer behavior; no executable action backed only by a draft interface. |
| Independent integration/check owner | Failure matrix, isolated complete cycles and restore/recovery evidence; update executable specs only after implementation. | All preceding groups; Stage 6 manual/original-environment acceptance remains separate. |

### 11. Meaningful failure matrix for implementation

No cases below were executed by this research. Reuse current fixture builders and existing test evidence rather than repeating Stage 1-3 acceptance as a substitute for Stage 4 proof.

| Case / ledger mapping | Required assertion and useful boundary |
| --- | --- |
| Earlier run succeeds, requested manual run fails; same timestamp; another Bank supervisor failure — prerequisite/D84 | Real B5 scheduler/repo + operation owner: exact failure/claim identity, correct retry state, cancellation only of the intended unclaimed request. |
| Backup proof and replica have same Bank ID but changed generation/lineage/epoch; no checkpoint — C08/C10, PR01 | Status **and incident** retain backup history but never produce an apparently exact cross-history interval. No remote head means unknown unseen loss even when local cursors match. |
| Native or application cursor rollback in seed/full/incremental reset and ordinary page paths — C09/C10, D93 | Dedicated refusal where provable, unchanged checkpoint, no rollback-absorbing rebuild, explicit-run hold; supported generation replacement remains distinct. |
| Write/maintenance finishes just before final fence; ordinary API/MCP/control/worker work races fence — C07, PR01 | Real native ownership path: final native/application proof includes accepted effects; blocked writer cannot publish behind the sealed boundary. Transport doubles alone are insufficient. |
| Executor crashes/lease expires after final proof, around Core COMMIT or before native finalization acknowledgement — C07/C09 | Old writer stays retired/quarantined until outcome proof; stale executor cannot release new ownership. Core receipt decides selected authority. |
| Full Local -> Hindsight -> Local -> Hindsight cycle with Global/multiple/new Character Banks — C07 | Add/edit/invalidate/restore, unchanged-source-revision policy, expiry/deletion, Blocks and derived/source data preserve values/identities/provenance. Assert unchanged targets are reused and no mandatory fresh Bank/full transfer occurs. |
| Missing mapping, corrupt body closure, changed target baseline, generation or foreign branch — C07/C08 | Refuse with preserved source/candidate/history; no silent field drop, Bank reset or merge. |
| Late primary append/finalization during drain, COMMIT, failed constructor/start and restart — C03/C07, PR03 | Exact group/member witnesses survive, only intended epoch owns unconsumed spans, completed per-Bank effects are not duplicated. New-Character fence exception must block or join the final inventory safely. |
| Queued mutation conflicts, bounds, abort, old invocation after cutoff and response loss after target effect — C07, PR04 | Durable identity before ACK, exact revision mapping, distinct queued/conflict/refused outcomes, one factual effect, no closure/Run/Effect rebinding. |
| Core COMMIT fails; bind fails after COMMIT; recovered Local switches again in the same process — C07/C09 | Atomic rollback before COMMIT, no fallback afterward, truthful unavailable status and binding-only repair; both old publication pointers and all workers are retired. |
| Native permanently absent/hanging; seal storage failure; crash after seal; Pending native outcome unknown — C08 | Emergency performs zero native calls, seals before COMMIT, discovers the same incident, preserves unknowns and refuses auto-merge when old native returns. |
| Initiating Home closes; second authenticated client attaches; late obsolete-client reply; lost submit reply — C07/C08/C09 | One operation identity, subscriptions restore truth, no duplicate submission, one normal confirmation and separate emergency confirmation; cancellation matches actual stage. |
| Stopped-Core paired restore with missing credential/mismatched pair and a copied in-flight transition — C10, PR01/PR02, D91 | Reviewed runbook on isolated copies validates pair/receipt before workers, preserves custody and unknown operations, never performs native-only rollback absorption. |

### 12. Related specifications and external references

Read and applied the relevant contracts in `.trellis/spec/backend/`: `canonical-local-memory-runtime.md`, `memory-local-cutover-coverage.md`, `memory-current-state-cutover.md`, `memory-hindsight-activation.md`, `memory-operations.md`, `memory-hindsight-backup.md`, `memory-replica-sync.md`, `hindsight-application-runtime.md`, and the transaction/authority portions of `database-guidelines.md`; backend index, root `AGENTS.md`, `CLAUDE.md`, `.trellis/workflow.md`, `docs/index.md` and `CONTEXT.md` terms were also read.

Planning authority: `docs/HANDOFF.md:181`; audit `research/plan-review-2026-09-18.md` (PR01-PR04 and final-frozen-state clarification), `overall-grill-2026-09-19.md` (accepted U1 and conditional grill); B7 `design.md` and `implement.md`. Older allocation/status statements there are superseded by current HANDOFF and the independent reports. D79-D83 remain after B7; D81 remains a derived-visibility limitation, not permission to lose original fields. Stage 5 provisioning/template/upgrade/full operations and Stage 6 integrated/manual gates remain separate.

External implementation reference: the inspected `H:/hindsight` source above, with the current expected application build `taki-memory-hindsight-0.9.0-d77-v1` / application state `1.0.0` documented at `hindsight-application-runtime.md:45`. This is source/protocol evidence, not live capability verification or native whole-tree acceptance. No external web/library API research was needed.

## Caveats / Not Found

- One focused Taki `jbcontext search` succeeded at indexed revision `fccfc4fb7895`; the single narrowed native retry found no index. The fallback was direct known-file inspection and filename lookup, not indexing or service execution. No further semantic searches or tests were run.
- The actual native persistent transition protocol, all-writer enforcement and used-Bank delta application are **unimplemented readiness gates**, not shipped contracts. Their exact API/schema, finite-maintenance ownership after final fence, compatible epoch comparison and native history lookup must be reviewed/proven in W2. This research does not enumerate every privileged native administration path.
- Engineering details still to finalize: neutral descriptor schema and field support, stable logical identity versus epoch-local placement, full queue command/result arms and limits, cancellation under unknown effects, incident snapshot/custody ordering, and all-Bank finalization recovery. Existing requirements resolve their safety direction; none currently requires reopening U1 or a new owner choice.
- `design.md` is directionally compatible with these findings. Essential implementation clarifications are the neutral reader behind the `initial-local` guard, a new target delta contract behind the narrow baseline guard, a retirement path distinct from Hindsight binding `stop()`, manual-sync exclusion during transitions, and a pre-persisted incident ID with seal lookup. They must remain explicit implementation gates.
- No production/test/spec/status/archive/memory files were edited; no Git operation, test, native process, original database or external service was used. Historical acceptance was not promoted to current Stage 4 or owner/manual acceptance.
