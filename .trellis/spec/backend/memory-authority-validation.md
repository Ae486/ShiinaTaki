# Current Memory Authority and Full Validation

## 1. Scope / Trigger

Use this contract for current Local/Hindsight identity checks, full selected-authority verification, runtime
construction/rebinding, unavailable diagnostics and recovery. It supersedes the former requirement to reconstruct
complete transition history on every ordinary connection check. The 2026-11-06 owner-authorized correction separates
these responsibilities; it does not weaken data identity, policy, write fencing or recovery-source validation.

## 2. Signatures

- `readCurrentMemoryAuthorityIdentity(db): MemoryAuthorityIdentity` reads current control identity only.
  It structurally extends `MemoryAuthoritySelection` with the active provider and lineage; it is not a full-proof result.
- `readMemoryAuthoritySelection(db, verification?)` and `readVerifiedTransitionPublication(db, receiptId, verification?)`
  retain their existing pure validation contracts for independent DB/copy consumers. Initial Local receipt validation
  is explicit, as described below; a marker-only Local result is not a complete receipt proof.
- The existing composed runtime exposes `verifySelectedAuthority(verification?)` and
  `verifyTransitionPublication(receiptId, verification?)` to live producer owners. These add matching-bound-identity
  failure handling around the full readers. Selected initial Local authority also invokes the existing
  `verifyCanonicalLocalReceipt` in that same owner boundary; its proof algorithm is unchanged. Do not broaden the
  pure marker reader globally or repeat this receipt check at each former caller.

## 3. Contracts

### Current identity and data guards

The stable identity comprises mode, epoch, initial snapshot/activation transaction or transition receipt,
provider lineage, saved checkpoint digest, and the canonical active provider/lineage. `updated_at` is not identity.
Compare fields directly; optional receipt absence is normalized consistently. No TTL, hash of the entire history,
global cache or remembered permission verdict is needed.

Validate the marker's actual shape and active canonical row. Legacy has no selected authority fields but can coexist
with a prepared canonical epoch. Initial Local requires snapshot/transaction and has null marker lineage/digest;
its active Local epoch still has a lineage. Initial Hindsight requires transaction/lineage/digest and no snapshot.
Transition markers require receipt/epoch/lineage/digest and no initial snapshot/transaction. Hindsight and transition
lineage must match the active epoch. A changed field invalidates a previously bound runtime even if epoch is unchanged.

Connection construction performs independent full validation, including direct private template-execution
construction. Transition target readiness remains required. Ordinary guards then reread current identity plus the
original connection/secret/template/Bank/cancellation checks. Actual data reads and writes retain body/head/artifact,
policy/scope/version, checkpoint pairing and CAS validation.

The 2026-11-08 template extension follows the same split. Construction captures the unchanged full
`readTemplateSelectionIdentity`; ordinary connection evidence guards compare
`readCurrentRuntimeTemplateIdentity` against that value. The current reader inspects eligible verified setup,
paired checkpoint namespace/epoch/deletion, exact enrollment, applied selection and selected-lineage defaults.
It preserves the existing aggregate hash and null/legacy semantics, omitting mutable cursors, legacy route inventory
and unapplied user/catalog changes. No guard result is cached across calls and shared Bank-scope guards remain in place.

Template document-body corruption with unchanged current metadata is discovered by the next full validation:
construction, publication, recovery or an actual template-consuming read. Ordinary guards do not revalidate stored
document hashes, receipt/snapshot proofs or historical previews. One current-data check remains: migration 058 has
no separate projection-digest column, so the reader extracts the selected definition projection and checks its
digest against setup. Corruption of that consumed projection still refuses immediately; unrelated document-body
corruption is deferred. This is a detection-timing change, not permission to consume unverified template data.

Keyed Hindsight capability evidence reuse does not cache current Authority/data permission or replace full-proof
boundaries. Ordinary sync still observes the live authenticated manifest and rechecks current connection, epoch and
cancellation around awaited admission work; historical capability evidence alone cannot admit an online operation.

Local ordinary entrypoints reuse their existing epoch/provider and write-fence boundaries with the published
binding's full current tuple. Construction may use the still-alive draft before that binding has an identity;
withdrawn/replaced instances remain fenced. A prepared standalone Local runtime is not a published authority.
The shared transition queue checks the supplied current-authority assertion after awaited capability resolution and
immediately before durable admission. Local and Hindsight compositions both supply it; a post-result check cannot
undo an already queued stale command.

Preserve transition checkpoint floors using only small, fully verified per-Bank namespace/native/application cursor
metadata captured at construction. Current checkpoint consumption must reject coherent rollback below those floors;
it must not reconstruct historical candidates to make that comparison. Legitimate advancement remains allowed.

Historical-only document corruption is discovered at full-validation boundaries, rather than every unrelated
ordinary operation. Current consumed-data corruption is still rejected immediately. This detection-timing tradeoff
must remain explicit in tests and delivery evidence.

### Full verification and known-invalid bindings

Full proof remains required for construction/bind/recovery, source/publication proof, atomic COMMIT/readback and
verified backup/restore. Live owner entrypoints use the runtime's explicit full-verification methods when validation
can concern the currently bound authority. Identity-only routing/status/eligibility/epoch stamping uses the current reader.

