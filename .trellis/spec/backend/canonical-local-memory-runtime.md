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
- Local intention retention captures a numeric default at Run/tool admission before asynchronous coordinator work.
  The same number reaches new `retain` requests and a Local provider `captureRetention(days)` facade for layer
  reclassification. That facade shares repositories, retrieval methods and vector-health ownership; it does not
  replace the runtime or reread mutable settings from an admitted Run. Ingestion captures before its Character queue,
  and observed writes receive an operation-local number. Existing persisted explicit expiries are never recalculated.
- Tidy keeps its admitted `MemoryConfig` before entering the Utility queue. Each later revision-fresh review receives
  that captured `intentionsDefaultDays` in `TidyReviewOptions`; it never rereads the setting when a queued review starts.
  Refile and supersede use the numeric option and preserve an existing expiring policy. Review options are copied so
  caller mutation cannot change already-created tools. Hindsight review adapters ignore this additive optional field.
- Legacy no-expiry intentions use the configured fallback captured once at each future retention sweep, so changing
  the setting can affect existing implicit-expiry rows at the next pass. Canonical intentions require explicit expiry;
  their stored deadline stays authoritative. Changing this setting does not restore already archived/invalidated rows.
- Shared `createCanonicalMemoryRun` / canonical tool inputs accept an additive optional `intentionsDefaultDays`.
  Omission preserves the established built-in default. Hindsight callers do not pass a Local override; no Hindsight
  retention, connection, synchronization, recovery or authority behavior is changed by this seam.

### Selected initiative assembly

- `CapturedMemoryRun.assembleInitiative({ global, character })` is an optional compatibility seam returning
  `{ text, sources }`. Production Local, Hindsight and Legacy captures supply it. It always includes the same
  captured assistant layer and Character Persona, plus only the selected scope's existing bounded Blocks/index.
- Capture scopes at the owning assembler; never split an already assembled primary prompt by headings. Missing
  Blocks remain absent. This path does not select pinned/relationship rows, invoke the legacy Intention picker,
  retrieve Memory, call a model, append Timeline or update primary pressure/auto-memory state.
- Freeze selected source text at capture; each emitted source records its actual identity and rendered-content
  digest. The complete text must fit the existing initiative instruction bound. Oversized Persona or scope content
  refuses instead of silently truncating identity or bypassing the owning Block renderer's budget.
- Provider authority, captured Bank routes, Legacy retirement and runtime lifetime must remain current each time
  the assembly is invoked. The initiative adapter also retains this original Memory binding across the later
  independent C1 admission capture. Primary `assemble(currentMessage)` behavior is unchanged.

### Exact-source ingestion and durability

- C4 primary-source currentness uses the exact C3 SQL Timeline digest, then the separate ingestion entry digest and
  immutable claimed span/gate/receipt chain. An unchanged primary row remains a direct source before any relevant
  confirmed ingestion binding exists; never force ingestion or invent a Source identity. Once a receipt exists,
  compare its original Source and revision-snapshot policy/unit baseline. A correction before the first later lookup
  must refuse, including physical deletion/retired Source identities while the old Timeline remains intact.
- Selected-topic initiative recall wraps the captured `recall` tool, preserving its Effect metadata and request path.
  Each selected Global/Character Bank has one attempted query per Run, four records and a final escaped/fenced
  512-token projection under the existing estimator. Failure/cancellation consumes that Bank's attempt. Provider
  selection captures the actual Source/unit/policy evidence before its next await; later consumers cannot capture
  the newest Source as a replacement baseline. Pending and unsupported opaque-source facts are not injected as facts.
- Once selected initiative assembly is used, its included Persona/Block/index source digests join `isCurrent`.
  Unselected Blocks do not invalidate the Run. Persona stays under the existing boot/first-use cache contract;
  editing its file does not pretend the current producer reloaded it. Primary assembly remains unchanged.

- Initialize the persistent eligibility baseline before the first primary append for each Character. It records where
  canonical observation began, not completed processing of older messages. Startup initializes existing Character Banks.
- Accept only positive exact commit evidence: Character, row ID, sequence, content digest and complete commit boundary.
  An autonomous assistant row or a numeric Timeline range is not proof of primary conversational origin.
- Migration 064 adds provider-independent `primary_conversation_sources` and exact Timeline membership. The primary
  writer commits user/open source together, response rows/retained state together, or no-output cancellation/retraction
  together. Publication uses `Database.afterCommit`. A provider callback is not the sole durable source producer.
- Capture admission authority identity locally; available Run metadata may accompany it. Capability availability or a
  changed capability digest cannot govern chat durability or reassign a source to another epoch/provider/lineage.
  Before accepting new work, boot seals old open inputs from actual durable members; it never invents output or settles
  uncertain Runs/Effects. Unknown historical rows are not relabeled by schema migration.
