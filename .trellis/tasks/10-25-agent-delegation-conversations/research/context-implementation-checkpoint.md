# S4 implementation checkpoint

Owner: worker_context. Updated during resume on 2026-10-25.

## Actual recovered state

- Worktree and branch verified: `H:/TakiAgent-worktrees/t4`, `task/t4-skills-mcp-productization`. Explicit session task supersedes stale global pointer.
- Recovered actual tool mutations from rollout `01a1724a-0ddf-7140-8437-879341457be1`, including custom tool calls/outputs. Prior checkpoint was stale.
- Existing edits: `agents/work-context.ts`, `run-message-store.ts`, `private-task-context.ts`, `private-task-summarizer.ts`, `subagent-self-history-tool.ts`, `tool-disclosure.ts`; `db/subagent-context-summary-repo.ts`, `subagent-tool-result-repo.ts`; `harness/subagent-tool-materials.ts`; `shared/subagent-context-schema.ts`. These are live partial implementation, not accepted completion.
- SDK owner was extracted into `agents/agent-attempt.ts`; this agent now owns both it and `chat-agent.ts`, preserving foreground inbox routing and actual-intent retry fences.
- Saved live preimages in `research/context-preimages-20261025-resume/` before new edits. Runtime owns migration DDL, shared exports and `run-message-repo.ts`; root owns `turn-recording.ts` and main composition.

## Interface decisions

- Async work preparation receives the full instruction/schema envelope; exact raw input receipts stay distinct from summary revision witnesses. Pending reads are paged through a captured watermark.
- Same Run/Attempt SDK rollover at complete durable pressure boundaries, global step ordinals, no retry/final callback/Run settlement between segments.
- Root adds private recording release; S4 releases completed material and observation references. Disclosure retains activated names only.
- Runtime already wires summary/tool-result repos and optional governed Utility summarizer. Root must pass UtilitySlot and calibrated context window.

## Verification

- Current final verification is recorded in the final milestone below. Earlier milestone commands remain historical evidence with their exact scopes.
- Installed SDK 7.0.148 source/research read; offline feasibility does not satisfy real ChatAgent/SQLite gates.

## Remaining

- S4 production/context/SDK changes and focused checks are complete within deterministic coverage.
- Coordinator owns final whole-worktree/native integration and independent review. Real-model semantic summary accuracy, native Hindsight, T4/main schema convergence and owner UI acceptance remain separate gates. No paid call, user database mutation or Git delivery was performed.

## Milestone: actual SDK integration

- `agents/agent-attempt.ts` now awaits work preparation, measures child instructions/active tools, removes only child step caps, and rolls SDK calls within the same Attempt. `worker-sdk-segment.ts` guards complete non-provider tool frontiers. `chat-agent.ts` exposes calibrated contextWindowTokens. Foreground private routing and actual-intent retry fences remain.
- Completed material, invocation and observer caches are released only after the complete SDK segment is drained. Root supplied `TurnRecording.releaseThrough`. Private activity cache release is coordinated with Runtime.
- Fixed actual SDK summary result integration: GenerateTextResult uses prototype accessors; spreading it omitted text. Read `generated.text` and `generated.finishReason` explicitly.
- Source CAS now hashes actual canonical row/source/sender fields, not only saved digests. Self-history cursor validates body continuation and remains self-scoped.
- Passing command: `pnpm --filter @taki/core exec vitest run src/agents/chat-agent-worker-context.test.ts` (initial 3 tests, before added safety cases). Actual ChatAgent/SQLite test executes 36 model requests/35 tools with 35 addressed corrections across multiple SDK rollovers; one Run/Attempt, unique step/material keys despite reused provider IDs, separately governed summary Effects, exact raw receipts and no summary-only raw receipt. Primary configured cap and complete large-body paging also pass.
- Additional passing focused regression: inbox + overflow 15 tests (from 19-test combined run; old empty-selection expectation was updated to include intrinsic reporting/history).
- Added 205-input complete-watermark, unfit pending, cancellation at rollover, unknown non-model Effect and owner/source/revision CAS cases; currently resolving their test setup and Runtime safety wiring. Scoped lint found modest factory-size issues; extracting preparation/persistence helpers, no broad rule exemptions.

## Milestone: recovered successor edits and verified existing safety cases

