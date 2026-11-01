# Hindsight Application State and Runtime

## 1. Scope / Trigger

Use this contract for D77 application-state storage, canonical Hindsight consumption, policy assessment, source
ingestion and B6 runtime lifetime. The accepted design is the B6 task's
[implementation contract](../../tasks/08-09-memory-runtime-integration/research/d77-implementation-contract-2026-09-11.md).
The native producer lives in `H:/hindsight`; Core/Shared live in `H:/TakiAgent`.

This layer consumes an already selected Authority. It does not activate Hindsight, grant a cutover certificate,
perform B7 switch-back/takeover or replace native extraction, observations and mental-model maintenance with Local code.
Existing G1/D78 schemas, receipts, hashes, native clocks and cutover gates remain independent.

Owner sequencing update (2026-09-13): [D79-D83](../../tasks/08-09-memory-runtime-integration/research/memory-capability-followups-2026-09-13.md)
are follow-ups after scoped B6 closeout and existing B7. The temporary blanket observation guard was removed during
the owner-approved closeout. Ordinary observations use their own exact binding, lifecycle and Taki policy gates.
Complete derived propagation stays a documented limitation until D81 is delivered; ordinary policy/field fidelity and
authority integrity are not waived. A direct-unit eligibility result is not a complete dependency-admission proof.

## 2. Entry Points and Storage

| Area | Entry point / responsibility |
| --- | --- |
| Shared wire and JSON | `hindsight-application-*-schema.ts`, `hindsight-application-{json,json-reader,encoding}.ts` |
| Shared consumer results | `hindsight-memory-consumer-schema.ts`; provider-selected lossless validation without changing Local/G1 contracts |
| Policy | `memory-policy-assessment-schema.ts`, `hindsight-application-policy.ts`, `hindsight-policy-{context,assessment,admission}.ts` |
| Transport and proof | `hindsight-application-{client,body-transfer,bundle,bundle-loader,integrity}.ts` |
| SQLite publication | `hindsight-application-replica-repo.ts`; verified bodies/artifacts/heads, projection, FTS, Blocks and paired checkpoints |
| Source and first policy | `hindsight-application-{source-write,source-binding,binding-context,binding-runner}.ts` |
| Application commands | `hindsight-application-command-repo.ts`, command runner and `hindsight-application-writer.ts` |
| Whole foreground writes | `hindsight-memory-write-repo.ts`, `hindsight-memory-writes.ts` and its admission/recovery/result helpers |
| Ingestion and policy work | `hindsight-ingestion.ts`, `hindsight-policy-curator.ts` and their durable repositories |
| Selected runtime | `hindsight-runtime-{connection,state,bank-service,view,consumers}.ts`, `hindsight-memory-{provider,runtime,subsystem}.ts` |
| Boot | `runtime-selector.ts`, `runtime-composition.ts`, `main.ts`; one selected subsystem and one shared Utility Slot |

SQLite migrations are additive: 042 application evidence/projections, 043 source ingestion, 044 application commands,
045 policy work, 046 verified capability evidence, and 047 whole-operation write intents. Historical migrations and
recorded receipt bytes are unchanged. Application projection uses complete BLOB values and iterative codecs; old
B5 native projection hashes and JSON1 limits must not be silently reinterpreted.

## 3. Contracts

### Independent native application state

- Require build `taki-memory-hindsight-0.9.0-d77-v1`, `application_state` version `1.0.0`, and the actual client methods.
  `application_reflect` is a separate capability. A configured endpoint or native reflect method does not prove it.
- Namespace is application `taki` plus provider lineage and Bank generation. Every body, command, receipt, page,
  snapshot and event hash is scoped to the exact namespace and Bank.
- Native revision/cursor and application revision/state cursor are distinct. A policy-only commit never invents a
  native edit. A fresh B5 baseline requires a real authenticated native V1 snapshot at the same native cursor as the
  D77 view. A same-generation application rebuild retains `snapshotId`/`snapshotManifestDigest`; the current
  projection's `manifestDigest` may change when policy changes.
- Artifact kinds are Bank, Source, Memory and Core Block. An original Source is not a native fact; a Block is not a
  fabricated directive or mental model. Preserve original Canonical/source bodies and their native associations.
