# Slice 3 implementation evidence

## Authoritative execution status

The architecture theme is split into sequential, context-reusing batches. This section is the first recovery anchor
after session compaction; verify it against Git and the latest agent report before continuing.

| Batch | Boundary | Status |
| --- | --- | --- |
| 3A | Effect/Usage contracts, migration/repository/service, per-provider model middleware, authoritative usage, Model/Run/Attempt truthfulness | `committed:e55a8dc` |
| 3B | Governed Tool, Approval wait/final revalidation, Host identity threading, MCP generation/lease settlement | `committed:36a3596` |
| 3C | Explicit Memory effects, non-primary preservation, full cross-boundary/process acceptance | `approved_pending_commit` |

The unique Slice 3A implementation and formal-check agents have finished. The final xhigh check approved 3A only after
repairing the real overflow replacement-Attempt binding, durable Effect event evidence, stale callback classification,
and the direct acceptance-matrix tests. Do not dispatch another 3A implementation or check agent.

## Slice 3C authoritative implementation boundary

The focused Memory seam review is in `research/slice-3c-memory-seam-review.md`. 3C reuses the one Effect lifecycle and
the selected Memory authority; it does not create a second Memory runtime, receipt store, or recovery worker.

1. Explicit canonical Memory tools are classified as `kind: "memory"` Effects with bounded Memory source/executor
   references. Their request identity, captured authority epoch, provider lineage, capability snapshot/digest, and
   request digest are passed to the existing `MemoryCoordinator`.
2. The Effect intent commits immediately before the coordinator call. The validated MemoryResult settles the same Effect
   once. Provider receipts remain a separate authority/transaction; 3C must document this boundary rather than claim
   Core Effect plus canonical-memory receipt atomicity.
3. `recall(both)` is one model-facing Memory Effect. It derives bounded `global`/`character` branch request identities
   from the outer request identity and captures one expected authority epoch; branch partial failure stays in the single
   bounded result and never creates two Core Effects.
4. Explicit retain/edit/invalidate/restore writes default to replay posture `never`. `safe` is allowed only when the
   exact request identity/hash, expected revision, provider lineage, authority epoch, and idempotent-write capability
   remain valid. Conflicts and revision mismatches remain Memory domain results.
5. Detached primary AutoMemory/image hooks are not re-fired by Effect observers. Retraction suppresses them as today.
   Non-primary turns preserve no fake Timeline, costume, conversational watermark, or image-save side effects; an
   explicit Memory tool on a non-primary turn may still produce one normal Memory Effect.

### Slice 3C acceptance matrix

- [x] Explicit recall/retain/reflect/edit/invalidate/restore each create one Memory Effect with intent-before-provider and
      one terminal settlement.
- [x] `recall(both)` creates one outer Effect with deterministic branch request IDs; partial/both failure is bounded and
      does not double-record Effects.
- [x] Expected epoch/provider/capability drift fails closed; stale/duplicate/wrong-Attempt callbacks cannot mutate truth.
- [x] Exact canonical receipt replay remains idempotent; same request ID with a different hash remains conflict; stale
      expected revision remains revision mismatch.
- [x] Write Effects default `never`; no unsafe replay or epoch redirect is introduced.
- [x] Raw memory content, queries, tool args, provider exceptions and credentials are absent from Effects/events/logs;
      only digest, identity, epoch, bounded outcome/code/counts and safe summaries remain.
- [x] Primary detached AutoMemory/image, retract, and all non-primary invariants remain green; observers do not trigger
      detached work a second time.
- [x] Full Slice 3 cross-boundary tests cover Model -> Memory -> Tool/Approval/Host/MCP interactions and preserve 3A/3B
      ordering, projections, and unknown/stale semantics.
- [x] Shared/Core/Desktop/CLI/E2E/Rust gates, real Core boot/process smoke where applicable, task validation, and
      `git diff --check` pass.

### Slice 3C implementation evidence (2026-08-25)

- Canonical Memory metadata is attached as an in-process sidecar and mapped by Core Tool Governance to one
  `kind: "memory"` Effect. The sidecar carries only the operation, authority epoch, provider identity/lineage,
  capability digest, replay posture, and request/input digests; it is not part of model-facing tool input or the
  Timeline payload.
