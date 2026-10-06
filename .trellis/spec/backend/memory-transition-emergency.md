# Offline Emergency Authority and Paired Recovery

## Scope and ownership

W6 adds explicit `transition.emergency-local` to the existing operator operation owner and transition ledger.
It is separately confirmed; a failed healthy switch never promotes itself to emergency. W4 still owns the one
authority/candidate/custody/queue COMMIT. W7 owns Home; D91 remains an operator recovery runbook, not automatic restore.
Related contracts: [publication](./memory-transition-publication.md), [backup](./memory-hindsight-backup.md),
[application](./hindsight-application-runtime.md), [migration lineage](./sqlite-migration-lineage.md).

## Admission and offline lifetime

- `createEmergencyTransitionService` receives SQLite, the existing artifact store, runtime owner and local readers.
  It has no Native/client/credential/model dependency. Preview, admission, quiescence, sealing and publication cannot
  invoke or await a provider probe, fresh backup, remote head or model, including permanently hung old producers.
- Preview is issued after its complete local read, with the existing 120-second confirmation window. Emergency
  confirmation must be unexpired at the start of one synchronous operation-owner admission. The owner captures
  that entry time once in its fresh `TransitionEvidenceContext`; both plans use it even when their own complete
  local proof work crosses the window. They still reread the immutable stored preview, actor/request/recovery,
  current configuration, authority, custody and complete inventory. Only byte-verified immutable artifacts can be
  shared inside that context; no current-state result or final verdict is cached. Operation/lease clocks remain real.
  The context closes before notification/execution; a later new submission has a fresh entry time and refuses an
  expired preview. Exact durable request retries only observe the original operation. Healthy transitions retain
  their separate real-clock final-expiry checks. Do not enlarge TTLs or rewrite prior previews to hide local cost.
- Execution renews its same local executor every 30 seconds using the shared serial heartbeat and the unchanged
  five-minute lease. Transaction-external boundaries yield and join pending renewal after copy, each Bank capture,
  candidate/proof work, publication and binding/readiness. Stop, renewal failure or a replaced/expired executor
  prevents further work; terminal cleanup clears and joins the timer. Emergency renewal never contacts Native.
  Cumulative valid work may exceed five minutes; one synchronous step that outlives its actual lease still refuses.
- The validated admission transaction appends immutable quarantine associations for old-epoch healthy, replica,
  backup and lifecycle producers. It preserves attempts, dispatches, requests and receipts, and marks their operator
  outcomes unknown. A reentry's committed receipt identifies the current Hindsight epoch even if its intent names
  a Local predecessor. Unrelated exclusive Local work still refuses busy.
- Quarantined attempts cannot reclaim a lease, admit a queue item or publish a late success. Native-dependent
  manual requests keep their original rows plus immutable quarantine. Old executor identities are never rebound.
- Withdrawal/retirement is synchronous; native-dependent completion is detached only for the captured old epoch.
  Work/utility/compaction generations and local DB authority guards refuse late publication. Ordinary stop retains
  its original join/cleanup semantics. Backup ordinary stop still restarts the source scheduler and removes failed
  partial captures; emergency retirement must not restart it or destroy retained evidence.

## Complete disclosure and immutable evidence

- Preview enumerates actual current setup, current-epoch canonical/assigned primary scopes, Timeline and Blocks;
  it does not consume the backup status display's bounded Bank list. Unreadable inventory is unknown, never empty.
- Complete verified consumable replica closure can be used even when the historical setup status is pending.
  Missing/native-only/incompatible/unreadable closure cannot create a submit identity: `expected:null`,
  `takeover:refused`, explicit blockers. Missing backup alone is not a refusal and never means zero loss.
- Last verified backup identity/age is independent of comparable interval coverage. Numeric native/application
  intervals require exact epoch/lineage/generation compatibility. Remote head and unseen remote loss stay unknown.
- Persist transition-owned incident/capture/attempt identity before copying. The existing backup store writes a
  fresh partial Core copy, derives and verifies captured facts from that immutable copy, then atomically seals
  `incident-<id>/`. Incident-local evidence has `fullBackup:false` and is never a verified Native pair.
- Exact-ID read-back verifies manifest, associations and Core digest. Lost seal ACK reuses the same valid seal.
  Partial/corrupt/conflicting artifacts refuse; cleanup cannot delete an earlier valid seal or silently overwrite
  a failed partial. No unsealed evidence can authorize authority publication.
- `readCurrentReplicaClosure` and `verifyReplicaClosure` verify complete native heads/bodies, application bodies,
  artifacts, scopes and hashes. Emergency adds capture/transition ownership outside this reusable validator.
  Local reconstruction reuses W3 projection, identity, policy, Source aliases/history, mappings and Blocks. It
  cannot invent missing policy/default content from an unavailable Native provider.
- A surviving `binding_missing` Memory unit may reuse only its exact previously committed healthy Canonical
  record and `transition_initial_policy` history. Independently verify the predecessor's publication, candidate,
  Native evidence, namespace/generation, full current application head, Native record, native-to-logical mapping,
  original proof/native/policy/provenance joins. Missing or changed correspondence refuses. This is historical
  policy reuse, never a new policy or fresh healthy-final certificate. Preserve the committed logical document and
  source-memory IDs, Local revisions/timestamps, policyVersion/updatedAt and provenance; only relocate epoch/Bank.
  Never pass already-Canonical references through the Native-to-logical translation a second time.
- Candidate preparation, proof, COMMIT and public readers each own a fresh synchronous `TransitionEvidenceContext`.
  Nested emergency verification, installation, read-back and predecessor-policy checks share that context. Every
  evidence access rereads the actual SQL identity and bytes; only previously fully verified immutable body closure
  and pure per-Bank projection may be reused. The context closes on return/error/asynchronous misuse and never
  crosses an await, retry, Database or process. Separate Native and surviving projection slots prevent one kind
  from evicting the other during predecessor validation.
