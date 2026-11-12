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
| Source and first policy | `hindsight-application-{source-write,source-binding,binding-context,binding-collector,binding-runner}.ts` |
| Application commands | `hindsight-application-command-repo.ts`, command runner and `hindsight-application-writer.ts` |
| Publication convergence | Internal `HindsightApplicationReceiptTarget { authorityEpochId, namespace, checkpoint }` on Bank synchronization and `HindsightReplicaRunInput`; no wire or storage schema |
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

- Require build `taki-memory-hindsight-0.9.0-d77-v1` or `taki-memory-hindsight-0.9.0-transitions-v1`,
  `application_state` version `1.0.0`, and the actual client methods. The latter build does not imply transition
  readiness: its independently versioned contract, actual schema and client inventory must pass their own gate.
  `application_reflect` is a separate capability. A configured endpoint or native reflect method does not prove it.
- Ordinary sync reads persisted admission for `(authorityEpochId, configFingerprint)`. Missing evidence uses full
  health/version/compatibility admission; warm evidence requires one authenticated compatibility request, current
  capability/client-method/lineage checks and whole-manifest `sameApplicationValue` equality. Changed manifests take
  full admission or the existing refusal before pull; readable historical D77 namespaces do not prove live lineage.
  Save only new/changed evidence under the existing request/connection/cancellation guards, including after awaits.
  Availability failures retain historical evidence but every online retry still needs a successful live manifest.
  Reflect reads sync-admitted evidence and independently requires guarded Reflect; D77 Pending recovery reads it after
  the first successful pull for native-result support. Failed evidence reads throw. Standalone/legacy paths stay fresh;
  private template sync stays fresh and nonpublishing, and explicit connection revalidation retains all three probes.
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
- A bounded multi-page Bank synchronization owns one absolute run deadline. Foreground Recall and the foreground Bank
  sync started for Run admission instead run to completion or caller/runtime cancellation, with no implicit business
  timer; Run admission itself waits for that sync only up to the admission budget (see Run capture below).
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
- The same guarded cache read may reuse immutable bodies already persisted in the command outbox (migration 044),
  including after a commit-before-pull interruption and SQLite reopen. Require the same Bank/namespace and complete ref;
  a mismatched command-body ref is a cache miss and downloads normally. Keep existing replica corruption refusals.
  The immutable store verifies reused bytes, and the loader still verifies the complete event; local bytes never replace remote receipts, affected
  version proof or paired publication. No extra cache, copied body store or readable state is created by this reuse.
- Source-candidate queries filter their verified artifact envelopes by document/binding kind before loading body
  closure. Exact source association still validates every selected body/reference. Unrelated Source bodies must not
  be decoded again for every memory binding; the awaiting-source pass requests only awaiting bindings.
- The binding collector selects native kind before candidate body validation and scans past ineligible candidates.
  Commit at most eight commands, packed within the existing 16 MiB unique direct closure including the command envelope;
  end a batch before a member that would exceed it, and preserve the existing failure for an oversized singleton.
  Preserve stage order: Bank alone, awaiting Source associations, Blocks, remaining Document/Source bindings, then
  Memory bindings. Every committed batch requires a complete incremental pull before collecting again; dependent
  Memories reference published exact Source versions. Looking for Documents never scans all unbound Memories.
- Recover prepared/dispatched `binding:*` jobs from the existing outbox before assembling a new batch, even if the first
  pull changed candidate membership or already published their effects. Preserve original bodies, labels and Native
  operation IDs, including legacy singleton jobs. A recovered applied job continues collection; false means eligible
  work is exhausted, and true means a committed batch needs pulling. Refused batches retain their complete receipts;
  CAS conflicts use the existing three consecutive retry pulls, while timeout/lost ACK resumes the original job.
- Each packing pass requests label evidence once for its eligible new Memory candidates, using the shared bounded
  request schema. Exclude invalid extraction IDs individually. Validate every proof's target, unit ID, revision,
  payload hash, scope, complete selected-group hash, value membership, canonical tag and layer ownership independently;
  missing, malformed, duplicate or invalid unit proofs leave only those units neutral. Response-envelope failures
  retain the existing whole-request handling; authentication, lifetime and transport failures are not missing evidence.
  Recheck the complete selection after the await and before preparation; selection drift refuses the whole batch.
  There is no spill-label lookahead: a byte-boundary continuation requests fresh evidence and rebuilds bodies after
  pulling. Already prepared jobs always reuse their original bodies and labels without another evidence request.
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

