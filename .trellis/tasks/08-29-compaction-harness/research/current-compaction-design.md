# Research: Current TakiAgent compaction and replay design

- Query: Describe the current compaction/replay implementation, preserving the ratified T5 and archived Batch 7 decisions, and identify the evidence and gaps relevant to a compaction harness redesign.
- Scope: internal (live repository plus prior T5/task artifacts); archived external research is cited but was not refreshed from the web.
- Date: 2026-08-29

## Findings

### Executive conclusion

The current design is a four-stage, projection-only context pipeline over an append-only per-Character timeline:

1. Persist the full conversational tail, including structured tool-call/result rows.
2. On every model attempt, derive a replay view: persisted rolling summary substitution -> pressure-gated tool folds -> emergency token cut.
3. After a successful primary turn, run detached per-Character maintenance: episodic write -> flush -> tidy -> compaction.
4. When compaction succeeds, overwrite one per-Character summary row and advance its `through_seq`; the next replay sees the new summary head.

This implements the original T5 priorities well: memory extraction precedes retirement, the user-facing timeline is never rewritten, compaction never blocks the chat turn, and provider overflow shrinks the calibrated budget rather than synchronously compacting. The largest current architectural defect is that the compactor is owned by the legacy Markdown memory subsystem. Canonical memory activation deliberately disables or avoids constructing that subsystem, so the summary read path stays live while the summary writer stops.

### Files found

| File | Role |
| --- | --- |
| `packages/core/src/agents/chat-agent.ts` | Primary-turn persistence, fresh replay pull per attempt, overflow retry, detached post-turn maintenance trigger. |
| `packages/core/src/agents/conversation-store.ts` | Single replay-view seam: summary substitution, folds, cut, summary head, wall-hit reporting. |
| `packages/core/src/agents/context-window.ts` | Token-window selection, 200-row hard backstop, newest-item guarantee, leading orphan-tool removal. |
| `packages/core/src/agents/replay-folds.ts` | Pure pressure-gated folding of tool results and stored tool-call arguments. |
| `packages/core/src/agents/compaction-pass.ts` | Trigger, retirement boundary, flush-before-retire, rolling summary generation and success-only upsert. |
| `packages/core/src/agents/window-calibrator.ts` | Persisted estimator correction and overflow-driven effective-window shrink. |
| `packages/core/src/memory/auto-memory.ts` | Detached per-Character serialized chain: episodic -> flush -> tidy -> compact. |
| `packages/core/src/memory/bootstrap.ts` | Creates the shared flush writer, utility slot, compactor, and legacy auto-memory chain. |
| `packages/core/src/memory/runtime-composition.ts` | Selects legacy/canonical memory runtime and exposes the authority-aware legacy `autoMemory`. |
| `packages/core/src/memory/runtime-selector.ts` | Does not construct the legacy subsystem when canonical memory is selected at boot. |
| `packages/core/src/memory/authority-aware-legacy-surfaces.ts` | Turns legacy auto-memory into a no-op after in-process canonical activation. |
| `packages/core/src/db/summary-repo.ts` | Typed single-row-per-Character summary repository. |
| `packages/core/src/db/migrations/012-conversation-summary.ts` | Durable `conversation_summary` schema. |
| `packages/core/src/config/context-config.ts` | Declared windows, history ratio, compaction ratio, and protected-tail configuration. |
| `packages/core/src/memory/render-transcript.ts` | Converts retiring rows to role/content-only summary input. |
| `packages/core/src/agents/turn-mapping.ts` | Persistence/replay privacy boundary for tool arguments, tool results, and image parts. |

### Current data flow