- New application JSON preserves supported typed values, null/empty, deep containers and inert own keys. It uses
  `taki-application-state/tagged-json-binary64-v1`; native payload witnesses retain the frozen native codec. Byte
  checksums and scoped semantic hashes are separate. Reject duplicate JSON keys, cycles, accessors and non-finite numbers.
- Decoded parts are at most 256 KiB; ordinary HTTP responses at most 512 KiB. Command preparation covers the complete
  unique direct body closure and has a separate 16 MiB ceiling. Refuse unsupported input before native dispatch;
  do not truncate a successful record or redefine Canonical validity around an old envelope.
- All changes use native/artifact CAS and immutable operation receipts. Exact replay returns the historical receipt.
  Native commits reject duplicate exclusive native targets in one batch; independent Sources may share a document.
  Retirement must address its own binding, with no unrelated or extra native CAS. Historical assessment remains tied
  to its historical artifact during retirement; current native CAS does not invent a reassessment.
- Snapshots and hydration contain complete artifact history/source closure. Native hydration returns only explicitly
  selected native heads: candidate recall requests a Bank selector and at most 255 Memory selectors per batch.
- A bounded multi-page Bank synchronization owns one absolute run deadline. Foreground Recall and the Bank sync needed
  for Run admission instead wait for completion or caller/runtime cancellation, with no implicit business timer.
  Their request callback rechecks the current lease, authority and cancellation before every snapshot/event page,
  body descriptor and body part, and caps each HTTP call separately. Nested readers and candidate hydration must
  retain that callback rather than spending one HTTP timeout across the whole operation. Standalone reads without
  an owner callback retain one finite deadline for their complete closure. No partial download publishes a checkpoint,
  and a retry cannot reset an explicit or bounded operation deadline.
- Foreground synchronization may CAS-renew only the same live lease: Bank, run, owner, fence and old expiration must
  match, and the lease must not have expired. Renewal changes expiration alone. Cache and publication guards read the
  current lease while retaining the originally captured Authority, namespace and expected predecessor checkpoint.
  Scheduled, write, recovery and explicitly bounded operations never renew past their original deadline.
- Independent immutable body reads run with bounded concurrency (at most eight bodies). Descriptor identities are
  deduplicated before dispatch; conflicting refs are integrity failures. A failed body cancels and drains its batch
  before lease release or database shutdown, preserves the first error, and never publishes a partial closure.
- Completed, individually verified body bytes may be cached under the exact namespace and descriptor before a full
  snapshot completes. Cache reads/writes retain the current lease, Authority, Bank and predecessor-checkpoint guards.
  They write no artifacts, native heads, consumer projections or checkpoints; normal reads still require published
  state. A later bounded run reuses the bytes after validation, including across SQLite reopen. A different generation
  cannot reuse the old namespace's cache. This prevents cold reads from repeatedly discarding the same valid progress.
- Source-candidate queries filter their verified artifact envelopes by document/binding kind before loading body
  closure. Exact source association still validates every selected body/reference. Unrelated Source bodies must not
  be decoded again for every memory binding; the awaiting-source pass requests only awaiting bindings.
- The binding runner selects native kind before candidate body validation and reads one candidate for its one-command
  publication step. Looking for remaining documents must not rescan every unbound memory on every iteration.
- Native publication, binding work and native mutations share the original transaction. Bank deletion closes a
  generation while preserving historical source evidence and receipts. All application tables belong to native backup.

### Policy, admission and original evidence

- Known policy applies immediately when its exact native binding is verified. New verified valid units may receive a
  durable neutral policy: unclassified, retrieved, importance 5, permanent, no disclosure or emotional weight, and
  assessment due. Detailed model assessment is not a prerequisite for recall or factual Pending confirmation.
- Neutral is an explicit first policy, not permission to erase hidden, pinned, mood, retention or ownership decisions.
  Rebinding preserves restrictions and original evidence. Corrupt/unavailable state is never authenticated absence.
- Ordinary observations are admitted by the same own-record policy/lifecycle rules as world and experience facts.
  Neutral/curated/assessed policy and declared source IDs do not prove every input used to generate a derived body.
  Taki hidden/expiry changes do not yet guarantee removal or regeneration of every derivative; D81 records this known
  limitation. Neither a visible source subset nor D78 cutover proof is represented as complete runtime input proof.
