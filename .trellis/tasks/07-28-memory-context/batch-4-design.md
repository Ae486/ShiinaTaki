# Batch 4 design — Maintenance (Utility Slot, tidy pass, blocks content, retention sweeper)

Pre-development design for PRD §Batch 4. Binding inputs: prd.md §Batch 4 + notes.md rulings
(R11 slot; the confirmed tidy recipe; R14 index block; M-D4 user-model; R8 sweeper/reversibility;
Q11-2 "model-first for maintenance tasks"; R13 config; batch-1/2 planning notes (1)-(4) near the
bottom of the ruling block). Research bank `research/rc-letta-sleeptime-and-search-governance.md`
is LAW for the tidy recipe (Part A verified against Letta source; §"Concrete recommendation" is
the five-class report contract). Written 2026-07-30 by the leader; owner-confirmed before dispatch.

## 0. Execution shape

Two implement waves, ONE check at the end (leader call, standing flow-elasticity):
- **4a — foundations**: utility slot, main.ts bootstrap extraction, tidy watermark migration,
  retention sweeper + shared sweep-runner extraction, auto-memory additive seam.
- **4b — the tidy pass**: health report SQL, tidy toolset, prompt, orchestration, WS method,
  index/user-model block maintenance, events.
4b depends on 4a (slot + watermark + seam). Gates green between waves.

## 1. Wave 4a

### 1.1 Utility Slot (R11)

- `config/utility-config.ts` — TAKI_UTILITY_BASE_URL / _API_KEY / _MODEL, all-or-none like
  vision-config (the shipped optional-slot precedent); absent → null.
- `memory/utility-slot.ts` — `createUtilitySlot({model, config?, logger})`:
  - `model` — the resolved LanguageModel: utility provider when configured, else the MAIN model
    (Letta shape verbatim: sleep-time inherits the primary's llm_config; "stronger model" is
    guidance, not default — rc A2).
  - `run(label, task)` — GLOBAL serial promise chain (background tasks run serially — R11
    constraint); never rejects outward (structured warn, error-handling spec).
  - `usage()` — cumulative {calls, inputTokens, outputTokens} accumulated from each task's
    reported LanguageModelUsage (fields are `number | undefined` in v7 — treat undefined as 0
    and count a `usageUnknown` tally). In-memory since boot; reportable (media-usage precedent);
    surfaced in the memory.tidy WS response (4b) — no separate WS method in T5.
- Wiring option (take it): main.ts passes `utilitySlot.model` to the episodic/flush writers'
  `model` dep — one line at the call site, no writer file touched; all background LLM work then
  honors the operator's cheaper-model choice. Chat model untouched.

### 1.2 main.ts bootstrap extraction (planning note 3 — now REQUIRED, main is at 299/300)

New `memory/bootstrap.ts`: `createMemorySubsystem({db, dataDir, promptDir, logger, model…})` →
{engine, autoMemory, blockStore, memoryRoot, …} — moves the persona provider + block store +
engine + reconcile logging + auto-memory construction out of main. `memoryRoot` stays on the
returned object (mediaUsage registration still reads it). Pure move, transport-faithful: zero
behavior change, main.ts drops well under the cap with headroom for 4b wiring.

### 1.3 Tidy watermark

- Migration `010-memory-tidy-state.ts`: `ALTER TABLE memory_auto_state ADD COLUMN last_tidy_at
  TEXT` (nullable; null = never tidied). 006-style mechanism test.
- `memory-auto-repo.ts` gains `lastTidyAt` in get + `setTidy(characterId, isoTime)` (same upsert
  shape as the two existing watermarks).
- Write-count derivation needs NO new counter: writes-since-mark = SQL count over
  `memory_entries` in the character's recall scope (global OR characterId) where
  `COALESCE(updated_at, created_at) > last_tidy_at` (updated_at counts R9 reinforcements as
  activity — a reinforced store is a changed store).

### 1.4 Retention sweeper (R8) + shared runner

