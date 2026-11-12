# Compaction Harness

## Scenario: Durable Character-scoped summary replacement

### 1. Scope / Trigger

- Trigger: detached post-turn Compaction has selected a balanced retiring Timeline range and must replace the current
  projection-only rolling summary without losing evidence across cancellation, competition, or process restart.
- This contract begins at migration `032-conversation-compaction-lifecycle.ts` and applies to request preparation,
  Context Reduction, `CompactionCoordinator`, `CompactionOperationRepo`, `SummaryRepo`, and Core memory runtime
  composition.
- Compaction remains a context-management operation under the existing Character/Run/Turn runtime. It never creates a
  second Session, Run, Timeline, or user-visible history authority.
- Production measures the exact assembled instructions, outgoing AI SDK messages, and prepared/estimated tool schemas.
  Proactive handling begins at `projectedInputTokens >= effectiveWindowTokens * compactPressureRatio` (default `0.8`).
  `historyRatio` sizes Replay View admission only; the overflow calibrator's `0.9` shrink remains a separate retry rule.

### 2. Signatures

- Migration: version `32` adds revision/source metadata to `conversation_summary` and creates
  `conversation_compaction_operations` plus append-only `conversation_compaction_events`.
- Summary checkpoint:
  `SummaryRepo.getCheckpoint(characterId) -> { throughSeq, text, revision, lastOperationId, sourceFromSeq,
  sourceThroughSeq, sourceDigest, capturedTailSeq } | null`.
- Durable coordination:
  `CompactionOperationRepo.begin`, `renewLease`, `recordFlush`, `recordSummaryGenerated`, `fail`, `cancelActive`, `commitSummary`,
  `reconcileExpired`, `get`, `active`, and `events`.
- Runtime coordinator:
  `maybeRun(characterId, correlation?)`, `cancel(characterId)`, and `reconcile()`.
- Request admission: `prepareOutgoingRequest` measures the exact outgoing projection, applies the deterministic reducer
  when pressure qualifies, remeasures, and sends that reduced `ModelMessage[]` to the provider.
- Post-turn admission: after normal assistant/tool persistence, `measurePostTurnRequest` projects the updated Replay base,
  applies the same deterministic reducer, remeasures, and publishes the next-request pressure snapshot before
  `createMaintenanceAutoMemory`'s `setImmediate` callback can read it.
- Relationship pressure publication (`onRequestMeasured`) belongs to primary turns only. Non-primary ephemeral control
  requests still receive request reduction and ordinary Run/Effect/usage telemetry, but cannot replace the snapshot
  consumed by pending relationship maintenance.
- A lease contains `{ operationId, characterId, owner, fence, attemptNo, expiresAt }`. A stale fence is never valid for
  an event append, terminal transition, or summary commit.

### 3. Contracts

- Provider maintenance and context compaction retain their existing per-Character serialization and share the Utility
  Slot; an occupied slot is not extra model concurrency. Only Legacy Markdown requires maintenance-before-compaction.
  Shutdown settles both branches.
- `runtime-compaction-composition.ts` omits the fact-flush port for an effective published Local runtime and for a
  published Hindsight binding whose complete bound identity matches current authority. This is nonretiring rolling
  summary work: all raw Timeline/PrimaryConversation sources remain, ingestion progress and `lastFlushSeq` do not
  advance, and no synthetic `flush` success event is emitted. Extraction/tidy/connection failures cannot withhold
  otherwise eligible local summaries under that exact published binding. A marker alone is not publication.
- Legacy and unpublished, withdrawn, mismatched or unreadable bindings retain the selected `prepareRetirement`
  fact-flush precondition; an unavailable selected facade yields `retryable_failure` / `MEMORY_FLUSH_FAILED`.
  The coordinator captures the port per operation and preserves its real flush event history. Explicit provider
  coverage and activation/real-retirement preparation remain independently required in every mode; Hindsight's
  direct retirement still needs factual coverage in each selected Bank. Retired writers are never reused.
- At actual Utility Slot dispatch, reject cancelled/expired ownership before calling the model, then renew a valid
  lease for generation. Queue time cannot consume generation's lease, and an expired lease is never revived.