- The native Reflect gate enforces the addressed record's current policy before reranking, tool output and every
  subsequent model/cache submission. Core's shared gate covers healthy hydration, verified replica fallback, prompt
  rows and curator inputs. Whole-source, profile/directive and unsupported opaque-input restrictions remain intact.
  Ordinary native Recall retrieves candidates before Core hydration and does not acquire guarded Reflect's pre-reranker
  policy contract. Native callers without the guard retain native semantics.
- `due` and `failed` are usable with valid current policy. `not_required` carries no invented model attempt/prompt;
  `assessed` and failures retain actual attempt, prompt hash, completion or retry evidence.
- Registry policy requires sufficient trusted per-unit labels and matching Bank ownership. A source-wide label does
  not assign every extracted fact's policy. A bare relationship tag cannot create a deliberate pin.
- Basic scope, lifecycle, hidden, retention, mood and ingress checks precede consumption and final limits. Candidate
  fields must match the exact hydrated native state; stale candidates are omitted explicitly, never relabeled.
  Mood-gated records with null, empty or whitespace-only disclosure are rejected consistently by Core and native
  guarded Reflect; a missing trigger is not a match. Preserve the existing nonempty keyword matching behavior.
- During an outage, a new Run refuses if a still-valid, unexpired known required pin needs rebinding. Do not silently
  omit it, render its old text or render an unbound replacement. Invalidated, deleted and expired units do not block.
- A valid, bound, eligible pinned observation remains available to prompt capture. Fact type alone does not refuse
  the Run. The required-pin rebinding refusal above remains independent of the removed observation experiment.
- New provider-origin objects have truthful provider-derived provenance and null conversation bounds where appropriate.
  Preserve original Source text/metadata independently. Native document edits must not reuse old provenance merely
  because an operation ID or document ID matches.
- Preserve a Source artifact before dispatching its native retain. Binding the original witness requires exact G1
  operation/namespace/request proof plus document content-hash and original-text evidence. Unknown witnesses remain null.

### Durable foreground writes and degraded reads

- Whole-operation journal 047 owns the immutable original request, actor, captured mutation target, native child,
  application command and terminal result. Parent/native/source preparation is one SQLite transaction before I/O.
- Same request identity reuses the original target, time and child. A changed request/actor is a conflict. Preserve all
  factual references, including results larger than 256; model previews do not truncate the actual execution result.
- Pure layer changes have no native child. Compound text/layer writes retain independent native and application proof.
  Native G1 completion alone cannot complete the parent while its policy effect is still awaiting local publication.
- After an application ACK, completion compares the exact policy the saved command wrote, not only layer ID. A newer
  restriction or native revision yields superseded; assessment-only evidence changes with the same policy remain valid.
- G1 does not prove a historical document revision. The completed retain stores the source revision actually observed
  at its confirming application checkpoint. The saved result is stable on replay; no predicted revision 1 is fabricated.
- Pending retain source and mutation intent use the separate typed overlay. They never become fake Canonical facts.
  Display dedupe has no authority to complete or retire durable work. Eligibility uses the exact current target policy.
- Availability fallback stays under Hindsight Authority and uses verified replica/FTS plus truthful Pending overlays.
  Integrity errors do not become fallback. B5 normalizes some diagnostics to plain `Error`; match the same closed
  availability code set after normalization so an ACK-loss intent remains pending rather than becoming an internal error.
- Guarded Reflect owns a separate 300,000 ms operation allowance shared by synchronization, admission, policy upload
  and generation. Each stage receives only the remaining allowance; caller/runtime cancellation still applies. Its
  explicit completion-token budget is preserved. Model descriptions must explain that some providers spend that budget
  on internal reasoning as well as final text, so a small allowance can return no completed answer despite model usage.

### Ingestion, curator and lifetime

- Source-dependent C4 initiative keeps the original primary witness and exact confirmed ingestion Source/Bank/epoch
  chain. Whole-write retain completion now optionally stores bounded immutable native Source/unit heads and exact
  policy baselines; ingestion acknowledgment reuses that original completion evidence. A formerly Pending source may
  use its exact recovered parent receipt, never a newly observed policy baseline. Historical receipts without these
  bindings remain unavailable; no replay, backfill, expiry renewal or authority promotion is implied.