- Extract `scheduler/sweep-runner.ts` (repo map already reserves scheduler/): the shape both
  existing GCs share — `startSweeper({name, sweep, intervalMs?, logger})` = one boot sweep + 6h
  unref'd interval + count-only log line. REFACTOR `media/attachment-gc.ts` and
  `perception/ambient-shot-gc.ts` onto it (R8: the 3rd instance is the extraction trigger);
  their tests keep passing unmodified if the refactor is pure.
- `memory/retention-sweeper.ts` — driven ENTIRELY by the registry `retention` field (its first
  consumer). Per variant:
  - `{rollingDays}` (activity): HARD delete past the window — file removed + index row deleted.
    `store.ts` gains `deleteAtPath` (containment-guarded unlink; the sanctioned-fs-site header
    already covers it); repo `deleteByPath` exists.
  - `"expiring"` (intentions): archive (R8 — never delete) when `expires < now`; **null-expiry
    intentions** (planning note 2): archive when `expires IS NULL AND age > intentionsDefaultDays`
    (config, default 30 — LOCAL choice, flag it; nothing sets expires today, so without this the
    expiring layer never expires anything).
  - NEW registry variant `{archiveBelowImportance, afterDays}` — episodes moves from "permanent"
    to `{archiveBelowImportance: 4, afterDays: 90}` (LOCAL defaults, flagged like memory-index's
    400; registry numbers are zod-validated data — the rollingDays/budgetTokens precedent).
  - Age anchor everywhere = `COALESCE(updated_at, created_at)` (R9: reinforcement refreshes
    recency — a reinforced row must not decay on its birth date).
  - Sweeper logs counts only; archived rows keep their files (status flip — reversible, R8).

### 1.5 Auto-memory additive seam

`auto-memory.ts` deps gain OPTIONAL `tidy?: { maybeRun(characterId): Promise<void> }`; called
after `maybeFlush` inside the SAME per-character chain (serialization for free; absent = today's
behavior byte-identical). This is the write-count trigger's hook point.

## 2. Wave 4b — the tidy pass (rc Part A is the recipe; every row below cites it)

### 2.1 Triggers (rc A2 trigger row + our deltas)

1. Write-count: `maybeRun` fires the pass when writes-since-mark >= `tidyWriteThreshold`
   (config, default 40/character). Letta's skip-guard adopted in spirit: nothing new → not even
   a report query.
2. Operator WS method `memory.tidy` (registry.register, server/methods pattern): runs NOW,
   bypassing the count check — but a clean store + no new writes still returns
   `{status:"clean"}` with ZERO model calls (the rc §135 property).
3. croner wall-clock — T4, additive onto the same function (record only).

### 2.2 Input assembly (rc §133-139 — the five-class contract)

`memory/tidy-report.ts` — deterministic SQL/code, zero model cost when clean:
- **FACTS** (stated flatly, rc §137): (a) missing recall-trigger — `disclosure = ''` rows
  (boolean; under R12 such a row can never fire the index); (b) over-budget — non-truncatable
  pinned rows total vs `pinnedBudget`, plus each block's used/limit numbers (the SAME numbers
  the prompt renders; batch-2 F6: used may EXCEED limit on a trimmed block — the prompt must
  say this is expected).
- **QUESTIONS** (hypotheses with evidence, rc §138 — never verdicts, R8): (c) stale — retrieved/
  mood-gated rows with `COALESCE(updated_at,created_at)` older than `tidyStaleDays` (config,
  default 45, LOCAL choice flagged; pinned rows are never "stale" — they are always visible),
  phrased "why was this never recalled?" with age + threshold shown (Nocturne's
  `Stale for: ~M days (Threshold: T)` rendering); (d) near-duplicate — `normalizeForDedupe`
  pair scan within layer+scope (reuses dedupe.ts; lexical only), phrased "same thing, or a real
  distinction?" with BOTH contents; (e) misfiled — NOT a fake SQL detector: the question "does
  this belong where it is?" is asked over the NEW-WRITES SLICE (recent auto-written rows), per
  rc §139 point 5 — fresh mistakes get caught before they age into defects.
