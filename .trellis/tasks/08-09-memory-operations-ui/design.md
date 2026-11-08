# Memory Operations and Setup - Design Draft

## Current design priorities (2026-10-28)

The owner requested practical use first and contraction of unnecessary implementation. Follow
[implement.md](implement.md); the historical schedule below no longer gates the existing-instance path
on C2b, D1 or full model upgrades. This update selects delivery priorities, not a new deployment protocol.

Reuse current Native APIs/templates, Core adapters/operations and the existing secret store. First
verify the actual existing-instance Home-to-Native journey. Preserve Local independence, Taki policy,
single authority, complete supported data transfer and ordinary write/restart recovery.

For subsequent managed work, compare the smallest existing/native mechanism before extending the
custom dependency checker, private transport or supervisor. A test's no-real-provider constraint
does not automatically become a permanent product egress policy. Any change to an existing secret,
ownership or data-integrity contract needs an explicit justified design delta; this plan does not
remove production checks or declare a simpler mechanism verified.

Retain Stage 3 backup and completed lifecycle work. D1/C4/D2 resumes for the D95 upgrade trigger,
without rewriting recorded migrations or weakening preserved-data requirements. Known applicable
defects must be fixed before use; speculative hardening and the residual broad fault/platform matrix
follow D96. Use one consolidated increment review rather than independent reviews of each small packet.

## Approved first-use increment (2026-10-29)

The owner approved key entry -> fresh validation fix -> sync settings -> controlled journey.
One independent Astra design challenge confirmed reuse of current persistence/admission contracts;
no new scheduler, migration, secret store or durable configuration operation is needed.

- Add a Hindsight-specific write-only password form using `secret.set/clear/presence`. Keep input only
  in component memory, clear it after submission/retirement, distinguish locked/unknown from absent,
  and ignore retired-client replies. Stored does not mean the connection has been validated.
- Allow `setup.validate` from `unconfigured` in Home. Core retains authority/busy/revision/config
  checks; do not invent a readiness state or change historical migration 022.
- Expose per-Bank automatic/manual-only, incremental interval and full-reconciliation interval.
  The immediate operator RPC sends the complete existing `MemoryReplicaScheduleConfig`; it resolves
  the current runtime per call, requires a started scheduler, and refuses an active transition.
  Scheduler configuration uses `ensureBank({ bank, config })`, its existing Bank/fence checks and
  timer rearming; active runs and queued manual requests remain intact. No stop/start cycle.
- New Banks keep automatic / six-hour incremental / seven-day full defaults. There is no new global
  default or inheritance mechanism. Existing one-minute to 31/90-day bounds remain unchanged.
- Current `memory.authority.status` remains the read source. Save outcomes trigger refetch; a thin
  `memory.replica.changed` invalidation for configuration edits shares the existing operation
  subscription lifecycle and refreshes other Home clients. Never manufacture an operation event.
  This does not claim a new push producer for every automatic scheduler run.
- Explain existing-instance model configuration as externally applied, and the supported v1 setup
  -> activation -> explicit v2 template/default action. Use the ordinary Native entrypoint on fresh
  controlled resources; reuse historical corpus/transition results without replaying their data.

Regression scope: fresh validation visibility; secret absence/locked/set/clear and generation
retirement; operator/Bank/runtime/transition admission, per-Bank configuration persistence and
rearm with active/manual work; connected Home/RPC/Native usage and bounded outage recovery.
Real credentials, original data, paid models and installed/manual acceptance remain outside this run.

## Historical design gate (2026-10-07)

The owner approved proceeding with the presented Stage 5 plan. The 5A child independently passed and released
its Native/Shared/Core/Home implementation. The reviewed 5B child is active at B1, followed by B2/B3 gates.
This parent remains the residual planning map; do not use historical prose below to dispatch completed work.
5C helper/custody design-readiness review is read-only and independent of B1 implementation.

The historical draft below predates Stages 1-4. Its descriptions of missing operation ownership, first activation,
writer custody, backup and repeated/emergency handoff are superseded by the delivered task specs and
[current Stage 4 review](../09-29-hindsight-transitions-emergency/research/stage4-review-2026-10-07.md). Reuse those
owners and contracts; do not create a second scheduler, backup journal or authority runtime.

