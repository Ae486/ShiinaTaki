# Research: B7 runtime handoff foundation

2026-09-14 correction: R1 is withdrawn. [The grounded B7 record](../../08-09-memory-operations-ui/grill.md) applies the
accepted reuse of verified baselines, identity mappings and subsequent changes. Runtime replacement is an engineering
prerequisite, not a reason to require new physical Banks or full retransfers. Proposed owner/facade details below remain
unaccepted implementation design.

- Query: How can an explicitly committed Memory Authority transition replace the constructed runtime without leaving retired executable engine/tool/flush/maintenance references usable, and which first-activation B2 assumptions must fresh Local-epoch re-entry extend?
- Scope: Internal, read-only engineering research for B7 design, constrained by the already accepted repeated-switch preservation and continuation rules.
- Date: 2026-09-13
- Workspace: `H:/TakiAgent`, `main`, HEAD `3c63a8080c92ffbb3ee8257dc2d979c2ba4ed711`; current working files include the retained B6 implementation. Branch/worktree metadata was read inside this checkout only, without Git commands.
- Active task: `.trellis/tasks/08-09-memory-runtime-integration`, from `.trellis/.runtime/sessions/codex_01a07553-c738-75f0-93c4-bd8a7cd0b014.json`, using the supplied context identity. The legacy `.trellis/.current-task` remains empty. No task/pointer changes.
- Method: Direct reads of the named runtime, promotion, storage and consumer files; exact identifier searches; source inspection of existing tests. No tests, services, models, native repository, credentials or live data were used. The workflow/spec foundation loaded during the preceding research was retained and the relevant runtime specs were read again where needed.

## Findings

### Conclusion and boundary

A stable Core runtime owner should keep the existing process-wide public ports while replacing one complete
provider-runtime generation after a verified authority commit. Persisted authority remains the sole source of truth.
The owner must retire concrete old-generation executables, preserve immutable admitted Run bindings, and expose an
unavailable runtime when post-commit reconstruction fails. Reassigning a top-level variable, changing a configuration
flag, or invoking the existing forward-promotion function does not accomplish this.

There are useful foundations already: the delegating `MemoryEngine`, switchable `MemoryFlushBinding`, B2's
irreversible post-commit retirement, immutable coordinator/Run bindings, storage epoch checks, and Hindsight's
stop/drain implementation. Current composition supports boot selection and a one-way Legacy-to-Canonical Local
handoff. It is not yet a general Local/Hindsight replacement owner.

The observations below are B7 design and test requirements. They do not revise the independently verified B6
closeout. In particular, the B4 post-commit read issue identified below is a fence lifecycle control-flow risk;
this research does not demonstrate that an old-authority write can still commit.

### 1. What current runtime selection actually does

| Current behavior | Source | Consequence |
| --- | --- | --- |
| Boot reads the durable selector, builds exactly one Legacy/Local/Hindsight engine, and refuses selected Hindsight when its factory is absent. | `packages/core/src/memory/runtime-selector.ts:26` | Keep marker-first boot and no implicit provider fallback. |
| `selected.memory` is a stable delegating engine whose methods resolve a private `current` engine at invocation. | `runtime-selector.ts:41`, `:69` | Existing consumers can retain a stable facade; it must dispatch only to a fully published current generation. |
| `bindCanonical()` handles Legacy retirement and Canonical Local construction. If already canonical it returns after checking the existing facade, rather than constructing for another epoch. | `runtime-selector.ts:51` | It cannot be reused unchanged for Local-to-Hindsight, Hindsight-to-Local, or same-provider/new-epoch replacement. |
| Provider composition also keeps separate `canonical` and `hindsight` variables and chooses `hindsight ?? canonical ?? selected.legacy`. | `packages/core/src/memory/runtime-composition.ts:81` | Updating only the selector's engine leaves other ports bound to a different provider; leaving both slots populated makes Hindsight win regardless of the new selector. |
| `snapshot`, `captureRun`, `recordPrimaryCommitted`, `tidy`, and `writeMemory` resolve through the composition scope; they are different closures from the selector's engine delegate. | `runtime-composition.ts:58` | A replacement must publish a complete coherent bundle, not update `memory` alone. |
| Compaction uses a stable flush delegate; Legacy retirement binds a failing port and successful Local binding installs the new port. | `runtime-composition.ts:108`, `:129`; `packages/core/src/memory/memory-flush-port.ts:84` | Reuse this indirection and the failing-port posture during handoff, while guarding in-flight flush completion as well as future calls. |
| `stop()` permanently closes the full runtime, selected engine, AutoMemory and process Utility Slot, then waits for subsystem stop. | `runtime-composition.ts:114` | Full process shutdown is not a temporary provider handoff. A hot-switch owner needs a provider lifetime separate from the shared utility/Compaction lifetime. |

