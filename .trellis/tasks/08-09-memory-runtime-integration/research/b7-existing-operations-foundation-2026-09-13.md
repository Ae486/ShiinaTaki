# Research: Existing B7 operations foundation

2026-09-14 correction: the re-entry destination candidate below was based on an incomplete reading of the accepted
B6 grill and is withdrawn. Apply [the grounded B7 record](../../08-09-memory-operations-ui/grill.md): repeated switches
reuse verified baselines, identity mappings and subsequent changes. Source findings remain useful; missing transition
implementation does not reopen that rule or establish mandatory new Banks/full copying.

- Query: Which accepted decisions, production producers, operator RPCs, and Home UI seams should B7 reuse for setup, health/status, synchronization, recovery, backup/upgrade, planned Local return, Hindsight re-entry, and emergency takeover? Which product choices remain genuinely unspecified?
- Scope: Internal, source-based follow-on research for the existing B7 task; no implementation or live acceptance.
- Date: 2026-09-13
- Workspace: `H:/TakiAgent`, `main`, HEAD `3c63a8080c92ffbb3ee8257dc2d979c2ba4ed711`. The inspected working files include the owner's ongoing B6 changes; this is not a claim that those changes are committed.
- Active task: `.trellis/tasks/08-09-memory-runtime-integration`, resolved from `.trellis/.runtime/sessions/codex_01a07553-c738-75f0-93c4-bd8a7cd0b014.json` with the supplied `TRELLIS_CONTEXT_ID`. The legacy `.trellis/.current-task` file is empty. The session binding and task metadata identify B6 as `in_progress`; no pointer was changed.
- Method: Read workflow, relevant specs, B7 PRD, parent requirements/design, ADR 0009, then current production code. One `jbcontext search` succeeded against revision `3c63a8080c92`; subsequent discovery used exact identifiers and direct reads. Branch/worktree identity was inspected through local `.git` metadata, without Git commands or opening another worktree.

## Findings

### B7 is an operations delivery, not just a status page

Most authority and recovery product decisions are already settled. B7 should expose and complete the existing
Core-owned machinery, while adding the missing operator orchestration and Home integration. It must retain setup,
backup/upgrade, healthy Local return, re-entry, and emergency takeover in scope. A successful B3 setup, a synchronized
replica, or B6 provider-only reconstruction does not independently implement these workflows.

The active B7 PRD still requires its design/grill before implementation. Its scope and acceptance criteria are at
`.trellis/tasks/08-09-memory-operations-ui/prd.md:14` and `:23`; the owner sequencing amendment is at `:38`.
The parent explicitly records no currently known owner-blocking product question at
`.trellis/tasks/08-09-hindsight-memory-provider/prd.md:217` and `info.md:405`. Missing production entrypoints below
are implementation work, not permission to reopen settled requirements.

### Settled owner decisions and their present implementation boundary

