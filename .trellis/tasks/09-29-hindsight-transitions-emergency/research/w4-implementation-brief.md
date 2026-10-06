# W4 implementation handoff

Ready for dispatch: complete W3 implementation and independent check passed on 2026-10-02. Read the final
`w3-independent-check.md` and its SourceSet repair before consuming the verified interfaces. Parent rehashed all97
Taki/60 native final checked paths with no mismatch and confirmed the original delivery manifest unchanged.
No W4 production work or acceptance is claimed by this handoff.

## Assignment and ownership

Implement the complete W4 wave in `implement.md`: receipt-proven atomic authority handoff, bidirectional primary
custody, symmetric runtime retirement/rebinding, durable intent admission/execution, and boot/shutdown composition.
The leader owns cross-wave decisions and integration acceptance. You are not alone in the codebase; preserve all
existing changes and do not revert another actor's work. Do not spawn agents. One complete implementer is followed
by one independent checker; W5 owns healthy orchestration and W6 owns offline emergency integration.

- Taki workspace only: `H:/TakiAgent`, main, initial HEAD `fccfc4fb78958c90efebdb4a5a98b355bcb73a40`.
- Native dependency: `H:/hindsight`, main, initial HEAD `6a749ba3e7d8719e336d9d1d8735a8e09da4366b`.
- Task: `.trellis/tasks/09-29-hindsight-transitions-emergency`, in_progress. The actual parent session is
  `codex_01a0ed15-10d0-7802-90a1-48c5d50ec0fc`; empty legacy `.current-task` is not authority. Never use T4.
- Verify live cwd/branch/HEAD/worktrees, session binding and migration head before implementation. W3 allocated
  additive053; recheck the actual registry and allocate a later additive migration only if needed.
- Native W2 production contracts are checked dependencies. Report an exact producer defect to the leader before
  altering them. Preserve the recorded native baseline and final ownership hashes.
- `w4-prior-source-baseline.json` reconstructs244 Taki/349 native checked pre-W4 hashes from immutable predecessor
  inventories and records their digests. Use it for attribution; it is not a post-edit live snapshot or a new test.

Own the necessary Core DB handoff/custody/effect journals, transition runtime modules, existing selector/composition
and Local/Hindsight bindings, invocation/fence adapters and `main.ts` composition. Shared changes precede consumers.
Keep package boundaries, direct internal imports, module headers, indexes and executable specs synchronized.

Read root AGENTS/CLAUDE/workflow, trellis-before-dev, curated implement context, PRD/design/implement, final W0-W3
independent reports and `stage-4-runtime-prerequisites.md`. Apply database/transaction/migration, canonical Local,
application runtime, onboarding/activation, operation and transition contracts before code.

## Delivered W3 integration seams

Read `w3-implementation.md` and the final independent report for exact signatures. The delivered W3 production
entrypoints are `captureTransitionLocal`, `loadTransitionNativeEvidence`, `persistTransitionNativeEvidence`,
`buildTransitionLocalCandidate`, `prepareTransitionDelta`, `executeTransitionDelta`,
`buildTransitionHindsightCandidate`, `readVerifiedTransitionCandidate`, `saveTransitionCommonBaseline`,
`requireTransitionCommonBaseline` and `installTransitionLocalCandidate`. Capture inputs carry the real lease,
time and configuration assertion. Use these checked seams rather than recreating candidate or delta logic.

Parent verified the delivered `db/memory-transition-local-staging.ts`: the installer requires the exact target
Local epoch with reason `planned-switch`, matching predecessor, still-selected predecessor and no existing target
Bank rows. It creates neither the epoch nor global Blocks, markers, receipts, custody or queue results. Its nested
transaction must participate in W4's outer COMMIT. W4 allocates the matching unselected epoch, installs and verifies
the rows, publishes global Blocks and the complete authority/custody/receipt join in that same outer transaction.

`db/memory-transition-evidence-repo.ts` currently records a W1 receipt only after a proven attempt and matching
selected active target epoch; this is deliberately only a partial publication guard. Its receipt/proof hashes and
admission identity checks remain intact. W4 adds the complete candidate/marker/checkpoint/custody/queue join and boot
validation instead of assuming that the existing recordTransitionReceipt call itself publishes all those facts.