1. A primary turn appends its user row once before model execution (`chat-agent.ts:172-178`). Each attempt then performs a fresh `store.history(characterId)` pull, which is why an overflow retry immediately observes a recalibrated smaller window (`chat-agent.ts:200-207`, `chat-agent.ts:220-227`).
2. Completed assistant/tool messages are persisted from `responseMessages`, while interrupted visible text is separately retained (`chat-agent.ts:432-446`). Structured tool results survive in timeline parts; tool-call arguments are deliberately reduced to names-only before persistence (`turn-mapping.ts:38-68`).
3. After a clean committed primary turn, chat returns without awaiting maintenance and fires `autoMemory.onTurnCompleted` (`chat-agent.ts:281-293`, `chat-agent.ts:324-332`). Non-primary turns do not append to the conversation timeline and do not trigger this path.
4. `createAutoMemory` serializes maintenance per Character with a promise chain and a `setImmediate` boundary (`auto-memory.ts:73-87`). The ordered pass is episodic -> ordinary window-exit flush -> tidy -> compaction (`auto-memory.ts:93-100`). Every sub-pass failure is swallowed and logged so the chat turn is unaffected (`auto-memory.ts:102-121`).
5. The compactor calculates a token-priced retirement boundary (DSH-grounded retain ratio `0.16`) over balanced replay units, flushes any not-yet-flushed retiring rows, makes one utility-slot `generateText` call over the old summary plus the newly retiring span, then advances `through_seq` only after non-empty output (`compaction-pass.ts:125-132`, `compaction-pass.ts:148-178`, `compaction-pass.ts:181-224`, `retirement-selector.ts:23-64`).
6. A turn arriving while generation is in flight still reads the old summary because the durable watermark changes only at the final upsert. Concurrent appends extend the live tail but are beyond the boundary captured at pass start (`compaction-pass.ts:143-158`).

### Trigger and budget logic

- Defaults are a declared main window of `131072`, history share `0.7`, compaction trigger ratio `0.8`, DSH-grounded retain ratio `0.16`, and a `40`-row minimum-tail compatibility guard (`context-config.ts:12-28`, `context-config.ts:49-73`, `retirement-selector.ts:11-12`). All operator knobs remain fail-closed Zod-parsed boot configuration.
- Production defines the history wall as `floor(windowCalibrator.effectiveWindow() * historyRatio)` and gives the same closure to replay selection and the compaction trigger (`main.ts:128-145`). With defaults, the exact pre-compaction threshold is strictly above `0.8 * floor(effectiveWindow * 0.7)` estimator units.
- The calibrator persists an EMA correction factor from reported input usage. A classified overflow instead lowers the real effective window to at most `floor(observedInput * 0.9)`; it never invokes compaction (`window-calibrator.ts:39-63`, `chat-agent.ts:183-207`).
- The trigger reads the post-projection `estimatedTokens`. It does nothing for an infinite wall or at/below the ratio; it fires only on strict `>` (`compaction-pass.ts:146-152`).
- Slice 1 resolved the row-count retirement defect: the compactor pages a token-sufficient newest suffix, retains at least the explicit minimum-tail guard, and selects the boundary by estimator-priced replay units rather than by `keepMessages` (`compaction-pass.ts:154-178`, `replay-source-loader.ts:31-95`, `retirement-selector.ts:23-64`). The shared unit builder keeps all matching result rows and overlapping/partial spans together; invalid evidence remains excluded from provider replay (`context-window.ts:52-78`, `context-window.ts:105-135`).
- A single oversized newest message is always retained, even if it alone exceeds the budget (`context-window.ts:51-62`). This preserves a usable prompt at the cost of exceeding the nominal history wall.

### Summary persistence and replay projection