| Settled decision | Evidence | Current boundary |
| --- | --- | --- |
| Exactly one authority; an outage preserves Hindsight authority, using verified replica reads and durable Pending Memory. No automatic failover or conflict merge. | `docs/adr/0009-single-memory-authority-with-local-replica.md:3`, `:45` | Active-epoch readers, provider guards, replica and outbox exist. No automatic Local takeover should be added to status/error handling. |
| Global plus Character-user Banks; layers remain policy within a Bank. | ADR 0009 `:11`; parent `prd.md:44` | B3 bindings and B6 runtime routing already implement this topology. Operations must include every configured Bank; a UI selection must not silently narrow an authority-switch coverage set. |
| Authenticated existing-instance setup and managed local setup are both required. Core owns connection/memory semantics; Shell/helper owns process, Docker, storage and service actions. | ADR 0009 `:33`; parent `prd.md:131`, `:139`; archived B3 `prd.md:66` | Existing-instance connection/setup is implemented. Managed deployment has a strict receipt input but no production provisioning helper was found. |
| One default model with advanced overrides; native behavior, then Taki template, then explicit user override. Existing-instance deployment models remain externally managed. | ADR 0009 `:35`, `:39`; archived B3 `prd.md:31`, `:56` | Config projections, template dry-run/application and explicit Bank LLM health exist. Saving a model identifier does not prove a deployment changed or a model call succeeded. |
| Secrets use write-only set/clear/presence; Hindsight model/DB credentials belong to the deployment/helper boundary. | archived B3 `prd.md:33`; `.trellis/spec/backend/secret-catalog.md:27` | Secret Catalog and operator methods exist. Core resolves the Hindsight connection key only; managed-model slots remain opaque references. |
| Incremental polling defaults to six hours; full reconciliation to seven days; persisted catch-up and retries; single-flight work; manual mode has no automatic retry wake. | ADR 0009 `:7`, `:53`, `:55`, `:57` | B5 schedule state and scheduler are implemented and composed into B6. These defaults are not new B7 questions. |
| Routine confirmation requires reliable native-result proof and actual local factual application; derived freshness is separate and can be unknown. | ADR 0009 `:45`, `:47`; parent `prd.md:109` | Current tracked recovery and D77 application recovery implement this separation. Historical legacy rows retain their older protocol; do not turn an old spec paragraph into the current universal rule. |
| Healthy Local return requires lineage/health, accepted-work drain, required maintenance, final incremental sync, full reconciliation, zero unresolved writes, a short fence, snapshot and a new Local epoch. | ADR 0009 `:51`; parent `info.md:252`; B7 `prd.md:29` | Initial Local-to-Hindsight promotion primitives exist. A complete reverse transition, fenced-write queue/replay and runtime replacement are not implemented by those primitives. |
| Re-entry includes current Local-epoch changes and reuses verified baselines, identity mappings and subsequent changes; the former epoch cannot overwrite it. | ADR 0009 `:51`; B6 `grill.md:22-24`, `:47` | Current-state transfer is reusable, but the current B4 creation/promotion path still requires the original B2 activation receipt. It is not a generalized re-entry API, and that gap does not require a new Bank set or full retransfer. |
| Emergency takeover is separate, explicitly confirmed, after repair/backup recovery options; snapshot replica/outbox/checkpoints and disclose the potentially missing remote interval. A returning old instance is a foreign historical branch. | ADR 0009 `:49`; parent `info.md:264`; B7 `prd.md:30` | The epoch reason enum anticipates takeover. No production takeover service/RPC/UI was found. An enum value is not execution support. |
| Upgrade requires bank/config backup, separate candidate checks and promotion only after compatibility/migration/retain-recall/sync/template checks. Preserve user customizations and the existing authority on failure. | ADR 0009 `:35`, `:37`; parent `prd.md:63` | Compatibility and snapshot/import verification primitives exist. No complete staged-upgrade/backup/restore operator workflow was found. |

### Compact producer / RPC / Home reuse map

All paths in this table are repository-relative. “None found” refers to production source in this checkout, not to
native Hindsight capabilities or validation scripts. `packages/core/src/main.ts:166`, `:226`, `:448`, and `:498`
confirm actual runtime composition, setup registration, migration registration, and scheduler startup.