Owner amendment: small cohesive line-count-only overages caused by formatting/wrapping do not need forced splits,
compression or removal of comments. The delivered root lint has exactly one such exception (51 versus50 lines).
Keep all other lint/type/functional checks and report raw command results plus explicit exceptions truthfully.

## Atomic publication and verifiable history

Use W1 immutable intent/proof/receipt/queue storage and the final W3 candidate, complete evidence, mappings and
staging APIs. A prepared candidate or hash alone is never an authority receipt. Implement one synchronous outer
SQLite transaction that proves the current source authority, exact live attempt, closed admission/cutoff, complete
Bank/config/inventory and custody boundary, target candidate/manifest/mapping and every required final native proof.
Join the exact persisted records; do not trust caller-supplied replacements for current state.

The same COMMIT must close the old epoch, create/select the target epoch and authority marker, publish the complete
target representation, assign exact primary custody, associate queued execution obligations and insert the W1
receipt. Local candidate rows and Blocks must become visible atomically. W3 deliberately does not publish global
Blocks while merely staging an unselected candidate. Verify staged rows against the candidate before selection;
partial or foreign rows refuse and rollback. Reentry must use the actual final post-maintenance mapping and proof.

Keep initial Local onboarding and first Hindsight activation contracts intact. Do not create a B2 import receipt,
rewrite old B4 activation history, temporarily select a candidate, loosen initial-local validation or infer readiness
from a provider setting. Introduce a distinct receipt-proven transition boot path. If another join is required in
Shared/storage, extend it explicitly without rewriting immutable history or overloading an unrelated receipt field.

Pre-COMMIT failure leaves the source selected. Reopening source writes requires positive unchanged-authority and
native release evidence. A COMMIT whose response is lost is reconciled by its exact immutable receipt. Constructor,
start, status-read or reply failure after COMMIT leaves the committed target selected and unavailable; it never
causes automatic source revival, a second promotion or re-execution of a parent Run.

## Runtime lifetime and all writer owners

Current known seams from source review:

- `runtime-selector.ts`: its existing canonical boolean and early-return Local binding are insufficient for a
  later Hindsight-to-Local epoch. Selection/recovery must distinguish the actual selected provider and epoch.
- `runtime-composition.ts`: `current()` currently prefers a published Hindsight runtime. Withdraw that publication
  before returning to Local; preserve the one shared Utility Slot and Core-owned Compaction.
- `local-runtime-binding.ts` and `hindsight-runtime-binding.ts`: distinguish epoch retirement from permanent
  whole-Core shutdown. Each later cycle constructs a fresh binding; old held references remain retired forever.
- `hindsight-memory-subsystem.ts`: stop and settle foreground work, scheduler, curator, ingestion, provider, writes,
  application writer, service and sync. A pointer swap alone does not close those owners.
- `canonical-memory-run.ts` and Effect adapters: keep immutable captured authority/route/capability identities.
  A held old Run/Effect never becomes a target-epoch invocation by mutation of its context.

Quiescence must include foreground sync/hydration, manual sync requests, automatic work, policy/source/Block writers,
retention and primary-source ingestion. Admission and completion must use the same ownership boundary; do not allow
manual sync or a nested child to reacquire a fresh identity behind final ownership. Use the existing actual producer
fences and lifetime guards, not only a transition-local flag. Shutdown aborts and settles owned work before DB close.

Boot checks marker, epoch, receipt, complete candidate/mapping and unresolved transition obligations before enabling
writers. Same-epoch recovery repairs a selected unavailable runtime without redispatching the original transition.
Corrupt/incomplete evidence remains visibly unavailable; Legacy is never a fallback after canonical selection.

For re-entry, Core COMMIT does not itself activate native writers. The existing native outcome contract requires
an exact Core receipt/proof for `activate`, with factual outcome phase `active`. The pre-COMMIT proven target remains
fenced. Provide a durable native-finalization/readiness seam so W5 can reconcile activation for every Bank before
enabling Hindsight writers or queued target effects. Lost replies retain selected-target unavailability and exact
recovery identity; no remote resolve occurs inside the SQLite transaction. Return-Local may retain a visible pending
native retirement while the old Bank remains fenced; runtime readiness and overall operation completion stay separate.

