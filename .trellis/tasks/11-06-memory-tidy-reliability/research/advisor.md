# Independent tidy reliability review

Date: 2026-11-06. Scope: architecture advice before implementation; no production edits or live model/database mutations.

## Decision

Proceed with one new `tidy` kind in the existing durable memory operation owner, one Canonical Local reviewed-candidate checkpoint, and a small explicit completion/error-resolution contract. Retain the existing Utility Slot and canonical transactional mutation APIs. Do not add a second operation recorder, queue, general workflow framework, or replacement-action matching system.

The owner's requirements are execution correctness, practical recovery, and actionable unresolved outcomes. They do not require proving model judgment infallible. Ordinary rejected model calls are part of an agent's normal control flow; unknown persistence outcomes and a changed authority are materially different.

## Verified premises

- `canonical-local-tidy.ts:228-255` retains non-revision errors under fatal keys. `tidy-pass.ts:196-210` separately accumulates SDK validation errors with no resolution path. The baseline reproduction is consistent with both mechanisms.
- `tidy-pass.ts:138-146` captures the review and builds its report before waiting for the Utility Slot. `utility-slot.ts:52-70` serializes only the callback. A manual request waiting behind a writer can therefore hold an obsolete review. The fix belongs at queue admission, not in a looser CAS write.
- `tidy-report.ts:204-230` truncates new candidate rendering, while `tidy-pass.ts:160` advances one whole-pass timestamp. This timestamp is not proof of per-candidate coverage.
- `memory-operation-service.ts:47-67` already owns restart reconciliation and lifetime; `:69-89` owns single-flight admission and detached execution; `:122-135` owns durable transitions/publication. `memory-operation-repo.ts` stores generic kind text and JSON, so adding a kind does not require rebuilding its SQL table.
- `memory-operation-schema.ts` currently forbids nonterminal `result`, but permits a typed mutable producer reference. A tidy producer reference can carry a bounded progress summary without overloading final result semantics.
- `memory-status.ts:29-32` cannot recover a lost tidy outcome. `memory-tidy-controller.ts:27,44,55-62` is disposable local UI state. More client retries alone cannot solve this.
- `tidy-pass.ts:185-187` has only a step limit. The direct Utility compatible model has no tidy total deadline. A provider that does not settle can occupy `utility-slot.ts:74-78` indefinitely. This is a reachable missing failure-path control, not an observed explanation of the four completed live requests.

## Concrete wiring

1. Construct the selected Memory runtime as today. It owns the raw Local tidy producer and candidate eligibility.
2. Construct `MemoryOperationService` as today in `main.ts:329`, adding a narrow live Local tidy accessor to its context and a `tidy` kind handler.
3. Install a narrow `submitTidy(characterId, origin)` callback into runtime composition before accepting WS/chat work. Apply it to the current Local subsystem and later Local activation. Runtime imports only the callback contract, not the operation service. No producer invokes its own operation handler.
4. Automatic maintenance performs ingestion, checks Local candidate/backoff eligibility, then submits or joins family `tidy:<characterId>`. A busy family reuses the active operation; it does not silently enqueue another snapshot.
5. The kind's execute path calls **raw `runNow`**, never `maybeRun`. The raw producer acquires the existing Utility Slot, then rereads candidate state and captures exact revisions. Queued work never trusts a pre-queue report.
6. New Home behavior uses the existing operation submit/status/list/push channel. Legacy `memory.tidy` remains a compatibility wrapper that submits/joins and awaits that same in-flight execution. A keyed in-flight promise map is sufficient; no new worker/queue is required.
7. Keep direct Legacy/Hindsight tidy semantics on their existing paths. Do not announce Local progress/recovery guarantees for those providers without their own implementation and tests.

## Completion and errors

Keep one bounded issue ledger. Give each refusal a short, Core-minted issue ID and a closed safe classification, tool name, field/validation stage where known, and correction hint. Do not save raw memory bodies or arbitrary exception text to operational diagnostics.

Extend the existing finish tool rather than adding another agent or elaborate action matcher:

- A known **no-write rejection** may be acknowledged as corrected using a later successful call ID, or explicitly discarded as not needed using a small disposition/reason vocabulary.
- Corrected references must name a real later success from this review; do not accept an invented call or a cached pre-error success. Do not claim exact semantic equivalence when the original reference was malformed and that equivalence is unknowable.
- A model may decide an attempted edit was unnecessary. Record that as a skipped/rejected attempt, distinct from a successfully applied edit. Explicit acknowledgment makes this reviewable; automatically forgiving every failure on finish does not.
- Unknown/internal errors whose persistence effect is not established, authority retirement, and request-identity conflict remain blocking. Acknowledgment cannot turn them into known no-write outcomes.
- Successful tool results and accepted finish are different events. Change the stop condition to accepted finish, not merely `hasToolCall(finish)`, because a rejected finish must leave room for correction.

Short pass-local handles are reasonable prompt usability work: map a small handle to the same exact canonical identity and revision internally. This preserves the existing ownership/CAS rules while avoiding repeated model copying of long base64 references. A returned new handle may admit a new revision after a successful edit. External revision conflicts need a fresh disclosed view before another write, not silent current-revision substitution. The historical live invalid-call arguments are missing, so reduced copying errors is a prospective benefit, not the proved historical cause.

Set SDK `toolCallConcurrency: 1` for this mutation-heavy private toolset unless tests establish a reason to retain parallel execution. Keep full current record content visible when granting a newly refreshed revision. Do not blindly refresh a record that has become hidden or left the captured Character/Bank scope.

## Candidate coverage

Use an epoch/Character/Bank/memory keyed **reviewed revision and reviewed timestamp** checkpoint. A single chronological cursor is not the simpler correct choice: mixed report classes, equal timestamps, writes during a pass and edits created by tidy itself would require additional exceptions.