- Plus the new-writes slice itself (id, layer, importance, disclosure, content, age) — the
  Letta-shaped raw material (rc A2 input row).
- SQL NEVER prescribes an action (rc §140; R8 reversibility).
- Report caps: per-class candidate limit (config, default 10) so a degraded store cannot blow
  the pass's context — dropped counts are STATED in the report ("12 more not shown").

### 2.3 The pass (`memory/tidy-pass.ts`)

- Runs via `utilitySlot.run("tidy", …)`; per-character; advances `last_tidy_at` ONLY on success
  (auto-memory's failure-retries-next-trigger convention).
- Framing (rc A2): input delivered as a role:user message wrapped in `<system-reminder>`: she is
  NOT the primary agent, she is reviewing her own memory store after the fact, produce NO
  user-visible text (base-prompt no-self-narration rule).
- System prompt: the six voice-variant refinement principles (Integrate / Update / Organize /
  Infer-Sensibly / Be-Precise / Be-Comprehensive-&-Concise — rc A4), the do-nothing permission
  VERBATIM in spirit ("if there are no meaningful updates, call finish immediately; not every
  observation warrants an edit"), absolute-dates rule, R10 `MEMORY_VOICE_RULE` import (ONE
  voice across all writers), the tool-granularity doctrine (precise ops for narrow edits,
  block rethink for sweeping ones — rc A5 docstring discipline), the used>limit-on-trimmed-
  blocks expectation, and the R14/M-D4 block duties (below).
- **Structural exit** (rc A2 termination row): `stopWhen: [hasToolCall("memory_finish_edits"),
  stepCountIs(tidyMaxSteps)]` — verify the exact AI SDK v7 API names against the installed
  package (source-grounding; flush-writer's isStepCount is the sibling precedent). Step cap
  config, default 12 (far below Letta's 50 — rc A2 note).
- Zero-model-call exit: no defects AND no new writes → return without constructing an agent.

### 2.4 Tidy toolset (`memory/tidy-tools.ts` — maintenance verbs the FOREGROUND agent never gets)

| Tool | Semantics |
| --- | --- |
| `memory_reinforce(id)` | Row op → engine reinforce path (importance-max + recency, R9 machinery reused) |
| `memory_archive_supersede(id, replacement?)` | Archive the row; optionally write the corrected replacement in one act (R18 supersede-don't-append; replacement goes through the write path → dedupe/ceiling apply) |
| `memory_set_disclosure(id, disclosure)` | Fixes the missing/weak recall trigger (planning note 1: this is ALSO the repair path for reinforce-discarded disclosures) |
| `memory_refile(id, layer)` | Move a row to the right layer (target restricted to writable layers; per Q11-1 the AUTO ceiling does NOT bind tidy — tidy promotion is one of the two sanctioned routes to the pin rung, but importance stays untouched by a refile) |
| `block_rethink(id, content)` | Whole-block rewrite via blockStore.writeBlock caller:"background" — the store REFUSES user-card by policy (batch-2 seam doing its job) |
| `memory_finish_edits()` | No-op terminal (rc A5) |

All execute never-throw `{ok:false, code, reason}` (memory-tools convention). Row ops resolve
id → path via the repo (same as memory_archive).

### 2.5 Block duties (the prompt's standing orders)

- **memory-index (R14)**: recompute per-character — a compact per-layer index of what EXISTS,
  phrased as recall triggers in question vocabulary ("用户问自己叫什么" style), NEVER bulk
  content; sourced from the store's disclosure/content fields. Model-written via block_rethink
  (Q11-2: model-first for maintenance judgment).
- **user-model (M-D4)**: maintain the global block — patterns + WELL-SUPPORTED inferences only
  (Letta Infer-Sensibly, rc A4: "do not invent unsupported details"); the Identity Card wins
  every conflict (R7 — restated in the prompt); (b)-leg-3: recurring same-class feedback
  consolidates into a standing rule here.

### 2.6 Observability

- Event kind `tidy` added to memory_events (count = edits made; turn_seq null) — its四 family.
- pino: one summary line per pass — {characterId, defects per class (counts), edits, steps,
  durationMs}; NEVER content (logging-guidelines).
- WS `memory.tidy` response: {status: "clean"|"ran", defects: per-class counts, edits, steps,
  usage: slot cumulative} — counts only; panel detail is #26's.

## 3. Constraints and frozen zones (batch 4)

- Frozen: `chat-agent.ts` (D1); `assembler.ts` retrieved section + RETRIEVED_* (batch 5);
  fts5-retriever/fts5-query/search-tokenizer INTERNALS (batch 3's, consume only);
  disclosure-gate.ts; write-convention.ts content (import it, don't edit it); the conversation
  toolset in memory-tools.ts (tidy tools are a NEW module).
- Touched-by-design: auto-memory.ts (additive seam), store.ts (deleteAtPath), memory-auto-repo,
  layer-registry (retention variant + episodes row), main.ts (shrinks), the two existing GC
  files (pure refactor onto sweep-runner).
- Zero new deps; no commit; OS-neutral; size caps (tidy-pass/report/tools are separate files BY
  DESIGN — do not merge into one); headers; index.md; why-only comments; every new number =
  config (utility env vars, tidyWriteThreshold 40, tidyMaxSteps 12, tidyStaleDays 45,
  intentionsDefaultDays 30, per-class report cap 10) or registry data (episodes retention
  values) — zod + fail-closed defaults; LOCAL-choice numbers explicitly flagged in comments
  (source-grounding: no fabricated precedent).
- Memory content NEVER in logs/events/WS responses. Boot smoke on main.ts change (non-default
  port + kill tree).

## 4. TDD table (per wave)

4a: slot falls back to main model when unconfigured / uses utility provider when set; run()
serializes two concurrent tasks; usage accumulates and tolerates undefined fields; bootstrap
extraction = main boots identically (smoke) + engine wiring test unchanged; migration 010
mechanism; watermark get/set + writes-since-mark counting (updated_at counts); sweep-runner boot
sweep + interval (fake timers) + both refactored GCs' existing tests still green; sweeper per
variant: activity hard-deleted (file gone + row gone), expired intention archived, null-expiry
intention archived past default days, episodes below-cut archived after days, reinforced row
NOT swept on birth date (COALESCE anchor), archived rows keep files.

4b: trigger fires at threshold and not below; explicit WS call runs below threshold; clean
store + no new writes = zero model calls (assert NO agent constructed); report facts vs
questions rendering (each class, thresholds shown, caps stated); misfiled questions come from
the new slice; near-duplicate pairs via normalizeForDedupe; structural exit (finish tool ends
the loop; step cap ends a runaway scripted model); every tidy tool op lands (reinforce bumps,
supersede archives + writes replacement through the gate, set-disclosure updates file+index,
refile moves file to the new layer dir + reindexes, block_rethink writes background blocks and
is REFUSED on user-card); watermark advances only on success; tidy event + count; WS response
shape; prompt contains the six principles + do-nothing permission + voice rule (string-level
pin, the write-convention test precedent).

## 5. Deliberately deferred (recorded)

- croner trigger → T4 (additive onto maybeRun). R17 fix-on-read prompt RULE → batch 5 prompt
  work (implementer's-call clause in the PRD; record here so it is not lost). Panel surfaces →
  #26. RB-1 usage-counter promotion → backlog (tidy does NOT read search events in T5).
- Stale-threshold sophistication (Nocturne's per-priority `3.5*2^prio` tiering) → revisit when
  real data shows the flat tidyStaleDays misfires; the config seam is the upgrade point.