- Recovered actual `custom_tool_call` mutations from rollout `01a172b1-b9da-7531-845d-af699dce1410`, including later summary fallback, intrinsic history pagination, activity cache release, material-reference restoration and source safety changes. The earlier incomplete-checkpoint wording was stale.
- Current preimages preserved separately at `research/context-preimages-20261025-final-resume/`; inherited edits remain intact.
- Fresh command: `pnpm --filter @taki/core exec vitest run src/agents/chat-agent-worker-context.test.ts` — all 10 tests passed (2026-10-25, 8.99s). This includes 205 pending corrections across the watermark, unfit pending batch refusal, Stop at rollover, unknown non-model Effect refusal, summary source/revision/owner CAS, blank/non-shrinking failures and loader disclosure continuity.
- Continuing with retained-reference audit, >2,000-record retrieval, continuation and unsafe provider frontier cases; scoped lint/typecheck pending. No paid provider or native acceptance is claimed.

## Milestone: complete history, continuation and retained-reference gates

- Actual SDK/SQLite `chat-agent-worker-context` + `chat-agent-worker-retention` run passed 16 tests with `--pool=forks --execArgv=--expose-gc` (11.07s), before the later added cases below. The forced-GC case runs 25 pressure segments/26 requests and proves all 22 oldest sampled raw SDK result objects collectible while 26 full tool bodies remain durable. The ordinary test command explicitly skips this GC-only case.
- Exact repository-history traversal covers 2,105 materials and 2,106 inputs/messages, complete body reconstruction and exclusion of arrivals beyond the captured watermark. These history fixtures use repository acceptance; they do not claim 2,105 simultaneous runtime admissions (the pre-existing pending-admission bound is 1,000).
- Same-conversation/same-work explicit continuation creates a fresh Run, reuses the committed summary, preserves the first original-input receipt and sends only the new raw correction plus retained exact tail.
- Verified two bugs with red-to-green regressions: settled local tool errors were incorrectly refused at rollover; empty-source producer lists retained completed cache identities without a result reference. Completed local errors now roll safely; empty source lists get an explicit unknown-source raw-result reference and release only after durability.
- Additional focused passing cases: correction and user Stop during actual summary generation; SQLite summary INSERT failure rollback; immutable input mutation refusal; provider-owned completed/deferred frontiers refuse unsafe rollover while keeping completed local material; success/error/provider/approval/preliminary/unresolved frontier unit matrix.
- Scoped S4 ESLint passed before the last provider-frontier cases. Core typecheck was initially green, then reported two S4 test typing errors (fixed) and in-flight Runtime/Shared errors (communicated to Runtime). Final scoped checks/regression batch pending.

## Milestone: S4 checks passed; coordinated lazy foreground correction

- Final S4 batch passed 63 tests across nine files (`chat-agent-worker-context`, `chat-agent-worker-retention`, `worker-sdk-segment`, `subagent-tool-materials-retention`, `tool-disclosure`, `chat-activity`, `chat-agent-overflow`, `subagent-service`, `subagent-materials`) with `--pool=forks --execArgv=--expose-gc`; 12.64s. Core and Shared typechecks both passed after all S4 changes.
- Root identified a remaining foreground integration gap: an inbox empty at Attempt start could not receive events at later safe model requests. Installed SDK `prepare-step.ts` supports carried-forward `instructions` and per-step `activeTools`, but no registry replacement.
- Coordinated fix: Runtime owns eager intrinsic bindings with a lazy first nonempty claim and dynamic instructions/source; S4 owns optional foreground prepareStep port and SDK overrides. One immutable consumer per Attempt remains. Root explicitly delegated the foreground port edits. Preimages saved at `context-preimages-lazy-inbox/`. No lazy changes are claimed as tested yet.

## Milestone: late first foreground batch integrated

- Added optional `ForegroundInboxContext.prepareStep()` and dynamic SDK instructions/activeTools overrides in `agent-attempt.ts`. Intrinsic tools register before SDK construction; empty-context names stay hidden from model disclosure but remain private to stream filtering. Runtime retries only an empty claim and freezes the first nonempty batch for that Attempt.
- Runtime separately fixed primary speech witnesses to require the actual persisted per-row event source sidecar, so a public preface before a late claim is not attributed to that event.
- Passing command: `pnpm --filter @taki/core exec vitest run src/agents/chat-agent-inbox-lazy.test.ts src/agents/chat-agent-inbox.test.ts src/agents/chat-agent-inbox-memory.test.ts` — 7 tests passed (5.41s). Actual Runtime/SQLite/SDK lazy case produces two child reports while a foreground tool loop runs: first report enters step 1, deliveries record steps 1/2, second report stays accepted for a later consumer, private handling remains absent from Timeline/activity, pre-claim speech has no event witness.
- Scoped ESLint for all files touched by the final S4/lazy changes passed without disabling size rules. Core typecheck pending completion in the current shell session. Source files frozen for the coordinator's native run; code-spec/checkpoint work continues.