### 2. Actual consumer capture points

Paths without a full prefix in this section are within `packages/core/src/`.

| Consumer | Captured reference and source | Required handoff behavior |
| --- | --- | --- |
| Boot-local dependencies | `main.ts:173` destructures `selectedMemory`, `memory`, `autoMemory`, `tidy`, `memoryRoot`, `writeMemory` once. | A later variable assignment cannot replace references already given to other services. Keep stable public ports backed by one owner. |
| Foreground Run admission | `main.ts:306` passes `memoryRuntime.captureRun` to `harness/run-snapshot-capture.ts:61`. That function freezes tools, memory reference, recall, prompt and assembly into `RunExecutionContext` at `:65`. | New admissions use the new owner generation. Existing captured bundles must remain bound to their original generation; never mutate their snapshot or redirect their tools to a new epoch. |
| Queued/retried chat execution | `server/methods/chat-send.ts:129` takes `runs.context(runId)`; `agents/chat-agent.ts:242`, `:329`, `:434` use captured assembly/tools/automatic recall, with engine fallbacks only for callers without that context. | Invalidating a global engine is insufficient for a previously admitted Run. Retire or settle its executable memory context and use existing Run/Attempt cancellation semantics where execution must stop. |
| Run restoration and duplicates | `harness/run-service.ts:123` preserves an in-process duplicate's original context and rejects context-loss restoration with a different complete memory reference. `:118` calls optional `dispose()` when releasing a context. | Reuse `dispose` for a generation-bound memory lease. Do not substitute a newly captured memory context for a persisted old-epoch Run. Current memory capture does not install this disposal hook. |
| Primary source witness | `main.ts:350` passes `recordPrimaryCommitted`; `agents/chat-agent.ts:316`, `:321` invokes it after actual primary Timeline commits, including partial committed output on a failure path. | Preserve positive source evidence and the committing Run association through the fence. A late callback must not silently acquire a new epoch merely because the owner changed. |
| Detached automatic maintenance | `main.ts:349`, `agents/chat-agent.ts:359`; `memory/auto-memory.ts:99` defers per-Character work and resolves `maintenance()` when the chain executes at `:126`. | Account for queued as well as active work. Today a deferred callback can resolve a later provider through `current()`. The handoff must explicitly drain, retire, or retain the approved queued work rather than accidentally redirect it. |
| Image-description writes | `main.ts:187` captures `writeEpisode: writeMemory`; `memory/image-description-writer.ts:53` awaits a VLM result, then calls that captured writer at `:61`. | The resulting write must go through the owner's admission boundary. The helper has no stop/drain port, and its model call is outside the Utility Slot; do not count only AutoMemory/provider work as all late write producers. Preserve the existing best-effort image policy rather than inventing Effect replay. |
| Operator maintenance and migration | `main.ts:447` registers `memoryTidyMethod(tidy)`; `:448` registers `memoryRuntime.migrationRunner`, whose factory retains the original fence and `selected.bindCanonical` callback (`runtime-composition.ts:73`). | Registered methods must call owner ports, not an old subsystem. B2 migration stays a distinct Legacy migration path. |
| Workspace protection, prompt choice and storage display | `main.ts:289`, `:348`, `:437` capture `selectedMemory.canonical`; storage also retains `memoryRoot`. | Keep canonical-storage restrictions authoritative during unavailable handoff. A replacement must not briefly re-enable Markdown/workspace writes or legacy prompt vocabulary. |
| Dev-only tool entrypoint | `main.ts:478` prefers the admitted Run's memory tools, falling back to `memory.createTools`. | Both branches must preserve the same generation/epoch guards; a diagnostic path must not bypass retirement. |
| Shutdown | `main.ts:505` stops scheduling, seals Run admission, requests durable cancellation and calls `memoryRuntime.stop`; `:510` waits before DB close. | Preserve this final lifetime barrier. `RunService.seal()` is one-way (`run-service.ts:114`); it is not a reusable temporary memory-switch gate. |

