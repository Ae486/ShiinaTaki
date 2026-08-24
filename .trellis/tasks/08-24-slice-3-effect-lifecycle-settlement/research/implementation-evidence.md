# Slice 3 implementation evidence

## Authoritative execution status

The architecture theme is split into sequential, context-reusing batches. This section is the first recovery anchor
after session compaction; verify it against Git and the latest agent report before continuing.

| Batch | Boundary | Status |
| --- | --- | --- |
| 3A | Effect/Usage contracts, migration/repository/service, per-provider model middleware, authoritative usage, Model/Run/Attempt truthfulness | `approved_pending_commit` |
| 3B | Governed Tool, Approval wait/final revalidation, Host identity threading, MCP generation/lease settlement | `not_started` |
| 3C | Explicit Memory effects, non-primary preservation, full cross-boundary/process acceptance | `not_started` |

The unique Slice 3A implementation and formal-check agents have finished. The final xhigh check approved 3A only after
repairing the real overflow replacement-Attempt binding, durable Effect event evidence, stale callback classification,
and the direct acceptance-matrix tests. Do not dispatch another 3A implementation or check agent.

Recovery procedure:

1. Read `implement.md` section 0 and this file.
2. Inspect `git status`, current task status, and the latest `/root/slice3_impl` report.
3. Treat the final `APPROVED (Slice 3A only)` check below as authoritative over historical failed checks.
4. Commit 3A with an explicit batch label; then continue 3B using the same parent research and shared contracts.
5. Never claim complete Slice 3 until 3C integration acceptance passes.

## Slice 3A acceptance matrix

- [x] Every actual ToolLoopAgent internal provider request is wrapped by installed AI SDK 7 model middleware, not only
      the outer `agent.stream()` call.
- [x] Effect intent commits before `doStream`/`doGenerate`; failed intent starts no provider request.
- [x] Success, provider failure, abort, and uncertain outcome settle truthfully under the same reserved identities.
- [x] Each settled model request has authoritative `reported`, `estimated`, or `unknown` usage evidence.
- [x] Effect CAS, exact duplicate no-op, stale/wrong-attempt rejection, redaction, event order, and post-commit live
      isolation are tested.
- [x] Existing primary Timeline persistence, partial response, cancel/retract, clean overflow retry, and non-primary
      behavior remain green.
- [x] Migration fresh/historical/reopen/no-op, Shared/Core typecheck/tests, lint, E2E typecheck, task validation, and
      `git diff --check` pass.
- [x] Any limitation in atomically coupling model output storage, Effect settlement, and Run/Attempt progression is
      documented as a concrete authority boundary; no false atomicity claim remains.

## Verified

- Added `effect.v1` bounded shared contracts for effect identity, subsystem references, replay posture, terminal outcomes, and usage quality.
- Extended the Slice 2 RunEvent closed union with `effect.intent_committed`, `effect.waiting`, `effect.settled`, and `usage.settled`; category/source pairing is validated and legacy lifecycle events remain unchanged.
- Added additive migration 026 with Run-owned `run_effects` and authoritative `run_usage` tables, lineage triggers, and indexes. Historical 17/18, 20, and 25 migration lineages converge through 026 and reopen as a no-op.
- Added `EffectRepo` and `EffectLifecycleService` with intent-before-dispatch persistence, version CAS settlement, exact terminal duplicate no-op, stale callback rejection, post-commit live publication, reserved result/usage IDs, and bounded summaries/error codes.
- Replaced the initial outer stream wrapper with installed AI SDK 7 `wrapLanguageModel` middleware. Both `wrapStream`
  and `wrapGenerate` commit intent before invoking the provider. A two-step tool-loop test proves distinct effects for
  the two internal provider requests.
- Provider stream finish settles reported usage; missing provider counts settle estimated usage; interrupted/errored
  streams settle `outcome_unknown`, while pre-stream provider failures settle failed unless an abort made acceptance
  uncertain. Raw prompts/provider errors are never persisted.
- Model Effect intent and settlement atomically update the active Attempt version together with effect state, usage,
  and canonical events. Timeline response storage remains a separate ConversationStore transaction. The reserved
  result identity records the intended linkage, but 3A does not claim atomic output-content plus Effect settlement;
  Timeline remains conversational authority and Run/Effect rows remain recovery/current-state authority.
- Readable projection maps effect and usage milestones without exposing effect IDs; technical identity remains in the
  inspector/event plane.
- Formal-check repair: every terminal Model effect now receives an authoritative usage row/event. Missing provider
  counts use `unknown` on failures/interruption and a bounded estimate only when request identity is available; no
  missing count is represented as zero. Generate abort and stream uncertainty settle `outcome_unknown`.
- Formal-check repair: a normally closed provider stream without a finish part settles unknown instead of leaving
  `intent_committed`. The request digest now hashes canonical request values, so equal-length distinct prompts do not
  collide, while raw request content remains transient and never enters the database or event payload.
