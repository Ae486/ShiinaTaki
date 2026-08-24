# Slice 1 Implementation Seams

## Readiness conclusion

The child PRD, design, and implementation plan are specific enough to begin implementation without inventing a new
runtime architecture. The live repository already supplies the needed primitives: one synchronous SQLite wrapper and
transaction boundary, explicit numbered migrations, typed repository row parsing, optimistic generation/revision
guards, an immutable Extension/Host run-context snapshot, a provider-neutral Memory authority/capability seam, and a
single AI SDK `ToolLoopAgent` loop. Implementation still needs three owner decisions frozen before code is written:

1. whether the additive `chat.send` acknowledgement carries a required `runId` (recommended) or keeps `runId` only in
   a later query;
2. whether a non-primary turn may write any relationship Timeline rows in Slice 1 (recommended default: no rows; Run
   evidence/Receipt only); and
3. whether Admission may await provider-neutral capability reads before returning the acknowledgement (recommended:
   yes, outside the SQLite transaction).

No migration number is allocated here. The synchronized registry is currently contiguous through version 23.

## Verified live patterns

### SQLite, migration, repository, transaction, and optimistic version patterns

- `packages/core/src/db/sqlite.ts:24-29,56-68` defines the only `node:sqlite` boundary. `Database.transaction(fn)` is
  synchronous, supports nested savepoints, and rolls back on throw. No async gap may occur inside the callback.
- `packages/core/src/db/migration-runner.ts:8-40` uses numbered TS constants (`{version, sql}`), creates/tracks the
  `migrations` table, and wraps each migration plus its tracking row in one transaction. Failure is fatal-fast with a
  migration-specific error.
- `packages/core/src/db/migrations/index-list.ts:27-55` is the explicit registry. `index-list.test.ts:4-9` proves
  versions are unique, ascending, contiguous `1..23`, and non-empty. The next version must be checked against main and
  all exercised histories immediately before implementation, never reserved in a planning file.
- `.trellis/spec/backend/database-guidelines.md:9-19,30-45,59-69` requires snake_case tables, ISO UTC timestamps,
  one repository per real aggregate, Zod parsing at row boundaries, post-commit WS events for externally relevant
  writes, and short synchronous transactions. The same spec requires additive convergence migrations when divergent
  histories have reached real databases.
- `packages/core/src/db/timeline-repo.ts:41-57,67-117,126-145` is the closest simple repository pattern: prepare
  typed SQL once, sanitize before insert, map rows through a schema at the boundary, and make deletes idempotent.
  `ConversationStore` then colocates `onAppend`/`onRemove` after the repository write
  (`packages/core/src/agents/conversation-store.ts:85-114`).
- `packages/core/src/governance/governance-policy-repo.ts:51-75,92-127` is the best optimistic-version service
  pattern. It reads the current generation and applies the mutation inside one transaction; stale writers receive a
  structured `PolicyConflictError`; no-op mutations advance nothing. Its tests pin this behavior at
  `governance-policy-repo.test.ts:29-47`.
- `packages/core/src/db/hindsight-connection-repo.ts:39-49` is the direct compare-and-swap row pattern: validate the
  candidate revision equals `expected + 1`, update with `WHERE ... revision=:expected`, and require
  `changes === 1`. The test at `hindsight-connection-repo.test.ts:6-15` proves stale revisions fail.
- `packages/core/src/db/canonical-memory-repo.ts:64-68,160-190,221-237` combines a short `atomic` transaction,
  request-hash idempotency receipts, expected-revision checks, replay of an identical request, and conflict on a reused
  request ID with a different hash. This is the preferred pattern for Trigger idempotency and terminal settlement.
- `packages/core/src/db/hindsight-cutover-run-repo.ts:93-127` and
  `packages/core/src/memory/legacy-migration/legacy-migration-ledger-repo.ts:65-75,95-118` demonstrate lease/fence
  guards: update predicates include owner/fence/status and every mutation requires exactly one changed row. Slice 1
  should use the same `changes !== 1` stale/no-op guard for Run and Attempt callbacks, without adding a lease aggregate.

### WS `chat.send` acknowledgement, queue, error, cancellation, and close semantics