- `characterId` is the durable isolation boundary. `operationId` is only an idempotency/evidence identity; optional
  `runId`/`attemptId` are correlations and never become Compaction authorities.
- A retiring range is contiguous: `selectedFromSeq = expectedSummaryThrough + 1`, and
  `selectedThroughSeq >= selectedFromSeq`. The stable operation identity binds Character, expected summary revision and
  coverage, selected range, and the canonical source digest.
- Exactly one `open` operation may exist per Character. Lease expiry permits a later fenced attempt; an old attempt
  cannot remove the new attempt's controller or write through the replacement fence.
- Timeline appends strictly after `selectedThroughSeq` are allowed while summary generation runs. A change to canonical
  source fields inside the selected range changes the digest and rejects the generated summary as `SOURCE_STALE`.
  The optional tool-call/result `displayName` is presentation metadata and is excluded from this hash; all other source
  fields and the unlabeled v1 digest bytes remain unchanged. See [Operation Presentation](./operation-presentation.md).
- Summary revision and `throughSeq` are rechecked at commit. A competing summary produces `SUMMARY_CONFLICT` and remains
  authoritative.
- Summary replacement, operation state `committed`, and the immutable `committed` event execute in one short synchronous
  SQLite transaction. Any failure rolls all three back.
- Cancellation records durable `cancelled` truth before aborting local model work and never advances `throughSeq`.
  Expired open work becomes `abandoned/LEASE_EXPIRED`; reconciliation is bounded and idempotent.
- The mutable operation row is the recovery cursor; `conversation_compaction_events` is immutable evidence. Neither is
  replayed as model conversation or shown as Timeline scroll-back.
- Operation/event/log evidence is bounded metadata only: opaque IDs, sequence boundaries, token counts, route metadata,
  digests, timestamps, states, and closed failure codes. Never persist or log summary text, prompts, credentials,
  authorization material, raw provider exceptions, raw Tool/MCP payloads, or sensor/media bytes.
- Utility Slot failures log `{ label, code: "UTILITY_TASK_FAILED" }`; provider exception text never crosses the logging
  boundary because it may contain request content or secrets.
- Provider usage is post-hoc calibration for the completed request. A positive authoritative `inputTokens` sample may
  anchor that report, and cache-read tokens still consume capacity; zero/absent usage falls back to the complete local
  estimate. A later usage callback never overwrites the already measured next-Replay pressure snapshot.
- Primary turn calibration uses the last completed SDK step's `event.usage` paired with that same model-call start's
  actual instructions, messages and prepared tool definitions. SDK `result.usage` aggregates all steps and must never
  be divided by a single request estimate. Retain one bounded sample and emit it only through the existing successful,
  non-cancelled after-commit callback. This preserves one EMA update per turn; cumulative Run/Effect accounting remains
  separate. The actual-SDK `chat-agent-usage.test.ts` changes messages, inbox instructions and disclosed tools between
  requests and verifies the paired sample and persisted calibration factor.
- Context Reduction is projection-only. It preserves message order, tool call/result identity, the current user message,
  recent dialogue, system/Character/Memory instructions, and Timeline bytes. Production reducers currently cover typed
  tool results and a provenance-marked rolling-summary head; generic dialogue truncation is not enabled.
- Reducer admission and progress use the full provider-message estimate, never a bounded rendering of candidate text.
  Reprice each applied replacement and stop when the actual message target is met, preserving later candidates such as
  the rolling summary when an earlier tool reduction is sufficient.
- Pressure qualifies at equality, so the reducer's integer message target is
  `max(0, ceil(thresholdTokens - nonMessageTokens) - 1)`. Reaching the inclusive trigger itself is not a safe result;
  fixed non-message pressure may still require compaction even after every reducible message is exhausted.
- Tool output reduction preserves the AI SDK tool-result envelope and call identity. Compaction transcripts use bounded
  structured facts from `TimelineEntry.parts`, head/tail serialization, credential-pattern redaction, and explicit media
  omission. This is defense in depth, not a claim that pattern matching detects every possible secret.
