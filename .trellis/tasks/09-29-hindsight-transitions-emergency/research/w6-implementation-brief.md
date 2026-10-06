# W6 offline emergency takeover and recovery handoff

Active task: `.trellis/tasks/09-29-hindsight-transitions-emergency`.
Exact cwd: `H:/TakiAgent`; branch: `main`. Resume complete W6 from `research/w6-checkpoint.md` once dispatched.

Preparation only. Dispatch after W5 functional readiness, using its completed predecessor checks and final real-journey evidence. Checked W3-W5 APIs/reports
take precedence over provisional seam names. This brief neither enables emergency takeover nor claims acceptance.

## Assignment and ownership

Implement W6 in `implement.md`: separately confirmed offline emergency producer, durable incident sealing/recovery,
verified surviving-replica Local candidate, Pending/primary/queue disposition, old-provider isolation and a reviewed
D91 paired-recovery runbook with isolated proof. Reuse W1-W5 storage/runtime/operations and the Stage3 backup store.
W7 owns Home UI; W8 owns final integrated review. Do not replace these with a second backup engine or authority.

You are not alone in the codebase. Preserve every existing change and do not revert others. Do not spawn agents.
Leader owns requirements, cross-wave decisions and private real-corpus preparation. Under the owner's 2026-10-06
direction, finish the coherent W6 implementation with focused checks at incident, authority, recovery and cleanup
boundaries; the leader schedules the consolidated independent review from actual risk and progress. Do not request
a separate checker for each implementation slice. Prioritize correctness and functional completion; defer performance
work that does not block those contracts. Engineering docs/comments use English; owner updates use Chinese.

Verify `H:/TakiAgent` (branch `main`), initial HEAD `fccfc4fb78958c90efebdb4a5a98b355bcb73a40`, worktrees, migration registry and
task `.trellis/tasks/09-29-hindsight-transitions-emergency` before actions. Current parent session pointer is
`codex_01a10bce-c98d-7930-a034-2842a2739758`; verify the live binding rather than relying on an older session ID.
Empty legacy `.current-task` is not authority. Never use T4.
Native dependency is `H:/hindsight` (branch `main`), initial HEAD `6a749ba3e7d8719e336d9d1d8735a8e09da4366b`; preserve native
baseline/ownership hashes and report exact producer gaps before changing its production code.

Own necessary Core transition emergency modules, existing backup/emergency/store/status hooks, immutable incident
joins, candidate/custody/Pending disposition and operation/composition wiring. Shared contracts precede consumers.
Read root instructions, trellis-before-dev, curated specs, PRD/design/implement, final W0-W5 reports and runtime
prerequisites. Apply transition/runtime/backup/replica/application/database contracts. Allocate an additive migration
only after checking actual W4/W5 registry; never rewrite a previously recorded receipt, migration or incident.

## No native dependency on the emergency path

The operator selects `transition.emergency-local` with its distinct confirmation. A failed healthy transition must
not automatically become emergency. Emergency admission, preview, drain, evidence sealing and authority publication
cannot call or wait for an unavailable native client, compatibility probe, live remote head, new backup or model.
Provider hangs and absent credentials must not hang the offline path. Stop local old-provider dispatch and retain
unresolved effects; do not wait forever for factual remote completion that cannot be known during the outage.

The real operation admission path must uphold that rule too. On2026-10-06, source review found that the existing
exclusive-family admission and nonterminal transition fence can block a new explicit emergency behind a hung old
healthy operation. In the same validated emergency admission transaction, preserve the old factual uncertainty
and append an immutable quarantine/supersession association; never erase old intents/receipts/queues or invent a
terminal Native outcome. Old leases, dispatch, queue admission and recovery must honor that association. Apply
the same offline requirement to old-authority Native-dependent manual replica/backup producers and their late
callbacks, reusing existing epoch retirement guards wherever sufficient. Unrelated or purely Local exclusive work
may still refuse as busy. Identify ownership from the actual selected epoch/receipt: an unfinished reentry may
already have committed the current Hindsight epoch even though its request names a Local predecessor. A return
already committed to Local is not an emergency-Hindsight source. Do not introduce a generic cross-system canceler.

