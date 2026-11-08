# Current-State Transfer and First-Activation Proof

## 1. Scope / Trigger

Use this contract for D78 current Local import, native maintenance verification, B4 raw replica staging and the
actual readiness/promotion guards. It extends [current Local coverage](./memory-local-cutover-coverage.md), preserves
[G1 routine recovery](./memory-native-result-recovery.md), and does not establish B6 runtime or healthy-return support.
The provider implementation and maintenance inventory live in `H:/hindsight/TAKI_PATCHES.md`, patch `TAKI-HS-010`.

Three proofs remain distinct: a complete current Local capture, a committed structured native transfer, and complete
finite native maintenance bound to an immutable snapshot. None can be replaced by an old B2 receipt or a queue count.

The shared tagged codec retains unsigned UTF-8 key ordering without normalization. After rejecting unpaired
surrogates, scalar-value comparison is byte-order equivalent and avoids repeated `TextEncoder` allocation during
sort. Do not replace it with UTF-16/default string ordering. Preserve the fixed Python fixture hash, scalar boundary
and invalid-surrogate tests, and byte-for-byte retained-document comparisons when changing this integrity primitive.

## 2. Signatures

| Entry | Responsibility |
| --- | --- |
| `captureHindsightCurrentLocal(db, {lease, manifestId, expectedEpochId, now})` | Reserve the Local writer; capture every selected manifest payload and disposition once. |
| `fetchHindsightCurrentBaseline({bankId, ttlSeconds, client, context})` | Read complete native snapshot pages for the exact target Bank. |
| `prepareHindsightCurrentBank(db, {...captureInput, sourceBankId, providerLineage, bankGeneration, baseline, supersede?})` | Verify actual B3 scope/template/binding and freeze one transfer request or explicit gaps. |
| `importHindsightCurrentBank({db, preparationId, client, context})` | Read historical result first; submit only if absent; verify and persist all mappings. |
| `verifyHindsightCurrentBank({db, preparationId, lease, verificationId, replicaEpochId, client, context, now})` | Prepare/resume the finite candidate, verify complete evidence/snapshot pages, and publish raw replica/checkpoint atomically. |
| `requireHindsightCurrentCutover(db, {manifest, now?})` | Require exact current capture, imported Bank set, certificate, raw rows and checkpoint in the existing B4 guard. |
| `requireHindsightCurrentNativeState(db, {preparationId, candidateId?})` | Reject a previously observed authenticated native invalidation after restart. |

Native routes are under `/ext/taki-memory/banks/{bank_id}`: `POST /current-state-transfers`, historical
`GET /current-state-transfers/{operation_id}` and its `/mappings/{page_number}` suffix; `POST /cutover-verifications`,
`POST /cutover-verifications/{verification_id}/verify`, historical `GET /cutover-verifications/{verification_id}`
and `/certificates/{certificate_hash}/pages/{page_number}`. Historical requests include native lineage/generation.
Advance uses `expected_revision` CAS. Read the source schemas for the exact versioned snake_case fields.

Migration 039 owns `hindsight_current_captures`, `hindsight_current_preparations`, `hindsight_current_import_evidence`,
`hindsight_current_verification_candidates`, `hindsight_current_verification_evidence` and
`hindsight_current_native_invalidations`. They are independent evidence, not B2 history or disposable replica caches.
UPDATE, DELETE and replacement through every unique key refuse immutable evidence; lease/selection remains separate.

## 3. Contracts

### Capture and transfer

The capture preserves typed Bank/source/unit/policy/provenance/lineage/derived/Block payloads and gives every manifest
witness one explicit `native-object` or `taki-artifact` disposition. Policies and Blocks are retained artifacts, not
facts sent for extraction. Current B2-converted units use their current Canonical version. Old B2/source-evidence-v1
payloads and G1 frozen commands/hashes are unchanged.

Each Bank request binds `operation_id`, `request_hash`, `local_manifest_digest`, the source Bank witness, target
Bank revision/payload hash, verified B3 `preserve` resources, native lineage/generation and the complete structured
record set. Source identity/revision/hash is distinct from target identity/revision/hash. Native entity values are
canonical names. An actual chunk ID requires supplied chunk evidence. Source text null, empty text and original
declared source hash remain distinguishable; native content hash describes actual retained text.