### 3. Existing retirement and drift protection

#### Legacy/B2: strong reusable post-commit pattern

`fenceMemoryEngine()` wraps reads, engine writes, retention, foreground/background/tidy tool construction and tool
execution (`packages/core/src/memory/legacy-migration/fenced-memory-engine.ts:10`, `:31`). Checking execution matters:
a tool may have been created before a model request and invoked long after the provider was retired. Legacy
maintenance and flush share the same fence (`packages/core/src/memory/bootstrap.ts:105`).

The fence permits temporary quiescence to reopen after a verified pre-commit failure, but `retire()` permanently
prevents reopening (`memory-authority-fence.ts:25`). B2's runner explicitly retires after activation and always runs
`retireUnlessLegacy()` in `finally`; only a positively read Legacy selector allows reopening. A failed selector read
therefore remains fenced (`legacy-migration-runner.ts:42`, `:53`). This is stronger than relying on a successful
return from a function that also performs post-commit reads or callbacks.

`runtime-selector.ts:55` removes the Legacy engine before constructing/publishing Canonical Local. A constructor,
callback or mismatched post-commit binding failure leaves the delegating engine unavailable. Composition also
disconnects Compaction from the old flush at `runtime-composition.ts:108`.

Existing source tests cover this behavior:

- `runtime-activation-failure.test.ts:62` checks held engine/tool/write/retention/tidy/maintenance/flush references.
- `:92`, `:133`, `:149` cover constructor, synchronous/asynchronous callback, and post-commit marker-read failure;
  `:172` covers transaction rollback before commit.
- `runtime-selector.test.ts:29`, `:42` cover pre-commit binding refusal and an unavailable facade after handoff failure.
- `legacy-migration/memory-authority-fence.test.ts:5`, `:23`, `:33` cover irreversible retirement, pre-commit reopening,
  and a drain timeout that must not reopen a retired fence.

#### Local and Hindsight: distinguish storage safety from complete lifetime ownership

Canonical Local's captured tools already use immutable coordinator bindings. The coordinator checks the captured
epoch/provider/lineage, provider object and executable methods before dispatch and again after invocation
(`packages/core/src/memory/memory-coordinator.ts:70`, `:101`, `:172`, `:201`). A write that may already have applied
reports `MEMORY_OUTCOME_UNKNOWN` on post-call drift (`:177`), rather than pretending it was undone.

Local storage independently rejects new mutations against a closed or different authority:

- `packages/core/src/db/canonical-memory-maintenance-storage.ts:30` requires matching active Local epoch.
- `canonical-memory-repo.ts:59`, `:77`, `:140`, `:156` executes ordinary mutations transactionally with that check.
- `canonical-memory-maintenance-storage.ts:39` additionally verifies Bank/Character scope for maintenance.

Historical idempotent receipt reads can legitimately return old proof before a new mutation check
(`canonical-memory-repo.ts:78`, `:141`). That is evidence replay without a new write, not renewed old authority.

However, Local subsystem `stop` is currently only `retention.stop`
(`packages/core/src/memory/canonical-local-subsystem.ts:37`, `:48`). Its ingestion queue has no stop/settle API
(`canonical-local-ingestion.ts:28`, `:43`); direct tidy/flush calls are not all represented by AutoMemory's chain.
This is a gap to address when adding hot replacement, not a claim that closed-epoch writes evade storage guards.

Hindsight has a substantially complete subsystem stop/drain:
`packages/core/src/memory/hindsight/hindsight-memory-subsystem.ts:100` first closes connection/sync admission and then
settles foreground consumers, scheduler, curator, ingestion, provider, Pending/parent writes, application writer and
Bank service. `hindsight-runtime-consumers.ts:20` wraps complete tool invocations and preserves non-enumerable Effect
metadata. `:30` wraps automatic recall; `:37` prevents publishing a capture after stop.

Those wrappers do **not** currently wrap the captured `assemble` callback. Both providers create an immutable
assembly closure over admitted rows/Blocks (`canonical-local-runtime.ts:55`, `hindsight-memory-runtime.ts:56`;
`canonical-memory-run.ts:35`). It remains a process-local captured value unless a new generation guard or the Run's
execution lifetime prevents reuse. Historical snapshots may remain inspectable; callable retired context must not
be mistaken for a fresh active-provider read.

