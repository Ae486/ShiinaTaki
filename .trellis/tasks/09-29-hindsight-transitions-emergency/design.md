# Stage 4 design: repeated transitions and emergency takeover

Status: owner approved implementation on 2026-09-29. Proposed protocol details remain subject to the assigned engineering proof gates. Baseline: `fccfc4fb78958c90efebdb4a5a98b355bcb73a40`; cwd: `H:/TakiAgent`; branch: `main`.

Read [PRD](prd.md), [recovered acceptance](research/recovery-2026-09-29.md), and
[source prerequisites](research/stage-4-prerequisites.md). The source report owns exact file/line references;
this document owns the proposed contracts. Existing first-activation and backup receipts retain their meanings.

## 1. Decisions and boundary

2026-10-07 continuation: [W9 final lease guard](research/stage4-w9-lease-plan-2026-10-07.md) supplements this design.
Healthy publication must perform a final live-clock check of the original executor and exact post-write revision
after complete read-back and before transaction return. Genuine expiry rolls back the entire Core publication;
it does not become a committed authority followed by a late lease refusal. The owner approved this amendment on
2026-10-07, including a consistent finite lease extension if functional verification demonstrates it is necessary.

1. Extend the existing Core operation service, scheduler, provider clients, canonical stores and runtime owner.
   Introduce transition-specific durable state where necessary; do not build another sync engine or UI ledger.
2. Healthy return, healthy re-entry and emergency takeover are distinct operator requests in one exclusive
   transition family. First activation remains its existing operation. Configuration disable is not switching.
3. A normal preview is confirmed once (accepted U1). After admission Core performs the complete guarded operation.
   Emergency preview/confirmation is separate and never a fallback selected after a healthy transition fails.
4. The authority marker plus a validated transition receipt establishes committed authority. Runtime availability,
   operation progress and remote effect completion are separate facts. A bind failure cannot roll authority back.
5. Re-entry reconciles the complete current Local state against a verified common baseline and mappings. Compare
   complete descriptors, reuse unchanged bodies, and transfer necessary changes. Neither new Banks nor a full
   retransmission is the default. Missing proof produces a concrete refusal, not an invented import receipt.
6. Native algorithm parity is not required in Local; preservation of agreed logical records, original fields,
   policy, provenance, lifecycle and Blocks is required. D81 does not become a promise of derived erasure.
7. All initial execution evidence uses owned temporary fixtures. Original data, real authority changes and native
   administration require their own authorization. Stage 5/6 and D79-D83/D23 boundaries remain as recorded.

Rejected alternatives: a settings-toggle switch has no transaction/recovery boundary; replaying old closures
retains obsolete Run/Effect authority; fresh-Bank full import by default violates the accepted reuse contract;
timestamp/queue-count readiness cannot prove exact effects or a final native maintenance state.

## 2. Existing foundation and mandatory repairs

| Existing producer | Reuse | Required extension / constraint |
| --- | --- | --- |
| Durable operation service and kind registry | Admission, authenticated observers, progress, cancellation, boot observation | Add transition producer identity and receipt-based recovery; serialize against setup/onboarding/activation/lifecycle/backup. |
| B5 scheduler and application-aware sync | Leases, native/app checkpoints, retries, factual result recovery | R1/D84: correlate the exact manual request, claim and outcome. Close D93 rollback classification on transition-used paths. |
| D78 capture/import/verification | Complete typed Local capture, transfer mappings, required native maintenance evidence | First-activation guards are not reusable authority for later Local epochs. Add an explicit transition source proof and common-baseline reconciliation. |
| Canonical Local and Hindsight runtime bindings | Captured authority, lifetime checks, selected publication, bind failure behavior | Generalize Local reconstruction and repeated retirement/rebinding without fake B2 history. Preserve old-reference refusal. |
| Primary custody and source journals | Exact committed append membership and recoverable finalization | Carry ownership atomically into each resulting epoch, including emergency and pre-bind intervals. |
| Stage 3 backup service and emergency seal | Verified pair inventory, custody, offline Core copy and incident artifact | R2: compare compatible histories before interval arithmetic. Transition owns quiescence, operation identity and seal/COMMIT ordering. |
| Existing Core/Shared/Home operation surfaces | Strict status, same-Core observation, generation-safe refresh | Add usable preview/progress/normal/emergency actions backed by real producers. |