### Synchronous runtime-row capture

The connection captures a fully validated template selection identity at construction, including private rollout
construction. Its ordinary `assertEvidence` compares the fresh `readCurrentRuntimeTemplateIdentity` to that captured
value, while authority, configuration, secret, hold, executor and checkpoint-floor checks remain unchanged.
The current template reader performs current-row consistency checks; it never reconstructs selection history or
previews. It retains the selected projection digest check because setup's digest has no independent stored copy.
`readTemplateSelectionIdentity` remains the full reader at construction, publication, recovery and original receipt
comparisons. Document-body corruption with unchanged current metadata is detected at those full boundaries or when
template data is consumed, rather than by unrelated ordinary guards. The consumed current projection still must
match setup. See [Current Authority and Full Validation](./memory-authority-validation.md).

`captureHindsightRuntimeRows(state, { characterId, intentions })` reads one coherent SQLite snapshot. Inside
`state.db.transaction`, `runtime.resolveBanks(characterId)` performs the complete current connection/publication,
configuration/secret and template guards and captures the exact Global/Character routes. A function-local
`createHindsightApplicationReplicaRepo` then uses only those routes for scope resolution. Its `readSnapshot` checks
each consumed Bank's checkpoint/hash/authority/native pairing once and shares the existing evidence reader across
the callback. Exact immutable body/artifact reads are deduplicated; namespace, deletion, head, projection, policy,
pinned and ingress validators still run for every relevant record.
An unknown Bank refuses with the existing route error. Only the final rows leave the synchronous callback; no local
replica, route closure or selected/ready verdict may escape or cross an await. A later capture validates afresh.

The same lexical read API is used by curator collection, prompt preparation and each model-input validation.
It exposes no mutation/lease/cache-write methods, closes on callback return/throw, and refuses a Promise result.
Nested synchronous validation shares that reader; nothing retains authority across model/Utility/HTTP waits.
The factory only creates closures; these callbacks perform no writes. The `createStores` Bank-scope callback remains
unchanged: independent reads, sync, cache, command and publication still depend on its full current connection guard.
The replica's own active epoch/provider/lineage checks do not replace that guard.

Byte-verifying replica readers and fully verified bundle owners supply the optional `decodedBody(ref, scope)`
projection port, checking exact descriptor and Bank/namespace before reuse. The independent native reader still
decodes unowned bytes. Full bundle/publication/recovery/backup proof is not replaced by a stored boolean.

The loader resolves each synchronous body-reference frontier through one `cachedBodies` lookup. The existing
replica/prepared-command stores retain entry/exit publication checks and final lease/deadline validation. Cache
misses keep the bounded eight-body download group, first-error cancellation/drain, per-request guards and durable
partial-byte progress. Independent `cachedBody` calls retain their guards. No new body store or migration is added.
Recall hydration may reuse exact published replica bodies through a fresh read snapshot; current authenticated
Native manifests/pages and complete bundle verification still decide the selected heads/artifacts. Availability
fallback and corruption refusal remain distinct. The original single-body callback still verifies arbitrary supplied
bytes; the batch callback is an explicit byte-verifying owner port.

Wrong: replace the shared Bank-scope callback with unguarded routing, or reuse a captured route for later I/O.
Correct: validate routes once inside one runtime-row read transaction, use the original integrity readers locally,
and discard that reader when the callback returns or throws. No TTL or process-wide permission cache.

### Durable foreground writes and degraded reads

- Whole-operation journal 047 owns the immutable original request, actor, captured mutation target, native child,
  application command and terminal result. Parent/native/source preparation is one SQLite transaction before I/O.
- After durable admission, bounded recovery expiry permits reading the saved Pending/terminal result under current
  cancellation, Authority and integrity guards; network work keeps its original shrinking deadline and recovery
  failures permit this readback only for existing availability/Pending classifications.
- A foreground Pending result hands its Bank to the existing scheduler retry policy without changing the receipt or
  foreground deadline; manual-only Banks arm no background recovery and await an explicit action.
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
- Pre-retirement flush and explicit ingestion coverage require complete confirmed or actual durable Pending source coverage in every selected Bank.
  A queued promise, guessed timeline interval or one successful Bank is insufficient. Late witnesses remain recoverable.
- Nonretiring rolling-summary Compaction may proceed under an effective published Local runtime or a published
  Hindsight binding whose complete bound identity matches current authority. It preserves all raw Timeline/source
  bytes and does not advance ingestion, `lastFlushSeq` or invent flush events. Connection drift may delay extraction
  while that local summary still proceeds. Unpublished, withdrawn, mismatched or unreadable identities retain a
  failing factual flush. Real retirement always requires confirmed/actual durable Pending coverage in every selected
  Bank; a guessed range or one successful Bank remains insufficient.
