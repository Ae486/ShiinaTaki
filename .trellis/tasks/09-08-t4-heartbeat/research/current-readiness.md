# Research: Heartbeat current code readiness

- Query: Identify reusable Run/Agent seams, distinguish absent Heartbeat surfaces from reservations, assess Scheduled Task as an integration reference, and identify incoming main-branch Memory review gates.
- Scope: internal; current T4 source plus root-supplied read-only main diff.
- Date: 2026-09-08
- Worktree: `H:/TakiAgent-worktrees/t4`; branch `task/t4-skills-mcp-productization`.
- Task: `.trellis/tasks/09-08-t4-heartbeat`; `task.json` is `planning`. This report records readiness, not implementation or acceptance approval.

## Findings

The common execution foundation and non-primary Agent seam are real and reusable. Heartbeat remains a downstream product implementation: its Signal/Wake policy, thin context, structural outcomes, Pattern authority, and Class B delivery are not implemented by the existing initiator enum. Scheduled Task proves the shared execution route, but its text delivery is explicitly unfinished. Main has an incoming Memory change that requires semantic and migration-lineage review before integration.

### Evidence basis and files found

Paths below refer to current T4 files unless explicitly prefixed `main@dd2e15b`. Main citations are new-side line numbers reconstructed from the root's scoped Git patch, not reads from another worktree. No semantic-index result is treated as current source evidence.

| File | Purpose |
| --- | --- |
| `.trellis/tasks/09-08-t4-heartbeat/prd.md` | Current planning requirements and unresolved delivery slices. |
| `docs/T4-HANDOFF.md` | Frozen product boundaries, especially sections 5.1-5.8; historical seam notes require source verification. |
| `docs/adr/0010-separate-autonomous-run-history-from-relationship-timeline.md` | Separate execution history; only real Companion speech enters the relationship Timeline. |
| `packages/shared/src/harness-schema.ts` | Trigger, Run, Attempt, immutable snapshot, delivery class and status contracts. |
| `packages/core/src/harness/run-service.ts` | Admission, context lifetime, start/retry/settle and shutdown sealing. |
| `packages/core/src/harness/run-snapshot-capture.ts` | Captured Host/extension/governance/Memory authority and process-local tool bindings. |
| `packages/core/src/db/run-repo.ts` | Transactional admission, immutable events, Attempt guards and receipts. |
| `packages/core/src/harness/effect-lifecycle-service.ts` | Shared guarded effect boundary and contained observability publication. |
| `packages/core/src/agents/chat-agent.ts` | Existing model loop, non-primary control input, context assembly and persistence boundaries. |
| `packages/core/src/agents/turn-queue.ts` | Shared per-Character serialization; only blocking acquisition exists. |
| `packages/core/src/scheduler/scheduled-run-adapter.ts` | Working provider-to-Harness-to-Agent consumer. |
| `packages/core/src/perception/perception-layer.ts` | Existing source eligibility, Privacy Pause, scrubbed/fenced context and content-free invalidations. |
| `packages/core/src/memory/runtime-composition.ts` | Current Memory selection and authority snapshot; maintenance/compaction separation. |
| `packages/core/src/memory/canonical-local-runtime.ts` | Current Local Persona/block/pinned context implementation. |
| `target/uiux-continuity-20260908/closeout/main-memory-entry.json` | Root-owned Git metadata, changed-file list and incoming Memory patch. |

### 1. Reusable execution and non-primary seams