Stage 4 W9 is independently accepted. Before each Stage 5 implementation, replace the relevant historical
sections with reviewed current contracts. Distinguish actual deployment-model configuration from stored Taki model hints
and per-Bank configuration, define independent overlay revisions/preservation, and coordinate candidate upgrade
with exact Native build/extension gates, historical receipts/baselines and paired recovery. Core stays OS-neutral;
managed provisioning must not become a prerequisite for an existing instance. This draft is not dispatch-ready.

## Status and sources

Status: planning, subject to contract/readiness review. The owner approved proceeding after bounded B6 closeout; B7 production
implementation has not started. The previous R1 destination premise is withdrawn; see [the grounded grill](grill.md).
U1 below is accepted. The owner's latest direction makes
[overall grill](../09-14-hindsight-integration-completeness-audit/research/overall-grill-2026-09-19.md) conditional on
major unresolved requirements; none is currently known to block continuation. Remaining engineering contracts in
this draft still require review, and Stage 1's delivered operations foundation must be reused.

Authoritative inputs:

- [B7 requirements](prd.md).
- [Grounded B7 grill and implementation audit](grill.md).
- [Accepted repeated-switch preservation ruling](../08-09-memory-runtime-integration/grill.md).
- [ADR 0009](../../../docs/adr/0009-single-memory-authority-with-local-replica.md).
- [Current producer/RPC/Home inventory](../08-09-memory-runtime-integration/research/b7-existing-operations-foundation-2026-09-13.md).
- [Verified B6 closeout and limits](../08-09-memory-runtime-integration/research/b6-closeout-validation-2026-09-13.md).
- [Current-state transfer contract](../../spec/backend/memory-current-state-cutover.md).
- [Current application runtime contract](../../spec/backend/hindsight-application-runtime.md).
- [Home connection recovery](../../spec/frontend/operator-connection-recovery.md).

The existing setup, synchronization and recovery producers are real, but their presence is not a completed B7 operation
workflow. The parent decisions already require one authority, both setup modes, guarded switching, backup/upgrade and
explicit emergency takeover. Those requirements are not reopened here. D79-D83 remain separate follow-ups after B7.

## Boundaries and reuse

| Owner | B7 responsibility | Reuse / constraint |
| --- | --- | --- |
| Shared | Strict operator request, durable operation result and status/subscription schemas | Extend the existing setup, cutover, schedule and Pending schemas; define wire types once. Proposed operation names become advertised only when real handlers exist. |
| Core operations facade | Discover current operations, project actual status and invoke the selected live runtime/producers | Reuse B3 setup, B4 capture/import/proof, B5 scheduling/recovery and B6 application-aware service. No second sync worker or UI-owned authority. |
| Core operation journal | Persist admitted intent, captured identity/revision, underlying producer IDs, progress and terminal/unknown outcomes | Wrap existing receipts and journals; do not replace them, duplicate memory data, or equate a wrapper success with factual application. |
| Core runtime owner | Drain and retire the old memory runtime, commit an explicit authority transition, bind the new runtime and refuse old references | Extend current construction/promotion seams deliberately. Configuration changes and `memory.hindsight.disable` are not authority transitions. |
| Shell / administrative helper | Managed deployment, service/process/storage control, backup artifact production and candidate upgrade operations | Core remains OS-neutral. Reuse an explicit helper boundary and verifiable receipts; a receipt input schema is not an implemented helper. |
| Home | Guided setup, state/progress rendering, explicit operator actions and actionable recovery | Reuse Operations, Settings, the shared Home connection and existing page primitives. Refetch Core truth after reconnect/remount. |

### Explicit operation prerequisites

The original B7 task is led by interaction and requires real Core-backed operations. Current B4 promotion is still
first-activation-specific, B5 recovery retains Hindsight authority, and B6 constructs a selected runtime without a
general repeated provider handoff. Healthy return, current Local-epoch re-entry and runtime replacement therefore
need separately specified and verified backend work before their UI actions become executable. Keep that prerequisite
visible in the delivery plan; it does not reopen the accepted incremental-continuation or preservation requirements.

## State and operation contract