- Known exact source groups on both sides of an unresolved hole may complete independently. Claims prove every
  selected witness and every user occurrence within the claimed interval. Completion revalidates original receipts
  and cannot advance coverage across the first gap. Stored cursors retain their historical monotone high-water mark;
  returned current coverage may be lower after a late exact witness. Explicit coverage gaps always refuse retirement,
  including below the eligibility baseline, and never authorize rewriting earlier positive receipt history.
- The curator is limited to Taki policy and authorized Block work, with separate Global/Character model inputs. Keep
  user-card ownership, filter hidden/expired/ineligible-mood input before each submission, and persist claims, prompts,
  results, command identities and retries. Restart resumes saved proposals without rerunning a completed model call.
  Private journal reads inside one synchronous `atomic()` operation reuse its entry/exit admission; they retain
  the original byte/hash validation. Public reads stay independently guarded. Claim token/revision checks, expiry
  checks before and after mutation, COMMIT failure rollback and exact original command identities are unchanged.
  This admission cannot escape the callback, cross an await or admit a later Native dispatch.
- Every curator tool checks run liveness and refuses a closed/finished review. `block_read` and finish do not reverify
  review inputs; assessment and Block update recheck only the resolved work record before saving its proposal, including
  a Block target's source/context dependencies. The full review check remains before each model submission, so changed
  Blocks or newly restricted records cannot reach the next model step through a captured snapshot or tool result.
  Publication and failed-assessment saving retain their currentness checks. Do not multiply full review verification
  by the number of tools in one step; proposals remain unpublished until the existing publication checks succeed.
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
- Run capture (`hindsight-capture-sync.ts`) syncs the routed Banks serially in foreground mode (each HTTP call keeps the
  `requestTimeoutMs` allowance) and waits for them at most the admission budget
  `min(requestTimeoutMs, floor(chatAckMs / 2))`. `chatAckMs` is the effective `TAKI_CHAT_ACK_TIMEOUT_MS` from Core's
  ConfigSource (invalid or unset -> the 15000 default), read per capture so a live change applies without a restart;
  the half leaves the client's `chat.send` ack room for the rest of admission. Caller cancellation reaches the sync only within that budget; afterwards the Bank service
  owns the unfinished sync until it completes or Core stops (tracked by `settle()`/`stop()`), so binding progress is
  never abandoned and later syncs reuse durable intent-digest receipts instead of duplicating a commit. A Bank still
  running at the budget is `deferred` (`HINDSIGHT_DEADLINE_EXCEEDED`); any failure other than cancellation or
  `MEMORY_INTEGRITY_ERROR` / `MEMORY_AUTHORITY_MISMATCH` / `MEMORY_REQUEST_ID_CONFLICT` is `degraded`: the Run proceeds
  on the readable replica (partial) with verified capability evidence, or as a memory-unavailable Run
  (`admission_unavailable`) without it. Those three refuse the Run as a logged structured refusal, except that a live
  connection change or disable seen after an incomplete sync (its guards then fail as `MEMORY_AUTHORITY_MISMATCH`)
  degrades the Run to `config_changed` / `connection_disabled`, as the same drift does before the sync. Recheck cancellation
  before exposing the captured result. Each unsynced Bank emits one closed-code event (never a raw message).
  Degrade-vs-refuse table: [`memory-hindsight-lifecycle.md`](./memory-hindsight-lifecycle.md).
- A binding commit refused with `native_version_conflict` / `artifact_conflict` (native consolidated between the pull
  and the commit) re-pulls and rebinds within the same sync run, at most `BIND_CONFLICT_RETRIES` (3) consecutive times;
  the next conflict fails that run with its closed code, which capture then degrades.
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

### D105 receipt-targeted publication convergence

- A curator publication supplies the already accepted command's epoch, namespace and paired checkpoint to the
  existing bounded Bank service. The target only decides when to stop pulling; it never publishes an artifact or
  advances a cursor. Compare its identity once using captured authority and the checkpoint already read at admission.
- Apply every event in the current change page and retain the existing page-end checks. Only then may a cheap
  native/state cursor comparison stop another page request. Receipt-targeted calls skip unrelated binding passes;
  ordinary foreground, scheduled and no-target recovery calls keep their complete synchronization behavior.
  A reset keeps the accepted namespace and existing full snapshot, rollback, lease and publication proof.