- Migration 012 stores exactly one overwritable row per Character: `(character_id PK, through_seq, text, updated_at)`; it is not a timeline row (`012-conversation-summary.ts:8-20`). `SummaryRepo.upsert` replaces text and coverage together, while `getMeta` exposes only counts/date to operator status (`summary-repo.ts:23-42`, `summary-repo.ts:55-80`).
- Measured replay pages newest Timeline rows until its token candidate, summary bridge, history end, or the explicit `10,000`-row source backstop; no-budget compatibility mode still uses the legacy `200`-row window (`conversation-store.ts:171-224`, `replay-source-loader.ts:14-20`, `replay-source-loader.ts:41-95`).
- The summary becomes a projection-only `role: "user"` head fenced as `<conversation-summary>...</conversation-summary>`; the base prompt teaches that it is the assistant's earlier record and that the memory store wins on conflict (`conversation-store.ts:165-169`, `base-prompt.ts:68-71`).
- The head is inserted only if the fetched 200-row slice still contains at least one covered row. If the fetch already starts after `through_seq`, no head is rendered because it cannot honestly bridge the missing unsummarized gap (`conversation-store.ts:138-144`).
- The summary head consumes the same token wall as live rows. Folds and the emergency cut operate only on the remaining entry budget (`conversation-store.ts:145-161`). The head itself is never truncated or dropped.
- `windowStart`, `history`, and `estimatedTokens` all call the same `selectView` closure, so replay and ordinary pre-window flush share one boundary (`conversation-store.ts:98-124`). Rows retired by a summary therefore count as having left the live window.

### Tool-result folding

- Folding is pure, copy-on-write, deterministic, and disabled when under budget or in unmeasured legacy mode (`replay-folds.ts:36-60`). User prose and assistant prose are never folded (`replay-folds.ts:36-40`).
- Candidate order is fixed (`replay-folds.ts:63-70`):
  1. Snapshot-class results, classified only by a string `capturedAt` field inside the output, excluding the newest three per `toolName` (`replay-folds.ts:73-86`, `replay-folds.ts:141-147`).
  2. Remaining fact-class tool results, oldest first.
  3. Stored tool-call arguments whose JSON exceeds 200 characters (`replay-folds.ts:21-23`, `replay-folds.ts:89-107`).
- A folded result becomes a one-line trace with tool name, payload character count, and optional deterministic `HH:MM`; folding is skipped when the trace would not shrink the payload (`replay-folds.ts:122-139`).
- The persisted structured tool result is otherwise replayed in full until folded or retired (`turn-mapping.ts:58-68`, `turn-mapping.ts:88-116`).
- The tool-call-argument stage has no practical effect on new production rows: current persistence omits raw tool inputs (`turn-mapping.ts:43-48`) and replay always emits `{}` for tool-call input regardless of a stored `input` value (`turn-mapping.ts:94-105`). Consequently `entryTokens()` sees the same cost before and after an argument fold. The existing test asserts that the stored part changes, but not that replay bytes or estimated tokens shrink (`replay-folds.test.ts:159-168`).

### Memory-runtime coupling

- The original safety contract is strong: compaction reuses the exact flush writer and `memory_auto.lastFlushSeq`; it cannot advance a summary beyond content the memory writer has already judged (`bootstrap.ts:91-110`, `compaction-pass.ts:161-185`). A failed summary retries without re-flushing because the flush watermark advances independently (`compaction-pass.test.ts:183-195`).
- However, construction ownership is wrong for the current two-runtime system. `composeMemoryRuntime` creates the compactor only inside `createMemorySubsystem`, which is the legacy Markdown runtime (`runtime-composition.ts:20-29`).
- At canonical startup, `selectMemoryRuntime` sets `legacy = null` and never invokes `createLegacy` (`runtime-selector.ts:17-25`), so the returned `autoMemory` is `undefined` (`runtime-composition.ts:31-48`).
- After in-process activation, the legacy object remains allocated but `authorityAwareAutoMemory` turns every call into a resolved no-op (`authority-aware-legacy-surfaces.ts:10-12`). The retirement behavior is explicitly test-pinned (`authority-aware-legacy-surfaces.test.ts:5-14`).
- The summary reader remains independently wired into `conversationStore` before memory runtime selection (`main.ts:137-156`). Therefore canonical mode can continue replaying an old summary, but cannot produce or advance future summaries through the current path.
- This coupling also means a redesign cannot simply keep invoking the legacy flush writer after canonical activation: the pre-retire memory action needs an authority-neutral contract or a canonical implementation, while conversation compaction itself should remain conversation infrastructure.