- Selected-topic recall consumes the original captured tool once per applicable Bank and retains exact current
  native heads, bound artifacts, direct Source original witness and unit policy. Known edits, deletion, hidden/expiry,
  namespace/route drift and unbound evidence close dependent output. Verified replica fallback keeps Hindsight and
  truthful partial/degraded status. Remote changes cannot be known before verified synchronization.
- C4 omits record bodies without an available direct Source or with an unsupported derived-input closure; the model
  receives a bounded partial result. This conservative consumer restriction does not change ordinary Recall or
  represent a solution to D81's provider-wide opaque-derived exclusion problem.

- Hindsight ingestion consumes exact committed Primary source witnesses, one eligibility/ownership gate and the existing
  20-message cadence. It does not perform Local fact extraction. Persist stable per-Bank requests before asynchronous work.
- Primary Timeline capture uses the shared provider-independent source lifecycle described in
  [Canonical Local Memory Runtime](canonical-local-memory-runtime.md). Import retained sources from local authority
  identity without provider/capability I/O, reuse existing Hindsight witnesses, and isolate unresolved gaps from later groups.
- Explicit ingestion coverage requires complete confirmed or actual durable Pending source coverage in every selected Bank.
  A queued promise, guessed timeline interval or one successful Bank is insufficient. Late witnesses remain recoverable.
- Context compaction runs independently of ingestion/curation and preserves raw Timeline and pending source state.
  Its summary retains salient facts even while extraction is delayed; continuous ingestion coverage never skips a hole.
- The curator is limited to Taki policy and authorized Block work, with separate Global/Character model inputs. Keep
  user-card ownership, filter hidden/expired/ineligible-mood input before each submission, and persist claims, prompts,
  results, command identities and retries. Restart resumes saved proposals without rerunning a completed model call.
- An interrupted policy attempt with a saved prompt but no saved result first publishes its truthful failed assessment.
  The old journal item can complete while the current policy remains failed/retryable; its new artifact enters the
  ordinary due queue. A pass with `status=failed` may still have real applied edits. Report recovered work, applied
  assessments and eventual target completion separately, using actual current artifact and journal evidence.
- Policy knobs are read from ConfigSource per pass: `TAKI_HINDSIGHT_POLICY_TIMEOUT_MS` defaults to 60000;
  `TAKI_HINDSIGHT_POLICY_PROMPT` defaults to an empty additive instruction. Additional text does not replace safety rules.
- B5 retains scheduling/backoff/leases. Direct calls serialize per Bank; a cancelled queued waiter does not release its
  predecessor's serialization barrier or acquire a later lease. Foreground queue wait observes cancellation; explicitly
  bounded queue wait also observes its original deadline. Generation-reset retries retain the owning mode, captured
  authority/checkpoint and lease fence rather than creating a fresh lifetime.
- Run capture carries caller cancellation and any explicit trigger deadline through runtime composition and both Bank
  synchronizations. Recheck cancellation before exposing the captured result. Without verified capability evidence,
  failed pre-synchronization must refuse admission using the actual failure; it must not start an unowned cold retry.
  Existing verified capability evidence remains usable for the documented outage/replica behavior.
- The client settles caller/runtime cancellation even when an injected transport ignores its signal, preserves the
  first cancellation/timeout classification and contains late success/rejection. Local settlement never proves a
  dispatched remote write was cancelled; unknown outcomes retain the existing durable Pending/recovery semantics.
- Shutdown first refuses new work, cancels owned operations and waits for ingestion, curator, application commands,
  Pending/parent writes, sync and provider calls. It also drains complete captured tool/automatic-recall/admission
  promises before SQLite closes. Held consumers must refuse before entering the coordinator after stop.
- Foreground lifetime wrappers preserve frozen tool schemas and every non-enumerable Effect metadata descriptor.
  Authority/configuration errors keep the original structured consumer behavior; lifetime wrappers govern stop only.