| Capability | Existing producer and concrete reference | Current operator RPC | Home seam and missing integration |
| --- | --- | --- | --- |
| Connection and model settings | `packages/core/src/config/hindsight-config.ts:14` resolves effective non-secret settings; `packages/core/src/memory/hindsight/hindsight-secret-refs.ts:9` defines stable secret references. | Existing `config.list/set/subscribe` and `secret.set/clear/presence/list`; secret registrations at `packages/core/src/server/methods/secret-methods.ts:31`. | `apps/desktop/src/windows/home/pages/settings/config-groups.ts:72` puts Hindsight keys in Advanced. No guided Hindsight editor; `apps/desktop/src/lib/ws-client.ts:175` already supplies the sensitive `secretSet` path. Presence/clear need typed client integration. |
| Compatibility, Bank/template setup, explicit model health | `packages/core/src/memory/hindsight/hindsight-setup-service.ts:76`, `:109`, `:163`; compatibility gate at `hindsight-compatibility-service.ts:42`; SQLite CAS snapshot at `packages/core/src/db/hindsight-connection-repo.ts:14`. | `memory.hindsight.status/validate/setup/disable/llm-health`, operator-only, in `packages/core/src/server/methods/hindsight-setup-methods.ts:27`; exact names/params at `packages/shared/src/hindsight-setup-schema.ts:14`, `:70`. | No corresponding Home calls found. Reuse the Core snapshot, phases, revision, attempt ID and safe diagnostics. `llm-health` is deliberate and requires `acknowledgeProviderCalls: true`, not background UI polling. |
| Legacy preview and first Hindsight activation evidence | B2 runner through `packages/core/src/server/methods/memory-migration.ts:36`; current Local capture at `packages/core/src/db/hindsight-current-capture-repo.ts:17`; Bank preparation at `hindsight-current-preparation-repo.ts:21`; import/verification at `packages/core/src/memory/hindsight/hindsight-current-orchestrator.ts:21`, `:43`. | `memory.migration.*` supplies B2 dry-run/stage/resume/status/verify/exceptions/exclude/activate. B4 exposes only `memory.hindsight.cutover.status/verify`, at `packages/core/src/server/methods/hindsight-cutover-methods.ts:21`. | No Hindsight migration wizard. B2 activation selects Canonical Local, not Hindsight. B4 status requires a known `runId`; no general current-operation discovery/start/resume/cancel surface was found. |
| Authority, provider and runtime readiness | `packages/core/src/db/canonical-memory-authority-repo.ts:42`; `packages/core/src/memory/runtime-selector.ts:26`; `packages/core/src/memory/runtime-composition.ts:58`; `packages/core/src/memory/hindsight/hindsight-memory-provider-context.ts:60`. | Cutover status includes authority mode/epoch for that run. Existing `memory.status` only returns window, summary and auto-maintenance counters (`packages/core/src/server/methods/memory-status.ts:24`). | Existing Operations card is not provider-health or authority status. Add a truthful operator projection over actual active authority, runtime admission and operation evidence, not over configuration booleans. |
| Schedule, incremental sync, full reconciliation, retry | `packages/core/src/memory/hindsight/hindsight-replica-scheduler.ts:19`, `:92`, `:116`; SQLite schedule at `packages/core/src/db/hindsight-replica-scheduler-repo.ts:24`; shared status at `packages/shared/src/memory-replica-schedule-schema.ts:70`. B6 composes the scheduler at `packages/core/src/memory/hindsight/hindsight-memory-subsystem.ts:51`. | No schedule/status/manual-sync/reconcile operator registration found. Core primitives already expose `requestManual(bankId, kind)`, `verifiedReconnect()`, `status()` and `lastError()`. | Reuse those producers and strict schemas. The runtime composition currently keeps the Hindsight subsystem internal (`runtime-composition.ts:58`); a narrow operator facade must reach its live scheduler rather than create a second worker. |
| Pending writes and recovery | `packages/core/src/db/pending-memory-repo.ts:29`, `:196`; `packages/core/src/memory/hindsight/hindsight-pending-recovery-runner.ts:52`; `hindsight-runtime-bank-service.ts:59`; D77 parent write journal at `packages/core/src/db/hindsight-memory-write-repo.ts:25`. | No Pending inspection/retry/cancel or runtime recovery operator RPC found. | Display real pending/native-confirmed/completed/superseded/failed/unknown counts separately. The live Bank service also advances D77 parent writes after native recovery (`hindsight-runtime-bank-service.ts:139`); a new UI must not report entire write completion from the B5 outbox alone. |
| Existing maintenance and Home rendering | `memoryRuntime.tidy` selects Local maintenance or Hindsight's narrow policy curator (`runtime-composition.ts:68`; `hindsight-memory-subsystem.ts:78`). | `memory.tidy`, `memory.status` remain registered. | Reuse `apps/desktop/src/windows/home/pages/operations/operations-page.tsx:17`, `use-operations.ts:30`, and shared page primitives. Current cards cover tidy, compaction/calibration and storage only. They do not show B7 health/sync/upgrade/switching. |
| Managed deployment, backup/restore, staged upgrade | Receipt shape at `packages/shared/src/hindsight-setup-schema.ts:55`; validation at `hindsight-setup-service.ts:201`. Existing native/application snapshot, import and proof code are lower-level foundations. | No production helper execution, backup/restore or upgrade method found. | These require actual helper/operator workflow plus Core-owned progress/evidence before a success action can be shown. A receipt validator or temporary replica snapshot is not a backup implementation. |
| Planned return, re-entry, emergency takeover | Existing forward primitive: `packages/core/src/memory/hindsight/hindsight-authority-promotion-service.ts:10`; atomic forward transaction at `packages/core/src/db/hindsight-authority-repo.ts:39`, `:222`. | No production reverse-switch/re-entry/takeover method found. Forward promotion itself has no registered mutation RPC. | Build the accepted workflows around new epochs, complete current-state transfer and runtime retirement. Do not map `memory.hindsight.disable`, `TAKI_HINDSIGHT_ENABLED=false`, or a secret clear to switching authority. |