Full-runtime `stop()` also closes the shared Utility Slot and AutoMemory. Both closures have permanent stopped flags
(`utility-slot.ts:46`, `auto-memory.ts:97`). Reusing the stopped utility for the replacement would silently skip
background tasks; constructing a second utility without draining the first would violate the existing single chain.

### 4. B4 post-commit read failure: precise risk statement

Current forward promotion is:

1. `promoteHindsightWithFence()` calls `fence.quiesce({ retireOnSuccess: true }, ...)`
   (`packages/core/src/memory/hindsight/hindsight-authority-promotion-service.ts:16`).
2. `promoteHindsightAuthority()` commits the epoch, selector and receipts in one transaction, then calls
   `readMemoryAuthoritySelection()` **outside** the transaction (`packages/core/src/db/hindsight-authority-repo.ts:39`,
   `:47`, `:222`).
3. If that post-commit read throws, the quiescence callback rejects before `retireOnSuccess` is applied.
   `memory-authority-fence.ts:33` can consequently restore `fenced = false` when the fence had not otherwise retired.

This is a static control-flow finding, not a reproduced data-write defect. B4's wrapper currently has no production
operator activation caller, and Canonical Local writes still have the coordinator/storage checks above. Reopening
this JavaScript fence does not reopen the old database epoch, restore the old selector, or prove an old write can
commit. The existing B4 service tests at `hindsight-authority-promotion-service.test.ts:21` cover busy/pre-commit
refusal; they do not establish the proposed post-commit handoff case.

B7 must reproduce the post-commit selector-read exception with real SQLite and test three observations independently:
the fence disposition, durable authority/receipt state, and whether held old references attempt or commit any new
effect. The service/owner should carry an unambiguous commit boundary and remain retired/unavailable on post-commit
failure. A positive proof that the predecessor is still authoritative is required before reopening after failure.
Do not report a constructor/read/callback failure as a rolled-back authority transition merely because the RPC failed.

### 5. Exact first-activation assumptions that re-entry must extend

These restrictions are cumulative. Changing one `reason` predicate does not make re-entry valid.

| Current restriction | Source | Required engineering extension |
| --- | --- | --- |
| Current Local capture accepts only active Local with `reason === "initial-local"`. | `packages/core/src/db/hindsight-local-coverage-reader.ts:57` | Recognize a genuine newly authoritative Local epoch through its own verified transition provenance; keep the current epoch/Bank/state checks. |
| Writer reservation and current coverage counts also require `initial-local`. | `hindsight-local-coverage-repo.ts:162`; `hindsight-local-coverage-guard.ts:56` | Extend the same provenance rule consistently to reservation and status. Otherwise a returned Local epoch is refused or incorrectly shown as unavailable. |
| Creating a B4 run requires an existing B2 `memory_migration_runs` row with `phase=activated`, `status=completed`, and that exact predecessor epoch. | `hindsight-cutover-run-repo.ts:111` | A fresh Local-epoch migration needs real source-transition evidence, without fabricating a Legacy migration run. |
| Promotion again requires the predecessor's epoch reason to be `initial-local` and selector mode/epoch agreement. | `hindsight-authority-repo.ts:79` | Admit the new Local predecessor only through the corresponding verified transition path. Never relabel its reason or reactivate the original Local epoch. |
| Promotion unconditionally joins the same B2 run to `memory_migration_activation_receipts` for the predecessor. The later current-import branch does not bypass this check. | `hindsight-authority-repo.ts:61`, `:90` | Preserve B2 proof for first activation; add the independently validated re-entry origin. Current-state import proof does not by itself prove how Local became authoritative. |
| Coverage manifests include a `b2EvidenceDigest` and comparison against historical B2 sources/results/receipts; `assertCurrent` rechecks that digest. | `hindsight-local-coverage-repo.ts:67`, `:111`; `hindsight-local-coverage-b2.ts:33`, `:69` | Separate complete current Local content proof from origin-specific historical comparison. Version any changed contract; do not silently reinterpret an existing B2 digest or modify historical receipt bytes. |
| B4 cutover run, replica staging and activation receipt persistence use foreign keys to `memory_migration_runs`. | `packages/core/src/db/migrations/040-hindsight-cutover-schema.ts:75`; `023-hindsight-initial-cutover.ts:88`, `:145` | An additive migration and compatible origin/lifecycle design are needed; a new arbitrary run ID cannot pass the existing database schema. Applied migration files remain immutable. |
| Boot-time selection validates Hindsight activation receipt/run/bank count against the canonical active epoch. Canonical Local selection requires snapshot/transaction marker fields. | `packages/core/src/memory/legacy-migration/legacy-activation-repo.ts:17`, `:29` | Extend actual committed selection/receipt validation for the new transition kinds. Do not populate marker fields with fabricated B2 evidence merely to satisfy shape checks. |