### Hard message-count backstop

- `REPLAY_WINDOW = 200` is explicitly retained only as a broken-estimator guard, and becomes the entire window when no token budget is injected (`conversation-store.ts:19-21`, `conversation-store.ts:71-75`).
- The measured path no longer applies the old `200`-row cap before token selection. The bounded source loader has an explicit `10,000`-row emergency ceiling and reports it separately; only the no-budget compatibility path uses `REPLAY_WINDOW = 200` (`conversation-store.ts:178-180`, `conversation-store.ts:219-224`, `replay-source-loader.ts:14-20`).
- It counts timeline rows, not user/assistant exchanges. Tool calls and tool results each consume their own row.
- The selector drops any leading tool rows stranded by the count/token cut, because provider replay cannot begin with an orphan tool result (`context-window.ts:37-47`). This preserves wire validity but can discard useful tool evidence.
- If more than 200 unretired rows accumulate after the last summary, the old summary head disappears by design. The current unit test explicitly calls this a stale-summary case (`conversation-store.test.ts:319-328`). In canonical mode this is not merely an outrun edge: the writer is permanently absent, so the condition is inevitable in a sufficiently long conversation.

### Tests and evidence

| Evidence | What it proves |
| --- | --- |
| `conversation-store.test.ts:204-272` | Token selection, shared `windowStart`, 200-row backstop, oversized-newest behavior, orphan-tool removal. |
| `conversation-store.test.ts:294-376` | Summary substitution/head conditions, stale-summary disappearance, summary-aware flush boundary, head token accounting. |
| `conversation-store.test.ts:381-466` | Replay idempotence, storage isolation, substitution -> fold -> cut order, wall-hit warning/deduplication. |
| `replay-folds.test.ts:55-214` | Pressure gating, keep-three snapshot policy, fact-result folding, argument threshold, prose exclusion, copy-on-write. |
| `compaction-pass.test.ts:111-216` | Strict trigger math, token-priced minimum-tail boundary, flush-first sequencing, success-only watermark, retry behavior, counts-only logs. |
| `compaction-pass.test.ts:218-356` | Rolling old-summary input, token-priced selector invariance, balanced multi-call/result and oversized-unit ranges, verbatim unbounded output, prompt/date rules, utility/main fallback. |
| `auto-memory.test.ts:504-578` | Maintenance ordering, self-deciding compaction hook, optional wiring, failure isolation. |
| `summary-repo.test.ts:17-58` and `012-conversation-summary.test.ts:18-61` | Durable row shape, overwrite semantics, Character isolation, metadata privacy, STRICT schema. |
| `runtime-selector.test.ts:14-26` and `authority-aware-legacy-surfaces.test.ts:4-25` | Canonical selection excludes legacy construction and activation retires legacy auto-memory. These tests indirectly prove the compactor-loss coupling. |
| Archived `07-28-memory-context/notes.md:379-413` | Batch 7 close reported full gates and one authorized 44-turn real-gateway probe. The probe found all six priority classes survived, but also found a fabricated year; the date anchor was then added. |

There is no current full-stack or E2E test that drives real chat persistence through the detached trigger and then verifies the next provider request's summary head. The archived design explicitly excluded a new E2E (`batch-7-design.md:231-238`). The one semantic-quality probe was manual and historical, not a repeatable harness.

### Strengths