| Seam | Verified code pattern | Readiness boundary |
| --- | --- | --- |
| Typed trigger | `packages/shared/src/harness-schema.ts:17`: `RunInitiatorSchema = z.enum(["primary", "scheduled", "heartbeat", "flush", "subagent", "webhook"])`; `:42` defines `TriggerRequestSchema`. | Heartbeat can carry real Character, provenance, idempotency, `class_b`, `autonomous`, deadline and budget references through the common entry. |
| Admission and deduplication | `packages/core/src/harness/run-service.ts:65`: `TriggerRequestSchema.parse(candidate)`; `:66-67` rejects expired/zero-budget requests. `packages/core/src/db/run-repo.ts:85`: `readRunByIdempotency(...)`; `:93-99` transactionally inserts admission and Run/Attempt/context events. | Generic Run correctness exists. Signal freshness, model-opportunity rates and delivered-utterance rates are additional provider policy. |
| Captured authority | `packages/core/src/harness/run-snapshot-capture.ts:60`: `Object.freeze({ ... })`; `:63` freezes Character Memory tools; `:69-73` captures Host generations, governance generations and Memory authority metadata. | Reuse bindings across Attempts. This is not yet a fully captured Heartbeat context: `:74-78` still records `tokenAccounting: "unknown"`, `replayDecision: { status: "not_captured" }`, and `sourceRefs: []`. |
| Attempts and Effects | `packages/core/src/harness/run-service.ts:85-103` delegates start/retry/settle; `packages/core/src/harness/effect-lifecycle-service.ts:29-32` guards intent/dispatch with `RUN_EFFECT_DISPATCH_REFUSED`; `packages/core/src/db/run-repo.ts:208-223` checks active Attempt, cancellation, deadline and budget. | Reuse the existing lifecycle and outcome-unknown handling; no second Heartbeat execution ledger or replay authority. |
| Recovery and shutdown | `packages/core/src/main.ts:329-331`: recovery scan precedes trigger registration; `packages/core/src/harness/run-service.ts:111`: `seal: () => { accepting = false; }`. | Heartbeat must join this boot/shutdown boundary and provide its own durable opportunity/disposition semantics. |
| Non-primary input | `packages/core/src/agents/chat-agent.ts:43-48`: `turnKind`, `controlInput`, captured `runContext`, `onRetry`; `:190`: `primary ? store.appendUser(...) : undefined`; `:237`: `if (!attempt.primary) return false`. | Existing stream loop can execute without creating either a fake user row or assistant/tool rows in the relationship Timeline. |
| Costume and maintenance isolation | `packages/core/src/agents/chat-agent.ts:296` consumes the costume notice only for primary; `:299` disables primary request-pressure reporting for non-primary; `:318` returns before detached turn writes. | Conversational auto-memory, primary pressure and costume notice consumption are already isolated. Preserve these guards. |
| Main Model and history | `packages/core/src/agents/chat-agent.ts:260`: `vision ? vision.model : deps.model`; `:270` constructs the same `ToolLoopAgent`; `:390-392` appends an ephemeral model-facing control envelope to replay. | A text-only Heartbeat can share the Main Model. SDK `role: "user"` for the transient control envelope does not create a persisted user message. |
| Character queue | `packages/core/src/agents/turn-queue.ts:12`: `acquire(key: string): Promise<() => void>`; `:27-28` appends to the per-key promise chain. | There is no `tryAcquire` or non-destructive busy probe. Heartbeat must account for queued primary work, not just the active TurnRegistry entry. |

The generic non-primary seam is **not thin-context selection**. `packages/core/src/agents/chat-agent.ts:256` always calls `store.project(characterId)`; `:390-392` retains that replay; `:426` calls `memory.assemble({ characterId, currentMessage: turn.message })`. Current Canonical Local assembly (`packages/core/src/memory/canonical-local-runtime.ts:41-53`) projects Persona, Memory Blocks and pinned records, but exposes no due-intention/Pattern/Companion-State query here. Heartbeat needs a provider-neutral context decision before dispatch, while preserving the existing model loop.

History means the Run/Attempt/Event/Effect ledger and bounded internal receipts, not a second conversation store or a saved private transcript. `packages/core/src/db/run-repo.ts:301-311` creates generic internal receipt/settlement evidence. That does not itself decide whether a receipt or utterance should appear in Home. ADR0010 requires silent/avatar-only Heartbeats to stay absent from the relationship surface.

### 2. Heartbeat-specific surfaces: absent versus reserved

Exact searches across non-test `packages/core/src/**/*.ts` and `packages/shared/src/**/*.ts` found Heartbeat identity/labels and reserved comments, but no `SignalProvider`, `WakePolicy`, `InteractionPattern` or `heartbeat_respond` implementation. The distinctions below also use the adjacent source, not search absence alone.