R1 (false sync success) and R2 (incomparable backup interval) are confirmed defects; repair them before consuming
their outputs as transition proof. R3 is a Local fence documentation/inventory caveat: a newly captured Character
can create a Bank while memory writes are fenced. Preserve D87's safe refusal and add a final inventory check;
do not equate `quiesce()` with a closed Bank set. Exact evidence is in the independent reports.

## 3. Durable identities and ownership

Allocate migrations only after checking the live migration head. Persist immutable evidence separately from the
mutable operation projection. The following are proposed required fields, not claims about today's schema:

| Record | Required identity / contents |
| --- | --- |
| Transition intent | Operation/request identity, kind, authenticated actor, confirmation/preview identity, source authority+epoch, target kind, selected Bank inventory and digest, connection/config revision, admitted time. |
| Execution attempt | Transition identity, lease owner/generation, phase and revision, admission cutoff, checkpoint/producer IDs, last proven effect and structured failure. Lease takeover changes executor ownership, not logical request identity. |
| Common baseline | Source/target epochs, provider lineage, each logical scope and Local/native Bank mapping, native generation, native/app cursors, complete manifest and mapping hashes, policy/Block revisions, prior transition receipt. |
| Final proof | Exact fenced inventory/state, native fence identity, required-maintenance inputs/outcomes, snapshot/checkpoint hashes, source custody boundary, unresolved-work accounting and backup/incident reference. |
| Transition receipt | Source predecessor, new epoch, direction, final proof and mapping identity, custody reassignment, COMMIT evidence. Immutable and sufficient for boot-time authority validation. |
| Queued intent | Transition and sequence, source epoch, captured caller/Run/Effect reference as provenance only, immutable normalized command/hash, logical targets/revisions, replay identity, status and result. |

All authority-sensitive DB writes use the existing single-writer/transaction conventions and predecessor/CAS
checks. Reject stale operation/epoch/config/Bank inventory at admission and again at the final commit. Terminal
history is immutable; an explicit recovery command may repair a runtime or settle a new attempt without rewriting
the original failed/unknown operation as if it had always succeeded.

D86: resolve an existing Local Bank by logical scope and retain its exact ID. A reconstructed new scope receives
one persisted ID before publication and reuses it on retry. Preserve both historical ID schemes and their receipts.

## 4. Admission, fences and final-state proof

The Core transition owner first closes conflicting control-plane mutations, establishes queue admission and
drains already admitted source writers. The writer inventory includes explicit retain/mutate, ingestion/flush,
Local tidy/retention, Hindsight parent/Pending/application writes, curator work, foreground sync, scheduler runs,
Bank provisioning and relevant setup changes. Primary Timeline appends can continue only with exact durable custody.
Manual sync admission is excluded by the same transition family; already admitted foreground work must drain or retain an exact unresolved outcome before final proof.
New Character capture either joins the proven inventory before cutoff or remains witnessed/unavailable for memory;
an uncovered Bank cannot slip into a committed proof.

The current in-memory Hindsight fence is a Core-side admission mechanism. It is not proof that native Control Plane,
MCP, API or background maintenance writers have stopped. A healthy reverse transition requires a native transition
fence integrated with the real native Bank writer/maintenance owner. The provider contract must support:

- identity-bound acquisition and historical lookup under the authenticated compatible extension;
- drain of accepted writers and required finite maintenance, with explicit incomplete/failure outcomes;
- a final snapshot/certificate produced while the same fence remains valid;
- refusal of stale holder/attempt writes and safe crash/lease recovery;
- explicit abort/release and retirement/transfer outcomes, distinguishable after a lost reply.

This is a missing capability to implement, not a promised existing endpoint. Reuse the native writer ownership
foundation; Core stays OS-neutral and never acquires PostgreSQL authority through an HTTP key. A deployment lacking
the proven capability reports the switch unavailable. Do not silently downgrade to the local fence.

Lease expiry must not silently reopen native writes while Core's COMMIT outcome is unresolved. Executor lease loss
revokes the old executor; durable transition fencing remains quarantined until receipt-based recovery can prove an
abort or committed retirement. Direct privileged database administration is outside the supported writer contract;
namespace/state drift detected afterward refuses reuse rather than being silently merged.

For healthy return: warm catch-up/reconciliation may occur before the fence to reduce the pause, but only the
post-fence maintenance and final native/application snapshot establish the promoted state. Prove every selected
Bank, including empty Banks. Distinguish pre-cutoff unresolved source work from new transition-owned intents;
zero Pending or an old certificate alone proves neither completeness nor the final cut.

## 5. Healthy Hindsight to Local

1. Preview current authority, compatible provider, Bank coverage, unresolved work and recovery prerequisites.
   Admit after the single confirmation, capturing the expected identities/revisions.