- `packages/core/src/server/methods/chat-send.ts:32-49` currently allocates a random `messageId`, schedules
  `runQueued` with `setImmediate`, and returns `{messageId}` immediately. The comment at lines 44-46 makes the contract
  explicit: the ack is flushed before the first delta. The ack does not mean a model request started or succeeded.
- `chat-send.ts:62-73` acquires the per-Character process queue, registers an active `AbortController`, then always
  ends the registry entry and releases the queue in `finally`.
- `chat-send.ts:76-121` registers `ctx.onClose` only inside `pump` today (line 81), forwards deltas, emits `chat.complete`
  on ordinary/after-output cancellation, emits `chat.error {retracted:true}` when the agent retracts a pre-output user
  row, and maps provider/agent throws to bounded `chat.error` text. `readableError` at lines 123-130 never includes the
  prompt or key by construction.
- `packages/core/src/server/ws-server.ts:42-59,125-141` owns sockets. `ctx.onClose` callbacks are collected per
  connection and run once on socket close; replies are sent only while the socket is open. `dispatchFrame` waits for
  the method handler and sends its response before closing when a handler requests closure.
- `packages/core/src/agents/turn-queue.ts:9-45` is a FIFO keyed async mutex. It serializes the same Character and keeps
  different Characters concurrent. It has no non-destructive busy probe or queued cancellation today.
- `packages/core/src/agents/turn-registry.ts:7-49` tracks only active controllers. `cancel` is idempotent and returns
  false for idle or already-aborted turns; queued-but-not-started work is explicitly not cancellable.
- Existing assertions to preserve are `packages/core/src/server/methods/chat-send.test.ts:43-72` (same-Character FIFO),
  `:74-123` (cancel and role), `:126-165` (retract/error versus complete), and the real socket ack ordering in
  `packages/core/src/server/ws-server.test.ts:197-212` (ack precedes first delta). Socket close and pre-auth behavior
  is covered at `ws-server.test.ts:109-146,148-181`.

#### Recommended Admission/ack boundary

Admission must run before the ack is returned. The `chat.send` handler should:

1. derive/generate a trigger request ID and idempotency key;
2. validate/admit synchronously at the SQLite boundary, or await provider-neutral reads before entering the short DB
   transaction;
3. commit a `queued` Run, its immutable snapshot, and its first `prepared` Attempt in one Core transition/transaction;
4. register a close callback immediately after admission that requests durable cancellation for this Run, then aborts the
   process-local controller when one exists; and
5. schedule the existing queue pump only after the admission result is committed, returning `{messageId, runId}`.

This preserves the old ack-before-delta ordering while changing the truth of the ack from “a pump was scheduled” to
“a durable Run was admitted/queued.” It never claims model success. Admission failure returns a JSON-RPC error and
creates no fake Timeline row or model effect. A connection close while a Run is waiting for the Character queue is
therefore visible to the durable Run service; the current `ctx.onClose` registration inside `pump` is too late for this
case and must move to the post-admission handler seam. Existing `chat.cancel({characterId})` behavior should remain for
legacy callers; an optional `runId` exact-cancel field is the safest additive extension if owner approval permits it.

## Recommended persistence shape

Use one Core Run transition service as the only lifecycle writer. The likely repository split is:

- `run-repo.ts`: Run current state, Run-owned Operation/program-counter fields, idempotency lookup, and immutable
  snapshot reference. It performs compare-and-swap transitions against `(run_id, state_version, active_attempt_id)` and
  refuses all writes once terminal.
- `attempt-repo.ts`: subordinate ordered Attempts, each carrying `attempt_id`, `run_id`, ordinal, state/version,
  retry reason, captured generation tuple, deadline/start/settlement timestamps, and bounded result/error summary. Every
  settle/update predicate includes the Run/Attempt identity tuple and expected versions.
- `run-snapshot-repo.ts` (or a Run child repository if kept private): append-only immutable snapshot rows keyed by
  `snapshot_id` and `run_id UNIQUE`; no update API. Store only the redaction-safe manifest and digest described below.
- `run-receipt-repo.ts`: a projection/evidence record keyed by `run_id`/`receipt_id`, written in the same transition
  transaction for terminal summaries and read by query. It must not be a lifecycle authority.

The next migration should create the smallest additive set of tables (exact name/version remains implementation work):