- Summary output is rejected when blank, provider-truncated/filter/error-finished, non-shrinking against the exact safe
  source projection, secret/tag-bearing, or copied from configured protected prompt content. Rejection keeps the prior
  checkpoint authoritative and records only the existing closed `SUMMARY_EMPTY` or `SUMMARY_GENERATION_FAILED` class.
- Optional Timeline `sourceContext` and tool-result `sourceMaterials` are interpretation evidence. Include them in the
  captured/final source digest; omit an absent source property so legacy-null v1 digest bytes remain unchanged.
  Source-only drift refuses summary commitment just as canonical content drift does.
- `renderSafeTranscript` keeps source descriptions beside the bounded associated text, with explicit native tool
  outcome. `reduceSourcedToolResult` uses the projection's retained original-output association; do not parse arbitrary
  tool text as metadata or drop the only source header while retaining its body. Replay folds preserve sidecars and
  failure/denial status even when replacing a payload with an omission trace.
- Source-aware summary instructions share the Memory voice/source convention. Original Timeline text and pending
  source records are unchanged; a summary is never a new original-primary Memory source. Preserve salient facts,
  names, preferences and currently relevant constraints without assuming canonical extraction has already succeeded.
  Actual request/CAS regressions and live semantic observations are separate evidence levels.
- For relevant retained threads, preserve the source/person of each reported event and explicit negation. Similar
  events affecting two people remain separate; a user's clarification does not retract the external person's event.
  An assistant-role sourced material row alone is not evidence that an attribution mistake previously occurred.
- Retry budget and cooldown are derived from durable operation rows. The same operation exhausts its own attempt budget;
  a changed source gets a new operation identity but remains subject to the latest Character-wide failure cooldown.
  Cancellation can retry later without inheriting an unrelated permanent budget exhaustion.
- AI SDK 7.0.17 `prepareStep` remains disabled for Context Reduction. The installed source proves that a returned message
  projection becomes the next loop base, but does not prove exactly-once completed effects across every transport path.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Another unexpired operation is open for the Character | Return `active`; do not start a second Utility Slot call. |
| Same committed operation is observed again | Return committed/duplicate truth; do not replace the summary or append duplicate terminal evidence. |
| Lease owner/fence is stale, cancelled, or expired | Reject the transition as stale; do not append misleading stage evidence or advance the checkpoint. |
| Selected range is discontinuous from expected summary coverage | Reject before durable operation creation. |
| Stable operation ID is reused with different source identity | Reject with an operation identity conflict; never reopen it for different evidence. |
| Canonical source fields in the selected Timeline range change during generation | Record `SOURCE_STALE`; keep the previous summary. |
| Summary revision or coverage changes during generation | Record `SUMMARY_CONFLICT`; preserve the newer checkpoint. |
| Effective published Local ingestion is incomplete or failed | Eligible compaction may proceed; preserve raw sources and truthful ingestion gaps. |
| Hindsight, Legacy or unavailable binding flush is incomplete, fenced, failed, or unavailable | Record the closed failure class; do not summarize/retire the range. |
| Auxiliary generation fails or returns empty text | Record `SUMMARY_GENERATION_FAILED` or `SUMMARY_EMPTY`; do not advance. |
| Terminal event insertion or summary CAS transaction fails | Roll back summary, operation terminalization, and event together. |
| Process restarts with expired open work | Reconcile once to `abandoned/LEASE_EXPIRED`; repeated reconciliation is a no-op. |
| Complete pressure is just below / exactly at / above the proactive threshold | Skip below; qualify at and above. |
| Provider input usage is absent or zero | Use the local complete-envelope estimate; do not fabricate a provider anchor. |
| Deterministic reduction makes the next Replay safe | Persist no false savings; skip Utility compaction only because the same projection will be applied at next admission. |
| A tool result is much larger than its bounded candidate rendering | Price the full provider payload, reduce it, and remeasure before deciding whether another candidate is needed. |
| Integer or fractional trigger leaves a message budget | Target the largest non-negative integer strictly below that budget; equality still qualifies for compaction. |
| A non-primary control request runs while primary maintenance is pending | Preserve the primary relationship pressure snapshot; ephemeral control text cannot trigger Timeline compaction. |
| Summary quality validation fails | Record the bounded existing failure class, keep the old checkpoint, and enforce durable cooldown/budget. |
| Tool output contains nested file/media data | Omit bytes from the compaction transcript; preserve only bounded metadata/facts. |