### Status and operation truth that the UI must preserve

1. **Configured is not active or freshly healthy.** B3 `configured` proves its setup snapshot has verified Banks and
   compatibility (`packages/shared/src/hindsight-setup-schema.ts:32`). `status()` reads persisted state without a
   network probe (`hindsight-setup-service.ts:72`). B3 validate/setup/LLM-health require Canonical Local
   (`:82`, `:115`, `:167`, `:254`), so they cannot simply become active-Hindsight health actions. Runtime admission
   and typed provider errors are separate evidence sources. `disable()` only persists the setup phase (`:153`).

2. **Keep time and progress dimensions separate.** Existing schedule fields include `lastAttemptAt`, `lastSuccessAt`,
   `lastFullReconciliationAt`, due/retry times, current lease/run and safe error. `lag` is a cursor difference, not a
   time duration; it is known only when observed lineage/generation matches the checkpoint
   (`packages/core/src/memory/hindsight/hindsight-replica-scheduler.ts:164`). Replica age must use the appropriate
   verified timestamp, and unknown progress/lag must remain null/unknown. Do not manufacture “0 pending”, “up to date”
   or a live-health badge when the required producer is absent.

3. **Zero `pendingCount` is not zero unresolved work.** `PendingMemoryRepo.summary()` separates failed and unknown
   rows from `pendingCount` (`packages/core/src/db/pending-memory-repo.ts:196`). Routine convergence checks all three
   (`hindsight-pending-recovery-runner.ts:70`). D77 has an additional durable parent write and application-command
   layer. Preserve that distinction and do not sum overlapping ledgers as if they were independent user operations.
   Derived maintenance and first-activation readiness remain separate again.

4. **Durable state exists, but a complete durable operation API does not.** Setup has persisted revision/attempt and
   per-Bank progress; cutover has persisted leases/coverage/proofs; synchronization has persisted schedules and runs.
   B3 returns a Promise that waits for validation/setup, and has no public cancellation or restart-recovery method.
   Its `requireIdle()` rejects in-progress setup phases (`hindsight-setup-service.ts:229`); the connection repository
   has read/save only (`hindsight-connection-repo.ts:9`). No automatic recovery of an orphaned B3 busy phase was found.
   B7 must close operation discovery/resumption and unknown-outcome handling gaps, not claim that persisted JSON alone
   completes window-close/restart recovery.

### Authority, cancellation, epoch and restore invariants

