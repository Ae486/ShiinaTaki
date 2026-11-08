# Hindsight First Activation: Drain, Chain, Custody Carry and Rebind

## 1. Scope / Trigger

Use this contract when a Canonical Local instance moves to Hindsight authority through the durable operation
`hindsight.activate`, or when a change touches the Local write fence, the activation drain, the B4/D78 chain callers,
the promotion transaction, custody routing across COMMIT, the Hindsight runtime binding or `memory.activation.status`
(`core/memory/hindsight-activation/`, `operations/memory-operation-kind-hindsight.ts` + `-hindsight-evidence.ts`,
`db/hindsight-activation-custody.ts`, `hindsight-runtime-binding.ts`, `runtime-selector.ts`, `runtime-composition.ts`).
Reverse transitions (Stage 4), backup (Stage 3) and the native patch are out of scope; the Bank and connection lifecycle
after COMMIT is [`memory-hindsight-lifecycle.md`](./memory-hindsight-lifecycle.md). D78
primitives: [`memory-current-state-cutover.md`](./memory-current-state-cutover.md); lifecycle:
[`memory-operations.md`](./memory-operations.md); fence: [`canonical-local-memory-runtime.md`](./canonical-local-memory-runtime.md).

## 2. Signatures

Shared: `packages/shared/src/memory-hindsight-operation-schema.ts`, `memory-activation-schema.ts`.

```ts
// source; Core mints every epoch/transaction/replica/verification id, clients never send one
{ mode: "new", setupRevision, expectedEpochId } | { mode: "resume", runId } | { mode: "recover", epochId }
MemoryHindsightPhase = "reserved" | "draining" | "capturing" | "preparing" | "importing" | "verifying" | "ready"
  | "committing" | "binding" | "completed";
MemoryHindsightProducerRef = { kind: "hindsight", runId, hindsightEpochId, transactionId, configFingerprint, manifestId,
  progress: { phase, bankCount, prepared/imported/verifiedBankCount, carriedWitnessCount },
  banks: [{ nativeBankId, scope, replicaEpochId, verificationId, preparationId }] };
MemoryHindsightResult = { kind: "hindsight", runId, outcome: "activated" | "binding_unavailable" | "prerequisite_blocked",
  epochId, runtimeAvailable, blocking: [{ scope, characterId, localBankId, code }] };  // superRefine ties all three
MEMORY_ACTIVATION_METHODS = { status: "memory.activation.status" };  // strict {} params; MemoryActivationStatus =
// { authority, runtime, setup, prerequisites: { banks, blocking }, run (+ receipt) | null, custody, operation, actions }
```

`MemoryHindsightActivationErrorCode` = `HINDSIGHT_ERROR_CODES` + the B4/D78 codes + `MEMORY_QUIESCENCE_TIMEOUT`,
`MEMORY_INGESTION_INCOMPLETE`, `MEMORY_RUNTIME_UNAVAILABLE`, `HINDSIGHT_ACTIVATION_INTERRUPTED`, `..._INTERNAL_ERROR`.
Core: `createHindsightActivationService(...)` -> `{ plan, status, authority, committedProducer, binding, runtime, start,
resumeActivation, recover, stopRequested, stop }` (composed in `core/boot/hindsight-activation-boot.ts`);
`carryHindsightActivationCustody` runs via `promoteHindsightAuthority({ ..., beforeCommit })`. Composition adds
`activationLocalRuntime()`, `bindHindsight`, `recoverHindsightBinding`, `hindsightBindingSnapshot()` and asynchronous
`prepareHindsightActivation({ epochId, bankIds, signal })`; activation-service `recover` also awaits preparation.
The selector adds `bindHindsight`, `recoverHindsight` and the `hindsightLive()` input. This correction adds no migration: durable truth is
`hindsight_cutover_runs`, the D78 evidence tables and the promotion receipts; the operation row holds ids + checkpoints.

## 3. Contracts

### Admission and single-flight (R1, R2)

- `admit` is synchronous and side-effect free: `refuseWhileExclusiveFamilyBusy` (families `setup`, `local-onboarding`,
  `hindsight-activation`, `hindsight-lifecycle` are mutually single-flight), then `service.plan()`. `new`/`resume` require marker
  `canonical-local`, the B2 run id joined by the Local activation receipt, setup `configured` with compatibility, and
  no fingerprint drift; `new` also requires `expectedEpochId`/`setupRevision` equal to Core's view and no existing run.