| Surface | Current state | Required boundary |
| --- | --- | --- |
| Heartbeat identity/class | Implemented shared vocabulary only: `harness-schema.ts:17`, `:27`; display labels in `packages/shared/src/observability-presentation.ts:10-15`. | These permit recording a Run; they do not create opportunities or deliver output. |
| Signal Providers | Absent as Heartbeat providers. Existing Perception producers consult capability availability and pause at `packages/core/src/perception/perception-layer.ts:120-140`, and expose sanctioned context at `:161-164`. | Normalize allowed observations into meaningful typed Signals. A UI invalidation or sampler tick is not by itself a model wake. |
| Wake Policy | Absent. No Heartbeat eligibility/configuration or persistent opportunity budget was found; Run admission only supplies generic deadline/budget guards. | Periodic and event sources must converge before `TriggerRequest`, with freshness/dwell/deduplication/debounce/cooldown/chance/privacy/busy/quiet-hours/model-budget decisions and bounded skip evidence. |
| Structural terminal outcome | Absent. ChatAgent has an extensible `stopWhen` at `chat-agent.ts:277`, but no Heartbeat outcome tool. `packages/core/src/avatar/presentation-stop.ts:23` requires that some step already produced text. | Add the dedicated terminal contract for `silent | express | speak`; ordinary avatar-tail stopping cannot implement structural silence. |
| Class B delivery/budgets | Absent; only the shared class value exists. There is no Heartbeat delivered-utterance counter, gap/quiet-hours/busy/TTL/ignore-backoff producer. | Separate model opportunities from actual delivery counts and from Class A. Generic Run `budgetHint` is not a delivery budget. |
| Interaction Pattern | Absent in executable schema/store/API/Agent tool. Handoff `:419-439` describes the previously approved checklist direction evolving into Patterns; it is a design authority, not evidence of an implemented store. | One typed Core authority for conditions, purpose, context refs, outcomes, cadence/expiry/chance, provenance/evidence/revision and lifecycle. Seed behavior is data. Long-lived proposals remain reviewable. |
| Heartbeat tool boundary | Common governance exists; no Heartbeat-specific v1 restriction is wired. `packages/core/src/main.ts:306` includes both file read/write tools, and `:389` supplies that static set to non-primary turns; `chat-agent.ts:325-340` also composes Memory/avatar/extensions. | Generic non-primary execution does not automatically satisfy the v1 prohibition on exec, external effects and new sensor acquisition. Reuse the canonical unattended ask refusal and preserve source eligibility. |
| Time/maintenance reservations | `packages/core/src/time/time-context.ts:65-68` explicitly reserves `renderWallClock`; `packages/core/src/memory/auto-memory.ts:19-22` carries a Heartbeat origin type. | Neither is a provider or policy. `renderWallClock` uses process-local Date access at `:70-72`; the frozen User Timezone contract still requires deliberate wiring. |
| Companion evolution | Documented/reserved, not implemented by these runtime seams. | Keep Persona/safety stable; reserve bounded user/relationship/Companion-State/intentions context, feedback, revision and rollback without silently implementing long-term self-modification. |

Frozen behavior/defaults are already in `docs/T4-HANDOFF.md:393-439` and the current PRD. This report does not reopen them. In particular, pending Memory status alone neither wakes nor suppresses Heartbeat (`docs/T4-HANDOFF.md:455`).

### 3. Scheduled Task is the integration reference, not completed delivery

- `packages/core/src/scheduler/schedule-engine.ts:40-44` claims a durable occurrence then dispatches it; `:46-54` handles reconciliation, single-flight execution and shutdown. `packages/core/src/main.ts:475-480` wires and starts this consumer against the same RunService and Character controls.
- `packages/core/src/scheduler/scheduled-run-adapter.ts:25-33` derives an occurrence idempotency key, submits `initiator: "scheduled"`, `deliveryClass: "class_a"`, `contextMode: "autonomous"`, links the Run, acquires the shared Character queue and calls non-primary ChatAgent with captured context and Attempt retry handling.
- The delivery gap is explicit at `packages/core/src/scheduler/scheduled-run-adapter.ts:34`: `void delta; /* Delivery is a later projection slice. */`. A completed Scheduled Run therefore does not prove a user received its generated speech. Failure settlement is recorded at `:37`; occurrence reconciliation is at `:43`.
- Reuse this provider-to-runtime pattern. Heartbeat still needs outcome capture and policy-controlled delivery through the ordinary Timeline append path, whole-utterance Pet presentation, and generation/staleness protection (`docs/T4-HANDOFF.md:472-479`). Internal receipt creation is distinct from the unfinished public delivery disposition; a shared delivery design must preserve Class A/Class B differences.