The reuse target is the complete current-state capture/transfer/verification pipeline, not the old Markdown import.
`hindsight-local-coverage-guard.ts:18` already distinguishes B2 catch-up diagnostics from required current import,
then requires current cutover proof. Keep its source completeness, required-maintenance, namespace, snapshot,
invalidation and final writer-reservation protections when extending the lifecycle.

### 6. Minimum proposed owner/facade boundary

The following is an engineering proposal, not an implemented API or a new Shared schema.

1. **One coherent selected generation.** Evolve the composition scope into the single owner of the selected subsystem
   bundle: engine, capture, primary-source witness, write port, tidy/maintenance, flush, provider start/stop and active
   identity. Replace the separate priority-selected `hindsight`/`canonical` slots with one coherent published holder.
   Identity comes from verified persisted selection/receipt state. A process-local generation token is only a lifetime
   fence; it is not another Memory Authority or a replacement for `authorityEpochId`.

2. **Stable public ports, bound captured executables.** Preserve the existing injected facade references in `main.ts`.
   At each new operation admission, capture its generation once. Concrete tool/recall/assembly/maintenance/flush
   closures bind that generation and refuse after retirement. A stable facade may serve a later new operation through
   the new generation; an already admitted operation must not transparently redirect. Preserve frozen schemas,
   metadata descriptors and structured errors when adapting the Hindsight consumer wrapper for this purpose.

3. **Separate provider replacement from process shutdown.** Keep the one process Utility Slot and Core-owned
   Compaction outside the replaceable provider lifetime. Give both Local and Hindsight complete admission closure,
   settle/stop ownership for direct and detached work. Local constructor currently starts a boot sweep and timer
   (`canonical-local-subsystem.ts:37`; `scheduler/sweep-runner.ts:58`); candidate construction/start/cleanup must not
   leak that work if publication fails. A stopped utility or AutoMemory closure cannot simply be reopened.

4. **Fence accepted work deliberately.** The existing Legacy fence is not a global Canonical write barrier. Enforce
   handoff admission at the owner and retain the existing SQLite/native guards. Drain or settle previously accepted
   work according to the committed operation protocol, and preserve the B7-required queued mutation intents. Do not
   turn a delayed image callback, post-turn source witness or deferred maintenance trigger into new-epoch work by
   incidental late resolution. Do not introduce a new timeout or silently drop accepted Pending work here.

5. **Commit is irreversible; binding can fail independently.** Pre-commit refusal can leave the verified predecessor
   runnable. At the positive durable commit boundary, withdraw the old published generation and retire its admission
   synchronously; expose a failing flush/unavailable execution facade until the new generation is installed. Ensure
   post-commit marker reads and observer callbacks cannot reopen the retired predecessor. Cleanup/drain operates on
   retained old/candidate handles, not on a `current()` getter that may now be intentionally unavailable.

6. **Publish only a complete replacement for the committed identity.** Current factories validate active authority at
   construction, so they cannot simply be run against an uncommitted target as if it were current. Validate passive
   prerequisites before the transition, reconstruct against the verified committed identity afterward, and publish
   engine/capture/write/maintenance/flush/start ownership as one coherent bundle. Start replacement background work
   once. A failure remains visible as committed authority plus unavailable runtime; retry reconstruction from that
   receipt, not the import/promotion or a new epoch creation.