| Invariant | Source and implication for B7 |
| --- | --- |
| Authority selection must agree with the active epoch; stale callers fail closed. | `canonical-memory-authority-repo.ts:42` validates active status and expected epoch. `hindsight-runtime-connection.ts:33` checks captured epoch, lineage, effective configuration and secret marker; Bank routes are revalidated at `:39`. Editing configuration is not an authority transaction. |
| Authority epoch, replica epoch, Bank generation, native cursor and application state cursor are different identities. | `.trellis/spec/backend/memory-replica-sync.md:32` and `.trellis/spec/backend/hindsight-application-runtime.md:47`. Replica repair does not mint authority or overwrite immutable activation receipts; policy-only publication does not invent a native revision. |
| Actual publication is guarded inside one SQLite transaction. | `.trellis/spec/backend/memory-replica-sync.md:32`, `:133`: records, indexes and checkpoint must commit together after lease, predecessor, deadline, authority and Bank checks. Earlier complete pages remain valid if a later page fails. B7 must call existing guarded producers rather than write checkpoints from UI state. |
| A client timeout/close is not operation cancellation or safe replay. | `.trellis/spec/frontend/operator-connection-recovery.md:104`: replace retired clients, then refetch Core truth. Mutation timeout is unknown outcome. Do not automatically resend setup/import/switch/upgrade because Home reopened. |
| Local cancellation cannot erase a possible native effect. | `packages/core/src/db/pending-memory-repo.ts:126` permits cancellation only while queued; later phases refuse with unknown-outcome semantics. `hindsight-replica-run-execution.ts:32` revokes the lease before abort, protecting against late responses. Preserve known factual success and resume proof/application instead of relabelling it failed or cancelled. |
| Routine recovery and authority cutover have different evidence requirements. | ADR 0009 `:47`; `.trellis/spec/backend/memory-native-result-recovery.md:34`. Factual result plus transactional checkpoint permits ordinary confirmation. Cutover additionally needs current complete required-maintenance/integrity evidence and the final fence; neither empty queues nor native task timestamps replace it. |
| Existing fences are primitives, not the planned-switch write queue. | `memory-authority-fence.ts:17` currently rejects admissions while fenced; `:25` makes retirement irreversible. `hindsight-authority-promotion-service.ts:16` uses it for forward promotion. B7's accepted queued-mutation/replay behavior must be implemented around the transition, not inferred from this primitive. |
| Runtime replacement must follow the committed authority and retire every old capability. | `runtime-selector.ts:51` supports only the existing Legacy-to-Canonical binding; Hindsight is selected at construction (`:26`). `hindsight-memory-subsystem.ts:100` stops foreground consumers, scheduler, curator, ingestion, writes and synchronization. A reverse switch must create an appropriate new runtime, not reopen an old retired object or fall back after a failed bind. |
| Re-entry imports current Local state and preserves the former branch. | ADR 0009 `:51`. `hindsight-cutover-run-repo.ts:111` and `hindsight-authority-repo.ts:90` currently bind B4 to an activated B2 source run/receipt and its predecessor epoch. Reuse current capture/preparation/verification, but deliberately extend the lifecycle for a new Local epoch; do not forge a B2 receipt or replay the old initial import. |
| Backup and restore preserve proof as well as readable memories. | ADR 0009 `:37`, `:49`; `.trellis/spec/backend/memory-native-result-recovery.md:52`: nonempty native proof and partial replay state must survive backup/restore. D77 original fields, application artifacts, namespace bindings and receipt bytes are part of recoverability; copying only native facts is insufficient. `.trellis/spec/backend/hindsight-application-runtime.md:225` requires compatible native code/contracts and rejects destructive nonempty downgrade. |
| A certificate is historical proof, not permanent current-state validity. | `.trellis/spec/backend/memory-current-state-cutover.md:75`, `:81`, `:99`: retained snapshot proof and exact mappings remain reusable only under their identity/invalidation guards; current drift and the final Local writer reservation still matter after reopen. Network failure is not a fabricated drift observation. |
| Emergency missing data remains an honest uncertainty. | ADR 0009 `:49`: snapshot the verified replica, outbox and checkpoints; show the potentially missing remote-only interval and obtain the separate confirmation. Neither conversation continuity nor a recently successful local write proves no unseen remote change. A recovered old server never auto-merges into the new Local epoch. |

### Home integration patterns to reuse

- `apps/desktop/src/windows/home/pages.ts:34` is the sole page registry; `PageId` derives from it. Existing Operations
  and Settings are appropriate entrypoints for B7. Page placement is a routine design choice unless the owner has a
  specific navigation preference; no new independent operator window or connection is needed.