- Ordinary maintenance imports retained local sources idempotently into existing immutable provider witness tables,
  including below-cadence passes. Failed binding retains the source for later retry; another provider's witness is not
  duplicated. Reuse the existing span plans and receipts rather than introducing another extraction queue.
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
- Select valid pending source groups independently of earlier unknown holes; never join context across a hole.
  Report processing progress separately from contiguous coverage, which stops before the first unresolved source.
- An unresolved post-baseline primary witness gap, incomplete receipt, authority change or failed flush prevents a
  successful explicit ingestion-coverage claim. It does not block canonical context compaction.
  A genuinely pre-baseline range with no applicable positive source is `not_required/before_canonical_ingestion_eligibility`.
  An uninstalled ingestion adapter is a failure, never a synthetic successful flush.
- Per-Character maintenance and compaction have independent serialized chains; all model work shares one process
  Utility Slot. Do not wrap a chain that calls `slot.run` in another `slot.run`. Legacy alone retains synchronous flush.

### Source descriptions in exact-primary ingestion

- Optional `IngestionMessage.sourceContext` travels with the immutable sanitized span. The gate and Local extraction
  render it beside eligible original text using the common source rules; metadata is context, not a user claim or a
  new ingestion witness. Private child/tool/publication/summary rows do not gain eligibility from carrying a sidecar.
- Update `primaryEntryDigest`, the C3 `primarySourceRowDigest`, both Local/Hindsight exact-row readers and
  `readPrimaryMemorySource` together when source evidence changes. Absent/SQL-null context preserves prior serialized
  property order and digest bytes. A changed source cannot reuse the old primary witness or claimed-span digest.
- `retainedIngestionSource` stores approved wording joined only by the existing newline separator. Speaker/time,
  source descriptions and exact UTF-16 start/length stay in per-entry metadata; prompt wrappers never alter retained
  text or offsets. A sourced Local batch must match the selected span's original entries as well as its text/hash.
- Native Hindsight retain metadata can carry the same original evidence, but this does not establish its provider-owned
  extraction/reflection behavior. Keep native compatibility and live acceptance separate from Local gate/extraction tests.

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
- Tidy captures a fresh row/Block review when its Utility Slot task starts, not when it queues. Canonical revision-bearing
  identities stay internal; model-facing references may be short pass-local handles. Reject stale writes, cross-Character
  access and background writes to the user card. Hidden records stay excluded. A conflict may return the current scoped
  record for a new explicit model decision; it never silently retargets the failed write. Block absence uses revision 0.
- Count only new committed effects: cached receipts and unchanged outcomes contribute zero. A clean store consumes no model
  call. Canonical completion requires an accepted `memory_finish_edits` and no unresolved errors; capped or abandoned passes
  keep committed work but do not advance `lastTidyAt`. Preserve the separately tested Legacy bounded-pass and Hindsight curator
  completion contracts.
- Exact fresh same-action revision repair remains supported. Other known no-write rejections use explicit finish
  acknowledgements: `resolutions: [{ issueId, status: "corrected", correctedBy: laterSuccessfulCallId }]` or
  `{ issueId, status: "not-needed", reason: "already-satisfied" | "mistaken-request" | "no-useful-change" }`.
  A correctedBy success must be later, use the same tool, and match the same known stable target; its corrected payload
  may differ. Malformed input does not fabricate a target. Unknown persistence, authority and request-identity failures
  cannot be dismissed; subsequent new tool calls in that same SDK step are also blocked at the mutation boundary.
  Cached/unrelated success alone is not completion. Only an accepted finish stops the Canonical loop; a refused finish permits correction.
  Corrected and explicitly unnecessary calls are counted separately from applied edits.
- Migration 067 stores per-Character/epoch reviewed memory revisions, Block revisions and retry eligibility. Checkpoint
  only the visible accepted batch and its own resulting revisions; never substitute newer unseen revisions. Duplicate
  groups retain their comparison evidence as a unit. The report cap limits seed candidates, not deletion of relevant
  evidence. A remaining tail bypasses the ordinary write threshold. No historical timestamp fabricates per-record review.
- Canonical tidy captures pending stable Bank/memory identities at its first Utility dispatch, then drains that finite
  backlog inside the same durable operation. Each batch reads current revisions and removes departed/ineligible
  identities from admission. New memories, Block changes and external changes after accepted review remain eligible:
  return their actual remaining count and nextAction=continue, retaining pending retry state. Never falsely checkpoint
  their newer versions or chase newly arriving data indefinitely.
- Defaults are 100 candidate memories, 24,000 estimated initial input tokens (instructions, tool schemas and report),
  48 model steps and 600,000 ms per batch. Initial input is also limited to half the configured selected Utility/main
  model window to reserve tool-history/output space. Whole memories/duplicate groups are never truncated; an indivisible
  input that exceeds the budget reports input-too-large/check-settings before any model call.
- Each accepted batch releases and re-enters the existing Utility Slot, giving queued background work a turn. Queue
  time consumes no batch deadline. Slot usage contains only that batch, never cumulative operation totals. Local and
  Legacy shutdown abort active tidy requests and prevent further batches; Legacy still executes one bounded report.
  The enlarged defaults also apply to Legacy, without claiming Canonical checkpoint/continuation semantics.