7. **Connect to existing Harness lifetime rather than replay.** Carry generation disposal through
   `RunExecutionContext.dispose`. Reuse `RunService`'s immutable restoration comparison; add checks for capture that
   races retirement and for queued/executing Runs at the handoff boundary. `requestCancel()` only changes durable Run
   state (`run-service.ts:108`); real stream interruption still uses the turn controller
   (`server/methods/chat-send.ts:120`). Do not confuse deleting a context with cancelling execution. Never rewrite
   persisted Run snapshots or blindly replay old memory Effects against the new authority.

The helper/operator that performs an accepted authority transition should call this owner after the commit boundary;
Home remains a projection. Closing Home neither retires the Core provider generation nor supplies evidence that a
transition completed. The handoff design must support the accepted verified-baseline/mapping/change continuation rule.

### 7. Concrete invariants and verification cases for B7

Existing tests below are source references only; none were rerun by this research. New cases must use the real Core
SQLite path and held production consumer closures, with deterministic provider/model doubles where possible.

| Invariant / case | Existing foundation | Required B7 evidence |
| --- | --- | --- |
| Boot respects committed authority; unavailable target never falls back. | `runtime-selector.test.ts:28`, `:52`; `hindsight-runtime-composition.test.ts:111` | Restart after each new Local-return/re-entry/takeover receipt; assert exactly the committed provider or explicit unavailable state. |
| A complete facade changes coherently. | `runtime-selector.test.ts:17`; `runtime-composition.test.ts:101` | Retain all `main.ts` injected ports, perform Local -> Hindsight -> new Local, and verify engine/capture/writer/tidy/maintenance/flush all reference the same committed epoch. |
| Old tools cannot dispatch to either old or new provider. | `canonical-memory-run.test.ts:84`, `:94` | Hold foreground/background/tidy tools before handoff, then assert refusal, no new provider dispatch and no new storage effect; include same-provider/new-epoch and same-epoch runtime reconstruction. |
| Captured assembly and automatic recall have a lifetime. | `hindsight-runtime-consumers.ts:30`; `hindsight-runtime-composition.test.ts:180` | Retain `assemble`, recall and tool closures; retire the generation, close the old DB handle where appropriate, and prove no execution enters that handle or returns an active-context success from stale generation data. |
| B4 post-commit read exception is not rollback. | `hindsight-authority-repo.ts:47`; B2 regression at `runtime-activation-failure.test.ts:149` | Inject marker/receipt read failure only after successful transaction commit. Assert persistent Hindsight authority, truthful handoff failure, retired/unavailable facade, and separately test held Local write refusal and unchanged data. |
| Constructor/callback failure cannot revive old references. | `runtime-activation-failure.test.ts:92`, `:133`; `runtime-selector.test.ts:42` | Cover factory throw, partial construction/start failure, handoff observer throw and repeated reconstruction attempt. Clean up owned resources exactly once; preserve the original transition receipt and epoch. |
| Verified pre-commit failure preserves usable predecessor. | `runtime-activation-failure.test.ts:172`; `hindsight-authority-promotion-service.test.ts:22`, `:34` | Fail final integrity/write-fence/transaction publication before commit; assert no new authority or receipt and allow valid new predecessor admissions without reviving cancelled old invocations. |
| Deferred/direct work cannot escape drainage. | `auto-memory-shutdown.test.ts:12`, `:19`, `:33`; `hindsight-runtime-composition.test.ts:141` | Queue same-Character maintenance, hold direct tidy/flush, hold an image description before its write, and race a primary source commit. Prove each final effect has one explicit epoch disposition, with no lost positive source witness or accidental duplicate ingestion. |
| In-flight flush cannot falsely retire Timeline after handoff. | `runtime-composition.test.ts:101`; `runtime-activation-failure.test.ts:114` | Race transition with a held pre-retirement flush and Compaction commit. Preserve receipt/coverage checks; no success from a retired generation may authorize a new summary retirement without the required current proof. |
| Hindsight stop settles complete invocations and preserves metadata. | `hindsight-runtime-composition.test.ts:141`, `:154`, `:168`, `:180` | Reuse these guarantees during replacement; include abort-ignoring transport and late success/failure. Unknown native outcomes remain durable Pending work, not a cancellation claim. |
| Persisted Runs do not adopt new memory. | `harness/run-service-memory-restore.test.ts:39`, `:61`, `:71` | After handoff, duplicate/context-loss restore retains exact identity rules. No snapshot rewrite, silent context replacement, or Effect replay against a new epoch. Disposal must be exactly once. |
| Re-entry uses a genuine fresh Local predecessor. | `hindsight-cutover-run-repo.ts:111`; `hindsight-local-coverage-reader.ts:57`; `hindsight-authority-repo.ts:90` | Start from a real new Local epoch with planned-switch/emergency provenance and no fabricated B2 run. Import all current state, reject omitted changes/stale proof, and pass through the extended receipt/FK/coverage path. Keep historical initial-B2 acceptance cases intact. |
| Runtime and durable selection disagreement is explicit. | `runtime-composition.ts:155`; `runtime-selector.ts:51` | Inject durable selector change while an old runtime is held, and failures between each publication step. Report unavailable/mismatch rather than usable current authority; no configuration or process-local status overwrites the DB truth. |