Native admission holds the Bank writer lock and requires exactly the Bank, preserved controls and any explicitly
receipt-proven supersession set. Unknown targets, changed baselines or accepted unresolved work refuse admission.
The bounded v1 Bank import is atomic: at most 10,000 records and 16 MiB; no silent truncation or extraction fallback.
New native IDs, final live/archive lifecycle, source links, indexes, logical journal and immutable mappings commit
together. Historical result replay performs no write, even if the Bank has since been deleted.

The new protocol uses `taki-current-state/tagged-json-binary64-v1`: tagged JSON values, unsigned UTF-8 object-key
order, finite binary64 big-endian hexadecimal numbers and normalized zero. Lone surrogates and invalid JSON values
are refused. Typed JSON metadata preserves numbers/strings/booleans/null/arrays/objects through native recall.
Old G1 and snapshot hash encodings are not changed to obtain this property.

### Native maintenance and snapshot

The provider enumerates all required source/revision/resolved-scope and model definitions, including a B3 model in
an otherwise empty Bank. It records actual native inputs, action/no-op/failure outcomes and same-transaction receipts.
Partial actions survive interruption; a later attempt validates history and inputs before resuming. Queue/task state,
`consolidated_at`, zero counts, timestamps or a caller-supplied reduced set cannot prove completion.

Model proof separates definition, authored content, tracking/policy, eligible/retrieved/consumed inputs, lifecycle,
actual prompt and persisted outcome. Real reflect assembly and final delta truncation supply consumption witnesses;
diagnostic `based_on`/tool traces do not. First activation uses the complete current set with no lower or upper created
time bound. Missing model definition/lifecycle coverage, stale inputs, failed or skipped required delta operations
remain incomplete. Native irrelevant/no-op outcomes require actual native evidence.

The certificate binds the exact transfer identity/result, Local manifest, candidate/required-set/policy hashes,
complete ordered evidence stream and the native logical snapshot. `snapshot_records_hash` additionally hashes the
entire ordered native snapshot record sequence with the new tagged encoding. Its pages are retained by the same
sealing transaction. Taki validates all identities/counts/ordinals/page hashes/record hashes and cross references.
Only a fully validated certificate permits the retained-snapshot expiry branch; a boolean alone cannot do so.

A certificate proves its historical snapshot boundary. It does not make native state permanently immutable. Prepare
or resumed verification rejects known current generation/relevant state drift; authenticated definite refusals or
matching stale candidate status become independent immutable invalidation observations. Network failure, timeout,
503 and malformed responses do not assert drift. Candidate-scoped observations do not invalidate an unrelated new
candidate; preparation-scoped namespace/source/policy invalidation prevents reusing that frozen command.

### Ordinary native maintenance coordination

The real-data correction requires a finite, durable Bank maintenance owner acquired atomically with structured
import. Native finite work and ordinary scheduling/admission/worker/producer writes share the existing Bank writer
boundary. An admitted Local manifest cohort may renew only matching valid waiting owners; it cannot authorize
cross-Bank proof writes. Expired or replaced tokens cannot publish late actions or certificates. A retryable
incomplete candidate has a bounded renewal window, and lease loss alone must not be recorded as source drift.
Do not disable ordinary auto-consolidation, fabricate `consolidated_at`, discard pending work or weaken the accepted-work
gate. Completed genuine native work must perform its real source-completion bookkeeping before ordinary scheduling
resumes. Fully proven explicit supersession can atomically replace ownership; failed supersession preserves the old
owner. A normal Broker/MaintenanceLoop/WorkerPoller barrier regression is required alongside finite-proof tests.

### Actual B4 consumption

Publish complete normalized native `payload.value` records through `hindsight-replica-repo`, with certificate and
checkpoint in the same SQLite writer transaction. Older certificates cannot overwrite newer checkpoint cursors.
The same validated evidence may rebuild missing raw rows/checkpoints. Evidence survives raw replica deletion.

The actual `markReady`, `verify` and authority promotion path requires this evidence for every bound Bank, including
empty Banks, and reserves the Local writer before final epoch/fence/digest checks. Known invalidation is checked
again after restart. Status counts derive from persisted selected evidence; unavailable/corrupt state is `null`.

