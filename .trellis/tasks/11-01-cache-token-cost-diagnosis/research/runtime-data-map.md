# Runtime data, accounting, and replay evidence

Date: 2026-11-01. Read-only diagnosis; production code and data were not changed.

## Source and identity

- Worktree: `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`, HEAD `6b36d0d` at entry, 201 pre-existing porcelain status lines. Current dirty code is not an exact reconstruction of historical deployment.
- `packages/core/src/main.ts:174` bootstraps from process environment. `packages/core/src/boot/core-bootstrap.ts:50` resolves `TAKI_DATA_DIR` before the stored configuration overlay and opens `taki.db`; `packages/core/src/config/server-config.ts:32` defaults to the user home `.takiagent` directory. A stored setting cannot move the database already opened.
- Confirmed readable database: `C:/Users/55473/.takiagent/taki.db`, with its current WAL included through a normal read-only SQLite connection. No running Core process was observed during inspection. Do not describe this as a live request trace.
- Current worktree configuration has no `TAKI_DATA_DIR` override, main model `deepseek-v4-flash`, main hostname `api.deepseek.com`, monitor `FULL_LOCAL`, and max steps 20. This is a current file observation, not proof of historical launch environment or account tariff.
- Database usage names are `taki-provider.chat` with `deepseek-v4-flash` in the earlier cohort and `deepseek-flash` on October 24–28. The current official alias mapping cannot establish every historical backend checkpoint.

## Canonical evidence and denominators

- `run_usage` has one unique row per `effect_id`; use it as the accounting base. `usage.settled` events repeat those observations and must not be added a second time. `run_id`, `attempt_id`, and `effect_id` link requests to Runs, Attempts and model Effects (`packages/core/src/db/effect-repo.ts:184`).
- 176 Runs, 176 Attempts, 291 model Effects, 288 usage rows, 282 known input/output records, and 263 cache-detail pairs were observed. 174 Runs have at least one usage row. Three model Effects remain unsettled, and six settled usage rows have unknown counters; neither category proves zero billing.
- Overall normalized cache fraction is `10,446,464 / 15,268,640 = 68.4178%`. The denominator excludes 25 usage rows lacking a usable input/cache pair. The mean of individual request percentages is 69.6744%; 262/263 requests have positive recorded cache reads. These are three different metrics.
- All known input across 282 records is 16,657,760 tokens; all known output is 82,441. The paired cohort has 4,822,176 non-cache input tokens. A ratio of cache reads to all known input would incorrectly count old missing detail as misses.
- Main invariant checks: no duplicated usage Effect; every observed complete input-detail row satisfies `input = noCache + cacheRead`. This is normalized-counter consistency, not invoice reconciliation.
- Latest usage is `2026-10-28T14:27:45.593Z` (22:27:45 Asia/Shanghai). Timeline history runs from July 13 through October 28; 4,223 stored rows have maximum seq 4,232. Gaps in sequence numbers are not invented messages.

## Missing observability

- All 160 `context.snapshot` events say `accountingQuality: unknown` and contain source categories only. `packages/core/src/db/run-repo.ts:125` emits this admission metadata; it does not persist per-component token counts.
- `packages/core/src/agents/request-measurement.ts` computes instruction/message/tool/replay estimates, but `main.ts:212` and `main.ts:548` retain the current measurements in a process-local Map. No historical component series was found in this database.
- Snapshot manifests record model and authority/catalog references; `packages/core/src/harness/run-snapshot-capture.ts:97` uses `replayDecision: not_captured`. They do not store exact historical system instructions, outgoing messages, or schemas. `FULL_LOCAL` does not make these missing facts reconstructible.
- Installed AI SDK is 7.0.148 and the OpenAI-compatible adapter is 3.0.75. The installed adapter's `src/chat/convert-openai-compatible-chat-usage.ts:25` uses `cached_tokens ?? 0`; reasoning also defaults to zero when omitted. Preserve the distinction between reported zero and adapter-synthesized absence. The one zero-cache historical row has no retained raw provider body sufficient to resolve this.
- Reasoning is included in output tokens; never add both to cost. Cache reads are included in SDK input totals, unlike some reference-project counters.
- All Attempts have ordinal 1. This rules out recorded higher-ordinal Attempt retries in this cohort; it does not establish that SDK/transport-level retries never occurred.
- See [usage-coverage.md](usage-coverage.md) for auxiliary model paths and [reference-cache-practices.md](reference-cache-practices.md) for provider/accounting semantics.

## Current request construction