## Durable intents and primary custody

Consume W3's explicit `candidate.pendingSources` as part of final source disposition. These are genuine complete-
snapshot `awaiting_native` Source artifacts, persisted by Core before native dispatch, and can remain after terminal
failure or non-dispatch. Native final proof alone does not certify their completion. Join exact original operation,
artifact/body/namespace and document identities to actual Pending/parent/custody outcome. Known refusal/non-dispatch
keeps historical bytes; unresolved/unknown retains ownership. Do not construct a native document, claim confirmed
Local memory or replay an old remote operation into the new provider. W5 healthy publication requires a factual
disposition for every item; W6 may preserve unresolved evidence under its separate incident contract.

Integrate the W1 typed queue with real Local and Hindsight mutation/retain entrypoints and original caller provenance.
Queue rows contain normalized commands and immutable IDs, never closures. Admission must commit before returning a
distinct queued outcome. Preserve caller request, Run/attempt/Effect, source epoch/scope, logical identity/revision,
sequence and replay ID. A queued response is not successful retain or mutation. No arbitrary generic Run replay.

Close admission at the durable cutoff. Capacity exhaustion refuses before insertion; late old invocations refuse.
Execute eligible intents in stable order only after exact target mapping and revision validation using a fresh
internal target context. Persist the actual target request ID before dispatch. Reconcile original target receipts
after a crash between effect and acknowledgement. Two intents expecting the same old revision cannot both silently
succeed. Outcome unknown stays unresolved and keeps custody; it is not permission to retry with a different ID.

On a positively proven pre-COMMIT abort, admitted intents either execute against the unchanged source or receive
an explicit supported terminal disposition. Runtime readiness, switch receipt and individual queued outcomes remain
different facts. Original callers and later observers can recover results without reopening the initial UI session.

Carry exact primary append/group membership across both directions. Cover finalization while draining, after COMMIT
but before binding, cancellation/user-only finalization and reopen. Late source appends remain durably owned and are
eventually ingested once; missing/incomplete/unowned spans block publication. Existing Pending/native/application
unknown effects remain tied to their original authority and are not silently replayed into a new provider.

## Validation and limits

Exercise real SQLite transactions/reopen with failures immediately before/after receipt COMMIT, constructor/start
failure, corrupt receipt/candidate, stale config/inventory/lease, rollback of staged rows/Blocks/custody, and old held
Run/Effect refusal. Prove at least two provider cycles using fixture-owned genuine transition receipts rather than
mock selector booleans. Initial onboarding/activation boot and same-epoch repair remain covered.

Test real queue producer entrypoints and target effect receipts: admission-before-ACK, cutoff, capacity, ordered
revision conflict, effect-before-ACK crash and recovery, unavailable runtime, source abort and second observer.
Primary custody tests must use actual append/finalization producers and verify complete membership and exactly one
eventual ingestion. Include manual sync and foreground work racing drain, and shutdown with active work.

Run appropriate scoped Shared/Core/migration/boot checks with at most two Vitest workers, root lint/typecheck and
diff checks. Native fixtures stay owned/isolated. Real data testing follows `real-data-reuse-plan.md`: use fresh
private copies of existing converted outputs, never repeat the corpus conversion. Necessary real LLM tests are
authorized; record actual usage when available. Do not infer manual/product acceptance from deterministic tests.

Do not advertise a partially implemented transition action. W4 provides complete handoff/intent/runtime seams and
their production composition; W5/W6 provide complete healthy/emergency producer orchestration. Do not substitute a
test-only selector or leave required production writer entrypoints disconnected.

Deliver `research/w4-implementation.md` with exact APIs, files, invariants, commands/results, source identity and
limitations. Maintain `research/w4-checkpoint.md` before compaction. No commit/push/reset/rebase, new dependency,
original-data authority replacement, finish or archive.