- The governed boundary commits Effect intent immediately before the coordinator call and settles the same Effect
  from the bounded Memory result. Recall uses `safe`; retain, edit, invalidate, restore, and reflect use `never`.
- `recall(both)` remains one model-facing call. Global and character branches derive deterministic request IDs from
  the outer request identity and share one captured authority epoch; branch failures remain bounded in the one result.
- MemoryCoordinator validates expected epoch/provider/lineage/capability before and after provider dispatch. Provider
  retain/mutation transport ambiguity maps to `MEMORY_OUTCOME_UNKNOWN`; post-dispatch envelope/capability/authority
  acceptance failures on writes remain unknown because the provider may already have applied the mutation; authority
  drift on reads fails closed.
- Core governance carries Run/Attempt/Effect authority independently of the optional operator Approval socket. This
  keeps explicit Memory calls in non-primary/background turns inside the same Effect bracket while preserving the
  fail-closed Approval requirement when an interactive connection is absent.
- Focused verification already passed: Shared full suite 36 files / 342 tests; Core full suite 269 files / 1704 passed /
  1 skipped; Core Memory/Governance/Agent focus 63 files / 445 tests; Rust workspace 171 tests plus 7 secret-key tests;
  Shared/Core/E2E typechecks; `pnpm lint`; and the three Slice 3B lifecycle E2E files (9 tests).
- Whole-Slice integration evidence: `packages/core/src/agents/slice-3c-whole-slice.integration.test.ts` passed 1/1.
  A scripted real `ToolLoopAgent` turn produced two Model Effects and one canonical Memory Effect; the same fixture then
  exercised an Approval-gated MCP tool and Host preflight/settlement. It asserted one Memory Effect, no duplicate Memory
  Effect, five bounded intent/settled projection milestones, raw-content redaction, and Host `outcome_unknown` plus
  wrong-Attempt stale settlement rejection.
- Canonical production-process evidence: `e2e/src/canonical-memory-production.e2e.test.ts` passed 1/1. The existing
  `withStack` boots a real Core process against a temporary DB seeded with the canonical-local marker and two Banks;
  `capability.trigger` uses the same captured canonical Memory tools and Core Governance wrapper as production. The test
  proves marker selection, callable canonical `retain`, one terminal Memory Effect with epoch/provider metadata, no
  duplicate Tool Effect, no raw content in events/logs, and no legacy Markdown workspace surface.
- Final full gates: Shared 36 files / 342 passed; Core 269 files / 1704 passed / 1 skipped; Desktop 82 files / 427
  passed; CLI 8 files / 47 passed; E2E 24 files / 37 passed / 6 skipped; all workspace typechecks; `pnpm lint`; Rust
  workspace 171 tests plus 7 secret-key tests; Rust check/build/taki-node/clippy `-D warnings`; task validation; and
  `git diff --check`.
- The canonical Memory receipt transaction and Core Effect settlement are intentionally separate transactions. A crash
  between them leaves an unfinished Effect for Slice 4 reconciliation; Slice 3 does not claim cross-repository atomicity.
- Final xhigh formal check: `APPROVED (Slice 3C / whole Slice 3)`. Check fixes classify post-dispatch Memory write
  acknowledgement/capability/authority uncertainty as `MEMORY_OUTCOME_UNKNOWN`, and keep Run-owned Effect context
  available without an interactive Approval connection while Approval itself remains fail-closed. Final gates: Core
  1704 passed / 1 skipped; Shared 342; Desktop 427; CLI 47; E2E 37 passed / 6 skipped; Rust 171 plus 7 secret-key;
  all workspace typechecks, lint, Rust check/build/clippy, migration lineage, task validation, and `git diff --check`
  passed. No findings remained.

Recovery procedure:

1. Read `implement.md` section 0 and this file.
2. Inspect `git status`, current task status, and the latest `/root/slice3_impl` report.
3. Treat the final `APPROVED (Slice 3A only)` check below as authoritative over historical failed checks.
4. Commit 3A with an explicit batch label; then continue 3B using the same parent research and shared contracts.
5. Never claim complete Slice 3 until 3C integration acceptance passes.