- Surviving projection keys include the complete scope/epoch/time/ancestry/mappings/baseline plus explicit sorted
  policy Map entries containing committed Canonical records and original history. A Map cannot be hashed as `{}`.
  Frozen objects, copied Maps and isolated body bytes prevent caller mutation or same-ID envelope substitution.
  Candidate/publication verdicts and mutable configuration, lease, owner, authority, reservation, history, custody,
  queue, checkpoint and installed-row SQL checks are never cached. Emergency reads through the healthy observer
  open an independent context for every call and never consult its retained observation artifacts.

## Publication, unknown writes and restart

- Migration057 adds immutable captures, incidents, surviving evidence, quarantine and foreign-provider branches;
  it replaces the two admission triggers atomically. Older receipts, raw Pending and W1-W5 histories are unchanged.
- The explicit emergency candidate/proof schema joins original incident and complete surviving evidence; no healthy
  Native certificate is forged. W4's outer COMMIT closes old authority, selects Local, installs candidate/mappings,
  transfers exact custody/queue obligations and writes immutable receipt/foreign-branch history together.
- After full publication/read-back and immediately before the outer SQLite COMMIT, emergency rechecks configuration
  and the original captured executor with the current clock. Receipt insertion accounts for exactly one revision
  increment; never accept an arbitrary reread executor. Expiry rolls back epoch, installation, marker, custody,
  receipt and foreign branch together while preserving the original seal. A later bind failure retains the COMMIT.
- Original Pending, parent memory writes, application commands and unknown ingestion retain epoch/request identity
  and exact row hashes in the incident. They are held unknown, never materialized as successful facts or replayed as
  new Local requests. Awaiting Source bodies remain evidence, not fictional confirmed documents.
- Primary append/finalize during copy or between COMMIT and bind retains exact membership. Only unconsumed witnessed
  spans transfer once; an incomplete old ingestion can be held unknown without disappearing or blocking all takeover.
- Failure before COMMIT leaves no target selected. Lost COMMIT reply or failed bind reconstructs the original receipt,
  incident, capture and target epoch under a new attempt generation. Recovery never repeats authority replacement.
- The old Hindsight epoch is a foreign historical branch. Boot/manual sync/Pending recovery/healthy reentry cannot
  automatically reactivate or merge it. Reconciliation requires separately scoped future work.

## D91 pre-writer gate

- `validateHindsightRestoreCore` reads a stopped immutable Core copy against its sealed manifest and newly read
  restored Native proof. It verifies exact Core size/hash, actual authority marker/receipt, migration head, reviewed
  fingerprint, all actual setup Banks/checkpoints, terminal receipt scope and full application/body closure.
- `missingCredentials` comes from the actual Secret Catalog. Unreadable/locked custody cannot be replaced by a fake
  successful presence callback in the operator harness. Host identity remains catalog AAD; no key portability claim.
- Manifest authority identifies exactly one initial activation transaction or W4 transition receipt.
- Native restore preserves every current `BACKUP_TABLES` row, immutable requests/results/origins/initializations,
  and original trigger modes. Required publication/admission/immutable guards must exist and run in O/A mode;
  absent, disabled or replication-only guards refuse before writer startup. Failed COPY rolls back guards and rows.
- A Native-only rollback, wrong pair/schema/history/receipt, missing body/Bank or credential refuses before workers.
  Supported unfinished effects recover the original native operation/parts/result; never mint a replacement request.
- Task-owned stage/seal tools use genuine `backup.capture`/`backup.admit` through the original operation owner and
  an idle current runtime, without calling `runtime.start`. Preflight is read-only and does not perform replacement.
  All runtime/Native/model counters and original failed attempts remain factual and cumulative within their run.

## Verification requirements

Cover no/hung Native, missing credentials/backup, incomplete/overflow inventory, seal conflict/corruption/storage
failure, seal-before-ACK, ACK-before-candidate, before-COMMIT, lost COMMIT reply, bind failure, unknown writes,
primary finalization, old callbacks, independent process restart and foreign reentry. Use real SQLite close/reopen
and actual operation/runtime producers; label synthetic Native proofs distinctly from owned PostgreSQL tests.
Compare complete captured/installed state before Local startup. Later retention changes require exact producer
receipt, request hash, expiry input and before/after snapshots; never disable the sweeper or excuse unknown deletion.
Real reused corpus and owner/manual acceptance remain separate gates; fixture passes cannot mark them complete.
Also cover cumulative lease renewal, stop/renewal failure/foreign executor, expiry during final read-back, strict
predecessor-policy correspondence and durable corruption, and sealed-failure recovery through the actual Node driver
followed by a distinct restart process. The original unknown operation and incident/capture bytes must remain intact.
Task harness audits are extra synchronous work: yield between independent full audits and the production bind,
checking the same captured live executor before/after the yield. If a 30-second heartbeat became due, require an
observed lease extension before continuing; the harness cannot renew, replace or revive the executor itself.
Committed recovery consumes the exact failed history's prior pre-start installation proof and verifies current
producer-backed retention, rather than expecting post-start rows to equal pre-start rows. Require an explicit
owned history path; bind its bytes, original unknown operation, receipt, target and candidate. Preserve all prior
unknown operation rows and validate their hashes plus the original receipt/history before independent restart
starts any Local writer. Whole-driver bind/settlement plus independent restart must pass an owned-copy real-clock
rehearsal; a publication-only rehearsal does not establish those runtime timing gates.