### 4. Incoming main Memory changes and implementation gates

Root-owned evidence: `target/uiux-continuity-20260908/closeout/main-memory-entry.json`, source recorded as `Root read-only Git commands; research role does not execute Git`.

| Comparison fact | Value |
| --- | --- |
| T4 HEAD | `d6ddf2e5f932a096ff6162d31b05caeb16e7286e` |
| Local main | `dd2e15b98b6661a01b1f951cfb85f718f2aea75d` |
| Merge base | `c3f8bc4d0c061f67ac998cac0cd1b95a3e91f7fb` |
| Incoming scoped commit | `dd2e15b feat(core): complete pending memory factual recovery` |
| Scoped change size | 49 files, +3611/-62; includes ADR0009, Pending Memory persistence, native-result/recovery adapters, replica contracts, exports and migration tests. |

**Migration lineage must be resolved before integration.** Current T4 `packages/core/src/db/migrations/035-timeline-presentation.ts:8-10` declares `version: 35` and adds `timeline_messages.presentation`. Incoming `main@dd2e15b:packages/core/src/db/migrations/035-pending-memory.ts:8-21` also declares `version: 35` and creates `pending_memory`. Both branches register their own migration at `packages/core/src/db/migrations/index-list.ts:41`, `:78`. Current `packages/core/src/db/migration-runner.ts:15-19` reads the maximum applied version and skips `migration.version <= current`; a textual merge alone cannot reconcile existing databases. Review fresh, T4-applied and main-applied lineages and their reopen/migration tests. Do not blindly rename an already-applied migration or claim a simple renumber fixes every lineage.

**Review the incoming Memory contract, not just files that conflict.** Key verified changes:

| Incoming evidence | Consequence for Heartbeat planning |
| --- | --- |
| `main@dd2e15b:docs/adr/0009-single-memory-authority-with-local-replica.md:45-47` changes routine recovery to actual native-write evidence plus factual changes transactionally applied through a verified checkpoint. | Routine write confirmation no longer means all derived observations/mental models are current. Keep derived freshness separate and evidence-backed. Initial activation and healthy-provider-switch integrity gates remain separate. |
| `main@dd2e15b:packages/shared/src/pending-memory-schema.ts:26-30` binds intents to authority epoch, provider lineage, Bank generation, operation identity, original timestamp and base cursor; `:94-98` defines an overlay with `confirmed: z.literal(false)`. | A future thin context may project explicitly unconfirmed information; it must preserve authority/Character scope, distinguish facts from pending intents and never turn the raw outbox into a wake rule. |
| `main@dd2e15b:packages/core/src/memory/pending-memory-writer.ts:24-43` checks current Hindsight authority, Bank/payload, idempotency and checkpoint before enqueue. Its module boundary at `:4` explicitly says `no authority fallback or live runtime wiring`. | This is an upstream integration seam, not a live Heartbeat or fully wired Hindsight-context feature. Verify the eventual B6 runtime/provider/tool composition rather than inferring activation from a new module. |
| `main@dd2e15b:packages/core/src/memory/hindsight/hindsight-pending-recovery-runner.ts:49-72` pulls, replays, checks applicable completion, pulls again and confirms reflected records; `:75-95` captures/rechecks authority, lease, deadline and Bank. | Memory recovery stays inside its own synchronization authority, not Heartbeat or generic Run Effect replay. Preserve the native-result/factual-confirmation path and its legacy compatibility distinction. |
| `main@dd2e15b:packages/core/src/memory/hindsight/hindsight-pending-replay.ts:74-80` recovers the original mutation result before treating a newer target as superseded and handles identity conflicts explicitly. | An unknown or stale Memory effect cannot be blindly retried as a fresh Heartbeat action. |