## Slice 3B authoritative implementation boundary

The focused seam review is in `research/slice-3b-seam-review.md`. Its Host ordering caveat is resolved as follows and
must not be weakened into an exception:

1. `capability.request` becomes a bounded Host preflight. It validates the sealed control/input against the current
   Host connection/catalog/policy lineage and returns trusted `auto | ask | deny` classification without invoking the
   real capability handler.
2. `deny` settles the one logical Tool Effect without target intent. `ask` creates a durable Effect waiting reference
   to the canonical Approval identity/generations. Approval denial, expiry, cancellation, disconnect, or invalidation
   settles that wait and never creates target intent.
3. After `auto`, or after accepted Approval plus Core final policy/generation revalidation, Core commits the same Tool
   Effect's target intent. Only then may Core send an explicit Host execute/resume frame.
4. Host execution revalidates the same control, generation, input digest, trusted classification, and any one-use
   authorization immediately before the handler. It never redirects to a replacement generation.
5. Core `runId`, model `attemptId`, and `effectId` are typed correlation fields distinct from Host-local operation and
   execution-attempt identities. Neither authority overwrites the other.
6. MCP lease acquisition happens after Governance/Approval final revalidation and immediately before target intent.
   Direct MCP and `extension_call` share the same captured closure and are instrumented once, never at both layers.

### Slice 3B acceptance matrix

- [x] One AI SDK tool call creates exactly one durable Tool Effect across Core, Host, direct MCP, and MCP extension paths.
- [x] Auto tools commit intent immediately before raw execution; failed intent starts no raw tool/Host/MCP call.
- [x] Approval wait stores bounded canonical identity/generation/binding evidence; every non-allow terminal result settles
      without target intent, and allow is revalidated before intent.
- [x] Host preflight cannot execute. Explicit execute/resume is accepted only after target intent and against the same
      current connection/catalog/policy/input lineage.
- [x] Host-local operation/attempt identity remains distinct from enclosing Core Run/model-Attempt/Effect identity, and
      wrong/stale/duplicate/late frames cannot settle current Effect truth.
- [x] Cooperative reads cancel truthfully; unsafe Host disconnect/deadline and MCP forced-close/transport ambiguity
      settle `outcome_unknown` without redirect or replay.
- [x] MCP leases are not held during Approval waiting; retired generations reject new target intent, and the shared
      direct/extension closure cannot double-record.
- [x] Parallel tool calls preserve distinct Effect identities and AI SDK tool-result ordering.
- [x] Canonical rows/events/logs exclude raw arguments/results, prompts, credentials, unrestricted errors, and media.
- [x] Shared/Core/Desktop/Rust focused and full tests, cross-language fixtures, typechecks, lint, Clippy, E2E typecheck,
      task validation, real Core/Host process smoke, and `git diff --check` pass.

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
- Slice 3B implementation progress (2026-08-25): added bounded Approval effect references, waiting/terminal/CAS
  transitions, final-revalidation Tool coordinator in `governed-tool.ts`, MCP lease-after-governance ordering, and
  Core-to-Host correlation fields (`coreAttemptId`, `effectId`) with Rust serde parity. Focused governance/effect/MCP/
  Host tests and Rust `cargo check` pass.
- Slice 3B continuation (2026-08-25): Host `capability.request` is now preflight-only. Core reserves the correlation
  `effectId` in sealed control without writing target intent, then auto classification commits Host Effect intent before
  `capability.execute`; ask classification persists bounded Approval waiting evidence, commits the same Effect intent
  only after accepted Approval/current-lineage revalidation, then sends explicit `capability.resume`. Denial settles the
  waiting Effect without target intent. Focused order tests cover auto, allow, and deny.
- Host settlement now checks the same Core Run/model-Attempt/Effect tuple and fails stale settlement closed. Host-local
  operation/attempt identity remains distinct. Rust has a deterministic preflight test proving classification has no
  executor dependency or audit side effect, and shared/Rust golden fixtures cover the new `capability.execute` frame.
