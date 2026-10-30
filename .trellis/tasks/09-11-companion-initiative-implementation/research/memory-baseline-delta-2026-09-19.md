# Research: Memory baseline delta for Initiative child 1

- Query: What changed after the September 16 Hindsight audit, and which committed Stage 1 contracts and planned Stage 2 handoffs affect Initiative child 1?
- Scope: internal; bounded source/document review of main, plus the assigned T4 baseline contract and prior audit. No inspection of the integration worker's evolving T4 source.
- Date: 2026-09-19

## Findings

### 1. Effective baseline and correction to the prior audit

The source handoff choice is resolved. The parent selected **`516e151ad1cbd298d07b95e7b4460833e55442f6`**, including B6 `588e13e` and durable Memory operations Stage 1 through migration **048**. The [approved snapshot contract](baseline-snapshot-contract-2026-09-19.md) governs the integration worker. Do not import newer main working-tree content or reopen development approval.

The September 16 report remains historical. Its statements that B6 was uncommitted, the migration ceiling was 047, and all B7 operation-facade work was still planning are superseded. The new checkpoint contains the Core operation owner, setup/manual-sync operation kinds, operator RPCs/pushes, composite authority status and the Stage 1 Home integration. It still does **not** implement a general provider switch, transition queue, or Initiative held continuation.

Evidence labels in this report:

- **P — pinned production source:** read-only main source attributed to `516e151` using the parent's clean-source verification. This researcher ran no Git; the integration worker verifies Git-object bytes.
- **L — live planning/documentary evidence:** HANDOFF, plans and task records read on 2026-09-19. They may change concurrently. The Stage 2 pointer/scaffold neither proves an installed capability nor authorizes importing newer content.

Below, `core/` means `H:/TakiAgent/packages/core/src/`, `shared/` means `H:/TakiAgent/packages/shared/src/`, and other main paths are relative to `H:/TakiAgent/`. The prior audit's wider B6 conclusions are not repeated here.

### 2. Stage 1 is an installed Memory operations owner

**P:** `shared/memory-operation-schema.ts:11-28,39-52` defines the exact closed protocol:

```ts
submit: "memory.operations.submit",
status: "memory.operations.status",
list: "memory.operations.list",
cancel: "memory.operations.cancel",
subscribe: "memory.operations.subscribe",
changed: "memory.operations.changed",

MemoryOperationKind = "setup.validate" | "setup.apply" | "replica.sync";
```

Requests are revision-bound setup or Bank-bound sync requests. Clients do not choose identity/state. States are `admitted | running | completed | failed | cancelled | outcome_unknown`, with terminal/result invariants (`:65-88`).

**P:** `core/main.ts:232-242` constructs the operation service over `memoryRuntime.operations` and B3, then registers both method sets. `core/server/methods/memory-operation-methods.ts:23-47` enforces `roles: ["operator"]`; disconnect removes the subscription, not the operation. `server/memory-operation-subscriptions.ts:19-27` isolates dead-socket failures.

**P:** `core/memory/operations/memory-operation-service.ts:47-82,104-129` mints identity, records the epoch/sealed request/producer reference, refuses an active family with `MEMORY_OPERATION_BUSY`, executes independently of Home, and publishes after repository CAS. Reads may reclassify unsettled work; construction reconciles foreign-boot rows to `outcome_unknown` without re-dispatch.

`memory-operation-kind-replica.ts:16-30,56-64` wraps the **existing B5 scheduler**, admits only a known Bank with a started Hindsight runtime, calls `requestManual`, then awaits one `tick`. A conflicting request is not silently queued by a second scheduler. Setup handlers remain B3 consumers. The current executable contract is `.trellis/spec/backend/memory-operations.md`.

**L:** `docs/HANDOFF.md:183-192` points to archived Stage 1. `.trellis/tasks/archive/2026-09/09-19-hindsight-durable-operations/task.json:5-6,24` records completion and **manual acceptance not run**; `implement.md:8-19,24-28` records wiring/Home delivery. This audit verified source wiring, not those historical tests or live UI behavior.

### 3. Composite status has a narrower meaning than Run readiness

**P:** `shared/memory-authority-status-schema.ts:12,21-51` separates authority, runtime availability/reason, setup, replica, Pending/parent writes and operations. `derivedFreshness` is **`"unknown"`**; replica/Pending are null without available Hindsight authority.