- `apps/desktop/src/windows/home/use-home-connection.ts:20` supplies the shared settings-family Home connection.
  Chat and Pet keep independent lifecycles. Rebind on authenticated client replacement and ignore retired-generation
  results, following `pages/mcp/mcp-controller.ts:53`, `:89`, `:132`.
- The current Operations `memory-status` cache is a disposable, schema-validated cache of legacy maintenance counters
  (`pages/operations/use-operations.ts:37`). It must not become the authority/migration/progress store. For B7 actions,
  restore operation state from Core before enabling dependent mutations; last-good rendering is presentation only.
- Reuse `PageHeader`, `PageBody`, `PageAlert`, `PageCard`, `LabeledRows`, badges and action buttons
  (`.trellis/spec/frontend/home-window.md:188`). Keep active provider, current state, last successful synchronization,
  pending work and next action readable. Expose hashes, native operation IDs and fence details in diagnostics, not as
  ordinary workflow instructions (`:197`).
- Reuse the MCP controller's serialized mutation, conflict-refetch and partial-commit reporting pattern. Its
  `secretSet` path sends entered values only through the sensitive method (`mcp-controller.ts:125`). Do not reuse
  ordinary config payloads or persisted caches for secret values.
- Follow named lifecycle revalidation/push contracts (`.trellis/spec/frontend/operator-connection-recovery.md:146`).
  A Home remount must discover Core state; it must not infer completion from a vanished local spinner. No new timeout,
  polling interval, schema name, notification protocol or operation identifier is selected by this research.

### Genuinely unspecified product-choice candidates

The accepted safety/authority rules above do not need another vote. The former re-entry destination candidate is
withdrawn: the later B6 ruling already requires baseline/mapping/change reuse. The remaining backup-custody candidate
is a preliminary interaction proposal, not an accepted requirement or a blocker to B6 closeout. Follow the current
B7 grill rather than presenting this historical research as a queued owner questionnaire.

| Candidate | Existing constraint | Options and recommendation |
| --- | --- | --- |
| Backup artifact custody and cleanup experience | Required snapshots and tested rollback are settled; automatic deletion/rotation and a default backup destination are not specified (ADR 0009 `:37`, `:49`; parent `info.md:397`). | Operator-selected persistent destination with explicit cleanup, or a managed destination with automatic retention. Recommend explicit destination selection and retained artifacts until deliberate cleanup for the initial workflow; propose any automatic pruning policy separately. Do not invent a retention duration, include secrets in ordinary backup manifests, or remove the required backup/restore/upgrade work. |

Implementation details such as strict RPC shapes, captured revisions, durable operation lookup, lease reuse,
single-flight execution, version gates and failure mapping should be resolved from these producers and their tests.
They should not be presented as new high-level product questions. If the source review eliminates a candidate's
alternative, record that evidence rather than asking a choice that no longer exists.

### Files found and related specs