- Complete the work item only after the existing exact `writer.applied` artifact-history proof. Missing targets,
  invalid pages or cursor coverage without that history remain unconfirmed. A job already completed before recovery
  can use that exact proof to skip both remote execution and refresh; newly published jobs keep one terminal proof.
- No per-event `writer.applied`, extra body validation, cache, persisted cursor or generic stopping framework is needed.
  The rest of a current page (up to 128 manifests) may be applied beyond the target to preserve full-page semantics.
  Large events and earlier queued Bank owners can still delay this path. Publication completion does not claim that
  unrelated Bank enrichment finished or that real concurrent-use latency has been measured.

### D108 scheduled curator review and durable resume

- Ordinary post-turn maintenance performs ingestion only. The unchanged ingestion owner batches 20 messages;
  source retirement uses its explicit flush, while nonretiring Compaction follows the published-binding boundary above.
  `tidy.maybeRun` is inert under Hindsight; the full tidy diagnostic report is reserved for
  explicit operator `runNow`, which retains its existing response contract. Neither automatic chat path enumerates it.
- `hindsight-policy-config.ts` and the existing config registry own live `TAKI_HINDSIGHT_POLICY_REVIEW_MODE`
  (`daily`/`interval`), `_TIME` (`03:00`), `_INTERVAL_MS` (`86400000`) and `_THRESHOLD` (`100`). Daily time uses
  `createScheduledTaskRepo(db).userTimezone()`. Only `createSchedulePatternAdapter` performs calendar math; policy
  maintenance never enters Scheduled Task Run admission. A persisted interval anchor survives restart and zone changes.
- Migration 062 adds `hindsight_policy_review_schedule`, keyed by authority epoch and exact Bank namespace. Its
  validated progress records effective schedule revision/anchor, next due, one pending occurrence/reason, last attempt,
  last completion, catch-up notice identity, retry and measured progress. Existing migrations are unchanged.
  An overdue obligation is retained before recomputing the future schedule. Missed slots coalesce; a later distinct
  catch-up receives a new notice identity. Completion advances only after an actual successful empty inventory and
  zero nonterminal item work, including claims/results waiting on future retries.
- The replica scheduler supplies the only wake and lifetime. It dispatches the policy lane after its Bank drain without
  awaiting model work or keeping a replica lease. Bank-scoped curator entry prevents Global rediscovery per Character.
  The common full/incremental application owner notifies after COMMIT, including partial progress before later failure.
  Such notifications invalidate only their Bank. Activity notifications rearm paused obligations and do not scan idle
  below-threshold Banks. Configuration/startup reconciliation examines all configured Banks.
- Threshold inventory pages through the existing `duePolicyWork` eligibility reader, including deferred `due`/`failed`
  assessments, and excludes journaled saved results. Hidden, expired, invalidated and ineligible mood inputs remain
  filtered before the accepted-page limit. A changed checkpoint during the complete scan yields UNKNOWN/retry, never
  empty. This is replica-local inventory; manual-only synchronization remains manual-only and remotely unpublished or
  unpulled facts do not count as locally bound work.
- Discovery advances a local keyset cursor only after an item's admission commits. It deliberately restarts discovery
  from the beginning after interruption instead of persisting a second reviewed watermark. Deterministic journal IDs
  prevent duplicate admission and saved results bypass the model. This costs rereading earlier candidates on resume;
  each bounded report continues under the same pending occurrence until the actual backlog drains.
- Recovery first processes the existing item journal within the coalesced Bank pass. Saved results retain their original
  command IDs through dispatch, receipt and local application. An admitted prompt without a result publishes its existing
  truthful interrupted-assessment failure; the new failed policy revision remains retryable. Results lost before durable
  save may require another model call. Future claim expiry and failed-policy retry are unfinished work, not successful emptiness.
- The actual `TurnRegistry` supplies activity and idle timestamps. A Bank pass starts after five idle seconds for its
  Character; Global requires all turns idle. A cancelled but unsettled turn remains busy. Subsequent chat can proceed
  while an already admitted pass runs; concurrent-use invisibility still requires measurement.
- Model computation owns no backup write admission. Journal mutations enter `writeFence.admitSync`, and individual
  publications enter `writeFence.admit` through the required local application. Existing transition work fences remain
  active. A closed fence preserves the pending occurrence and saved result; scheduler stop/pause aborts and settles the
  accepted lane, without waiting for fence reopening. Existing retry delays rearm through the same scheduler timer.