```text
runs
  run_id PK, character_id, trigger_request_id, idempotency_key UNIQUE (provider scope as chosen),
  parent_run_id NULL, task_id NULL, initiator/provenance/delivery JSON, state, state_version,
  operation_phase, operation_json (bounded), active_attempt_id NULL, snapshot_id, receipt_id NULL,
  queued_at, started_at, deadline_at, terminal_at, terminal_outcome NULL, retryable NULL,
  cancel_requested_at/reason NULL, created_at, updated_at
attempts
  attempt_id PK, run_id FK, attempt_no, state, state_version, retry_reason NULL,
  provider_id/model_id, snapshot_id, started_at, deadline_at, settled_at,
  outcome NULL, retryable NULL, bounded_result_json/error_code/error_summary NULL,
  UNIQUE(run_id, attempt_no)
run_snapshots
  snapshot_id PK, run_id UNIQUE/FK, schema_version, manifest_json, manifest_digest,
  captured_at, created_at
run_receipts
  receipt_id PK, run_id UNIQUE/FK, state/outcome/retryable, reason/action,
  attempt_count, snapshot_id, bounded_summary_json, created_at, updated_at
```

The `runs` row is the current Operation authority; no public `operation_id` table is needed. A transition service should
perform state validation, expected-version update, subordinate Attempt settlement, and receipt projection in one short
transaction. Duplicate terminal settlement should return the existing terminal result. A stale callback should either
return an idempotent existing result (same attempt/version) or a stale/duplicate classification without changing rows.
Do not persist full Run Event Ledger facts in Slice 1; reserve the later event-ledger migration, while retaining bounded
receipt evidence now.

Migration acceptance must reuse the existing matrix: fresh install and no-op reopen (`sqlite.test.ts:44-57`), historical
T4 17/18, pre-021 database applying the committed 021-023 tail, and legal Hindsight marker/receipt reopen. The child
PRD/design already name these cases; implementation must run them against the current `MIGRATIONS` endpoint at 23 before
allocating the next number.

## Context Manifest and immutable snapshot

### Reuse existing runtime data without storing secrets or prompts

Admission should capture existing immutable/process snapshots, then persist a reduced manifest:

- Character and trigger provenance: `characterId`, initiator kind, provider kind, trigger/task/parent IDs, delivery class,
  context mode, deadline/budget policy, and bounded provenance references/hashes. Never store the trigger prompt body.
- Model route: provider identifier and model identifier only. `provider-config.ts:1-24` treats base URL/API key/model as
  boot credentials; persist only the non-secret model/provider labels, never base URL, API key, or environment payload.
- Host: from `HostContextSnapshot` (`packages/core/src/hosts/host-context.ts:12-29,31-37,56-85`) persist primary Host ID,
  per-Host ID/readiness and `connectionGeneration`/`catalogGeneration`, plus bounded capability IDs and execution class.
  Do not persist labels, workspace paths, media, or rendered prompt text unless a later authorized projection requires it.
- Extension/Skill/MCP: `ExtensionRunSnapshot` is built and frozen by
  `packages/core/src/extensions/extension-run-context.ts:25-58` and `packages/core/src/extensions/extension-registry.ts:108-128,265-272`.
  Persist an `extensionSnapshotDigest`, catalog generation tuple, and bounded identity tuples (kind, ownerHostId,
  subjectId, subjectRevision, connection/catalog generations, available/call mode). Do not persist instructions,
  descriptions, tool closures, raw MCP inputs, or credentials. The complete process snapshot remains in the adapter for
  retries; the DB manifest is the recovery/query-safe projection.
- Governance/Approval: persist policy generation, registry revision, and opaque approval/presentation generation refs
  from existing Core services. Never persist decisions' credential values, approval prompt prose, or secret catalog data.
- Memory: read provider-neutral active epoch and capability snapshot through `memory-coordinator.ts:43-49,52-78,88-99`
  and `canonical-memory-authority-repo.ts:42-57`. Persist provider ID, lineage ID, authority epoch ID, contract version,
  capability booleans, and a stable capability digest. Do not copy memory text, recall queries, prompts, Hindsight URLs, or
  raw provider payloads into the manifest.