| File / area | Description |
| --- | --- |
| `.trellis/tasks/08-09-memory-operations-ui/prd.md` | Existing B7 scope, dependencies, acceptance and 2026-09-13 sequencing. |
| `.trellis/tasks/08-09-hindsight-memory-provider/prd.md`, `info.md` | Accepted parent requirements and target flows; some historical implementation-status paragraphs are stale. |
| `docs/adr/0009-single-memory-authority-with-local-replica.md` | Authority, polling, recovery, templates, upgrades, return/re-entry and takeover decisions. |
| `.trellis/tasks/archive/2026-08/08-09-hindsight-connection-setup/prd.md`, `design.md` | B3 secret ownership, external-model setup, explicit LLM health and helper boundary. |
| `packages/core/src/main.ts`, `boot/hindsight-setup-boot.ts` | Actual production registration/composition; distinguishes exported helpers from reachable RPCs. |
| `packages/shared/src/hindsight-setup-schema.ts`, `hindsight-cutover-schema.ts`, `memory-replica-schedule-schema.ts`, `pending-memory-schema.ts` | Existing strict operation/state/result contracts, not a complete B7 RPC family. |
| `packages/core/src/memory/hindsight/` and the named `packages/core/src/db/hindsight-*.ts` repositories above | Current setup, native/application sync, recovery, leases, current-state transfer and first promotion producers. |
| `apps/desktop/src/windows/home/pages/operations/`, `pages/mcp/mcp-controller.ts`, `lib/ws-client.ts` | Existing Operations presentation, replaceable-client mutation pattern, and typed client extension seam. |
| `.trellis/spec/backend/memory-replica-sync.md`, `memory-native-result-recovery.md` | Replica publication/scheduler and tracked native factual recovery invariants; distinguish legacy subsections. |
| `.trellis/spec/backend/memory-local-cutover-coverage.md`, `memory-current-state-cutover.md` | Complete Local coverage, source bindings, current-state import, retained certificates and final writer guards. |
| `.trellis/spec/backend/hindsight-application-runtime.md`, `secret-catalog.md` | Current D77 runtime/application evidence, policy limitations, compatible restore boundary and write-only secrets. |
| `.trellis/spec/frontend/state-management.md`, `home-window.md`, `operator-connection-recovery.md` | Disposable views, page/connection ownership, generation restoration, request-outcome and presentation rules. |

### External references and version boundary

No external service, native repository, credential, model call or live database was accessed. Version claims here
are grounded in Taki's checked-in wire contracts and compatibility consumers, not a new native compatibility test.

- Base API remains Hindsight `0.9.0`, compatibility version `1.0.0`
  (`packages/shared/src/hindsight-connection-schema.ts:8`). B3 now accepts the explicit Batch 0, G1, D78 and D77 build
  constants in `packages/core/src/memory/hindsight/hindsight-compatibility-service.ts:58`; it does not accept arbitrary
  releases. The archived B3 PRD's Batch-0-only build statement is historical.
- Current runtime additionally requires `taki-memory-hindsight-0.9.0-d77-v1` application-state evidence and actual
  application client methods. Guarded Reflect has its own capability negotiation
  (`packages/core/src/memory/hindsight/hindsight-application-capability.ts:17`, `:26`). Passing generic B3 compatibility
  is not proof that the D77 runtime or a staged upgrade is ready.
- The original provider API/deployment reference is
  `.trellis/tasks/08-09-hindsight-memory-provider/research/hindsight-api-deployment-contracts.md`; later current
  contracts/specs above take precedence over its pre-implementation status descriptions.

## Caveats / Not Found

- This report proves source availability and gaps, not execution or owner acceptance. No tests, builds, live probes,
  helper actions, authority transitions, backup/restore operations or native compatibility checks were run.
- No production B7 Home wizard/status/control surface, reverse-switch/re-entry/takeover service, backup/upgrade
  orchestrator, or managed provisioning helper was found. Their lower-level enums, receipt schemas, tests and
  validation scripts do not satisfy the B7 acceptance criteria.
- No public B5 operator sync/reconcile/Pending RPC family or general durable operation discovery was found. The
  existing B6 service/scheduler is the reuse target; do not add a UI-owned worker or duplicate recovery engine.
- Parent design/research and older spec paragraphs contain historical statements such as missing Secret Catalog,
  Local-only Markdown runtime, or universal derived-wait recovery. Current production files and later amendments
  supersede those statements. This report does not edit them.
- D79-D83 remain deferred after B7: daily model review, Taki retention execution, complete derived-policy propagation,
  curator promotion expansion, and speculative optimization. The known derived-visibility limitation remains visible;
  preserved original fields and own-record admission are not complete derivative erasure. Sources:
  `docs/deferred-decisions.md:19`, B6 `research/memory-capability-followups-2026-09-13.md:27`, and
  `.trellis/spec/backend/hindsight-application-runtime.md:94`.
- The parent's ongoing B6 closeout/real-model acceptance is independent. No result or temporary experiment is marked
  accepted here. No task was activated/created/archived, no Git operation was performed, and the only research output
  owned by this subtask is this file.