The current Stage3 `sealEmergencyEvidence` in `hindsight-backup-emergency.ts` accepts no native route, but generates
its own incident ID and captures metadata before asynchronous copying. Extend that producer and existing
`hindsight-backup-store.ts` with transition-owned identity and durable read-back; do not write a competing directory
layout. W1 already reserves an emergency incident ID in the original intent before producer dispatch.

Persist exact transition/attempt/incident/capture identity before the copy. Establish a consistent surviving Core
boundary covering selected authority, complete actual Bank inventory, replica native/application checkpoints,
Pending and parent writes, application bodies, primary membership/custody and operation/queue evidence. Metadata
and copied SQLite must describe the same proved boundary. Do not hold an unsupported asynchronous SQLite transaction;
reuse actual backup/writer coordination and derive/validate immutable captured facts from the copied snapshot.
Late Timeline appends retain exact durable custody in the later COMMIT boundary.

Seal a complete incident before W4 authority COMMIT. The artifact is `incident-local`, `fullBackup:false`; it must
never be listed as a verified native pair. Recover a lost seal reply by the original incident identity and validate
its manifest, exact transition/source association and file digest before reuse. Incomplete/corrupt/conflicting
artifacts cannot be interpreted as completion or overwritten silently. A valid sealed incident is immutable;
cleanup of an incomplete attempt must not destroy a previously sealed artifact with the same identity.
Seal failure leaves takeover uncommitted. Crash after seal/before ACK and after ACK/before COMMIT are distinct cases.

## Proven surviving state and honest uncertainty

Build the Local candidate from complete verified consumable replica/evidence, using the checked W3 reconstruction
and W4 atomic publication seams. Healthy W2 final proof is unavailable by definition: introduce an explicit emergency
evidence join rather than forging a healthy certificate or weakening healthy admission. Retain real mappings,
typed fields, Source aliases/historical references, policy/provenance/lifecycle and Blocks present in the surviving
closure. Missing evidence is an explicit limitation or refusal where safety requires, never invented content.

Preserve last verified backup ID and age independently of comparable coverage. Existing backup status is a bounded
display projection, not the complete transition inventory: `verifiedNativeBanks` currently slices at256 whereas
transition identity supports a larger admitted set. Never use that display truncation or unreadable-as-empty result
as full emergency evidence. Establish every admitted Bank or mark an explicit unknown/incomplete scope.

Numeric intervals require exact compatible lineage, generation and proved epoch continuity. Record native AND
application coordinates where applicable. W0 currently allows exact epoch equality only; do not infer compatibility
from equal cursor numbers, Bank IDs or successful binding. Even comparable local cursors do not bound unseen remote
writes during an outage. Unknown remote head, changed history, unreadable counts or absent checkpoint remain unknown.
No verified backup is not automatically a blocker to surviving-local-evidence takeover, and never means zero loss.

Unknown Pending/native/application effects retain their original request IDs, epoch and factual uncertainty.
This includes W3 `candidate.pendingSources`: complete-snapshot awaiting Source intent with exact artifact/body,
operation/document and namespace identities. Preserve that evidence in the incident/custody disposition without
materializing a fictional document or confirmed fact. Native final proof by itself never proves Core Pending success.
Do not relabel them confirmed or execute them again as new Local memory. Classify only effects whose durable proof
supports a safe disposition. Preserve exact primary append/group membership and assign each unconsumed witnessed
span once to the selected epoch; unknown or incomplete membership cannot disappear under an aggregate count.
Admitted typed transition intents remain observable and follow W4's safe target/source disposition rules.

The same W4 outer COMMIT must select the new Local epoch, join the sealed incident and complete candidate/mapping,
carry custody and queue obligations, and insert immutable authority history. Post-COMMIT bind failure selects Local
but reports unavailable; restart repairs that same target. Old Run/Effect references and provider workers remain
retired. A returned old provider is a foreign historical branch: no automatic sync/merge/recovery or healthy re-entry
can overwrite the new Local state. Later branch reconciliation remains a separately scoped future operation.