- Shared defines `MemoryPolicyReviewStatusSchema` once. Core emits `review` in authority status, scoped to current
  checkpoint namespaces even during disconnects. State is pending/running/paused/error, or null when idle. It includes
  due-since, eligible remaining or UNKNOWN, live journal saved-awaiting-publication count, last completion and catch-up ID.
  Running/invalidated/unavailable eligibility is UNKNOWN. The optional wire field allows older status producers; current
  Core emits null outside Hindsight or for unreadable review evidence. Home joins these rows by Bank id, keeps
  unknown counts distinct from measured zero, and treats the retained catch-up ID as historical evidence rather
  than proof that a later running occurrence is itself catch-up.
- `onPolicyReviewChanged(bankId)` carries a thin invalidation from schedule saves and the first saved result or
  terminal work transition through runtime composition to the existing `memory.replica.changed` channel.
  Producers call it only after their existing successful persistence boundary; failed writes and idempotent result
  replay do not notify. Prepare/claim/prompt changes do not add notifications, queries, decoding or validation.
  The subsystem clears its callback at stop entry. The server's existing connection fan-out isolates failed sinks;
  Home's existing generation guard and dirty-read coalescing reread current authority status. Notification code
  never reconstructs status or rearms the policy scheduler, and no polling or generic database observer is added.

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
| State changes between synchronous row captures | Next capture reruns full guards and refuses current corruption/drift/stop |
| Corrupt current body/head/projection during row capture | Original replica integrity refusal; never omit it as an empty result |
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
- Good synchronous capture: many records share one fully guarded route snapshot, while every record retains its
  original integrity/eligibility checks; the next capture obtains a new snapshot.
- Bad: recovering missing original text from a similar native document, making G1 completion mean policy completion,
  using an old pin while its new native revision lacks binding, or dropping Effect metadata while wrapping a tool.

## 6. Required Tests and Operational Checks

- Receipt convergence through the real curator, Bank service and sync runner with controlled Native transport:
  complete the target page without waiting for a later page/bind; reject malformed remainder and cursor-only proof;
  preserve target identity/budget through reset, cancellation and lease failures; recover already applied work without
  another remote pull. Keep the existing no-target integration and exact-body-cache reuse regressions.
- Policy-review persistence notifications through actual registered operator WebSockets and current authority reads:
  first saved results remain visible while a later model call is held, terminal completion updates the count,
  failed journal/schedule writes do not notify, and retired runtime callbacks stay silent. Use controlled providers
  explicitly; this does not establish real Native crash recovery or concurrent-model responsiveness.
- SQLite transactions, commit failure, CAS, reopen, old migration lineage, namespace changes and paired publication.
- Full source/record/metadata body round-trip, cross-language hashes, parts, corruption, limits and original closure.
- Actual native HTTP/PostgreSQL through the assembled Core provider: neutral/hidden admission, guarded reflection,
  ACK loss/restart, layer/compound writes, both Banks, Core Blocks and provider-only reconstruction into new SQLite.
- Deterministic native model/reranker/cache spies verify actual input exclusion. They do not prove model classification
  quality or real-model operational acceptance.
- Captured tools/automatic recall, capability and route drift, source flush, stop/queue/held-reference behavior, live knobs.
- Actual completed-REENTRY row capture with multiple records, pinned/intentions/filtering and exact output parity.
  Count real publication `selected` calls, delegating to the original reader: fixed per snapshot rather than per
  record, and fresh on the next call. Cover transaction enclosure, subsequent marker/native/checkpoint/config/
  template/stop refusal and current body/head/projection corruption with the intended error, not a generic throw.
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

### Source evidence extension

Repeated transitions may add `application-source-evidence.v1`: immutable nested original Source bytes plus exact prior
artifact/body and native association. Full snapshot/event/hydration, SQLite evidence closure and ordinary Source readers
must validate all dependencies; association-only rebind changes only associated_native. The body is independently
negotiated by transition_source_evidence1.0.0; old capability support does not imply new upload/delta support.
Memory source_artifacts remain exact ordered version lists, allowing repeated keys and historical versions after latest
head retirement. A Source append fragment never replaces physical document text/metadata in runtime projection.

Current awaiting_native Sources remain unconfirmed intent evidence. Complete W2 proof may retain them even if no async
native work remains. W3 candidate.pendingSources classifies the current head with exact operation/bytes; W4 joins factual
Pending/custody disposition, and W5 cannot use a raw pending list as publication readiness. See memory-transitions.md.