- Formal-check repair: a `finish` part without provider usage now immediately settles `outcome_unknown`; the stream
  wrapper cannot mark that effect terminal merely because a finish marker arrived. The repository fallback creates the
  required unknown usage row and `usage.settled` event.
- Formal-check repair: `chat-send` mutates the shared TurnContext `attemptId` immediately after the durable overflow
  retry creates its replacement Attempt. The next middleware invocation therefore binds to the active Attempt rather
  than the failed predecessor.
- Formal-check coverage additions: EffectRepo tests now assert redaction of raw prompt/provider-secret text, exact
  intent -> effect.settled -> usage.settled sequence ordering, and durable terminal/usage state surviving a throwing
  live observer. Middleware tests assert intent failure prevents provider invocation, provider finish-without-usage
  settles unknown, and canonical digest collision resistance. Existing overflow regression suite remains green and
  verifies the real one-time retry path; the shared TurnContext update binds subsequent middleware calls to the
  replacement Attempt.
- Final formal-check repair: `chat-send` passes the exact mutable `TurnContext` object into `ChatAgent`; overflow retry
  mutates that object's `attemptId`, and the production-path regression proves the failed ordinal-1 Attempt and completed
  ordinal-2 replacement use different identities.
- Final formal-check repair: Effect events carry bounded durable `sourceRef` and captured-generation evidence. Unknown
  Effect IDs and callbacks against inactive or terminal Attempts classify as stale and cannot mutate current truth.

## Checks

- `pnpm --filter @taki/shared typecheck`
- `pnpm --filter @taki/core typecheck`
- `pnpm --filter @taki/core exec vitest run src/db/effect-repo.test.ts src/db/migrations/lineage-reopen-matrix.test.ts src/agents/chat-agent-lifecycle.test.ts src/agents/chat-agent-usage.test.ts`
- `pnpm --filter @taki/core exec vitest run src/db/effect-repo.test.ts src/db/run-event-projection.test.ts src/db/migrations/lineage-reopen-matrix.test.ts src/agents/chat-agent-lifecycle.test.ts src/agents/chat-agent-usage.test.ts` - 18 passed.
- `pnpm lint`, `pnpm --filter @taki/e2e typecheck`, task validation, and `git diff --check` passed on 2026-08-24.
- Post-check repair full gates on 2026-08-24: Shared 338 passed; Core 1682 passed, 1 skipped; Shared/Core/E2E
  typechecks, lint, task validation, and `git diff --check` passed.
- Direct regression suite after the unique formal-check repair: 39 focused Core tests passed across EffectRepo,
  middleware/usage, overflow, and chat-send; full Core now 1686 passed, 1 skipped; Shared 338 passed. Shared/Core/E2E
  typechecks, lint, task validation, and `git diff --check` passed.
- Final P1 repair focused check: 29 Core tests passed, including finish-without-usage unknown settlement and usage
  row/event assertions. Full gates: Shared 338 passed; Core 1683 passed, 1 skipped; Shared/Core/E2E typechecks,
  lint, task validation, and `git diff --check` passed.
- Final xhigh formal check: `APPROVED (Slice 3A only)`. Focused Core: 5 files / 42 passed; Shared: 338 passed; Core:
  1688 passed, 1 skipped; Shared/Core/E2E typechecks, lint, task validation, and `git diff --check` passed. No 3B/3C
  production adapters were included.

These historical checks are evidence for the initial 3A foundation only. The latest implementation report and a fresh
full 3A check supersede them.

## 3A Check Findings Requiring Repair

The first formal xhigh 3A check returned `NOT APPROVED`. No files were changed by the check agent. The same impl agent
must repair these findings before another check is dispatched:

1. Every terminal model effect, including failed, aborted, interrupted, uncertain, and no-finish paths, must write one
   authoritative usage row with `reported`, `estimated`, or `unknown` quality. `EffectRepo.settle` must not silently
   omit usage when the effect is terminal.
2. Overflow retry must carry the replacement Attempt identity into the new middleware closure. Effects from the retry
   must never use the superseded Attempt id.
3. A provider stream closing without a finish part must settle deterministically as an explicit terminal outcome and
   usage record; no effect may remain `intent_committed` only because the stream ended unexpectedly.
4. Input identity digest must preserve request distinctions; replacing every string with its length is collision-prone
   and cannot remain the effect identity digest.
5. Add direct regression tests for failure/abort/unknown usage, no-finish stream, redaction, event ordering,
   post-commit live isolation, and real overflow retry Attempt binding.

The check also confirmed the following and they remain in scope: installed AI SDK 7 middleware is at the actual
`doStream`/`doGenerate` seam; Timeline output persistence is a separate authority and must not be falsely claimed
atomic with Effect settlement; 3B and 3C are intentionally out of scope for this repair.