## D91 runbook and isolated recovery proof

Deliver a concrete current-code operator recovery runbook, not an unsolicited live restore command. Stop Core before
replacement, pair exact Core/native artifacts and secret custody, validate source/schema/lineage/generation/receipt/
checkpoint identities before any writers start, and reopen under guarded recovery. Native-only rollback must refuse
without absorbing old state through a rebuild. Secrets stay in their actual catalog/custody mechanism; reports and
backup manifests must not expose credential values or invent key portability.

Use existing native backup/restore tooling and checked W2 trigger/history preservation. Restore exact transition
request/fence/proof/result and Bank creation/initialization history, not fresh IDs that happen to yield equal counts.
After schema restore, all normal writer barriers are enabled; stale pre-restore executors cannot publish. Validate
complete application-body dependencies introduced by W3. Missing credential/pair/proof leaves workers gated with
an actionable outcome. A supported valid pair with an unfinished effect recovers its original native result once.

Run the drill on new private copies of actual reused corpus/owned artifacts. Read `real-data-reuse-plan.md` and
`real-data-reuse-preflight.md`, then the completed W5 journey report for the newest reusable stopped pair. Never
start/mutate the preserved baseline directly or repeat corpus conversion. Owner allows necessary scoped real LLM
tests, but the emergency path itself must produce zero native/model calls. Preserve original hashes and sanitized
counts/identities, stop owned processes, and retain evidence for W8. No original-user authority replacement.

## Required failure and integration evidence

1. Native permanently absent and a transport that never resolves; no verified backup; mismatched backup history;
   absent/partial replica state. Offline admission/seal/COMMIT performs zero native/model dispatch and gives honest
   per-Bank uncertainty. Include unreadable inventory and display-limit overflow without false completeness.
2. Storage failure, interrupted Core copy, corrupt artifact, reply loss after completed seal, exact original incident
   recovery, conflicting incident/source identity, and crash around ACK/COMMIT. No unsealed publication or duplicate
   incident; valid sealed evidence survives retry failures.
3. Pending/parent effect unknown, primary finalization before/after COMMIT and before Local binding, constructor
   failure/restart, queued outcomes and stale held references. Prove once-owned primary ingestion and no fabricated
   confirmation or arbitrary old-native replay.
4. Old provider returns after emergency and contains additional foreign writes. Boot, replica scheduler, Pending
   recovery, manual sync and healthy re-entry cannot reactivate or merge it into the new Local authority.
5. Current isolated paired backup/restore with all final native history, unfinished effects and Source/body closure.
   Mismatched pair, missing credential, native-only rollback and corrupt receipt refuse before workers; valid pair
   recovers exact original factual effects with no second dispatch.
6. Actual reused corpus emergency/restart/restore comparisons, original inputs unchanged and measured zero emergency
   network/model calls. Deterministic fixtures supplement real data for exact crash/concurrency/unknown timing.

For actual comparisons, retain the W5 final audit's distinction between exact captured/installed state and subsequent
legitimate Local retention effects. Compare the complete incident/candidate/installed representation, then audit any
new lifecycle change against its actual producer receipt and expiry input. Do not equate raw timestamp spelling or
independent Local/Native revision numbers, suppress the real sweeper, or excuse missing/unknown records as drift.

Run relevant Shared/Core/SQLite/boot and owned native/restore gates with at most two Vitest workers, root lint/
typecheck, spec/index and diff/encoding checks. Do not claim global native typecheck from scoped passes; preserve
established platform diagnostics accurately. Required current restore proof is not replaced by archived Stage3 runs.

Deliver `research/w6-implementation.md`, the reviewed current D91 runbook and sanitized execution evidence with exact
commands/results, source/ownership hashes and unresolved limits. Maintain `research/w6-checkpoint.md`. No commit,
push/reset/rebase, new dependency, original-data writes, finish/archive or inferred owner/manual acceptance.