`core/memory/operations/memory-authority-status.ts:24-41,45-52` checks Hindsight connection evidence and keeps Pending and D77 parent-write counts separate. `server/methods/memory-authority-status.ts:11-18` exposes the projection only to operators.

Implications for Initiative:

1. Reuse operator diagnostics without another store or fabricated zero/ready values.
2. Status availability, sync completion and empty Pending counts certify neither Character/Run admission nor derived freshness.
3. Autonomous context still uses bounded captured Memory fragments, not this administrative object.
4. Operation pushes carry no automatic Run/Attempt/Effect attribution.

### 4. Live operations access and captured Run access must stay separate

**P:** `core/memory/runtime-composition.ts:60-79,158-161` now exposes two distinct interfaces:

```ts
operations: () => scope.hindsight ? operationsRuntime(scope.hindsight) : null,
captureRun: async (characterId, signal) => { /* alive, cancellation, selected capture */ },
recordPrimaryCommitted: (commit) => { alive(); (scope.hindsight ?? scope.canonical)?.recordPrimaryCommitted(commit); },
```

`operations()` resolves the live selected subsystem per call. Its narrow `MemoryOperationsRuntime` contract contains epoch, scheduler controls, Bank enumeration, connection assertion and Pending summary (`memory/operations/memory-operation-contract.ts:13-25`). It is not an immutable Run bundle, an authority writer, or a general runtime-replacement API.

The B6 admission contract remains installed:

- `harness/run-snapshot-capture.ts:61-73` freezes the Memory bundle; `harness/run-service.ts:123-144` preserves original closures and rejects changed Memory references.
- `memory/hindsight/hindsight-memory-runtime.ts:52-74` still requires cancellable synchronization and capability evidence at capture. Manual sync/status cannot bypass it.
- `agents/chat-agent.ts:432-435` still suppresses Automatic Recall for `!attempt.primary`.

**Child-1 adjustment:** keep captured Memory for Run/retry/held continuation, and live access for operator operations. Never reacquire a provider for an old decision through `operations()`. A stored epoch is evidence, not a complete transition fence or queued-intent protocol.

### 5. Consumer lifetime and shutdown: preserve the implemented order

**P:** `core/memory/hindsight/hindsight-runtime-consumers.ts:9-18,20-40` tracks active capture/tool/recall promises, preserves non-enumerable Effect descriptors, and rejects calls after `stop()` marks the consumer retired. This is invocation tracking, not a durable lease that keeps an entire idle/held Agent Run alive across an authority transition.

`core/memory/runtime-composition.ts:117-129` marks the runtime stopped, retires its selected engine, and drains its auto-memory, Utility and selected provider lifetime. `memory-operation-service.ts:26-27,61` only **awaits** its in-flight executions; producer owners are responsible for stopping their work.

The actual process order is explicit in `core/main.ts:521-533`:

```ts
runService.seal();
recovery.close();
cancelDurableWorkForShutdown();
const memoryStopped = memoryRuntime.stop();
// ... await turn drain / scheduler / memoryStopped ...
// ... then memoryOperations.stop(), server.close(), other owners, db.close()
```

The Memory runtime stops the scheduler/manual tick before the operation owner finishes draining; setup calls use their existing deadlines. Initiative must preserve this order and add its own admission/held-work shutdown inside the existing lifecycle, without allowing late Effects or publication against retired Run/Memory state.

**Document drift:** archived Stage 1 `design.md:128-130,157-159` describes a service AbortController and the opposite stop order. Follow the installed service/`main.ts` and current spec; this report leaves the archive unchanged.

### 6. MemoryOperation does not replace Run/Attempt/Effect continuation

**P:** `shared/memory-operation-schema.ts:49-78` carries an operation UUID, authority epoch, request and a setup/replica producer reference. Replica references are **Bank + admitted timestamp**. It has no Run, Attempt or Effect identity. `db/migrations/048-memory-operations.ts:11-25` likewise stores an operator-operation journal, not an Agent execution ledger.

Consequently:

- A Memory operation must not become an alternative Heartbeat Run or delivery queue. Child 1 still owns its decision and same-Run/same-Attempt held continuation in the existing Harness/Timeline owners.
- `outcome_unknown/core_restart` for a Memory operation does not classify the Agent Run. Conversely, cancelling or completing a Run does not cancel/complete an independently admitted operator operation.
- A `memory.operations.changed` notification, a setup operation result or Bank synchronization outcome is not an attributable **known-Run completion**. Initiative's `completion_of` source cannot adopt it without an explicit real producer link and the required semantics. Do not fabricate an Agent Run merely to obtain such a link.
- The existing Harness recovery still infers completion from a terminal Effect (`harness/recovery-coordinator.ts:70-80`). Stage 1 did not add structural decisions or held-presentation awareness. Child 1 must still make that recovery decision-aware.