1. **Clear source of truth:** the timeline remains append-only and user-visible; all context loss is confined to a recomputed replay view (`docs/adr/0005-continuous-timeline-no-sessions.md:3-5`, `docs/adr/0008-replay-view-context-seam.md:1-13`).
2. **One deterministic boundary:** replay, size estimation, and flush use the same selector, reducing split-brain window logic (`conversation-store.ts:98-124`).
3. **Failure-safe retirement:** flush precedes retirement, summary coverage advances only on full success, and failures retry without double-flushing (`compaction-pass.ts:161-204`).
4. **User latency is protected:** summarization runs detached after a committed turn; a concurrent turn reads the old complete view rather than half-applied state (`auto-memory.ts:73-87`, `compaction-pass.ts:143-158`).
5. **Provider-neutral budgeting:** declared windows, post-hoc usage calibration, and overflow shrink avoid relying on a vendor tokenizer or provider-side compaction (`window-calibrator.ts:20-30`, `main.ts:128-145`).
6. **Privacy-aware surfaces:** summaries are absent from scroll-back, logs contain counts rather than text, operator status reads summary length rather than content, and summarization input uses the bounded `entry.content` projection (`summary-repo.ts:16-29`, `compaction-pass.ts:202-208`, `render-transcript.ts:8-10`).
7. **Recent tool fidelity:** tool payloads are kept byte-stable until actual pressure, snapshot tools retain a lagged window of three per tool, and folding never mutates durable rows (`replay-folds.ts:15-19`, `replay-folds.ts:36-60`).

### Weaknesses and harness targets

1. **Critical: compaction stops in canonical memory mode.** The harness should boot or activate canonical memory, drive enough primary turns to cross the trigger, and prove whether `through_seq` advances. Current code says it will not (`runtime-composition.ts:26-48`, `runtime-selector.ts:22-24`).
2. **Critical continuity cliff at 200 rows.** Fetch capping happens before substitution. Once the last summary is more than 200 rows behind, the summary vanishes and the model sees only the newest 200 rows, with no guaranteed warning when the token wall itself is not hit (`conversation-store.ts:137-155`, `conversation-store.test.ts:319-328`).
3. **No end-to-end behavioral harness.** Existing tests prove components with mocks, not the actual sequence `chat commit -> detached scheduling -> utility generation -> durable summary -> next request projection`, nor restart replay, concurrent append behavior, or canonical-runtime behavior.
4. **No summary quality gate.** The writer accepts any non-whitespace text verbatim. There is no must-survive audit, schema/section validation, injection-resistance check, retry-with-reasons, or factual comparison against the retiring span (`compaction-pass.ts:188-204`). Archived research explicitly found that mature systems audit output (`re-compaction-prompts.md:128-138`).
5. **No failure cooldown/circuit breaker.** While the view remains above threshold, an unavailable or low-quality utility model is retried after every completed primary turn (`auto-memory.ts:113-121`, `compaction-pass.ts:196-200`). This can create repeated background cost/log noise.
6. **Retirement pair splitting is resolved in Slice 1.** The pure selector and Replay View now share contiguous call/result units, including duplicate/mismatched/overlapping evidence; malformed units are still rejected from provider replay (`retirement-selector.ts:23-64`, `context-window.ts:52-78,105-135`).
7. **Summary input omits structured tool payloads.** `renderTranscript` supplies only `entry.content`; a tool-result row's content is merely `[tool-result: name -> type]` while the actual result lives in `parts` (`render-transcript.ts:8-10`, `turn-mapping.ts:58-81`). A result not restated in assistant prose can disappear when retired. This is privacy-friendly but fidelity-losing and should be an explicit harness case.
8. **Tool-call argument folding is effectively dead.** Current persistence/replay removes arguments before this stage can save tokens, and the test does not assert a lower replay estimate. The mechanism creates complexity without current pressure relief (`turn-mapping.ts:43-48`, `turn-mapping.ts:94-105`, `replay-folds.test.ts:159-168`).
9. **Unbounded summary can dominate the wall.** The head is stored verbatim with no length bound and is never cut; if it becomes very large, live entries compete for a negative or tiny residual budget and the view can remain permanently above the trigger (`compaction-pass.ts:202-204`, `conversation-store.ts:145-161`). This was an explicit owner quality-over-length ruling, so the harness should measure rather than silently add truncation.
10. **Snapshot classification is convention-based.** Any tool output containing a string `capturedAt` is treated as snapshot-class, with no explicit tool taxonomy or schema marker (`replay-folds.ts:141-147`). False positives/negatives are possible as tools evolve.
11. **No duplicate-result fold.** The original T5 survey recommended newest-wins deduplication of repeated large tool results, but current `foldCandidates` has only snapshot, fact-result, and argument stages (`replay-folds.ts:63-70`; `t5-context-management-survey.md:23-27`).
12. **Observability is minimal.** Wall-hit warnings are counts-only and deduped in memory per advancing boundary, but there is no durable compaction attempt/result ledger, latency/quality outcome, failure count, or reason the head disappeared. Restart intentionally resets warn deduplication (`conversation-store.ts:92-96`; archived `notes.md:412-413`).