Raw staging is not B5 `HindsightReplicaProjection`. Do not invent Taki importance, visibility or retention policy for
new native observations. D77 field rebinding/provider-only recovery, B6 projection/runtime, B7 and live/manual
acceptance retain their own gates. No new environment key, default model, automatic schedule or permission is needed.

## 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Missing/stale selected Local capture, lease or epoch | Existing coverage/lease refusal; preserve Local authority. |
| Missing chunk/source, unsupported model subtype, bounds or native value | Persist original evidence with explicit preparation gaps; do not submit partial Bank state. |
| Unknown target, changed B3 baseline, pending accepted native work | Native `target_conflict`/`ownership_drift`; no import/index/journal/mapping writes. |
| Lost import response after commit | Read the original operation/result/pages; no second extraction or write. |
| Wrong namespace, request/result hash, missing/duplicate mapping or payload drift | Refuse import evidence; no partial persistence. |
| Missing source/scope/model outcome, failed partial action, stale input or missing history | Typed incomplete/stale native status; no certificate. |
| Missing/forged certificate or inconsistent evidence/snapshot binding | No evidence or raw checkpoint publication. |
| Confirmed native drift after a previously complete certificate | Persist an immutable invalidation observation; actual guards reject after reopen. |
| Network/503/timeout/parse failure | Operational failure; do not fabricate a drift observation. |
| Higher raw checkpoint cursor already exists | Refuse old certificate publication; preserve newer rows/checkpoint. |
| Local writer changes state after certificate | Final current-state guard refuses readiness/promotion. |

## 5. Good / Base / Bad Cases

- Good: an edited B2 unit with unchanged source revision and nullable source text imports as its current structured
  version; the original source evidence and native actual content hash remain separate.
- Base: responses are lost after import and after certificate sealing; reopen retrieves the same identities, complete
  pages and snapshot, then stages them atomically without rerunning committed work.
- Bad: accept a B2 receipt for a new Local version, clear observations to obtain a no-op, infer model completion from
  timestamps, treat an empty Bank as implicitly complete, or activate using a known invalidated certificate.

## 6. Tests Required

- Cross-language golden hashes for numbers, nested JSON, Unicode/UTF-8 key order and negative zero; old G1 bytes stay
  fixed. Verify actual native recall/HTTP/model facts, not only DTO construction.
- Full null/empty/lifecycle/source-link/chunk/entity/derived preservation, rollback after journal/receipt, exact replay,
  concurrency, full owned supersession, paging/tamper, deleted Bank history and pending native work refusal.
- Actual native consolidation/model calls with complete required sets, authored model baseline, irrelevant/no-op,
  failures/partial recovery, attempt CAS, ABA/pruning, lifecycle, policy/definition/time and final snapshot equality.
- Real SQLite capture/dispositions/import/certificate/raw staging, two writers, reopen, known drift persistence,
  independent candidates, no fake invalidation on network errors, newer checkpoint refusal and same-evidence rebuild.
- Owned native PostgreSQL + HTTP + Taki SQLite for global and empty character Banks, two lost-ACK restarts, B3
  controls, typed metadata, unchanged B2 history and positive readiness followed by a real stale Local refusal.
- Fresh and both 035 histories through 039; native migration/backup/dialect/auth; canonical OpenAPI and all generated
  clients with scoped offline builds, repeat generation, type/lint/tests and strip-only Core startup.

## 7. Wrong vs Correct

```ts
// Wrong: these observations say nothing about exact current maintenance inputs or a sealed result.
if (oldB2Count === nativeFactCount && pendingTasks === 0) markReady();

// Correct: the repositories persist and validate the actual native evidence before B4's final guard.
const prepared = prepareHindsightCurrentBank(db, input);
if (!prepared.request) return prepared.gaps;
await importHindsightCurrentBank({ db, preparationId: prepared.preparationId, client, context });
const verified = await verifyHindsightCurrentBank({
  db, preparationId: prepared.preparationId, lease, verificationId, replicaEpochId, client, context, now,
});
// A complete certificate is necessary. Existing final Local/current/native evidence guards still apply.
if (verified.evidence === null) return verified.status;
```