### Files found and related specs

| File / area | Description |
| --- | --- |
| `packages/core/src/memory/runtime-selector.ts`, `runtime-composition.ts` | Current engine indirection, provider bundle construction, B2 rebinding, flush handoff and full-runtime lifetime. |
| `packages/core/src/main.ts` | Actual capture/injection points and shutdown ordering. |
| `packages/core/src/memory/canonical-memory-run.ts`, `memory-coordinator.ts` | Immutable Run/provider/method binding and pre/post-dispatch drift checks. |
| `packages/core/src/harness/run-snapshot-capture.ts`, `run-service.ts` | Process-local executable context capture, immutable persisted identity comparison, disposal seam and durable cancellation. |
| `packages/core/src/memory/legacy-migration/` named files above | Legacy invocation fencing, B2 activation/receipt and conservative post-commit retirement. |
| `packages/core/src/memory/canonical-local-subsystem.ts`, `canonical-local-ingestion.ts`, `utility-slot.ts`, `auto-memory.ts` | Local and shared background lifetime surfaces that a hot handoff must coordinate. |
| `packages/core/src/memory/hindsight/hindsight-runtime-consumers.ts`, `hindsight-memory-subsystem.ts` | Complete Hindsight invocation tracking, metadata preservation and provider-owned drain. |
| `packages/core/src/db/hindsight-authority-repo.ts`, `hindsight-cutover-run-repo.ts`, `hindsight-local-coverage-*.ts` | Exact first-activation predecessor/B2 proof assumptions and reusable current-state evidence. |
| `.trellis/spec/backend/canonical-local-memory-runtime.md:34`, `:95` | Immutable capture and post-marker retirement/failing-flush requirements. |
| `.trellis/spec/backend/hindsight-application-runtime.md:165` | Current complete runtime cancellation/drain, immutable Effect metadata and no provider fallback. |
| `.trellis/spec/backend/memory-current-state-cutover.md:99` | Complete proof consumption and final writer-reserved activation; reconstruction does not replace a transition gate. |
| `.trellis/spec/backend/sqlite-migration-lineage.md` | Any re-entry persistence extension must preserve applied migrations and historical evidence. |
| `docs/adr/0009-single-memory-authority-with-local-replica.md:49`, `:51` | New Local epochs, retained former branches, explicit takeover and fresh migration on re-entry. |

### External references / versions

No external API behavior or package migration is proposed. The repository's current contracts remain the authority:
Canonical Memory contract `1`, the existing Harness Run snapshot format, and the Hindsight `0.9.0` compatibility/D77
application runtime described in the related specs. No new numeric timeout, foreign schema, native hook or service
manager is assumed. The prior `b7-existing-operations-foundation-2026-09-13.md` contains the producer/RPC map and
version detail; it is intentionally not repeated here.

## Caveats / Not Found

- No general committed-authority runtime replacement owner, reversible provider pause/resume, or re-entry source
  lifecycle exists in the inspected production composition. The owner/facade section is proposed engineering work.
- Static fence reopening is not proof of an old-authority data write. Coordinator and actual storage epoch guards
  remain independent protections. The post-commit exception/mismatch cases above require B7 reproduction and evidence.
- Existing B6 tests and closeout remain their own verified baseline. This report neither reruns them nor reclassifies
  B7 hot-switch risks as B6 closeout failures.
- No old epoch, receipt, migration, provider state or production file was changed. D79-D83 remain deferred. The sole
  written file for the original research slice was this report; its former R1 premise is withdrawn by the correction above.
