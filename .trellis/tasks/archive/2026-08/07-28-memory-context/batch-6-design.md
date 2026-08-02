# Batch 6 design — Token window (R1 three tiers + R2 recalibration + flush coupling + Q14/Q5)

Contract: `prd.md` §Batch 6. Binding rulings: T5-R1 (tokens never messages; three tiers; no
provider-locked counting), T5-R2 (overflow recalibrates, never compacts), T5-R13 (numbers →
config + zod + fail-closed default), Q14/Q5 (prd §Batch 6 items). Compaction itself is batch 7 —
NOTHING here summarizes, folds, or drops-with-summary; this batch only measures, windows,
recalibrates, and stamps.

## 0. Source map

| Claim | Source |
| --- | --- |
| Tokens never messages; declared per-slot window; usage calibrates post-hoc; estimator decides; message count = hard backstop only | T5-R1 (t5-decisions.md:20-35) incl. its two verified facts: usage is inherently POST-HOC; no streaming usage today (`@ai-sdk/openai-compatible` sends `stream_options:{include_usage:true}` only when configured — main.ts does not) |
| Overflow → effective window := ~90% of observed usage, retry ONCE, persist; never compaction | T5-R2 (t5-decisions.md:37-43, owner-consistent leader patch) |
| Current hard boundary + its single-source coupling | `conversation-store.ts:12-14` (REPLAY_WINDOW=200, "the pre-compaction flush treats this boundary AS the context edge"), consumed at `auto-memory.ts:6` |
| Estimator seam + calibration intent | `token-estimator.ts` header ("constants live here for calibration") + regime constants |
| Provider construction sites (three slots) | `main.ts:101-112` (main + vision), `memory/bootstrap.ts` (utility, 4a) |
| `result.usage` = all-steps sum in ai@7.0.17 | Batch-4b verification against installed dist types (notes.md batch-4 closure) |
| Leading-tool-row drop on a window cut | `conversation-store.ts:66-71` (existing behavior, must survive the token cut) |
| includeUsage option name/shape; usage field names; overflow error shape | UNVERIFIED — implementer duty: verify against installed `@ai-sdk/openai-compatible` + `ai` dist types before coding (source-grounding guide; do NOT trust this design's spelling) |

## 1. Wave plan

- **6a — measurement + token windowing** (config slots, estimator extension, calibrator + persistence,
  `history()` token cut, shared boundary for the flush coupling, usage-capture seam).
- **6b — R2 overflow retry + Q14 includeUsage + Q5 snapshot timestamps** (touches the frozen turn at
  one named seam; separated so 6a's mechanical layer is checked before the subtle error-path work).

## 2. Wave 6a

### 2.1 Config: per-slot declared windows (R1 tier 1)

New `config/context-config.ts` (+test): `TAKI_PROVIDER_CONTEXT_TOKENS`, `TAKI_VLM_CONTEXT_TOKENS`,
`TAKI_UTILITY_CONTEXT_TOKENS` — zod coerce int positive, garbage fatal (R13). Absent → fail-closed
default `32768` (LOCAL choice, flagged: conservative floor for DeepSeek-class gateways; a too-low
declaration costs window headroom, a too-high one costs exactly one R2-healed request). One ratio
knob `TAKI_CONTEXT_HISTORY_RATIO` (0<r<=1, default `0.55`, LOCAL): the slice of the effective
window granted to replayed history — the remainder covers instructions + tool schemas + the
response. One knob on purpose; per-component reserves would be speculative config (KISS).

### 2.2 Estimator extension (R1 tier 3)

`token-estimator.ts` grows three exported helpers beside the existing regime constants (constants
stay IN-CODE per the file's own calibration-seam contract; the R13 env surface is the window-level
knobs above — interpretation note for the check):
- `estimateMessageTokens(message)`: part-aware — text via estimateTokens; per-message envelope
  constant (`MESSAGE_OVERHEAD`, LOCAL ~4); per-image flat constant (`IMAGE_TOKENS`, LOCAL — cite a
  provider-doc figure if findable, else flag) for file parts; tool-call/tool-result parts stringify
  their JSON payload through estimateTokens.
- `estimateMessagesTokens(messages)`: sum.
- Existing `estimateTokens`/`fitToBudget` untouched (block/pinned budgets keep their semantics).

### 2.3 Calibration + persistence (R1 tier 2, R2's storage)

New `memory/… no — agents/window-calibrator.ts` (+test), colocated with the store it serves:
- `createWindowCalibrator({ repo, declared })` → per-slot state
  `{ effectiveWindow(): number; onUsage(observed): void; onOverflow(observed): number }`.
- `onUsage`: rolling correction factor = EMA of (provider inputTokens / our estimate for the same
  request) — α LOCAL ~0.3; factor clamped [0.5, 2] (LOCAL) so one bad sample cannot halve or double
  the window. Estimate-at-send is supplied by the caller (the store computed it when windowing).
- `onOverflow(observed)`: effective window := floor(observed × 0.9) (R2), persisted, returns the new
  window. Never raises above declared.
- Persistence: migration `011-slot-window-state.ts` — table `slot_window_state(slot TEXT PRIMARY
  KEY, effective_window INTEGER, factor REAL, updated_at TEXT)`; repo methods on a new small
  `db/window-state-repo.ts` (single-writer invariant 2 holds — core owns the db). Boot loads
  persisted state; absent rows → declared × 1.0.

### 2.4 Token windowing in `history()` + the shared boundary (flush coupling point 2)

- New colocated `agents/context-window.ts` (+test): pure
  `selectWindow(entries, budgetTokens, maxMessages)` — walk newest→oldest accumulating
  estimateMessageTokens until the budget, cap at maxMessages (the hard backstop — REPLAY_WINDOW
  stays exported with its meaning narrowed to "backstop against a broken estimator", R1), then the
  existing leading-tool-drop. Returns `{ entries, windowStartSeq, estimatedTokens }`.
- `conversation-store.history(characterId)` uses it: budget = calibrator.effectiveWindow(slot main)
  × historyRatio. Store gains an optional injected `window?: { budget(): number }` dep — absent =
  legacy REPLAY_WINDOW behavior (tests unchanged by default; production wires it).
- **Flush coupling**: auto-memory/flush-writer must compute "leaving the window" from the SAME
  boundary. `history()`'s window result (windowStartSeq) is the single source: expose
  `store.windowStart(characterId): number` computed by the same selectWindow call. Implementer
  verifies the current flush math in `auto-memory.ts` (maybeFlush region, unread here — explore
  duty) and swaps its REPLAY_WINDOW arithmetic for windowStart, deleting the direct REPLAY_WINDOW
  import if nothing else needs it. Same slice, no drift window (prd coupling point 2).

### 2.5 Usage capture (the calibration feed) — named additive seam on the D1-frozen turn

`ChatAgentDeps` gains optional `onUsage?: (report: { inputTokens?: number; outputTokens?: number;
estimatedInput: number }) => void`. Fired DETACHED after the committed path (alongside
`fireDetachedTurnWrites` — same "never adds latency, only on committed turns" contract) with
`await`-free void promise handling: `result.usage` is a PromiseLike settled after stream end
(all-steps sum, 4b-verified). estimatedInput rides from composeInstructions+outgoing estimation
(computed once, passed through). Absent dep = today's behavior byte-identical. Transport-faithful
tests both endings (a thrown ending fires no usage report; a retracted turn fires none).
main.ts wires it to the calibrator (slot "main"). Vision/utility slots: NOT calibrated in v1 —
their traffic is rare and their windows generous; recorded as a deliberate gap (design honesty),
revisit when a vision-turn overflow is ever observed.

## 3. Wave 6b

### 3.1 R2 overflow retry (named seam, the subtle one)

In `runTurn`, wrap the `agent.stream(...)` call + stream consumption in ONE overflow-classified
retry: on a thrown provider error classified as context-overflow AND no partial text yielded yet
(nothing user-visible lost) AND first attempt: `calibrator.onOverflow(observedOrEstimate)`,
re-window history through the store (fresh `history()` call now under the shrunken budget), rebuild
outgoing + instructions, retry ONCE. Second failure propagates as today. Never triggers any
compaction/summarization (R2; batch 7 owns that).
- Classification: `APICallError`-shaped errors whose status/message match the openai-compatible
  context-length family — implementer derives the exact predicate from installed
  `@ai-sdk/provider-utils`/`ai` error classes + representative gateway messages; UNRECOGNIZED
  errors never retry (fail-open to today's behavior — a misclassification must not double-send a
  turn). Predicate lives in a colocated `agents/overflow-error.ts` (+test) — pure, string/status
  matching, LOCAL-flagged.
- Frozen-zone law: the stream loop body, persistTurn, retract machinery stay byte-identical; the
  retry wraps at the call granularity already present in runTurn. If the wrap pushes runTurn past
  the 50-line fn cap, extract the attempt body to a named fn (seam comment names it).
- Observability: one counts-only pino line + a `memory_events`-style record is NOT added (this is
  not memory); log line only.

### 3.2 Q14 — includeUsage provider config (default OFF)

`TAKI_PROVIDER_INCLUDE_USAGE` (boolean env, default false, zod) → when true, main.ts passes the
openai-compatible streaming-usage option at provider/model construction (exact option name/site
verified against installed dist types — R1's verified fact names `stream_options:{include_usage:
true}` as the wire shape). OFF default because gateway compatibility is unverified (R1).
REAL-MODEL ALLOWANCE (owner, 2026-07-31): batch-6 implement/check agents MAY run one-shot
real-gateway probes with the local key to verify functional correctness — the Q14 usage-arrival
test, a live `result.usage` shape check for the calibrator, and (if reachable safely) an overflow
classification sample. Evidence verbatim in the report; probes are one-shot, never load loops.

### 3.3 Q5 — state-snapshot tool results embed capture timestamps

The state-snapshot tool family — `screenshot-tool` (describe path), `process-list-tool`,
`clipboard-read-tool`, and the time tool if its result is persisted (implementer enumerates the
actual family from `capabilities/`; the criterion: a result that describes MUTABLE system state,
becomes stale, and persists into replay) — each result gains `capturedAt` (ISO, stamped once at
execute time). Byte-stable across replays (persisted with the tool-result row; never recomputed).
Purpose: the model can see how old a snapshot is (chat-agent teaches nothing new — the relative-age
convention arrives with batch 7's folds; this batch only records the timestamp). Shared helper if
>2 call sites need identical stamping (3rd-instance rule), else inline per tool.

## 4. TDD table (RED-first where behavior changes)

| # | Test | File |
| --- | --- | --- |
| 1 | context-config: parse/defaults/garbage-fatal sweeps per knob | config/context-config.test.ts |
| 2 | estimateMessageTokens: text/CJK mix, multi-part, image flat cost, tool-part JSON, envelope constant | memory/token-estimator.test.ts (extend) |
| 3 | selectWindow: token cut newest-kept, maxMessages backstop wins when estimator undercounts, leading-tool-drop after cut, empty/single oversized entry kept | agents/context-window.test.ts |
| 4 | history(): windowed by injected budget; absent dep = legacy 200-message behavior byte-identical | agents/conversation-store.test.ts (extend) |
| 5 | windowStart: flush sees EXACTLY history's boundary (same entries fixture, both paths, equality) | auto-memory.test.ts + conversation-store.test.ts |
| 6 | calibrator: EMA update from usage, clamp bounds, onOverflow 90% + floor + never-above-declared, persistence round-trip across re-create | agents/window-calibrator.test.ts |
| 7 | migration 011 mechanism test (006-style) | db/migrations/011-*.test.ts |
| 8 | onUsage seam: fired detached on committed turns only; absent dep byte-identical; both stream endings; retract fires none | agents/chat-agent usage tests (new colocated file) |
| 9 | overflow classify: true family match, non-overflow never matches, unknown error → no retry | agents/overflow-error.test.ts |
| 10 | R2 retry: overflow on attempt 1 → recalibrated + ONE retry with re-windowed history → success; overflow twice → propagates; partial text already yielded → NO retry | chat-agent overflow tests (transport-faithful both endings) |
| 11 | includeUsage: default off (no option passed), on when env set | config + main-wiring-adjacent test (construction-arg assert) |
| 12 | Q5: capturedAt present, ISO, stamped once (two calls differ), persisted through timeline replay byte-stable | per-tool tests (extend) |

## 5. Frozen zones (byte-compare at check)

All batch 1-5 artifacts: retrieval stack (retriever/fts5-*/tokenizer/indexer), blocks, tidy/sweeper/
utility/bootstrap internals, assembler, base-prompt + assistant-layer + memory-tools (prompt
surfaces), turn-tail/buildOutgoing/composeInstructions (5a seams), persistTurn/retract/vision
machinery. chat-agent.ts changes ONLY at the two named batch-6 seams (usage capture, overflow
retry). perception/avatar untouched. e2e untouched (no new e2e this batch — the L2 harness carries
no token-window scenario; window behavior is unit-proven).

## 6. Config numbers summary (R13)

`TAKI_PROVIDER_CONTEXT_TOKENS`/`TAKI_VLM_CONTEXT_TOKENS`/`TAKI_UTILITY_CONTEXT_TOKENS` (default
32768 LOCAL) · `TAKI_CONTEXT_HISTORY_RATIO` (default 0.55 LOCAL) · `TAKI_PROVIDER_INCLUDE_USAGE`
(default false, Q14). In-code calibratable constants (estimator envelope/image, EMA α, clamp
bounds, the 0.9 overflow factor — R2's own number) flagged LOCAL in comments. Panel surfaces are
#26's (unchanged rule).

## 7. Gates & verification

Standard: typecheck 5/5, lint 0, `pnpm -r test` (baseline core 948 / shared 199 / desktop 143 /
cli 18), cargo 141 untouched, e2e 26 net (leader), boot smoke (migration 011 must appear in
`applied[...]`). Grep sweeps: no remaining direct `REPLAY_WINDOW` consumer outside
conversation-store/context-window (the backstop) after the flush swap. main.ts headroom watch:
289/300 counted lines pre-batch — config loads compose into `context-config.ts` and wiring stays
one-line-per-seam; if the cap is threatened, extract provider construction to
`config/provider-factory.ts` (flagged as sanctioned relief, not sprawl).

## 8. Manual checks to queue at close

Q14 one-shot real-gateway usage test (leader-run, then owner-informed); window-behavior observation
(long real chat: no provider overflow, or exactly one self-healed retry visible in logs).

## 9. Routing suggestion (decided at dispatch)

6a mechanical-but-wide → fable if opus availability still low, else opus. 6b touches the frozen
turn's error path (subtle, transport-faithful test discipline) → fable.