- Replay/context accounting: persist source categories and opaque revision/hash refs, Replay View window start/summary
  coverage decisions, bounded token estimate/accounting status, implementation/schema version, and manifest schema version.
  `ConversationStore` remains the Timeline/Replay authority (`conversation-store.ts:98-125`); the manifest stores only its
  decision metadata, never reconstructed prompt messages.

### Suggested manifest contract

`RunSnapshot` should contain `schemaVersion`, `snapshotId`, `runId`, `capturedAt`, `characterId`, `initiator`,
`provenanceRefs`, `modelRoute`, `hostRefs`, `extensionRefs`, `governanceRefs`, `approvalRefs`, `memoryRef`,
`contextDecision`, `replayDecision`, `budget/deadline`, `sourceRefs`, `implementationRef`, and `manifestDigest`.
All arrays and strings require explicit bounds; all nested objects are strict Zod objects. A test must attempt to insert
prompt text, `dataBase64`, API keys, secret refs, raw tool input/output, and sensor/media payloads and prove the schema
rejects them or the builder drops them. Hash only when a caller can show the hash is non-sensitive and bounded.

## Narrow `chat-agent.ts` primary/non-primary seam

Keep `ChatSendParams` wire compatibility and carry the autonomous metadata through the existing `TurnContext` (or an
equivalent injected adapter input): `turnKind: "primary" | "non-primary"`, `runId`, `controlInput` (model-facing,
non-persisted), `runContext`, and `signal`. This is narrower than changing the AI SDK loop or forking an autonomous
agent. `ChatAgent.stream(params, turn)` remains one method and continues to construct exactly one `ToolLoopAgent`.

Branch only the primary-only boundaries in `chat-agent.ts`:

- At current `chat-agent.ts:146-163`, append a user row and capture `userSeq` only for `primary`; non-primary creates no
  fake user row and therefore has no sequence to retract.
- At `chat-agent.ts:206-236`, compose the model-facing non-primary control input as an ephemeral user message appended to
  the replay history. Do not mutate `history` or store the control input. The current `buildOutgoing` replacement of the
  last user row (`:359-375`) must have a non-primary branch because autonomous history may end in an assistant/tool row.
- At `:227-230`, call `costumeChanged` only for primary. Non-primary gets no one-shot notice.
- At `:334-347`, execute cancel-before-output retraction only when `turnKind === "primary"` and a real `userSeq` exists;
  non-primary cancellation settles Run/Attempt but never calls `ConversationStore.removeEntry`.
- At `:297-305`, fire `autoMemory.onTurnCompleted` only for primary. Non-primary must not advance the conversational
  watermark. Image-memory hooks should likewise be opt-in and provider-specific; Slice 1 should default them off for
  non-primary.
- At `:406-418`, persist the completed response tail/partial assistant text only through an explicit relationship-write
  policy. Recommended Slice 1 default for non-primary is no `ConversationStore` append at all; the Run Receipt/evidence
  path owns the bounded outcome. A later delivery slice can explicitly append whole speech through the ordinary Timeline
  owner.

Existing primary tests that must remain unchanged and green:

- `packages/core/src/agents/chat-agent.test.ts` (history prompt and base behavior);
- `chat-agent-lifecycle.test.ts:27-80` (full tool-call/result tail persistence and replay);
- `chat-agent-tail.test.ts:47-69,142-220` (volatile tail never persisted and both cancel endings retract correctly);
- `chat-agent-costume.test.ts:23-79` (one-shot notice, no persistence, no stale re-fire);
- `chat-agent-usage.test.ts:36-149` (detached usage only on committed primary paths);
- `chat-agent-overflow.test.ts`, `chat-agent-approval.test.ts`, `chat-agent-presentation.test.ts`, and
  `chat-agent-images.test.ts` (overflow retry, approval denial, presentation stop, and attachment boundaries);
- `conversation-store.test.ts` and `timeline-repo.test.ts` (relationship persistence/replay authority);
- `packages/core/src/server/methods/chat-send.test.ts:43-165` and `ws-server.test.ts:197-212` (ack, queue, cancel,
  retract/error, and ack-before-delta).

New focused tests required:

1. non-primary model input is ephemeral and does not append a user row, assistant/tool tail, or control-input text to the
   Timeline by default;