### 7. What is still planned: follow the latest allocation, not the old stage numbering

**L:** `docs/HANDOFF.md:183-192` points to the completeness audit's `research/plan-review-2026-09-18.md`. The review's revised allocation (`:49-57`) is:

| Stage | Scope and current significance |
| --- | --- |
| 1 | Durable operation owner, setup recovery/compatibility fixes and basic manual synchronization — now installed in the pin. |
| 2 | Local-only onboarding, existing-instance first activation, active Bank/configuration lifecycle and first-activation source/runtime handoff. |
| 3 | Independently executable backup/restore and common recovery-point validation. |
| 4 | Repeated healthy transitions, transition-owned queued intents, final frozen-state proof and emergency takeover. |
| 5-6 | Remaining managed/model/template/upgrade/Home work, then integrated/environment/manual acceptance. |

Use this revised allocation over the older `closure-plan.md` numbering. HANDOFF's future PR02/U1 owner questions remain outside this audit.

Live `.trellis/tasks/09-19-hindsight-first-activation/task.json:4-6,25-28` was **Stage 2b / PR03, planning** when read. `prd.md:5,7-13` had TBD requirements/acceptance; `implement.jsonl:1` was a template. This newer, changing planning pointer proves no capability in the pin.

**P:** the installed `core/memory/runtime-selector.ts:51-64` still permits the existing committed `canonical-local` binding path, not general Local/Hindsight handoff. The closed Stage 1 operation-kind union contains no activation/switch operation. A stored managed receipt on `setup.apply` does not install managed provisioning, first promotion or repeated switching.

The review supplies two concrete future contracts relevant to child 1:

- **PR03 (`plan-review-2026-09-18.md:25`):** exact committed primary-conversation spans must remain owned through drain, authority COMMIT, failed target construction and restart. Block new source commitment during the fence or durably retain it for the resulting epoch; prove no loss/duplication. The current `recordPrimaryCommitted` callback remains a required integration seam, not a replaceable notification.
- **PR04 (`:26`):** define transition-queue admission/cutoff, original intent ownership, target identity/revision proof and original-caller results. Do not replay old executable closures across epochs or silently rebind old Run/Effect references. PR03 is required for first activation; the full repeated-transition queue belongs to Stage 4.

For held Initiative output, capture the original source/authority validity and revalidate it before resuming. A stopped consumer or changed epoch means refuse/expire under the agreed continuation policy; it does not authorize rebuilding a request with the latest Memory. Staging speech does not keep a Memory consumer lease alive. If a held result needs no Memory call, its independent source/authority/TTL checks are still required. The exact source-custody/transition mechanism stays with the Memory stage owner.

### 8. Migration 048 and inherited D81/D84 limits

**P:** `core/db/migrations/048-memory-operations.ts:8-28` adds a STRICT `memory_operations` table, sealed request/producer/result JSON, `owner_boot_id`, timestamps and:

```sql
CREATE UNIQUE INDEX memory_operations_active_family
ON memory_operations(family) WHERE terminal_at IS NULL;
```

It changes no authority marker. `db/migrations/index-list.ts:54,104` imports/registers it. Update Initiative's integrated migration tail to **048**, preserve the existing 035/036/040 histories, and leave later numbers unallocated until the integration owner's final registry check. An old 047-based expected tail is now incomplete.

**D81 remains inherited.** Main `docs/deferred-decisions.md:30` still records incomplete propagation of hidden/expiry changes into derived observations/Mental Models. Stage 1 exposes that honestly as `derivedFreshness: "unknown"` (`shared/memory-authority-status-schema.ts:43`; `core/memory/operations/memory-authority-status.ts:40`). A successful sync or operation completion does not repair or certify derived visibility. Preserve the previous report's scope: Initiative can use the accepted addressed-record policy projection, but cannot claim complete indirect hidden/deleted/expired-source exclusion or restore the owner-rejected blanket observation guard.

**D84 is a new precision limit relevant to consuming operation events.** Main `docs/deferred-decisions.md:33` and `.trellis/spec/backend/memory-operations.md` describe three limits independently supported by the handler:

| Limit | Current source and Initiative consequence |
| --- | --- |
| A queued Bank B operation can receive a supervisor code produced by Bank A. | `memory-operation-kind-replica.ts:84-88` reads process-global `scheduler.lastError()`. Do not turn it into an exact per-Run/per-Bank causal claim. |
| Cancelling this unclaimed request may still be refused while another run holds its Bank. | `:42-52` maps scheduler busy/claim state to `MEMORY_OPERATION_RUNNING`. A refusal is not proof that this particular request was already dispatched. |
| Unclaimed work without a supervisor error can remain open. | `:84-90` returns null; `memory-operation-service.ts:121-135` may reclassify on read and `:53-54` reconciles foreign-boot rows. Do not infer success from an emptied request flag, elapsed time, or absent failure. |

The same-millisecond guard is installed: a non-null `pendingManualKind` is checked before accepting `lastAttemptAt/lastSuccessAt` as this operation's outcome (`memory-operation-kind-replica.ts:82-95`). These bounds prevent fabricated success but do not supply exact producer request/claim identity. D84 calls for extending the existing B5 claim with that identity when the owner needs stronger attribution, not creating a second scheduler.

D81/D84 are not automatic prerequisites for every Initiative feature. They become dependencies if Initiative requires stronger Memory freshness or exact sync-operation attribution than the current producer proves. Keep the limitation visible instead of silently adding those capabilities to child 1.

### 9. Concrete plan updates for the root

1. Replace historical baseline language with `516e151` and 048; source integration/verification stays with its assigned worker.
2. Include `.trellis/spec/backend/memory-operations.md` in review context; preserve exports, RPC/push/Home wiring and producer-before-owner shutdown.
3. Keep MemoryOperation separate from Run/Attempt/Effect/delivery identity. Do not expose operator administration as Heartbeat tools or use it for autonomous admission.
4. Keep immutable Memory binding and the stricter profile; live status is no replacement snapshot/lease/source proof.
5. Implement decision-aware same-Run continuation; coordinate PR03 custody and PR04 cutoff without implementing Memory transitions here.
6. Preserve D81/D84 in acceptance; operation events prove neither known-Run completion nor complete derived freshness.

The committed Stage 1 foundation adds integration responsibilities; it does not invalidate Initiative's product design. The authorized pinned-baseline integration can continue. Child-1 dispatch still follows the combined baseline gate; neither this review nor Stage 1's historical tests certify the evolving T4 integration.

### Files found

| Path | One-line role |
| --- | --- |
| `shared/memory-operation-schema.ts` | Strict operator operation kinds, identity, state and channel. |
| `shared/memory-authority-status-schema.ts` | Composite operator status with explicit null/unknown rules. |
| `core/memory/operations/memory-operation-service.ts` | Durable admission, detached execution, CAS settlement and restart observation. |
| `core/memory/operations/memory-operation-kind-replica.ts` | Existing B5 manual-sync wrapper and D84 attribution boundary. |
| `core/memory/operations/memory-authority-status.ts` | Actual authority/runtime/replica/Pending/operation projection. |
| `core/db/migrations/048-memory-operations.ts` | Additive operation storage and active-family uniqueness. |
| `core/memory/runtime-composition.ts`, `core/main.ts` | Live operations accessor, captured Memory consumer wiring and shutdown order. |
| `docs/HANDOFF.md`, closure review and Stage 2b task | Live future ownership/allocation, separate from pinned installed behavior. |

### Related specs and external references

Read the baseline contract, prior audit, task manifests/artifacts, workflow rules, backend index and `.trellis/spec/backend/memory-operations.md`. Existing B6, migration, push and connection contracts remain applicable.

No external documentation or `H:/hindsight` files/services were accessed. No dependency or deployed-provider version was independently revalidated. The only version upgrade asserted here is the parent-selected source checkpoint and its inspected migration/protocol additions.

## Caveats / Not Found

- Source provenance relies on the parent's pinned/clean production baseline. This researcher did not run Git; newer concurrently edited planning files are explicitly L evidence and are not part of the installed-capability claim.
- Archived design fragments contain shutdown/signature prose superseded by the installed code/spec. Stage 1 task acceptance records are historical assertions, not tests reproduced here.
- No production tests, service calls, databases, authority transitions or native/manual acceptance were exercised. No implementation, pointers or metadata were changed. Only this new research file was written; the prior audit remains unchanged.