### 5. Good/Base/Bad Cases

- Good: capture range `1..6` at summary revision `0`; canonical extraction is pending; row `11` is appended during generation; the digest
  for `1..6` remains equal; one transaction writes summary revision `1`, commits the operation, and appends one
  `committed` event while rows `7..11` remain verbatim.
- Base: the process dies before summary commit. The open lease expires, reconciliation records `abandoned`, and a
  later retry reuses the stable operation identity/fenced attempt. Original Timeline and ingestion journals remain.
- Bad: update `conversation_summary` first and append success evidence later; accept a stale lease because the operation
  ID matches; hash the newest tail instead of the selected range; or log the raw provider exception on failure.

### 6. Tests Required

- Fresh, version-31 upgrade, historical lineage, reopen, and second-open no-op coverage for migration 032.
- One-open-per-Character uniqueness, other-Character independence, stable retry identity, increasing attempt/fence, and
  stale-fence rejection.
- Equal source/operation identity for otherwise-identical Timeline rows with absent or changed tool display names;
  canonical content/output changes still change identity or cause `SOURCE_STALE`.
- Flush, generated, failed, cancelled, abandoned, and committed event ordering with append-only trigger enforcement.
- Failed and blocked Local maintenance still permits summary progress only for the effective published Local binding.
  Hindsight/Legacy keep factual flush ordering; an unavailable binding cannot skip it. Test the actual composition
  selector and flush-before-generation coordinator path, not marker identity alone. Queue cancellation/expiry makes
  no model call; valid dispatch renews the lease without fake flush evidence.
- Atomic rollback when committed evidence cannot be inserted; exact duplicate commit idempotency.
- Concurrent tail append acceptance, selected-range mutation rejection, summary revision/coverage conflict, and
  discontinuous range/operation-ID conflict rejection.
- Cancellation before model settlement, overlapping expired-attempt retry/controller ownership, restart reconciliation,
  and composition-level `cancel/reconcile` exposure.
- Timeline byte equality, deterministic Replay View replacement, Character isolation, and forbidden-content checks for
  operation/event/log evidence.
- Complete-envelope tests below/at/above `0.8`, cache-read occupancy, zero/absent usage fallback, history-ratio
  independence, effective-window calibration, and separate overflow shrink behavior.
- Tool-result and rolling-summary-head reducers independently change the actual provider projection, preserve valid AI
  SDK shapes, remeasure savings, protect recent/current dialogue, and leave Timeline rows byte-identical.
- A 60,000-character tool result must be reduced based on its full request cost even when its bounded candidate text
  looks small; once that reduction meets the target, preserve the next rolling-summary candidate byte-for-byte.
- Integer and fractional pressure thresholds both require a strictly-below-trigger message target.
- Post-turn tests persist assistant/tool output before measuring the updated Replay, then prove the final pressure
  snapshot is visible before detached maintenance and is not replaced by later usage reporting.
- Hold primary maintenance pending, run a large non-primary control request for the same Character, then release
  maintenance: the control reaches the model, but the snapshot and Timeline stay unchanged and no Utility compaction
  starts when the primary relationship pressure was safe.
- Summary quality tests cover blank/whitespace, length/filter/error finish, exact non-shrink, forbidden tags/secrets,
  protected prompt content, durable retry/cooldown across restart/source changes, cancellation, lease expiry, and CAS.
- Core focused/full tests, Core/workspace typecheck as applicable, root lint, migration/task validation,
  `git diff --check`, and an isolated Core boot whenever composition or migration wiring changes.

### 7. Wrong vs Correct

```ts
// Wrong: process-local locking plus a non-atomic summary write.
if (!running.has(characterId)) {
  summaries.upsert({ characterId, throughSeq, text });
  events.append({ kind: "committed" });
}

// Correct: a fenced durable lease and one SQLite CAS transaction own the checkpoint transition.
const begun = operations.begin(snapshot);
if (begun.status === "started") {
  operations.commitSummary({
    lease: begun.lease,
    text,
    sourceDigest: snapshot.sourceDigest,
    now,
  });
}
```
