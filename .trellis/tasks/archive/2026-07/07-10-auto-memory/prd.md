# PRD — Automatic memory writes: episodic summaries + pre-compaction flush

**GitHub issue**: #7 (M2). Parent: #1. Blocked by: #6 (DONE).
**Trellis task**: `07-10-auto-memory`

## 1. Goal

Two automatic write paths so the timeline never silently forgets (MEMORY-DESIGN §Write paths 2-3): every-N-turns **episodic summarization** into the `episodes` layer, and a **pre-compaction flush** that runs a silent tool-enabled turn extracting durable memories from the segment about to fall out of the model's context window. Both write ONLY through the #6 store API (file + index + structured log event) — no raw appends.

## 2. Context mapping (leader ruling)

We have no LLM-context "compaction" machinery; our context boundary IS `REPLAY_WINDOW = 200` (#5): messages beyond it silently stop reaching the model. Therefore **"pre-compaction" = "about to cross the replay-window boundary"**. Issue text's "today's episodes file" predates #6's uniform entry-per-file ruling — episodic summaries are **entry files** in `episodes/` (1-3 per pass), AC satisfied via correct frontmatter.

## 3. Design (settled)

- **State**: migration `003` — `memory_auto_state(character_id TEXT PRIMARY KEY, last_episodic_seq INTEGER NOT NULL DEFAULT 0, last_flush_seq INTEGER NOT NULL DEFAULT 0)`. Watermarks are seq values from `timeline_messages`. New repo `db/memory-auto-repo.ts` (get/set, upsert semantics). **The watermark IS the double-flush guard** (AC 3), plus an in-flight per-character mutex so overlapping triggers cannot double-fire.
- **Triggers** (in `memory/auto-memory.ts`, called fire-and-forget by chat-agent after each completed turn — `onTurnCompleted(characterId)`, injected optionally so existing tests stay untouched):
  - *Episodic*: `latestSeq - last_episodic_seq >= EPISODIC_EVERY_N = 20` → summarize the segment `(last_episodic_seq, latestSeq]` (fetch via timeline repo) → non-streaming LLM call (plain generate on the injected model — verify exact v7 generate API against installed `.d.ts`; archived research files cover the model/mock basics) with a prompt asking for 1-3 concise episode summaries → write each via store (`episodes`, importance from summarizer output clamped 3-7, `disclosure` optional) → advance watermark.
  - *Flush*: `latestSeq - REPLAY_WINDOW > last_flush_seq` → the segment `(last_flush_seq, latestSeq - REPLAY_WINDOW]` is leaving the window → run a **silent tool-enabled agent turn** (ToolLoopAgent with the #6 memory tools bound to characterId; instructions: "extract durable facts/promises/preferences worth keeping from this transcript segment; call memory_write for each; then reply DONE") — the model's text output is DISCARDED, no timeline rows, nothing streamed (OpenClaw silent-turn pattern) → advance watermark.
- **Failure policy** (error-handling spec): any LLM/store failure → `log.warn` (ids/lengths only), watermark NOT advanced (natural retry at next trigger), the user-facing turn is NEVER blocked or crashed (triggers run detached after the turn completes; `setImmediate` + catch-all).
- **Ordering**: episodic check runs before flush check in one serialized pass per trigger; both may fire in one pass.
- **Constants** in `memory/auto-memory.ts`: `EPISODIC_EVERY_N = 20`, flush uses `REPLAY_WINDOW` imported from its #5 home (single source). Deliberately config-later (Sampling-defaults stance).
- **"Event"**: each auto-write emits one structured pino info (`mod:"memory-auto"`, kind, characterId, entryId, segment range) — the MEMORY-DESIGN "event log line". WS push for memory events lands with UI slices.

## 4. File map

```
packages/core/src/db/migrations/003-memory-auto-state.ts   (+ index-list entry)
packages/core/src/db/memory-auto-repo.ts (+test)
packages/core/src/memory/auto-memory.ts (+test)            # triggers, watermarks, mutex, failure policy
packages/core/src/memory/episodic-writer.ts (+test)        # segment -> summary entries (LLM generate, store writes)
packages/core/src/memory/flush-writer.ts (+test)           # segment -> silent tool turn
packages/core/src/agents/chat-agent.ts                     # EDIT: optional autoMemory dep; onTurnCompleted after appendAssistant
packages/core/src/main.ts                                  # EDIT: wire auto-memory
```

Headers + index.md updates everywhere touched. Summarizer/extractor prompts are why-commented string constants colocated in their writer modules.

## 5. TDD plan (mock model everywhere; :memory: db; tmp workspace)

| Cycle | Tests |
| --- | --- |
| A state | T1 memory-auto-repo: default zeros, upsert, per-character isolation |
| B episodic | T2 below-threshold no-op; T3 crossing 20 fires EXACTLY once (double-trigger → one write set; watermark advanced), entries land in `episodes/` with correct frontmatter via store API (file+index both visible); T4 LLM failure → no entries, watermark unchanged, warn logged, next trigger retries |
| C flush | T5 no-op until `latestSeq - 200 > last_flush_seq`; T6 crossing fires ONE silent tool turn over exactly the leaving segment (mock model called with segment content; memory_write invoked via tool → file+index; no timeline rows added; nothing notified to WS); T7 double-flush guard: re-trigger without new messages → zero calls; T8 mutex: overlapping triggers serialize (no double LLM call) |
| D integration | T9 chat flow: mock streaming turn completes → detached trigger runs → user turn latency unaffected (turn resolves before auto-write finishes); existing chat-agent tests untouched (autoMemory optional) |

## 6. Constraints

All standing constraints (headers/index.md, size caps, closed union, why-only comments, pino no-content, sole node:sqlite importer via db/, store API is the ONLY write path — grep for raw fs in new modules must find none, no new deps). Verify the non-streaming generate call signature against installed ai@7 `.d.ts` before use (note it in a code comment or the report). All #3-#6 tests stay green.

## 7. Verification

```bash
pnpm -r typecheck && pnpm lint && pnpm -r test
# leader live smoke: fresh data dir -> pair -> chat 21+ short turns (scripted) -> episodes/ entry appears;
#   (flush live path needs 200+ turns - covered by tests, not live-smoked; note in devlog)
```

AC mapping: AC1←T3+smoke · AC2←T6 · AC3←T7/T8 · AC4←T3/T6 (store API asserted via file+index) · AC5←T3/T6/T7.