- `packages/core/src/agents/agent-attempt.ts:59` selects Replay View, `:63` obtains captured memory assembly, `:89` composes instructions, `:91` canonical-sorts tool keys, and `:189` appends the transient turn tail. `:193` performs complete request preparation.
- `agent-attempt.ts:292` composes memory policy, day date/timezone, memory context, extension/avatar additions and Run instructions. `canonical-memory-assembly.ts:30` freezes persona/blocks/pinned content but `:35` selects a relevant intention by the current message. Semantic memory, persona, intention and catalog changes can therefore change the early prefix. Their per-request historical contribution is not measurable from retained snapshots.
- Minute time, perception and automatic recall are already in the current user tail, not refreshed at the front on every tool step. Old transient tails are intentionally not persisted. Moving them into durable history to chase cache hits would change privacy and freshness contracts.
- `turn-mapping.ts:48` persists tool names/IDs without arguments; `:110` replays an empty input object. `:61` retains tool outputs. Exact same-run wire history and next-turn canonical replay are therefore different representations by design.
- Current disclosure (`tool-disclosure.ts`) hides dedicated tools until loading/description. Stable ordering is already implemented; a changed active schema set, inbox instructions, or an explicit private-context rollover remains a legitimate request change that must be measured separately.

## Offline replay probe

`probe_replay.mjs` imports the real current `createTimelineRepo` and `createConversationStore`, reads the source DB with Node SQLite `readOnly: true`, and projects the last 12 user boundaries. It never invokes the agent/model or writes through a repository method.

Inputs: latest persisted main calibration `131000 / 1.4138823936674911`, effective estimator window 92,652, existing default history ratio 0.7, history budget 64,856, and summary revision 5 / through seq 3715. This fixed calibration is a stated analytical assumption, not historical per-request calibration.

Observed in [replay-projection.json](replay-projection.json):

- Eight of eleven adjacent projections change their first replay message and window start; one additional pair changes an earlier folded result after 184 matching messages.
- The summary is present at seq 4205, absent at 4210/4212, present at 4214, absent at 4216–4228, and present at 4230. The source start moves between 3716 and later rows while tool call/result boundaries and candidate-page admission are respected.
- Every point has `tokenBoundaryHit: false` and `sourceBackstopHit: false`. These flags alone would not explain changing source admission/summary reachability. Source-window start and summary inclusion need their own facts.
- Projected history occupies 53,846–64,766 estimator units in these points. These numbers exclude system instructions, schemas, current tail and subsequent request-preparation reductions; they are not billed-token counts.

Mechanism: `replay-source-loader.ts:52` stops according to source budget, unresolved call/result pairs and summary reachability; `conversation-store.ts:184` substitutes the reachable summary, then folds (`:203`) and selects a window (`:204`). `replay-folds.ts:48` changes eligible result projections only under pressure. The probe proves a current-code mechanism that can destroy an old replay prefix with this data. It does not allocate the historical 68.4% result among this mechanism, early memory changes and provider cache conditions.

## Existing independent request capture

The retained October 30 diagnostic at `target/agent-delegation-20261030-validation/eight-foreground-prompt-comparison-20261030/` is separate from the normal-use DB. Structural read-back confirmed its two bodies differ only at `messages[0].content`; both have 15 messages and 30 schemas.

The baseline requests recorded 26,240/26,380 cached input (99.47%). First use of the changed system recorded 6,016/26,471 (22.73%); the repeated changed request recorded 26,240/26,471 (99.13%). This is a bounded sequential observation of a changed then warmed prefix, not a general causal allocation or reliability estimate. The four already-existing calls total 106,337 tokens and are excluded from DB aggregates. This diagnosis made no new paid calls.

Sanitized read-back is [existing-prefix-comparison.json](existing-prefix-comparison.json). No raw conversation bodies were copied into this task.

## Reproduction

From the T4 worktree:

```powershell
python ./.trellis/tasks/11-01-cache-token-cost-diagnosis/research/analyze_runtime.py --db 'C:/Users/55473/.takiagent/taki.db' --output './.trellis/tasks/11-01-cache-token-cost-diagnosis/research/runtime-metrics.json'
node ./.trellis/tasks/11-01-cache-token-cost-diagnosis/research/probe_replay.mjs 'C:/Users/55473/.takiagent/taki.db' './.trellis/tasks/11-01-cache-token-cost-diagnosis/research/replay-projection.json'
```

The Python output includes all cohort denominators, per-tool counters, stored payload character counts, compaction lifecycle rows and invariant results. Character counts are deliberately not mislabeled as tokens. Reproduction against a later database is a new observation and may differ from this dated snapshot.