2. Acquire the transition owner; drain source work through existing producers. Stop scheduler/foreground publication
   only in the defined final phase. Preserve per-producer factual/unknown outcomes.
3. Establish the native fence and final maintenance/snapshot proof described above. Read complete native and
   application state under that proof and verify reconstruction coverage, policy, Blocks and mappings.
4. Build an isolated Local candidate and common baseline. Retain existing scope IDs where available. Verify the
   full logical manifest and exact primary-source disposition before touching the selected authority.
5. In one SQLite transaction revalidate source/predecessor/fence evidence, publish the new Local epoch and immutable
   transition receipt, and assign outstanding witnessed primary groups and admitted queue ownership.
6. Retire old Hindsight references, publish the committed Local runtime, resolve queued intents through a fresh
   target context, and report the actual outcome. Release/retire native ownership according to its proven outcome;
   failure to acknowledge remote finalization stays visible and recoverable.

COMMIT does not depend on a browser staying connected. Failure before COMMIT preserves the Hindsight authority;
if remote outcome or fence release is unresolved, keep memory safely unavailable until reconciliation rather than
advertising restored writability. Failure after COMMIT repairs the Local binding; it never reopens the old authority.

## 6. Healthy Local re-entry

Current source has three independent first-activation constraints: `hindsight-authority-repo.ts` requires the
initial Local epoch and its B2 activation receipt; `hindsight-local-coverage-reader.ts` also requires
`reason='initial-local'`; `hindsight-current-baseline.ts` permits controls plus an explicitly proven supersession
set rather than arbitrary used-Bank delta application. Extract a neutral complete-descriptor reader for transitions,
add a new transition receipt/guard and native delta contract, and keep the old entrypoint guards intact.

Re-entry uses the last healthy common baseline, scope/record mappings and complete final current-Local inventory.
Compare full identity/revision/hash/lifecycle descriptors; timestamps and a list of new rows are insufficient.
Represent additions, edits, invalidation/restore, expiry/deletion, policy and Block changes explicitly. An absent
record is a deletion only when complete inventory/tombstone evidence establishes that meaning. Keep native-derived
payloads and original Taki artifacts distinct and lossless.

Verify the target lineage/Bank generation and the unchanged common baseline before applying a delta. A target
modified outside the admitted healthy history, an emergency branch, a missing mapping or incomplete coverage
produces a conflict/refusal with diagnostic evidence. No automatic branch merge, Bank deletion/reset or forced full
copy follows. Known D88 whole-Bank remedies remain separate.

Use a transition-specific native request/proof tied to the complete source manifest, target baseline and stable
replay identity. Read historical outcomes before submitting again. Every Bank's applied delta and required
maintenance must be proven against the final fenced state; reuse unchanged native records. All-Bank verification
precedes the atomic new Hindsight epoch, custody carry and runtime publication. First-activation history remains
immutable and is never manufactured to satisfy the old initial-Local guard.

A Character scope created while Local is active has no previous healthy native baseline. It uses a separately
typed unused-scope admission and persisted baseline, not a fabricated exit/retirement/Core receipt. W3 proves that
the logical Local scope is absent from the prior common baseline. W2 locks the actual target Bank and verifies its
namespace, creation/provisioning history, exact template/configuration witness, absence of prior user data and
transfer/mutation/application effects, and the complete allowed initialization state. Current empty tables alone
are insufficient: a previously used then cleared Bank, truncated/unverifiable history, or changed target refuses.
Read-materialization heads/snapshots are classified explicitly rather than mistaken for user writes. The new-scope
branch reuses the real complete-descriptor delta writer with its own exact baseline check; ordinary reused Banks
still require their retired healthy baseline. Final native proof binds the unused-scope proof and actual delta
receipt. This W2/W3 engineering contract was reviewed on 2026-09-30 and requires native PostgreSQL evidence before
the capability is advertised.

Independent W2 review confirmed that actual B3 template import always schedules a mental-model refresh. Its native
initialization history is therefore an explicit allowed state, justified by a non-backfilled append-only producer
ledger tied to the actual Bank creation, first template, import, operation, live worker, history and completed output.
Only a complete matching initialization may remain unused; ordinary interleaved work permanently records use, and
pending/failed/unknown, missing/extra events or changed template/model definitions refuse. Exact same-template retries
retain all original events. The ledger is included in final auxiliary evidence and physical backup/restore. This
refines the accepted allowed-initialization branch; it does not permit arbitrary cleared Banks or DTO attestations.