On a selected-proof failure, withdraw the matching published binding and record an explicit unavailable state through
its existing owner. Compare the identity/receipt that was actually validated with the identity bound at publication.
A foreign historical receipt, stale request, invalid uncommitted target or configuration/transport error must not
withdraw a healthy current binding merely because an error code looks similar. A failed target COMMIT/readback rolls
back without retiring the valid predecessor. Do not infer binding identity from a temporary marker inside that transaction.

Full-reader failure is handled by this explicit validation boundary, not a list of selected error codes. Context and
current identity are checked before entering it, and the original failure is rethrown. A durably selected target with
no published binding is also marked `authority_invalid` when its own complete proof fails; a different predecessor
binding is not withdrawn. Pure target COMMIT/readback never calls the live failure callback.

Pure DB readers have no hidden callbacks or writes. Copied/offline backup verification never carries a live-binding
invalidation callback. Existing producer factories receive explicit narrow verification ports; caught/converted errors
inside a producer must not hide a known selected-proof failure from the binding owner.

### Diagnosis and recovery

For a coherent current identity whose historical proof fails, Core must retain its control/diagnostic service while
memory data operations remain unavailable. Include full proof inside the controlled boot failure boundary, before any
provider factory/start. Do not construct Legacy/Local fallback, dispatch memory work or report a healthy runtime.
Expose `authority_invalid` as the runtime unavailable reason. It takes precedence over template-hold/configuration
degradation; a known-invalid authority cannot create an ordinary memory-unavailable Run.

Current checkpoint/replica observation failures report `evidence_invalid`, distinct from owner-detected full-authority
proof failure. Status reads do not retire bindings or erase valid template identity on this evidence failure. Changed
current identity remains `authority_mismatch`. Explain that local memory evidence requires validation/recovery without
claiming every failure can be rebuilt online.
The connection observation establishes current authority/configuration/hold state first; its composed evidence
projection validates current template selection and checkpoint floors before reading scheduler/Pending evidence.
Ordinary data connection guards retain both checks. Proven template identity change clears the bound status projection;
unreadable template/checkpoint evidence retains the already published identity as a fact, without granting data access.

Status combines current control identity with actual binding/failure state; it does not prove history on every poll.
Keep operation history, configuration and supported backup inventory readable. Settlement-capable operations queries
remain outside the read-only status snapshot. Malformed/missing identity or unreadable database is an explicit failure;
do not invent a known provider to fit the existing status schema.

Existing receipt-based binding recovery repairs interrupted construction of the same committed epoch. Existing
command/scheduler recovery resumes the original operation under a fresh valid owner and checks its receipt. Damaged
authority/history may require verified offline paired restore; emergency takeover is not a generic bypass for bad proof.

## 4. Validation and Error Matrix

| Condition | Result |
| --- | --- |
| Stable identity, current valid data | Ordinary work proceeds without historical candidate reconstruction |
| Any bound marker field/active provider/lineage changes | Old runtime refuses |
| Current body/head/policy/checkpoint corrupt or below saved floor | Consuming operation refuses; no fabricated empty result |
| Status cannot verify current checkpoint/replica evidence | `evidence_invalid`; no read-side binding retirement or false template-unbound state |
| Historical-only evidence changed after binding | Next full boundary detects it; ordinary guard does not claim to inspect it |
| Full verification of the bound identity fails | Matching binding withdrawn; status reports `authority_invalid` |
| Old receipt, copy or new target proof fails | Current healthy binding remains; new target writes roll back |
| Boot identity coherent, full proof fails | Control plane available; no memory provider construction or false fallback |
| Lost ACK / expired old owner | Original durable outcome retained; new owner resolves original receipt, no duplicate write |

## 5. Good / Base / Bad Cases

- Good: repeated ordinary reads check current identity/data; a complete rebind separately reconstructs proof.
- Base: an initial B4 connection verifies its activation receipts once at construction and retains live config/secret guards.
- Bad: a read-only status error leaves an explicitly invalid old binding serving writes, or a corrupt unrelated backup
  copy withdraws the live runtime. Both confuse validation scope with current ownership.

## 6. Required Tests

- Real B4/repeated-REENTRY/private-template construction and current-guard call boundaries; all stable identity fields.
- Legitimate checkpoint advancement, coherent rollback floor, actual consumed body/head/checkpoint corruption.
- Known current-proof failure through internally caught preview/recovery paths withdraws old references; foreign
  receipt/copy and failed uncommitted target do not. Full readers remain independent and pure.
- Coherent-identity/bad-proof Core boot responds to diagnosis without data runtime; intact-evidence bind interruption
  recovers the same epoch and ordinary retain/recall succeeds.
- Lost ACK/new owner/restart recovery preserves the original request and applies once; normal shutdown settles work.
- Current copied-instance recall and complete connected recovery journey under unchanged deadlines. Fixture passes
  and faster admission alone do not establish usability or original-user-data acceptance.

## 7. Wrong vs Correct

Wrong: treat `readMemoryAuthoritySelection()` as a cheap mode getter, or hide repeated full work behind another cache.

Correct: use the explicitly current-only identity reader for routing, use full verification at proof boundaries,
and let the existing binding owner handle failure of its own bound identity.