## Final milestone: historical interruption continuity and source stability

- Reproduced an additional real continuity defect using actual ChatAgent/SQLite under native Node: a cancelled Run retained `[input, partial]`; explicit Continue then failed after seven later model requests, with zero summary calls. Both partial and input-only variants were red in the retained regression.
- `private-task-context.ts` now distinguishes terminal historical evidence from a live incomplete frontier. Historical cancellation/no-output may be summarized with explicit canonical `outcome`/`outputKind`; raw partial replay is labelled incomplete. `subagent-context-summary-repo.ts` binds those canonical outcomes in its source digest and still rejects current unresolved/partial ranges. Raw rows and prior terminal receipts remain unchanged.
- Red-to-green regression: both cancelled partial and input-only histories continue through 35 later tools/36 requests, retain prior raw/terminal evidence and produce summaries. Unknown non-model effects, provider/deferred/approval frontiers and live incomplete ranges remain refused.
- Final command: `pnpm --filter @taki/core exec vitest run src/agents/chat-agent-worker-context.test.ts src/agents/chat-agent-worker-retention.test.ts src/agents/worker-sdk-segment.test.ts src/harness/subagent-tool-materials-retention.test.ts src/agents/chat-agent-inbox-lazy.test.ts --pool=forks --execArgv=--expose-gc` — 5 files / 27 tests passed, 14.54s. Core typecheck passed after the final fix; Shared typecheck had already passed and this fix did not change Shared.
- Final scoped ESLint passed without exceptions; owned `git diff --check` passed. Removed only the trailing extra blank EOF in `chat-agent.ts` requested by root. No global size-rule relaxation or size-only splitting was needed.
- New seven-section executable spec `.trellis/spec/backend/private-worker-context.md` is linked from backend/index.md. Root owns existing delegation/runtime spec changes and Runtime owns its private-inbox spec.
- Final source stability sent to root after these checks; Core/Shared/tests remain frozen for the native rerun. No confirmed S4 implementation defect remains in the tested scope. Semantic fidelity from a real model is intentionally not claimed.

## Review follow-up: SDK callback error boundary

- Independent review reproduced an output-checkpoint SQLite ABORT swallowed by SDK 7.0.148 `notify()`. Child executed a tool, lost its run_messages observation, then made another model request and reported validated completion. This invalidates completion until repaired.
- Scope: latch every source/material/completed-step callback failure outside SDK notification semantics; fence later preparation, model intent, summary/rollover and final callbacks. Preserve actual executed Effect facts and public partial recording; never replay the tool or release undurable segment references.
- Live `agent-attempt.ts` preimage saved in `context-preimages-step-failure/`; source freeze lifted by root for this fix.

### P1 callback failure repair

- Reproduced three red actual SDK cases in `chat-agent-step-recording-failure.test.ts`: run_messages INSERT ABORT, subagent_tool_results INSERT ABORT, and primary inbox private transcript ABORT. Before repair all performed a second model request; the primary case resolved successfully instead of rejecting.
- `agent-attempt.ts` latches the original callback failure outside SDK `notify()`, sets the executed-step retry fence, checks before every later preparation/model intent/stop/summary/checkpoint, and checks again after draining before settled text or cache release. Callback failure preserves buffered native public output through the existing primary finally writer. No tool retry or rollback of actual Effect/action truth is attempted.
- All first three cases turned green; the natural-final-step variant additionally verifies that after-drain failure handling suppresses the settled-text callback even without a next tool-loop condition. Focused affected S4/inbox/overflow/GC regression and Core typecheck are running; reviewer requested to recheck the original probe.

- Final P1 repair verification: `pnpm --filter @taki/core exec vitest run src/agents/chat-agent-step-recording-failure.test.ts src/agents/chat-agent-worker-context.test.ts src/agents/chat-agent-worker-retention.test.ts src/agents/chat-agent-inbox.test.ts src/agents/chat-agent-inbox-memory.test.ts src/agents/chat-agent-inbox-lazy.test.ts src/agents/chat-agent-overflow.test.ts --pool=forks --execArgv=--expose-gc` — 7 files / 45 tests passed, 12.82s. Core typecheck, scoped ESLint and owned diff check passed. Independent reviewer has the fix for recheck. Source stable again after this milestone.