The ordinary D77 `_check_body` contract keeps an artifact's `original_record`, `original_source` and Bank body
unchanged. A re-entry that changes current Local content therefore uses a separate transition-owned revision
publication, never a relaxation of that ordinary endpoint. Validate the exact previous artifact version/body hash,
common baseline, current Local manifest/record hashes and actual post-delta native version in the same atomic
native/application transaction. The new revision records the current Local input and explicit transition/previous
revision lineage; it does not rewrite the earliest historical source. Keep every old body, artifact and receipt
readable by revision. Unchanged artifacts retain their revisions. Preserve typed metadata, provenance, policy-version
and Block rules, and require complete deletion/tombstone proof. Stale or foreign predecessors and either half's
transaction failure must leave no partial publication. This source-grounded W2 extension was reviewed on 2026-09-30
and is part of the W3 consumer contract.

## 7. Transition-owned intents and caller outcomes (PR04)

Queueing starts at a persisted admission boundary and ends at a persisted cutoff. A request can enter only while
its captured source epoch is current and its operation is supported by a typed normalized intent. Admission writes
the exact intent and replay identity before returning an acknowledgement. Requests arriving from old Run/Effect
objects after COMMIT are refused; they are not retroactively enrolled.

| Event | Required result |
| --- | --- |
| Supported request admitted during the fence | Caller receives a durable queued identity, not memory-write success. The transition owns eventual execution and observable result. |
| Unrepresentable command or exhausted configured bound | Structured retryable refusal before admission; no closure capture or silent drop. Limits are explicit server policy and validated in the protocol. |
| Caller/WS closes after admission | Durable intent remains observable. Closing a client does not cancel a Core-owned mutation. |
| Conflicting commands for one logical target | Stable admission order plus revision checks; a later conflicting mutation gets a specific terminal conflict unless its intent explicitly binds to the prior queued result. No implicit last-write-wins. |
| Pre-COMMIT abort | Revalidate and execute still-valid intents against the unchanged source, or settle a truthful conflict/cancellation; do not silently discard them. |
| Post-COMMIT replay | Resolve an exact logical mapping and expected revision, mint a fresh target execution context, persist target request identity before dispatch, and recover its factual result before retry. |
| Crash after effect but before queue acknowledgement | Reconcile the original target request/receipt; never issue a new logical effect because the reply is absent. |
| Old invocation after cutoff/COMMIT | Structured stale-authority refusal; the caller explicitly obtains a new context if it wants to try again. |

Primary source custody is not a generic queued tool invocation. Retain exact append/group membership and its
epoch assignment; each committed source is either already consumed or owned once by the resulting epoch. Test
late finalization, cancellation and constructor failure independently from mutation replay.

Transition status distinguishes authority COMMIT, runtime readiness and queue settlement. `completed` requires
the committed runtime and terminal disposition of the admitted intent set. Per-intent refusal/conflict remains
visible; completion of the switch must never be rendered as success of every queued mutation. A target effect whose
result cannot yet be established stays unresolved and prevents claiming complete queue settlement.

## 8. Emergency Local takeover

Emergency admission is operator-only and distinct from healthy switching. Native unavailability must not block
local evidence collection. Stop/retire local dispatch to the old Hindsight epoch and take a consistent boundary over
Core authority, verified replica/checkpoints, parent writes/Pending, primary custody, operation journals and config.
Persist the transition/incident identity before calling the seal producer. A lost seal reply must recover the same artifact by that identity before any retry or COMMIT.
Invoke Stage 3's offline seal under the transition identity before authority COMMIT; record the immutable incident
artifact in the receipt. A seal failure leaves the old authority selected and takeover uncommitted.

R2 interval rules: retain the last verified backup ID and age independently of coverage. Numeric cursor comparison
requires matching lineage, Bank ID/generation and a proven compatible epoch relationship. Expose both native and
application coordinates where applicable. No checkpoint, changed history or unknown remote head means unknown
coverage, never zero lost memories. Even comparable local cursors do not bound unseen remote-only writes during an
outage; say so in the confirmation and incident artifact.

Build Local from the last verified consumable replica plus evidence whose factual status permits application.
Unconfirmed/unknown remote operations retain their identity and uncertainty; do not manufacture confirmed memory
or replay an old native mutation into Local without a separately proven disposition. Exact primary append evidence
must remain recoverable once under the new epoch. Persist this boundary with the new Local transition receipt,
then publish Local and settle only safely interpretable transition-owned intents.