- Identities are minted at admission (`mintRef`). `resume` reuses the newest family row's ids for the same run so
  per-Bank replica/verification ids are replayed, never re-minted. The ref's `verificationId` is a base: the chain
  presents `preparationVerificationId(base, preparationId)` (`hindsight-activation-chain.ts`), so replaying one
  preparation derives the same native id and a recapture's new preparation gets a new one (native refuses a different
  verification request under a used id with `request_conflict`). No persisted state is added. Banks lacking a verified B3 row get no identity;
  execution settles `completed` / `prerequisite_blocked` listing missing and extra scopes before anything native happens.
- Claim is one macrotask after admission via `tryClaim`; a stopping service never claims; cancel only while `admitted`.
  While a family row is open, direct `memory.hindsight.validate/setup/disable` refuse `HINDSIGHT_STATE_CONFLICT`
  (`activationOpen`); `disable` also refuses under marker `hindsight`.

### Drain before capture (R3, fix F1)

- `start` and `resumeActivation` both drain first: `fence.quiesce` (default 30 s, `MEMORY_QUIESCENCE_TIMEOUT`) ->
  auto-memory `settle()` -> `ingestion.settle()` -> forced `ingestion.run` for every Character with an incomplete span or
  an unconsumed witness. The fence covers every Local writer; reads stay open (see the Local runtime spec).
- Only an incomplete span after the forced run fails the drain (`MEMORY_INGESTION_INCOMPLETE`). Chat stays usable
  (grill Q1), so a witness committed during the forced run is expected and is carried at COMMIT, not a failure.
- Any pre-COMMIT failure releases the lease and reopens the fence only on a positive read of marker `canonical-local`
  with the predecessor epoch (`reopenCanonicalLocal`); an unreadable or moved marker keeps Local fenced.

### Chain over unchanged primitives (R4, G9)

- Lease owner `hindsight-activation:<operationId>`, TTL 600 s, renewed at every Bank boundary and before each native
  call. `resume` passes `takeOverFrom` only when the holder operation is absent or terminal (foreign-boot rows are
  terminal after reconciliation); a live holder refuses `HINDSIGHT_CUTOVER_LEASE_LOST`.
- The selected manifest is reused while `compareCurrent` matches; staleness at promotion is a refusal, and the next
  attempt records an explicit new version whose import supersedes the prior transfer by its exact receipts.
- Per Bank: baseline -> prepare -> import -> verify, a checkpoint after each (verify under the derived per-preparation id). A persisted preparation, import result or
  verification evidence is replayed, so each import/verification is POSTed exactly once across retries and restarts.
- `markReady` is idempotent only for the exact fingerprint + checkpoint-set digest (`HINDSIGHT_CHECKPOINT_SET_STALE`
  otherwise). `stopRequested` is honoured at Bank boundaries (`HINDSIGHT_ACTIVATION_INTERRUPTED`), never inside COMMIT.

### COMMIT and PR03 custody (R5)

- Inside the promotion transaction `beforeCommit` refuses any incomplete predecessor span, copies unconsumed Local
  witnesses into `hindsight_ingestion_primary_commits`, seeds per-Character cursors (`through_seq=0`,
  `eligibility_start_seq=tail+1`) and reassigns `open`/`finalized` groups to the new epoch. A throw rolls back the switch.
- Custody `begin` enrolls under marker `hindsight`; `finalize` routes witnesses by the assigned epoch's provider;
  `previousCommit` checks a same-epoch Hindsight witness first, so a carried row is processed exactly once.
- `recordPrimaryCommitted` routes by the durable marker (`witnessHindsightPrimaryCommit`) while no Hindsight subsystem is
  published, so a commit between COMMIT and bind, or after a failed bind, is witnessed, never dropped.

### Rebind and recovery (R6, R7, fix F2)

- After COMMIT: `fence.retire()`, then `bindHindsight` proves the marker, retires Local (`local.retire()` withdraws the
  publication and stops its workers) and publishes + starts the Hindsight binding. A failed construction or start leaves
  Hindsight selected with binding `unavailable`; the operation settles `failed` / `runtime_unavailable` /
  `MEMORY_RUNTIME_UNAVAILABLE` with result `binding_unavailable`; Local never reopens.