- Run admission now preserves one mutable interactive identity reference for captured MCP/Extension closures. The MCP
  governed wrapper reads Run/Attempt/Effect service lazily, and overflow retry updates that same reference without
  recapturing or redirecting the MCP generation.
- Latest checks: Shared full suite 35 files / 340 passed; Core full suite 266 files / 1692 passed / 1 skipped; Rust
  full suite 171 passed plus 7 secret-key tests; focused 3B Core 10 files / 69 passed; Shared/Core/E2E typechecks,
  lint, Rust check, Rust Clippy with warnings denied, task validation, and `git diff --check` passed.
- Real process-level 3B acceptance is now covered by `e2e/src/effect-host-lifecycle.e2e.test.ts`. The relay pauses the
  next `capability.execute`; while paused, the test opens the live Core SQLite database read-only and proves the exact
  `(runId, coreAttemptId, effectId)` row is already `intent_committed` with no outcome. Release then proves one Host
  audit/handler path, terminal Effect settlement, ordered `effect.intent_committed` -> `effect.settled` events, and
  no raw command in Core logs. The same file covers ask waiting -> Approval -> resume and an unsafe `exec` disconnect
  that settles `outcome_unknown` without replay. The dev-only trigger's `lifecycle` flag uses the production
  `RunService.admit/start/settle` path and leaves legacy L1 behavior unchanged.
- Cross-language Host canonicalization was repaired and pinned: Rust now excludes Core-only `coreAttemptId/effectId`
  from the Host control digest exactly as the shared canonicalizer does; Rust protocol tests and the real socket smoke
  both pass with populated Core correlation identities.
- Direct MCP keys and `extension_call` now have a durable exactly-once integration proof in
  `packages/core/src/extensions/extension-effect-exactly-once.test.ts`: each model-facing call creates one Tool Effect
  and one underlying dispatch, while a stale generation creates no replacement Effect. Parallel AI SDK tool calls are
  covered by `packages/core/src/agents/parallel-tool-effect.test.ts` with distinct Effect IDs, independent terminal
  settlement, and preserved call-a/call-b result ordering.
- Direct regression suite after the unique formal-check repair: 39 focused Core tests passed across EffectRepo,
  middleware/usage, overflow, and chat-send; full Core now 1686 passed, 1 skipped; Shared 338 passed. Shared/Core/E2E
  typechecks, lint, task validation, and `git diff --check` passed.
- Final P1 repair focused check: 29 Core tests passed, including finish-without-usage unknown settlement and usage
  row/event assertions. Full gates: Shared 338 passed; Core 1683 passed, 1 skipped; Shared/Core/E2E typechecks,
  lint, task validation, and `git diff --check` passed.
- Final xhigh formal check: `APPROVED (Slice 3A only)`. Focused Core: 5 files / 42 passed; Shared: 338 passed; Core:
  1688 passed, 1 skipped; Shared/Core/E2E typechecks, lint, task validation, and `git diff --check` passed. No 3B/3C
  production adapters were included.
- Slice 3B completion gates (2026-08-25): Shared 35 files / 340 passed; Core 268 files / 1694 passed / 1 skipped;
  E2E 23 passed / 6 skipped (36 tests passed / 6 skipped); focused real Host lifecycle E2E 3 passed; Rust 171 tests
  plus 7 secret-key tests; Shared/Core/E2E typechecks, `pnpm lint`, `cargo build --bin taki-node`, `cargo clippy
  --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings`, and `git diff --check` all passed.
- Final xhigh formal check: `APPROVED (Slice 3B)`. Check fixes added active-Attempt/state-version guards for waiting and
  terminal transitions, prevented stale Approval/MCP leases from leaving waiting Effects, required canonical approval IDs,
  and added waiting/event-chain evidence. Final gates: Core 1697 passed / 1 skipped; Shared 340 passed; Desktop 427,
  CLI 47, E2E 36 passed / 6 skipped; focused Host E2E 3 passed; Rust tests/check/build/clippy, typechecks, lint, task
  validation, and `git diff --check` passed. No findings remained.

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