When old Hindsight returns, its lineage/epoch is foreign historical state. Background recovery and re-entry cannot
overwrite or auto-merge it into the new Local epoch. Any later branch resolution is an explicitly scoped operation.
The incident artifact is surviving local evidence, not a freshly complete native backup.

## 9. Restart, cancellation and recovery

| Durable boundary | Recovery / cancellation |
| --- | --- |
| Admitted, no claim/effect | Safe cancellation; no producer dispatch. |
| Source/native work started, no Core COMMIT | Recover the same attempt from exact receipts. Cancellation requests stop at a proven boundary; unknown remote effects are reconciled, not called cancelled. |
| Final proof ready, source revision/fence lost | Refuse promotion; preserve evidence and selected authority. Explicit retry obtains valid current proof. |
| Core COMMIT exists, bind incomplete | Boot selects the committed epoch, refuses old references and performs binding-only recovery; no second promotion or automatic rollback. |
| Queue replay effect unknown | Keep the original target identity and factual recovery path; no re-execution of the parent Run. |
| Remote finalization/release unknown | Keep its pending obligation visible; stale executors cannot mutate, and the old provider is not silently writable. |

Native pre-effect abort checks and its ownership change share one Bank-lock transaction. For reused-Bank re-entry,
absence of any delta or maintenance plan/effect plus an unchanged verified baseline permits restoring the original
retired owner pointer; retain the aborted request/outcome/history and keep ordinary native writes fenced. A genuinely
new scope remains explicitly held under its unused baseline. A later new-scope request may replace that hold only
after validating the same creation/unused proof and every intervening safe-abort record. A delayed old executor must
be unable to publish after either outcome. If a delta already took effect or its outcome is unknown, abort refuses
without writing a terminal outcome: lookup/claim resumes the same transition. Healthy return can release after a
proved no-effect fenced abort; once maintenance has produced effects, recover the same finite plan to its actual
final proof before releasing it. No timeout, empty current table or guessed remote failure establishes these facts.

Epoch retirement must be distinct from whole-Core shutdown: the current Hindsight binding `stop()` is permanent. Withdraw the old publication and retire its workers while allowing a fresh binding for a later epoch in the same process.

The boot path must consult transition receipts before starting writers/schedulers. A corrupt or unverifiable
receipt reports unavailable instead of inferring authority from configuration. Shutdown drains/aborts owned work
in an order that cannot restart an already retired scheduler (preserve the Stage 3 shutdown fix).

D91 delivery is a reviewed recovery runbook plus isolated proof, not an unsolicited live restore tool. Stop Core
before replacement; pair exact Core/native artifacts and custody; validate schema/identity/receipts and rollback
guards before starting workers. Never perform a native-only rollback and then allow automatic synchronization.

## 10. Shared/Home contract and rollout

Extend the existing strict Shared operation unions and authority projection; exact names are finalized with the
first protocol wave. Status exposes direction, source/target authority, real phase, resumability/cancelability,
per-Bank proof progress, unresolved work, committed runtime state, queue outcomes and structured next action.
Unknown totals stay null. Return Core-derived action availability and stale-preview refusals.

Home adds normal-switch and emergency previews to Operations, with actual coverage/backup-age warnings, one healthy
confirmation and a separate emergency confirmation. Show loading, unavailable capability, busy, conflict,
pre-COMMIT failure, committed-but-unavailable runtime and unknown outcomes. Keep native hashes and lease tokens in
diagnostics. Subscribe before refreshing; use existing client-generation guards and never replay a mutation after
reconnect, remount or response loss. A second authenticated Home reads the same durable operation.

Rollout requires compatible native support for healthy final fencing/re-entry, additive Core migrations, and
validated runtime wiring. No new dependency, automatic deployment or secret scope is assumed. Before COMMIT a failed
candidate is unselected; after COMMIT recover the selected new epoch. Schema downgrade and deletion of history are
not rollback procedures. Keep recovery artifacts and foreign history; cleanup remains D90/Stage 5.

## 11. Review gates

- R1/R2/R3 and D84/D86/D91/D93 have explicit owners and regression cases in [implement.md](implement.md).
- Native fence expiry/recovery and retained-baseline re-entry must be proven in the real native writer paths;
  an interface or transport double alone cannot release healthy transitions.
- PR01-PR04 and C03/C07/C08/C09/C10 are mapped to concrete wave tests. Stage 6 manual acceptance remains open.
- Complete the source report and artifact consistency review before activation. Reopen owner discussion only for
  a material product/topology/preservation tradeoff that these accepted requirements do not resolve.