- Committed-but-unbound `captureRun` throws `MEMORY_RUNTIME_UNAVAILABLE`; there is no Local or Legacy fallback.
- New activation stays at the existing durable `binding` checkpoint while the selected subsystem synchronizes
  the Banks from this activation's producer/receipt. Await the existing Bank service's owned synchronization
  promises, including any earlier Bank barrier, using the existing `mode: "foreground"` owner. Keep the connection
  timeout as a per-HTTP limit; it is not a total deadline for queueing plus all Bank preparation requests. Activation
  owns cancellation and joins completion. Other explicit operations and Pending recovery keep their bounded mode.
  Only after successful preparation may the operation persist `completed`. This also applies with automatic
  scheduling disabled; a scheduler tick, installed runtime or elapsed sleep is not preparation evidence.
- Preparation can lengthen activation. It does not change ordinary cold capture's 7.5-second budget or expose
  unbound tools. Stop aborts and joins this preparation owner; post-COMMIT failure retains the selected Hindsight
  epoch and original closed error with incomplete progress. An installed runtime can coexist with failed
  preparation; use the existing nullable failure result instead of claiming it was uninstalled.
- `recover` re-proves the marker, reconciles custody and constructs only when unavailable: `hindsightLive()` is false
  once the binding withdrew a failed start, so recovery republishes instead of answering `healthy`. It never re-promotes;
  a thrown repair settles `failed` with its closed code. At boot, construct and start failures are recorded as binding
  `unavailable` and Core keeps serving; `memory.authority.status` reports `not_installed` until bound.
- Binding recovery always awaits the same receipt's required Bank preparation, even when the runtime is already
  installed, then persists `completed`. A crash after COMMIT but before `binding`, or after preparation but before
  `completed`, remains incomplete and can recover idempotently. Advance the in-memory latest producer only after
  its durable checkpoint succeeds. Older completed rows retain their historical meaning; do not rewrite them or
  claim this new first-preparation assurance retroactively. No parallel readiness cache or per-status Bank proof is needed.

### Settlement and boot classification (R9)

| Situation | Settlement |
| --- | --- |
| thrown before COMMIT, marker Local, no receipt | `failed` / `producer_failed` + closed code (unknown causes -> `HINDSIGHT_ACTIVATION_INTERNAL_ERROR`) |
| shutdown at a Bank boundary | `failed` / `producer_incomplete` / `HINDSIGHT_ACTIVATION_INTERRUPTED`; `resume` continues |
| stopping service before claim | `failed` / `runtime_unavailable` / `HINDSIGHT_ACTIVATION_INTERRUPTED` |
| matching receipt, durable producer phase `completed`, installed matching runtime | `completed` / `activated` |
| matching receipt, producer not yet `completed` | incomplete binding; never upgrade to completion from installed availability |
| matching receipt, runtime unavailable | `failed` / `binding_unavailable`; Hindsight stays selected |
| receipt with another transaction, marker not Local, or unreadable state | `outcome_unknown` / `commitment_unknown`; fail closed |
| restart before COMMIT (`observeBoot`, marker Local, same run) | `outcome_unknown` / `producer_incomplete`, phase from the durable cutover row; explicit `resume`, no redispatch |
| restart after COMMIT | Hindsight selected; `observeBoot` combines the receipt and durable producer checkpoint, without network work or re-promotion; unfinished preparation stays recoverable |
| lost submit reply / duplicate submit | discovery through list/status; `MEMORY_OPERATION_BUSY` + `activeOperationId` |

The receipt, never the exception, decides whether the authority switched.

### Operator read (R8)

- `memory.activation.status` is operator-only, invalidated by `memory.operations.changed` (no second subscription).
  Schema-enforced server-derived `actions`: `activate` = Local + proven run id + configured + no drift + no blocking +
  no run; `resume` = uncommitted run under Local; `recoverBinding` = committed run plus either unavailable runtime
  or a terminal incomplete producer matching its epoch/transaction; all false
  while the family row is open; `cancelOperationId` only for an `admitted` row. Custody counters read the Local ledger
  before COMMIT and the Hindsight ledger after it.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| wrong marker, stale `expectedEpochId`/`setupRevision`, unconfigured or drifted setup, `recover` without matching receipt | `MEMORY_OPERATION_UNSUPPORTED`; no row |