Status must distinguish effective configuration, verified compatibility, active authority/epoch, runtime availability,
last successful sync, last attempt, full reconciliation, retry schedule and unresolved writes. It must not display a
configured endpoint as healthy or active. Unknown lag, age, progress and maintenance state remain unknown.

Expose one operator projection over actual producer state. Pending totals must account for native confirmation,
D77 application/parent-write completion, failed and outcome-unknown states without double-counting overlapping ledgers.
An empty per-pass `pending` count is not proof that every assessment or write in the library is complete.

Long operations return a stable admitted operation identity and continue under Core/helper ownership. A status read
and subscription restore progress after Home closes. A lost response is resolved by that identity and underlying
receipts; the UI never resends a mutation automatically. Operator cancellation is stage-aware: undispatched work may
cancel, while a possible remote effect requires reconciliation and an explicit outcome instead of a false cancellation.

The operation journal must capture the initiating request, source authority/epoch, selected Bank set, expected
revisions, target identity, producer request IDs and backup/proof references. Allocate any new migration only after
checking current lineage. Exact schema and RPC names remain engineering work against the existing Shared conventions.

## Workflows

### Setup and first activation

1. Show prerequisites and choose managed-local or existing-instance setup.
2. Store secrets through the sensitive write-only path; display presence and replacement/clear actions only.
3. Validate the compatible build, configured Banks and template preview. Run model health only as an explicit
   operator action carrying the existing provider-call acknowledgement.
4. Run the current-state migration/preparation/import/verification producers through a resumable operation.
5. Activate only after the complete current-source, required-maintenance, reconciliation and final-writer gates pass.

B2 Canonical Local activation, B3 configured status and B4 status/verify are separate facts. None is a shortcut to
Hindsight activation. An orphaned B3 busy phase after Core restart needs evidence-based recovery rather than a reset
button that assumes the previous setup had no remote effect.

### Synchronization, recovery and maintenance

Expose manual incremental sync, full reconciliation and retry through the existing live scheduler/Bank service.
Keep its persisted scheduling, leases, backoff and manual-mode semantics. Do not create a new polling/recovery engine.
Keep last attempt and last successful synchronization separate, including partial Bank outcomes.

Continue using the provider-selected `memory.tidy` path. Display applied assessments, retained failure evidence and
retryable work independently; the B6 closeout demonstrates why a failed pass can still have persisted progress.
The UI does not promise daily review, retention execution or complete derivative visibility while D79-D82 are open.

### Backup, recovery and staged upgrade

Produce persistent, explicitly located artifacts with identity, compatible build/version, source epoch/Bank set,
captured checkpoints and validation results. Preserve complete native/application data and necessary Taki control,
mapping, Pending and operation state. A logical queryable replica alone is not a complete backup.

Secrets remain under their existing host/deployment ownership and do not enter ordinary manifests or status payloads.
Restore must expose missing required credentials explicitly. Retain backup artifacts until an intentional cleanup;
no automatic pruning duration is invented for this task.

Prepare an isolated candidate, run compatibility/migration/retain-recall/sync/template checks against its restored
data, and promote only after the accepted gates pass. Preserve the old authority and user template overrides on
pre-promotion failure. Packaging and helper execution must use the project-compatible build, never an unverified
upstream `latest` image. Exact helper/backup commands must be grounded before their implementation slice.

### Planned healthy return to Local

The accepted sequence remains: verify lineage/health, drain accepted work and required maintenance, final incremental
sync, full reconciliation, prove zero unresolved writes, obtain the short write fence and snapshot, then create the
new Local authority epoch and bind its runtime.

The transition must cover every configured Bank and preserve original fields, native-derived records, policies,
Blocks and provenance through the existing interchange model. Writes arriving during the fence need a durable,
transition-owned queue and an explicit mapping to the resulting authority. This is new orchestration; the current
fence merely refuses admission and does not implement that queue.

The [2026-09-18 source recheck](../09-14-hindsight-integration-completeness-audit/research/source-recheck-2026-09-18.md)
also confirms that `packages/core/src/memory/runtime-composition.ts:81-100` passes the shared fence to Legacy while
`packages/core/src/memory/canonical-local-subsystem.ts:22-48` has no fence input. The promotion wrapper therefore does
not prove that current Canonical Local writers have been drained. Specify and verify the real foreground/background
writer admission boundary alongside DB consistency guards, before first promotion or repeated-transition integration.