### External references preserved from prior research

- `.trellis/workspace/pleia/t5-context-management-survey.md:19-45`: established the split between mechanical tool-result pruning and persisted LLM compaction, append-only transcript/replay-only mutation, and provider-neutral constraints.
- `.trellis/workspace/pleia/t5-decisions.md:20-73`: owner-ratified R1-R5: token-based context, overflow recalibration rather than compaction, persisted summary head, tool-first folding, detached pre-compaction with hard-truncation fallback.
- `.trellis/tasks/archive/2026-08/07-28-memory-context/research/rb-projection-precedents.md:189-237`: sourced the idempotent replay-view terminology, lagged keep window, and storage/view separation.
- `.trellis/tasks/archive/2026-08/07-28-memory-context/research/re-compaction-prompts.md:11-26`, `:128-138`, `:210-218`: compared external summarizers, identified output auditing as the norm, and recorded fully detached conversation compaction as TakiAgent's deliberate local extrapolation.
- `.trellis/tasks/archive/2026-08/07-28-memory-context/batch-7-design.md:48-83`, `:85-137`, `:175-210`: authoritative Batch 7 implementation intent for pipeline order, background placement, flush-before-retire, and memory-summary precedence.

### Related specs and ADRs

- `.trellis/spec/backend/agent-runtime.md`: full tool-call/result persistence and valid replay are anti-hallucination invariants.
- `.trellis/spec/backend/database-guidelines.md`: typed repositories, Zod row boundaries, single Core writer, short synchronous DB work.
- `.trellis/spec/backend/logging-guidelines.md`: never log full prompts/responses; use counts and IDs.
- `.trellis/spec/backend/e2e-harness.md`: L1 deterministic evidence plus L2 real-agent evidence; compaction currently has neither as an owned scenario.
- `docs/adr/0005-continuous-timeline-no-sessions.md`: one append-only relationship stream; context management is invisible.
- `docs/adr/0008-replay-view-context-seam.md`: replay view is recomputed, idempotent, ephemeral, and storage-preserving.
- `docs/deferred-decisions.md:80`, `:85`: eager snapshot folding and prose folding remain deferred until explicit pressure evidence.

## Caveats / Not Found

- At the time this report was written, the active task's `prd.md` had not yet been expanded; the report intentionally did
  not infer target redesign requirements beyond the dispatched research questions. The current PRD and `design.md` now
  record the reviewed target decisions separately.
- This report began as a read-only research snapshot. Slice 1 subsequently changed the live implementation and added regression coverage; current verification is recorded in the implementation handoff rather than retroactively rewriting every historical claim.
- Prior external references were not refreshed on 2026-08-29. They are preserved as design provenance, not claimed as current vendor behavior.
- Slice 1 production changes are present in the worktree; no Git commit/push/reset/rebase/archive was performed, YCE was unavailable in this worktree, and no secondary agent was spawned.