| `new` with an existing run / `resume` with another run id | `MEMORY_OPERATION_UNSUPPORTED` / `MEMORY_OPERATION_NOT_FOUND` |
| any exclusive family open | `MEMORY_OPERATION_BUSY` + `activeOperationId` |
| Local Bank without verified B3 row, or extra B3 row | `completed` / `prerequisite_blocked`; zero native calls |
| admitted Local write does not drain | `failed` / `MEMORY_QUIESCENCE_TIMEOUT`; Local writable again |
| span still incomplete after forced drain | `failed` / `MEMORY_INGESTION_INCOMPLETE`; Local intact |
| coverage stale / target not empty / representation gaps | `HINDSIGHT_LOCAL_COVERAGE_STALE` / `HINDSIGHT_CURRENT_TARGET_CONFLICT` / `HINDSIGHT_CURRENT_PREPARATION_GAPS` |
| drift-proving native refusal | invalidation persisted; `HINDSIGHT_CURRENT_NATIVE_REFUSED`; `resume` refuses that preparation |
| `target_conflict` native refusal | no invalidation; `resume` resubmits the same frozen request (D88) |
| unreachable / timeout / unparseable reply | `HINDSIGHT_UNREACHABLE` / `HINDSIGHT_TIMEOUT` / `HINDSIGHT_RESPONSE_INVALID`; no drift recorded |
| lease held by a live operation | `HINDSIGHT_CUTOVER_LEASE_LOST`; evidence kept |
| B3 connection no longer `configured` before promotion | `HINDSIGHT_CONNECTION_NOT_VERIFIED`; `resume` after repair makes no new native writes |
| Local fenced write (tool / `writeMemory` / tidy / flush) | structured `MEMORY_AUTHORITY_FENCED`; reads succeed |

## 5. Good / Base / Bad Cases

- Good: Legacy -> Local -> `setup.validate` + `setup.apply` -> `hindsight.activate` -> marker `hindsight`, receipts,
  `operations() !== null`, runtime available, a Hindsight Run captured; one POST per import/verification.
- Base: a chat turn during the interval gets fenced memory writes, its commit is carried and processed once by the first
  Hindsight flush; a crash mid-import resumes from evidence without a second POST.
- Bad: counting unconsumed witnesses as a drain failure; answering `healthy` from a stale selector after a failed start;
  reopening Local after COMMIT; inferring successful preparation from `bindingSnapshot()` after a swallowed repair error.

## 6. Tests Required

- `hindsight-activation-service.test.ts`: one POST per Bank step, plan blocking, drain/incomplete span, quiesce timeout,
  F1 drain witness carried, recapture, target conflict/gaps, native refusals, lost replies, incomplete verification,
  lease takeover, Bank-boundary stop/shutdown, connection loss. `memory-operation-kind-hindsight.test.ts`: minted ids,
  refusals, blocked scopes, three-family single-flight, pre-claim cancel, boot classification, bind failure + recover,
  refused repair, committed identity from receipts.
- `hindsight-activation-journey.test.ts` (C03, temp SQLite + transport double): lost reply, duplicate, restart on both
  sides of COMMIT, commit between COMMIT and bind, corrupt marker. Plus custody-carry, write-fence, Block-repo,
  `hindsight-runtime-composition.test.ts` (F2), status and Shared schema tests, the recapture-after-posted-verification
  service test (ids derived per preparation, unique, identical on replay), and the isolated Core boot
  (`research/isolated-process-check.mjs`: migrations through 049, both status reads, kind registered, zero fetches).
- First Bank preparation held beyond 7.5 seconds keeps activation running at `binding`; release makes the first
  subsequent Run expose working retain/recall and the transferred Character fact. Cover manual-only scheduling,
  preparation failure/stop, both post-COMMIT crash windows, same-receipt recovery without duplicate transfers,
  failed completed-checkpoint persistence and historical completed-row settlement. Retain the ordinary cold-capture tests.

## 7. Wrong vs Correct

Wrong: treat any unconsumed witness left after the forced drain as incomplete.

```ts
if (pendingCharacters(db, epochId).length > 0) throw new Error("MEMORY_INGESTION_INCOMPLETE");
```

Correct: chat keeps committing while fenced; only an incomplete span blocks, witnesses are carried at COMMIT.

```ts
if (incompleteSpan(db, epochId)) throw new Error("MEMORY_INGESTION_INCOMPLETE");
```

## Known limits

- D87 (closed 2026-09-25): a Character first seen during the interval blocks `resume` until 应用配置 verifies its Bank,
  then `resume` completes (`hindsight-lifecycle-journey.test.ts` "blocks resume on a Character first seen during the
  interval ..."); a Character first seen after COMMIT is provisioned by `bank.provision`.
- D88: `target_conflict` has no distinct remedy; clearing the Bank is manual (retargeted to Stage 3/5).
- `readCommittedHindsightProducer` rebuilds `verificationId` from the latest verification candidate, i.e. the native
  per-preparation id, not the base; safe only while a committed run is never replayed through the chain.
- Owner acceptance on a real Hindsight/PostgreSQL instance is batched with the Stage 2 session, not automated here.