Do not reinterpret stale captured Run authority or replay generic Effects across epochs. Preserve original intent,
target revision and idempotency evidence; unresolved mutations remain explicit. Old runtimes/capabilities stay retired
after the committed handoff. A post-commit bind failure must recover the committed authority instead of automatically
switching back. A pre-commit failure retains the old authority and resolves queued work under the recorded transition.

The final design must ground the provider-side writer-fence and in-flight maintenance drain evidence. A last-seen
cursor or historical certificate alone cannot establish this guarantee. If the provider cannot prove the required
fence, readiness must refuse rather than report a completed switch.

### Hindsight re-entry

Re-entry must cover every change made during the current Local authority epoch. Reuse verified baselines, identity
mappings and subsequent changes, preserving or reconstructing the agreed consumable state. Verify the common baseline,
source/target identity and complete change coverage, apply the required changes, reconcile, and only then commit the
next authority epoch. A fresh authority migration does not mandate new physical Banks, another instance or full
retransfer of unchanged records. The prior R1 choice was based on that mistaken premise and is withdrawn.

Preserve the former epoch's history and prevent it from overwriting the current authority. Emergency/foreign-branch
recovery is a separate path, not ordinary healthy continuation. Unverifiable baseline or change coverage requires a
concrete refusal/recovery path; it must not silently become blanket full copying or branch merging.

Reuse current-state capture/import/verification and Local revision/receipt foundations where applicable, while
extending first-activation-specific source proof deliberately. Never fabricate an old B2 receipt to enter the existing
forward-promotion path. The actual reverse change application and repeated runtime handoff are not yet implemented;
their evidence and acceptance belong to the explicit operation prerequisites above.

### Emergency Local Takeover

Keep this distinct from healthy return and configuration disable. Present repair/backup-recovery options first, then
the verified replica boundary and potentially missing remote-only interval. Obtain the explicit takeover decision.
Preserve replica, outbox, checkpoints and uncertainty evidence; create a new Local epoch through the guarded
transition. A recovered former Hindsight instance remains a foreign historical branch and never auto-merges.

## Home behavior

Operations shows current authority and readiness first, followed by last successful sync, unresolved work, active
operation and the next useful action. Setup and advanced configuration use the existing Home/Settings navigation.
Keep native hashes, fence receipts and operation internals in diagnostics rather than normal workflow instructions.

Loading, empty, degraded, recovering, conflict, unknown outcome and failed upgrade states need distinct presentation.
Action availability follows current Core status and captured revision; a stale UI snapshot cannot authorize an
operation. Rebind subscriptions on authenticated client replacement and discard results from retired connections.

U1 (accepted; recorded 2026-09-19): after preview and one explicit normal-switch confirmation, the background operation
finishes the guarded switch when all checks pass, without a second confirmation after preparation. Show truthful
background progress and refuse on blockers. Emergency takeover retains its own explicit confirmation. All
synchronization, completeness and authority gates remain mandatory.

## Validation and rollout boundaries

- Real temporary SQLite tests: admitted identity, idempotency, restart/reopen, transaction/CAS and unknown outcomes.
- Actual native HTTP tests: final synchronization, full reconciliation, writer fencing, policy/source preservation,
  transition queue, response loss and new-epoch publication; keep native/application clocks separate.
- Runtime tests: all old references retire; new operations use the committed provider; bind failures do not create
  automatic failover; complete accepted source coverage survives transition.
- Helper tests: ownership, compatible version, backup completeness, restore checks, candidate failure and cleanup.
- Home key paths: setup, operation progress after closure/reconnect, conflict/refetch, secret presence/edit, normal
  return versus emergency confirmation, and actionable failure states.
- Run package-appropriate types/lint/tests and real Core startup. Use isolated copies for integration. Original-data
  activation, destructive administration, publication and owner/manual acceptance remain explicit operations.

Before implementation, ground incremental re-entry and the missing helper/fence/runtime-handoff details, update this
draft and `implement.md`, complete design/readiness review, and activate the relevant existing task through its normal
gate. Reopen grill only if a material unresolved product issue emerges.