- SDK tool execution is sequential, model retries
  are owned here rather than stacked, and compatible HTTP abort is tested. Timeout is cooperative; arbitrary injected
  providers that ignore cancellation are not supported as a hard-deadline guarantee. Automatic failure eligibility backs
  off for one then five minutes and stops automatic retries after repeated failure; manual retry starts from current state.
  A persisted exhausted budget reports nextAction=manual-retry and explicit automatic-retry-paused UI guidance. A
  confirmed clean manual pass also clears retry stop, so future new memories can again trigger automatic maintenance.
- The existing durable operation owner handles manual/automatic admission, Global single flight and reconnect status.
  Local mutation and committed-edit progress share the same SQLite transaction; publish only after its outer commit.
  Review checkpoints and reported progress also commit together. A retired operation's progress refusal rolls back the
  affected new mutation. Missing candidate counts remain unknown rather than zero.
- `TidyEngineView.reviewOutcome?(): TidyReviewOutcome` reports completion, actual edits and closed diagnostics. The existing
  `memory.tidy` clean/ran success shape is unchanged. Partial/failed calls return JSON-RPC INTERNAL_ERROR with
  `MemoryTidyFailureDetailsSchema` directly in `.data`: kind=memory-tidy, status=partial|failed, defects/edits/steps/usage,
  reason=tool-errors|execution-failed|review-stale|unfinished|timeout|input-too-large, at most 20 closed tool/code observations and issueCount.
  Observations may include issueId, stage=input|reference|write|completion and a closed field name. Durable operation
  outcomes additionally retain reviewed/remaining, recoveredIssues/skippedIssues, nextAction and retryAt when known.
  Partial requires positive edits; failed requires zero. Diagnostics never contain raw arguments or exception text.
  Regressions must cover explicit corrected/not-needed acknowledgements, sticky authority/unknown failures, no-op counts,
  rejected then accepted finish, later model failure, bounded multi-batch coverage, and the actual MethodRegistry envelope.
- The durable authority marker is the retirement boundary. Once committed, retire the Legacy fence before constructing or
  publishing a replacement. Constructor, callback or marker-read failures cannot reopen old held tool/write/maintenance/flush
  references. Before-commit rollback may reopen them. Failed replacement binding leaves an unavailable memory facade;
  independent context compaction must not keep using the retired writer.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Wrong epoch, Bank, Character or stale revision | Refuse without partial mutation; preserve the matching structured conflict/authority error |
| Forged/replayed commit with changed row or commit boundary | `MEMORY_INGESTION_SOURCE_UNPROVEN`; the entire witness batch rolls back |
| Unknown post-baseline user source | Explicit coverage remains incomplete; later valid groups and context compaction may proceed |
| Late exact source below baseline/cursor | Assign and process that source once; do not replay completed historical spans |
| Below cadence with no failed span | No Write Gate/extraction model call |
| Partial routed write or restart | Reuse saved gate/plan and committed Bank receipt; apply only missing work |
| Explicit hidden or invalidated memory | Excluded before ordinary recall limit; maintenance still has scoped historical access |
| Cross-Bank correction has private supporting facts | Preserve copied support edges as hidden evidence; exclude them from other Characters' prompts, sparse recall and tidy model input |
| Imported record receives an unchanged lifecycle operation | Persist the referenced snapshot with its receipt; return the same result on retry |
| More pending tidy rows than one report batch | Preserve complete visible comparison groups; checkpoint only accepted visible work and continue the remaining tail |
| Model corrects a known rejected/no-write call | Accept explicit correction evidence; do not keep an unresolvable historical failure flag |
| Tidy operation retires during a later mutation | Preserve earlier committed edits; roll back the new mutation and its progress together |
| Post-marker constructor/callback/read failure | Legacy stays retired; replacement is unavailable or correctly bound, never fallback |
| No real provider flush installed | Explicit coverage fails; canonical Compaction remains independent |

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
- Tidy: multiple batches and same-timestamp revisions; cap-one duplicate group; no-op review and fresh changes; invalid call
  correction and not-needed accounting; failed/aborted later steps; actual stalled HTTP cancellation; manual/automatic
  owner join, restart after a committed edit, no late write, and browser reconnect/remount without redispatch.
- Run the workspace TypeScript checks and real Node strip-only boot with fresh isolated Legacy and Canonical Local fixtures.
  Do not load `.env.local`, real credentials, another worktree or private D78 acceptance data for this verification.

## 7. Wrong vs Correct

Wrong: infer both provenance and completed work from a Timeline range.

```ts
const entries = timeline.rangeAscending(characterId, cursor, tail);
await extract(entries.filter((entry) => entry.role === "assistant"));
```

Correct: persist exact source membership locally, then let ordinary maintenance bind and process the same journal.

```ts
const opened = primarySources.begin({ user, runId, memory: capturedMemory });
primarySources.retain({ sourceId: opened.sourceId, rows: actualResponseRows });
await ingestion.maybeRun({ characterId });
```
