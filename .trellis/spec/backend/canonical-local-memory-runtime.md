# Canonical Local Memory Runtime

## 1. Scope / Trigger

Use this contract when changing Local memory ingestion, maintenance, Run admission, prompt projection, or provider
retirement. B6 installs real Canonical Local behavior on the existing provider and Core-owned Compaction seams.
Hindsight runtime, its application-state projection and provider-only recovery remain separate work; Local verification
does not establish Hindsight activation or owner acceptance.

## 2. Signatures

The production contracts live in `core/memory/canonical-local-ingestion.ts`, `canonical-memory-run.ts`,
`memory-flush-port.ts`, and `core/db/canonical-memory-maintenance-contract.ts`:

```ts
initializeBaseline(characterId: string): void;
recordPrimaryCommitted(input: PrimaryConversationCommit): void;
maybeRun(input: { characterId: string }): Promise<CanonicalIngestionRunResult | null>;
run(input: { characterId: string; throughSeq?: number }): Promise<CanonicalIngestionRunResult>;
prepareRetirement(input: MemoryFlushRequest): Promise<MemoryFlushOutcome>;
captureRun(characterId: string): Promise<CapturedMemoryRun>;
```

- `PrimaryConversationCommit` contains the exact committed `TimelineEntry[]`, Character and optional Run ID supplied
  by Chat persistence. It is an internal trusted callback, not a user-supplied message or a role-based inference.
- Maintenance writes carry `{ epochId, bankId, characterId, memoryId, expectedRevision, requestId, now }`.
  `policyEdit`, `reinforce`, `copyToBank` and `hardDeleteRolling` are private maintenance operations, not foreground tools.
- Migration 041 introduces the ingestion cursor, span journal, exact primary witnesses and retired-source identities.
  Witnesses store `authority_epoch_id`, `committed_through_seq` and nullable `ingestion_span_id`. Historical canonical
  snapshots and operation receipt bytes survive the migration; previously recorded migration versions are immutable.

## 3. Contracts

### Admission and foreground retrieval

- Capture provider, lineage, epoch, capability digest and trusted Global/active-Character routes once. The same capture
  supplies the Harness RunSnapshot, canonical tools and automatic recall. Restoring a persisted Run must compare that
  complete memory identity before reusing a process-local executable context.
- Provider/epoch/stable-capability drift fails closed. Recall alone can report the documented vector-health degradation;
  it must report the actual post-call vector state. No drift silently selects another authority.
- Automatic recall joins ephemeral `<turn-context>` before request measurement. It never enters stable instructions,
  Timeline, summary, Compaction source, Write Gate input or retained source. Global and active Character calls share one
  deterministic budget; defaults are 1024 tokens and 8 results. Normal automatic recall waits for provider completion or
  cancellation without a business deadline. An explicitly supplied finite `timeoutMs` applies one shared deadline;
  transport failure handling and cancellation remain independent. Failure leaves foreground chat usable.
- Canonical and Legacy vocabularies are not advertised together. Admission also freezes row/Block/persona projection.
  Preserve non-truncatable relationship content, eligible profile promotion, intention triggers/expiry and observed fences.
  Explicit hidden/mood visibility is honored; Blocks stay outside FTS.

### Exact-source ingestion and durability

- Initialize the persistent eligibility baseline before the first primary append for each Character. It records where
  canonical observation began, not completed processing of older messages. Startup initializes existing Character Banks.
- Accept only positive exact commit evidence: Character, row ID, sequence, content digest and complete commit boundary.
  An autonomous assistant row or a numeric Timeline range is not proof of primary conversational origin.
- Select unprocessed witnesses by epoch and absent span assignment. A late positive commit remains eligible even when its
  sequence is below the retirement cursor or original baseline. Cursor advancement cannot mark an unwitnessed source done.
- Reuse T5's `EPISODIC_EVERY_N = 20` actual unprocessed primary-message cadence for ordinary maintenance. A failed pending
  span retries immediately. Explicit `run` and pre-retirement flush force processing without waiting for that threshold.
- Sanitize injected envelopes, secrets and unsafe tool payloads. Persist one fixed sanitized span, one Write Gate decision,
  one Local extraction plan and per-Bank idempotent receipts. Retry the same plan; never rerun a completed gate or reinforce
  twice after partial Bank success or restart.
- Keep approved original text separate from facts. Preserve speaker/time and UTF-16 source offsets as metadata. Split only
  at supported source/message boundaries; do not truncate a supported 100,000-character source to make framing fit.
- Lexical duplicates reinforce the existing fact without another classification call, and retain the new source-to-fact
  evidence. Extraction obeys automatic importance/visibility limits. Trusted observed writes keep machine-observed provenance.
- An unresolved post-baseline primary witness gap, incomplete receipt, authority change or failed flush prevents retirement.
  A genuinely pre-baseline range with no applicable positive source is `not_required/before_canonical_ingestion_eligibility`.
  An uninstalled ingestion adapter is a failure, never a synthetic successful flush.
- Per-Character detached work serializes in the existing maintenance chain; all model work shares one process Utility Slot.
  Do not wrap a chain that calls `slot.run` in another `slot.run`. Compaction remains Core-owned.

### Authoritative maintenance and retirement