- Derive eligible candidates from current authoritative records and checkpoint evidence. Keep full diagnostic health counts separate from the bounded candidate batch.
- Select one bounded union of candidate records for a batch and render all selected candidates. Do not independently truncate classes and then mark their unseen union reviewed.
- Accepted finish acknowledges that visible batch. Atomically record its captured revisions and the known resulting revisions produced by its own successful edits. Never mark an externally updated current revision reviewed merely because it occupies the same identity.
- An interrupted/step-capped batch keeps its actual edits but no invented review completion. A later attempt reads fresh data; it never replays saved model actions.
- Successful intermediate batches may checkpoint while the overall operation still has pending candidates. Whole-operation success requires its pending coverage to be exhausted, not just an accepted finish for the first ten rows.
- Pending continuation must bypass the normal 40-new-write cadence; otherwise a tail smaller than the threshold stalls indefinitely.
- A judged no-op row must not immediately reappear at the same revision. `reviewedAt` permits time-based stale review to become due again under an explicit policy. New revisions remain eligible immediately according to cadence.
- Bootstrap the new checkpoint honestly. The old successful timestamp does not prove every historical row was shown; do not synthesize per-record acceptance from that timestamp. A bounded initial catch-up is preferable to preserving the known coverage hole.

## Durable progress and retry

Use the operation's tidy producer reference for counts/state needed while running: started/batch/steps/applied edits/reviewed/pending and retry metadata. Keep the final tidy outcome in the result arm. Operational status remains content-free.

If UI/restart promises exact applied counts, update the durable progress in the **same transaction** as each canonical mutation. The current outer guard counts after underlying writes return; merely adding an after-write in-memory counter leaves a crash gap. A narrow per-tool enclosing canonical transaction plus producer progress callback is sufficient. Publish transitions via `db.afterCommit` when nested inside a larger write, so rolled-back progress is never broadcast. Block edits must obey the same rule as row edits.

On restart the existing owner changes open operations to `outcome_unknown/core_restart`. Retained committed progress is a lower-bound/known fact, not evidence that remaining work ran. A new explicit or policy-permitted attempt creates a fresh review over the current database. It does not resume uncertain old tool calls.

Bound automatic retries with persisted failure count/next eligibility, or an equivalent query over the existing tidy operation history. A changed chat turn alone must not reset the failure budget. Preserve pending candidates when retry is paused and expose `retry_scheduled` versus `explicit_retry_required` in the final producer result. User-triggered Retry should start a new attempt after the active operation is terminal; it must not duplicate an active one.

Use the installed SDK's `timeout`/`abortSignal` controls for elapsed execution limits. Its installed declarations include `TimeoutConfiguration` (`index.d.ts:769`), agent-call timeout/abort (`:5152`) and sequential tool concurrency (`:5647`). Verify current official documentation and actual HTTP abort behavior before implementation claims. A cooperative timeout cannot guarantee cancellation of arbitrary non-cooperative custom model code; do not claim otherwise or introduce a detached duplicate execution loop.

## Acceptance failure matrix

| Scenario | Required observation |
| --- | --- |
| Malformed handle/schema, then a valid correction | One real successful edit; acknowledged rejected attempt; accepted final completion |
| Model abandons an unnecessary refused edit | Explicit skipped disposition and zero fabricated mutation |
| Unknown repository exception or authority retirement | Completion blocked; retained effects and actionable outcome preserved |
| Rejected finish, then corrected finish | Model gets a further step; first finish call does not stop the loop |
| Duplicate tool receipt or repeated operation submit | No additional mutation/count; one active operation |
| More candidates than report cap; unchanged/no-op candidate | Every batch remains addressable; no unseen row marked reviewed; no immediate loop on judged same revision |
| External write while waiting for Utility Slot | Fresh report sees new revision; no pre-queue reference used |
| External write after capture | CAS refuses; newly disclosed view required; new version never checkpointed implicitly |
| Manual plus automatic trigger, or two clients | Same durable active operation or explicit busy response |
| Step limit/provider failure after one committed edit | Partial outcome and exact durable committed progress; pending coverage survives |
| Core restart after mutation but before model finish | Prior operation unknown/interrupted; committed edit count preserved; fresh retry does not replay old action |
| Never-finishing HTTP response | Built-in timeout aborts request; Utility Slot becomes usable; operation reaches a clear terminal state |
| Repeated failures across multiple chat turns/restart | Backoff/stop persists and UI states the next action; no request storm |
| Lost submit reply, hidden page, remount/reconnect | Query/push restores the actual operation; UI does not resend mutation |
| Unseen initial historical row | Initial checkpoint migration does not fabricate prior review coverage |

## Why prior green checks were insufficient

The existing tests intentionally assert that invalid/unknown calls remain fatal (`canonical-local-maintenance.test.ts:296-309`), and the previous accepted design explicitly limited correction to exact revision conflicts. Those tests verified that narrow design; they did not prove the broader user requirement of recoverable everyday maintenance. Candidate-report tests separately assert truncation and counts, while pass tests separately assert timestamp advancement; the cross-layer coverage invariant was missing. Future checks must begin with these user-observable failure sequences, plus real SDK/HTTP and UI recovery wiring, rather than increasing the number of helper-level green tests.

## Limits

This review read the actual repository and installed SDK declaration surfaces. The parent's prior isolated reproductions support the sticky-error and candidate-coverage findings. This advisor did not run new tests, mutate production code, call a paid model, or re-run the live tidy action. Independent research of mature external projects is delegated separately. Model-generated memory correctness and owner UI acceptance remain separate from deterministic lifecycle verification.
