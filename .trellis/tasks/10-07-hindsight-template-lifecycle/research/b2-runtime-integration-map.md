# B2 runtime integration map

Read-only live-source investigation completed on 2026-10-08 by `stage5b_b2_admission_research`.
The first context_explorer could not start because its fixed model was unavailable; the replacement explorer
used one jbcontext query, then read current files. The index reported fccfc4fb7895, so all findings below were
verified against the main working tree. No production changes, tests, original data or services were used.
B1 independent review still gates implementation. References below are a navigation snapshot, not new acceptance.

## Operation ownership and terminal-state independence

- `packages/core/src/memory/operations/memory-operation-service.ts:115`: submit wraps existing/admit/
  insertAdmitted/persistAdmission in one synchronous transaction; execute begins afterward at :146.
  Persist the original template plan, Native request IDs and producer-owned checkpoint here.
- `packages/core/src/db/memory-operation-repo.ts:80`: state mutation checks operation ID, expected state and
  `terminal_at IS NULL`; it has no executor token/generation/deadline/checkpoint revision. Foreign-boot
  reconciliation at :92 and generic execution failure at service :162 both terminalize the generic row.
- `memory-operation-contract.ts:67`: exclusive-family admission reads only active families. A separate durable
  unpublished-effect predicate must survive failed/outcome_unknown rows and be consulted at common admission.
- `memory-operation-kind-replica.ts:19` checks only the transition family; `memory-operation-kind-transition.ts:17`
  intentionally bypasses the exclusive helper for a new emergency operation. Adding one family constant is
  insufficient. Read-only replay and explicit recovery of the original plan must remain distinguishable.
  Preserve W6's separately confirmed emergency exception through its existing local quarantine path, not a
  blanket hold bypass or a new Native-dependent wait. See the compatibility clarification below.
- `memory-operation-kinds.ts:24` is the existing closed handler registry. Add the template family here and in
  Shared request/result arms; do not add another operation service or autonomous recovery loop.

## Lease patterns, not borrowed ownership

`db/memory-transition-repo.ts:61,89,146` uses attempt/generation/revision/owner/operation/deadline and full old
JSON CAS. `transitions/transition-execution-heartbeat.ts:8` supplies serial renewal and cleanup behavior;
`transition-healthy-execution.ts:53,90` uses 300000 ms / 30000 ms. B5 `db/hindsight-replica-lease-repo.ts:38,59`
is per-Bank sync ownership and includes old expiry in renewal CAS. These are patterns to reuse narrowly;
neither transition attempts nor replica leases own a complete template rollout.

## Durable hold coverage

Paths in this section are relative to `packages/core/src/`.

| Entry | Current seam and required coverage |
| --- | --- |
| Boot | `main.ts:191` constructs runtime before operation service at :272. `memory/hindsight/hindsight-memory-subsystem.ts:48` / `hindsight-runtime-connection.ts:50` therefore need a DB-backed hold reader; observeBoot is too late. |
| New Run | Subsystem :91 routes through driftReason; `hindsight-memory-runtime.ts:59` captures multiple Banks through workFence. Degrade before new memory capture without dropping primary witnesses. |
| Provider calls | `hindsight-memory-provider.ts:25` track wraps workFence; recall/reflect at :43/:48. Provider context :55 asserts connection and :96 checks again when issuing HTTP allowance. |
| Local runtime reads | `hindsight-runtime-view.ts:20,77` prompt/Tidy/Block reads call runtime.assertConnection. Guarding only the Native HTTP client misses these reads. |
| Background/source | Subsystem :75 checks connection before Utility maintenance, but :87 flush only checks characterRouted. `hindsight-ingestion.ts:128` calls model.gate before resolveBanks at :138. A hold check must occur before Utility work. |
| Primary witnesses | Ingestion assertAuthority at :193 is also used by recordPrimaryCommitted. Do not close that path globally: `runtime-composition.ts:95` and `hindsight-runtime-binding.ts:167` preserve marker-routed primary witnesses. |
| Scheduler/Pending | `hindsight-runtime-bank-service.ts:39` own wraps capture/scheduled/on-demand work; :79/:146 recheck connection. Runtime state :57 wires the service. |
| Unavailable Chat | `hindsight-unbound-run.ts:28` currently recognizes configuration reasons. Add a genuine template-hold reason that reaches `hindsight-unavailable-run.ts:26`; do not fake config_changed and trigger automatic revalidation. |