- Every write verifies active Local authority, exact Bank/Character ownership and expected revision in the transaction.
  Canonical record, policy, sparse projection, source evidence and historical receipt updates commit together.
  An unchanged lifecycle result for an imported record also persists its referenced revision snapshot atomically with
  the receipt; retries must work after the record changes or is deleted.
- Preserve unrelated supported logical fields, absent versus null metadata, source links and lifecycle state. Same-Bank
  supersede retains original evidence; cross-Bank repair copies the complete support/source closure and reversibly invalidates
  the original under a single atomic operation. Only the selected fact receives the destination visibility; ancillary
  copied supports are hidden evidence so another Character cannot inherit unrelated relationship/pinned content. Their
  original records remain unchanged. Never change Bank ownership under the old identity.
- Hidden/invalidated records are excluded at FTS publication, rebuild and query before the result limit. Automatic lexical
  reinforcement preserves a hidden target's visibility; a duplicate occurrence does not implicitly promote it.
- Retention uses registry/per-record rules and reinforcement-aware time. Permanent records survive; permitted episode or
  intention expiry is recoverable invalidation. Only the machine rolling-window layer permits current-record hard deletion.
  Historic snapshots/receipts remain for exact retry; this is not a content-erasure API for historical evidence.
- Tidy receives an immutable row/Block review with revision-bearing references. Reject stale references, cross-Character
  access and background writes to the user card. Hidden records are excluded from the model's review; row tools accept only
  captured references or new references returned by successful row operations in that pass. Block absence uses expected
  revision 0; read/CAS/write is atomic.
- Count only committed effects. If a later model step or authority check fails, keep earlier actual effect counts but do not
  advance the successful tidy watermark. A clean store consumes no model call.
- The durable authority marker is the retirement boundary. Once committed, retire the Legacy fence before constructing or
  publishing a replacement. Constructor, callback or marker-read failures cannot reopen old held tool/write/maintenance/flush
  references. Before-commit rollback may reopen them. Failed replacement binding leaves an unavailable facade and failing
  Compaction flush; it must not keep using the retired writer.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Wrong epoch, Bank, Character or stale revision | Refuse without partial mutation; preserve the matching structured conflict/authority error |
| Forged/replayed commit with changed row or commit boundary | `MEMORY_INGESTION_SOURCE_UNPROVEN`; the entire witness batch rolls back |
| Unknown post-baseline user source | Flush refuses; no summary retirement or invented primary witness |
| Late exact source below baseline/cursor | Assign and process that source once; do not replay completed historical spans |
| Below cadence with no failed span | No Write Gate/extraction model call |
| Partial routed write or restart | Reuse saved gate/plan and committed Bank receipt; apply only missing work |
| Explicit hidden or invalidated memory | Excluded before ordinary recall limit; maintenance still has scoped historical access |
| Cross-Bank correction has private supporting facts | Preserve copied support edges as hidden evidence; exclude them from other Characters' prompts, sparse recall and tidy model input |
| Imported record receives an unchanged lifecycle operation | Persist the referenced snapshot with its receipt; return the same result on retry |
| Post-marker constructor/callback/read failure | Legacy stays retired; replacement is unavailable or correctly bound, never fallback |
| No real provider flush installed | Failure that prevents Compaction retirement |

## 5. Good / Base / Bad Cases

- Good: a primary commit is witnessed, passes one gate, persists original source and facts, and is reused by retirement flush.
  A crash after the Global write resumes only the Character write from the same plan.
- Base: no eligible sources and a clean store means no background model request; the ordinary foreground response proceeds.
- Bad: treating every assistant row as primary, clearing maintenance on canonical binding, returning an empty toolset as a
  completed Local implementation, or reporting a rolled-back retention operation as a successful deletion.

## 6. Tests Required

- Real temporary SQLite: fresh 041 migration, supported historical lineages, reopen no-op, unchanged historical receipts,
  request-ID conflict, revision races, scope refusal, copy/support closure, hidden FTS and current rolling deletion.
- Deterministic Utility Slot: one gate, source/fact separation, duplicate evidence, partial Bank failure/restart, late exact
  witnesses, 20-message cadence, immediate failed-span retry, forced flush and source-gap refusal.
- Runtime: immutable Run/provider/tool identity, drift refusal, persisted context restore, ephemeral recall ordering/exclusion,
  partial/timeout retrieval, Local maintenance composition, and actual pre-retirement source durability.
- Activation failure: held Legacy tool/write/retention/tidy/maintenance/flush references reject after a committed marker even
  when construction/callback/marker reread fails; pre-commit transaction failure retains usable Legacy authority.
- Prompt/Block: complete relationships, promoted profile, observed fences, mood/hidden visibility, captured content and CAS.
- Run the workspace TypeScript checks and real Node strip-only boot with fresh isolated Legacy and Canonical Local fixtures.
  Do not load `.env.local`, real credentials, another worktree or private D78 acceptance data for this verification.

## 7. Wrong vs Correct

Wrong: infer both provenance and completed work from a Timeline range.

```ts
const entries = timeline.rangeAscending(characterId, cursor, tail);
await extract(entries.filter((entry) => entry.role === "assistant"));
```

Correct: witness the persistence owner's exact committed rows, preserve cadence, and let flush force the same journal.

```ts
ingestion.recordPrimaryCommitted(primaryCommit);
await ingestion.maybeRun({ characterId });
await ingestion.flushPort.prepareRetirement(retirement);
```