The remaining implementation review should cover: (1) migration lineage and rollback/reopen behavior; (2) Memory runtime selection/coordinator/canonical tools/shared exports and captured Run authority; (3) current factual versus derived freshness and pending-overlay semantics; (4) a provider-neutral due-intention/context projection rather than direct Local-repo or legacy Markdown access. No merge or production edit was performed for this report.

## Related specs and reused research

- `.trellis/workflow.md` Phase 1: research persists under the active task; planning artifacts precede implementation.
- `.trellis/spec/backend/agent-runtime.md:265-304`: Scheduled is provider policy over one Harness, and its non-primary/occurrence invariants.
- `.trellis/spec/backend/observability-projection.md:5-8`: Run/Event authorities remain separate from read-only projections; Heartbeat needs real event producers rather than fabricated metrics.
- `.trellis/spec/backend/permission-authorization.md:243-261`: canonical Host challenge/resume and unattended `APPROVAL_REQUIRED` without ambient prompts.
- `.trellis/spec/backend/memory-replica-sync.md:89-94`: synchronization, Heartbeat policy and runtime provider/recall/tool composition are separate responsibilities. Its pre-incoming Pending notes require reconciliation with the main changes above.
- `docs/adr/0008-replay-view-context-seam.md`, ADR0009 and ADR0010: projected context, single Memory authority and separate autonomous execution history.
- `.trellis/workspace/pleia/t4-second-grill-prep.md` and `.trellis/workspace/pleia/t4-heartbeat-engine.md:792-867`: reuse the frozen Signal/Wake/Pattern and stable/evolvable Companion decisions; no new comparable research was opened.

## External references

No network documentation, services or new comparables were used. Repository lockfile versions are `ai@7.0.17` (`pnpm-lock.yaml:801`) and `croner@10.0.1` (`pnpm-lock.yaml:933`); these are source/dependency references, not a fresh runtime validation.

## Root refresh - 2026-09-11

This update supersedes the assumption that main still ends at `dd2e15b`; it does not claim integration or runtime acceptance. Root read Git objects from the T4 worktree. T4 remains `a35d273`, while local main is `3c63a80` (`feat(core): complete current-state memory cutover`).

Main now contains `packages/core/src/db/migrations/036-memory-timeline-convergence.ts`, explicitly accepting either applied migration-035 history. It creates Pending Memory when missing and ensures the ordinary nullable Timeline presentation column through the updated migration runner, preserving historical receipts. The registry extends through migration 040; `040-hindsight-cutover-convergence.ts` handles recognized early/current cutover schema branches and refuses unknown or unmappable historical state. Verify this supplied bridge and the complete runner/migration changes against T4 before integration instead of inventing another 035 fix. No database was opened or migrated for this refresh.

There is also a documentation-identity collision: T4 D77/D78 mean error fidelity and permission UX, while main D77/D78 now refer to Hindsight field fidelity and current-state import/maintenance. Preserve the actual requirements and references during integration, rather than treating equal deferred-item numbers as equal work. D79 was unused in both inspected ledgers when the owner-requested Character behavior item was registered in T4. No ledger entries in main were edited or renumbered.

## Caveats / Not Found

- `docs/T4-HANDOFF.md:492-501` retains early claims about unconditional user append and auto-memory. Current `chat-agent.ts` and the existing `chat-agent-non-primary.test.ts:19-34` supersede those claims. The generic thin-context gap remains real.
- The legacy `.trellis/.current-task` still names the earlier compaction task. The root supplied the current native-session Heartbeat binding; the explicit task assignment and current Heartbeat `task.json` were checked. The legacy file was left unchanged.
- Exact-search absence is bounded to current Core/shared production source; document reservations and display labels are not proof of executable policy. No broad UI review was repeated.
- Existing relevant tests were read as source evidence only. No tests, builds, dependency installs, external calls, Git commands, live database inspection or manual acceptance were performed by this researcher.
- Main evidence was supplied by the root and inspected here as a patch. The reported commits are a point-in-time comparison; recheck drift before integration. Actual database lineage and runtime/provider activation remain unverified.