The backup writeFence (`hindsight-writer-fence.ts:17,44`) intentionally leaves recall/reflect and capture open.
It cannot implement the complete hold. Status/actions also need the same durable predicate in
`operations/memory-authority-status.ts:73` and `memory-hindsight-lifecycle-status.ts:55`, independent of active rows.

## Quiescence, defaults and runtime lifetime

`transitions/transition-runtime.ts:127` already drains writeFence, then workFence and scheduler.pause, then
auto-memory settle. Expose only the needed runtime lifetime seam, without adopting transition lease/custody.
`MemoryOperationsRuntime` currently exposes writeFence but not workFence or scheduler.pause.

`hindsight-replica-scheduler.ts:91` pause cancels queued manual work, drains active work and permanently sets
transitionPaused; start at :72 cannot reopen it. Pause also calls connection-guarded banks(). The original
operation must be able to drain after establishing its hold; after publication construct a new binding instead
of pretending release(writeFence) restarts the old scheduler.

`hindsight-lifecycle-trigger.ts:29` automatically submits provision/revalidate for Bank/config reasons.
`hindsight-lifecycle-provision.ts:41,48` still applies v1 and reads the Global desired template; consume the
published scope default at this seam. `hindsight-lifecycle-revalidate.ts:67` still verifies every Bank as v1;
managed effective selections, including explicit none, require their own admission path while legacy stays intact.

## Final publication and recovery

B1 stores already support nesting: `template-overlay-store.ts:29,98` requires expected selection, exact
preview/receipt/current snapshot and final synchronous assertCurrent. `template-default-store.ts:31,52`
CASes defaults against supplied Bank selections/receipts. Core 058 stores configuration history, not executor
or unpublished-effect ownership. `sqlite.ts:94` supplies nested savepoints.

Use one final outer transaction for all Bank selections, applicable defaults, setup/readiness projections,
an exact publication receipt and hold release. `db/hindsight-connection-repo.ts:54` provides setup CAS;
`hindsight-bank-setup-repo.ts:20` ordinary upsert alone is not an identity/ownership guard. Recheck all live
executor/lease/revision/epoch/connection/Bank conditions after all synchronous readback, before COMMIT.
The W9 pattern is `db/memory-transition-publication-repo.ts:71`: verified readback followed by the live lease guard.

`runtime-composition.ts:176` -> selected.replaceHindsight -> `hindsight-runtime-binding.ts:72` already replaces,
publishes, stops the old runtime and starts the new binding. `runtime-selector.ts:83` recoverHindsight currently
returns healthy on same epoch plus an existing binding. B2 must also match the committed overlay-selection
identity and refuse an unpublished hold; the activation recovery caller at :112 must not bypass that predicate.
A published selection recovers binding only; unpublished dispatch recovers original Native requests.
Boot/status observation must never execute either recovery branch.

## Existing W6 emergency compatibility

The existing `.trellis/spec/backend/memory-transition-emergency.md:13-37,91-99` requires fully offline takeover,
quarantine of old-epoch Native-dependent producers, detached hung completion, immutable unknown outcomes and
a foreign historical Hindsight branch that cannot automatically reenter. Thus a common hold check must not
silently remove the emergency escape path. Extend the existing capture/quarantine inventory with the new
template producer/checkpoint/dispatch/hold/receipt identities before admitting that specific exception.
No new Native call, fresh backup, old-executor join or held-state consumption may be introduced.

Old template callbacks must fail current epoch/quarantine/executor guards and cannot publish, release a hold
or replace the original unknown outcome. Local takeover retains the incident and does not claim template
completion or authorize old-branch reuse. Ordinary operations and healthy reentry still respect the hold.
Exercise hung Native/template completion, late callbacks and restart using the actual existing emergency producer.

## Captured Run boundary to preserve

Existing assemble closures use frozen captured data; tool/automaticRecall consumers retain runtime guards.
The reviewed design preserves immutable previously captured context and primary witnesses. New capture, live
reads, provider/Utility work and old-runtime tools must respect the hold and retired selection. Do not erase
frozen context or add global Chat cancellation merely to implement a hold. During implementation, verify that
every unguarded assemble closure really performs no new mutable read or I/O; guard any actual live access found.

Confidence is high for the listed ownership and entry points; concurrency/restart behavior is untested here.
B2 implementation and its independent gate must provide the real lease-loss, partial rollout, reopen, unavailable
Chat/witness and binding-only recovery evidence.