2. non-primary never calls `costumeChanged`, `removeEntry`, `autoMemory.onTurnCompleted`, or conversational watermark
   advancement, including graceful and thrown cancellation;
3. non-primary still persists bounded Run/Attempt settlement and Receipt outcome, with no fake Timeline projection;
4. primary path remains byte/behavior compatible when `turnKind` is absent or explicitly `primary`;
5. exactly one captured extension/Host run context is reused by overflow retry, and stale generation is not redirected;
6. admission closes over the Run ID before queueing, close-before-start requests durable cancellation, and active close
   aborts the process-local stream;
7. query/Receipt output rejects or omits prompts, secrets, raw tool payloads, and sensor/media bytes.

## Minimal WS query surface

Follow the existing one-method-per-file/read-only pattern:

- Shared: add `RUN_METHODS = { status: "run.status" }`, `RunStatusParamsSchema = {runId}`, and a strict
  `RunStatusResultSchema` containing Run state/version, active/terminal Attempt summaries, snapshot/manifest digest and
  bounded Receipt summary only.
- Core: add `packages/core/src/server/methods/run-status.ts` with `roles: ["operator"]`, `paramsSchema`, and a handler
  that delegates to `RunService.status(runId)` and parses the result. This mirrors `memory-status.ts:18-33` and
  `hindsight-cutover-methods.ts:21-33`.
- Registry: register once in `main.ts` alongside other read methods. `method-registry.ts:87-104` already validates params,
  role, and result/error envelope behavior; no WS server switch is needed.
- No new subscription or live event method is needed in Slice 1. `chat.delta/.complete/.error` remain presentation
  notifications; Timeline subscriptions remain relationship projections and cannot settle Run state.

## Blockers and owner decisions

### Required before implementation

- Freeze ack schema: recommended `{messageId, runId}`. Keep `messageId` for current UI correlation; `runId` is durable
  admission/query identity. Existing clients parsing the current object schema continue to read `messageId`, while the new
  shared type becomes explicit. If the owner rejects this, document how a caller learns `runId` after a lost ack.
- Freeze non-primary Timeline policy: recommended no relationship writes in Slice 1, including assistant/tool tails;
  later delivery explicitly appends ordinary whole speech. If bounded assistant evidence is needed now, specify its
  separate Receipt field and never route it through `ConversationStore`.
- Freeze Admission read boundary: recommended await provider-neutral Memory capabilities/authority and any other snapshot
  reads before the short synchronous SQLite transaction; the WS dispatcher already awaits handlers
  (`method-registry.ts:87-104`). Do not await inside `db.transaction`.

### Not blockers

- Migration number is intentionally unverified until the implementation session checks main and all real histories. The
  current T4 registry is verified at 23; this is a required implementation gate, not a planning contradiction.
- Full Run Event Ledger, event sequence, recovery worker, Scheduler/Heartbeat policy, and delivery UI are explicitly
  deferred by Slice 1. Their future seams are preserved by `runId`, `attemptId`, snapshot/manifest references, and
  bounded Receipt evidence.

## Implementation-ready assessment

**Completed:** live code and required parent/child artifacts were read; persistence, WS, chat-agent, snapshot, query, and
test seams are mapped; this research artifact is written.

**Incomplete:** no production code, shared schema, migration, repository, service, or test was implemented by this
explore task. Owner decisions above remain to be frozen before implementation.

**Unverified:** no new migration lineage, Run service, non-primary adapter, or redaction test exists yet; no new Core boot
or full quality gate was run for Slice 1 production changes.

**Extra changes:** only `.trellis/tasks/08-23-slice-1-harness-foundation/research/implementation-seams.md` was modified.
No production files, PRD/design/implement files, JSONL manifests, Git state, or other worktrees were changed.

**Residual risk:** the current queue cannot cancel queued-but-not-started work and the current close callback is installed
only after queue acquisition; both must be corrected at the Admission/Run boundary. If the implementation writes a fake
non-primary user row or treats the ack as model success, it violates the accepted architecture. Provider-specific model
or Memory APIs must remain behind the provider-neutral snapshot adapter.

**Implementation readiness:** ready to implement after the three owner decisions are recorded. No architectural invention
is required beyond the concrete seams and table outline above.