- Legacy/Local selection does not construct or contact Hindsight. Hindsight selection cannot fall back to Legacy.
  Main builds the secret/config context before memory construction and waits for memory stop before closing SQLite.

## 4. Validation / Error Matrix

| Condition | Required behavior |
| --- | --- |
| Missing D77 capability / unsupported guarded reflect | Explicit refusal; never call unguarded reflect as fallback |
| Native or application CAS failure | Durable refusal, no partial command effects |
| Corrupt body/page/hash/namespace | Refuse publication; checkpoint remains unchanged |
| Replay floor reset | Verified complete snapshot; no fabricated native baseline identifiers |
| Lease/epoch/connection change during download | Refuse before SQLite publication or native dispatch |
| Lost native/application ACK | Reuse original operation IDs and receipts; no model or native duplicate |
| Newer policy after the original command | Superseded unless the full requested policy and exact native binding still match |
| Unavailable known pin binding | Refuse new Run; preserve durable data for retry |
| Queued timeout/abort | Settle the waiter without acquiring a later lease or touching SQLite |
| Stop while a captured read is active | Settle the complete consumer; no later DB access |
| Foreground read exceeds one HTTP allowance across multiple requests | Complete if each request progresses; keep renewing only the same live lease |
| One HTTP request exceeds its allowance | Preserve the actual timeout/degraded result; no unbounded transport wait |
| Cancelled cold admission without verified capability evidence | No extra cold request, late admission write or returned capture |
| Ordinary observation has a verified binding and eligible own policy | Admit it to the relevant consumer, including a required pinned prompt row |
| Observation itself is hidden, invalidated or expired | Exclude its body under the same direct-unit rules as other native facts |
| A source becomes hidden after a summary was generated | D81 known limitation; do not claim complete propagated exclusion or a passing hidden-content acceptance |

## 5. Good / Base / Bad Cases

- Good: a newly extracted unit receives verified neutral policy, is recalled immediately, and is classified later under
  a durable review claim. The original source, native version and model assessment remain separate facts.
- Base: a policy-only change advances application state and FTS while keeping native content/cursor unchanged.
- Bad: recovering missing original text from a similar native document, making G1 completion mean policy completion,
  using an old pin while its new native revision lacks binding, or dropping Effect metadata while wrapping a tool.

## 6. Required Tests and Operational Checks

- SQLite transactions, commit failure, CAS, reopen, old migration lineage, namespace changes and paired publication.
- Full source/record/metadata body round-trip, cross-language hashes, parts, corruption, limits and original closure.
- Actual native HTTP/PostgreSQL through the assembled Core provider: neutral/hidden admission, guarded reflection,
  ACK loss/restart, layer/compound writes, both Banks, Core Blocks and provider-only reconstruction into new SQLite.
- Deterministic native model/reranker/cache spies verify actual input exclusion. They do not prove model classification
  quality or real-model operational acceptance.
- Captured tools/automatic recall, capability and route drift, source flush, stop/queue/held-reference behavior, live knobs.
- Default per-request configuration across long foreground sync/Recall, renewable lease CAS and immutable predecessor
  guards; explicit Run deadline and caller/runtime cancellation; abort-ignoring transport and cancelled cold admission.
- Visible neutral/assessed observations in healthy/fallback Recall, automatic recall, pinned/intentions prompt and
  curator inputs; own-hidden/invalidated/expired observations excluded. Native reranker/model/cache positive and negative
  checks preserve direct-unit admission. Keep the actual D81 hidden-derived-content failure as separate unresolved evidence.
- Canonical OpenAPI and all pinned SDK generators; repeated output parity; original public schema/wrapper preservation.
- Workspace typecheck, root lint and tests, scoped native checks and real Node strip-only Core startup. Record unrelated
  platform/baseline failures separately; do not claim a failed whole-repository command is green.

## 7. Deployment and Rollback Boundary

Deploy compatible native D77 code/migration and generated contracts before selecting this runtime. Existing B3 endpoint,
secret and verified Bank bindings remain authoritative. These code changes do not themselves authorize activation.
Core applies 042-047 on its normal migration path. Preserve backups and original receipt bytes; a nonempty native D77
downgrade refuses rather than dropping evidence. No destructive rollback, Authority switch or B7 operation is implied.
