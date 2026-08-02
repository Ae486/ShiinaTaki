# Batch 7 design — Compaction (R3 summary substitution + R4 folds + R5 background pre-compact)

LAST batch (R0: compaction ships after everything it depends on). Contract: `prd.md` §Batch 7.
Binding rulings: T5-R3 (summary = head MESSAGE substituting the dropped prefix; persisted
overwritable per-character record; NEVER a timeline row), T5-R4 (fold gradient; projection-only,
idempotent, under pressure), T5-R5 (background pre-compact ~80%; wall-hit fallback = HARD
TRUNCATION, never synchronous compaction), T5-R2 (overflow NEVER triggers compaction — already
shipped), R10 voice, R13 numbers. Seam law: ADR 0008 (replay view — idempotent, ephemeral-never-
persisted, cache-shaped) + ADR 0005 (timeline append-only, user-facing). rb verdicts bind R4's
specifics: P2 keep-recent WINDOW of 3 per class (never keep-1 — every precedent keeps a byte-stable
window for cache stability), "nobody folds for correctness" (staleness answer is ANNOTATE — Q5's
capturedAt already landed), fact-class folds only under pressure.

## 0. Source map

| Claim | Source |
| --- | --- |
| Summary enters as a head message replacing the dropped prefix; stored timeline untouched; persisted per-character record with covered range | T5-R3 (t5-decisions.md:45-52, owner: "按 claude code 之类的处理方式,摘要直接进上下文") |
| Fold gradient tool-result → tool-call args → prose → user words LAST; Hermes one-line trace format | T5-R4 (t5-decisions.md:54-65) |
| Keep-window 3 per snapshot class, byte-stable; eager folds NOT adopted (economics weakened: our screenshots are already text) | rb §B/§Verdicts P2 (OpenClaw keeps 3 "so prompt cache prefixes for recent follow-ups stay stable"; Claude Code keepRecent 5; Anthropic keep:3) |
| ~80% background trigger; wall-hit = drop-oldest hard truncation; reuse per-character chain + auto-memory mutex; no user-visible pause | T5-R5 (t5-decisions.md:67-73) |
| Projection seam location + idempotence | ADR 0008 + `conversation-store.ts:61-64` (the ONE select closure both history() and windowStart() ride — batch 6) |
| Hard cut already exists structurally | `context-window.ts` selectWindow token cut (batch 6) |
| Utility slot + chain-hook precedent | batch 4a utility-slot + auto-memory `tidy?` seam (4b) — compaction reuses the same shapes |
| Flush-before-retire duty | MEMORY-DESIGN §Write paths 3 + batch-6 windowStart coupling; OUTSIDE PRECEDENT found by re: OpenClaw's pre-compaction memory flush (silent NO_REPLY agentic turn below the compaction threshold, once per cycle, optionally on a local model) |
| capturedAt on snapshot results (fold trace timestamps) | Q5 (batch 6b) |
| Compaction mechanics + summary prompt design across authorities | `research/re-compaction-prompts.md` (2026-08-01, opus): Claude Code separate-request-same-context [1P mechanics]; Codex synthesized-user-turn fresh summary [OSS]; Letta sliding_window EXTERNAL summarizer on a cheap model, 0.9 trigger, head-placement [OSS — our shape, sourced]; OpenClaw rolling previousSummary + compaction-only model + post-turn trigger [OSS]; Hermes external-but-blocking + iterative move-rules prompt [local tree] |
| Summary record storage shape | LOCAL (single overwritable row keyed by character_id; through_seq marks coverage [begin..through]) — R3 prose demands exactly these fields |

## 1. Wave plan

- **7a — pure projection**: summary substitution + R4 folds inside the replay view. Deterministic,
  no model calls, heavily unit-tested. Migration 012 + summary-repo land here (read side).
- **7b — the compactor (writer)**: trigger, utility-slot summary generation, flush-before-retire
  sequencing, wall-hit visibility, base-prompt teaching line. Depends on 7a's read side.

## 2. Wave 7a — projection

### 2.1 Storage (read side)

- Migration `012-conversation-summary.ts` (010/011 pattern, STRICT):
  `conversation_summary(character_id TEXT PRIMARY KEY, through_seq INTEGER NOT NULL, text TEXT
  NOT NULL, updated_at TEXT NOT NULL)`. One overwritable row per character (R3); coverage is
  [beginning .. through_seq].
- `db/summary-repo.ts` (+test): `get(characterId)` / `upsert({characterId, throughSeq, text})` —
  memory-auto-repo upsert shape.

### 2.2 Replay-view pipeline (the ONE select closure grows two stages)

`conversation-store.ts` select order (each stage pure; the closure remains the single boundary —
flush coupling survives by construction):
1. Load rows (latestAscending, REPLAY_WINDOW backstop).
2. **Summary substitution**: drop entries with `seq <= through_seq`; when a summary exists AND
   covered rows were dropped, prepend the summary HEAD message — `role:"user"`, content =
   `<conversation-summary>\n{text}\n</conversation-summary>` (fence tag LOCAL, grep-verified
   before use; teaching bullet ships in 7b). The head message is part of the PROJECTION only.
3. **R4 folds under pressure** (new pure module `agents/replay-folds.ts`): only when the
   post-substitution estimate exceeds the budget. Fold stages, stopping as soon as it fits:
   a. state-snapshot-class tool-results (results carrying `capturedAt` — the Q5 class marker)
      beyond the newest **3 per toolName** (rb keep-window): payload → one-line Hermes trace
      `[toolName] result folded — captured 14:02, 312 chars` (time from capturedAt, length from
      the folded payload). Byte-stable per row (content-derived), lagged boundary (seq-ordered).
   b. remaining (fact-class) tool-results oldest-first, same trace shape (no capturedAt → no time
      segment).
   c. tool-call ARGUMENTS whose JSON exceeds a size floor (LOCAL ~200 chars), oldest-first →
      `[toolName] called (args folded, N chars)`.
4. Existing token cut (selectWindow) — now the EMERGENCY oldest-drop only (wall-hit half of R5).

**R4-gradient-to-mechanism mapping (deliberate, flagged for the owner):** assistant prose and user
words are NEVER folded in v1 — they degrade only via summary retirement (meaning-preserving) or the
emergency cut (drop-oldest, which reaches them LAST exactly because the summary keeps retiring the
oldest span first). Literal prose-folding is deferred with a trigger (observing quality loss from
emergency cuts outrunning the compactor) — recorded in deferred-decisions at close.

Idempotence tests (ADR 0008): same rows + same budget → byte-identical view, twice; folds never
mutate stored rows (repo re-read byte-equal); substitution + folds + cut compose in order.

### 2.3 windowStart semantics

`windowStart` = first LIVE seq after ALL stages (substitution included) — rows retired by the
summary have "left the window" for the flush too. Safe because 7b flushes BEFORE advancing
through_seq (2 → the flush watermark already covers retired rows; monotonicity guard `through <=
lastFlushSeq` asserted in the compactor). The batch-6 equality test extends to a with-summary case.

## 3. Wave 7b — the compactor

### 3.1 Trigger + placement

`agents/compaction-pass.ts` (+test): `createCompactionPass(deps)` → hook handed to auto-memory as
`compact?` (the 4b `tidy?` seam pattern — runs LAST in the per-character chain: episodic → flush →
tidy → compact; failure swallowed + warn, retried next trigger; auto-memory gains the optional dep,
additive seam). Trigger check is cheap and model-free: the store exposes the select's
`estimatedTokens` (extend the select return); compact when
`estimatedTokens > effectiveWindow × TAKI_COMPACT_TRIGGER_RATIO` (default **0.8** — R5's own
number, config per R13).

### 3.2 The pass (inside the same per-character chain — no new concurrency, R5)

**WHO summarizes (owner question 2026-08-01, made explicit):** an EXTERNAL background module —
`compaction-pass.ts` on the utility slot — NEVER the chat agent itself. The chat agent is not
asked to summarize, receives no "please compact" turn, and its D1-frozen runtime is untouched.
This is the async half of R5's ruling: the alternative (the agent summarizing in-conversation,
the Claude Code `/compact` shape) is synchronous, consumes a visible turn, and produces exactly
the unexplainable pause R5 exists to eliminate. Imperceptibility mechanics: a user turn arriving
DURING a compaction run reads the OLD view (through_seq not yet advanced — watermark discipline)
and proceeds normally; the compacted view serves from the NEXT turn after upsert. Race safety:
newThrough covers only rows that existed at pass start; concurrent appends only extend the live
tail; the keep-turns guard is computed against latest seq at pass start.
**Async honesty flag (re §Contradiction-check):** no surveyed system runs CONVERSATION
summarization fully detached while the user may be typing — Claude Code / Codex / Cline / Hermes
all block the turn (Hermes' own code comments describe sessions "spending most of their wall-clock
summarizing" — the evidence FOR R5). External-on-cheap-model, retiring-span input, rolling merge,
post-turn trigger and flush-first are each individually sourced (Letta / OpenClaw); the
fully-detached COMBINATION is our deliberate LOCAL step beyond precedent, carried by R5's ruling
and the watermark discipline (a mid-generation turn reads the old view; nothing can half-apply).

1. Choose `newThrough` = everything except the newest `TAKI_COMPACT_KEEP_MESSAGES` messages
   (default **40**): the retiring span is ALL old conversation; post-compaction context =
   system prompt + memory + summary + the protected recent tail (low occupancy, ~10-20%).
   OWNER CORRECTION 2026-08-02: the earlier TARGET_RATIO 0.6 ("retire only down to 60%") is
   ABANDONED — it was a leader LOCAL invention with no precedent; it would oscillate forever in
   the 60-80% band, compacting ~3× more often (each pass lossily rewriting the rolling summary)
   and keeping per-request input cost permanently high. The surveyed norm matches the owner's
   shape: Claude Code compacts to summary + recent tail; Codex to summary + token-capped recent
   user messages. One knob dies; KEEP_MESSAGES is the single retention knob (renamed from KEEP_TURNS at owner granularity alignment 2026-08-02: it counts timeline MESSAGE ROWS, not exchanges) (message-count is the
   right unit for "the live thread"; pathological token blowups are already covered by the
   batch-6 window cut backstop).
2. **Flush first**: run the existing flush writer over the retiring span (reuse the flush-writer
   seam exactly as auto-memory invokes it; watermark guards prevent double-writes). Important
   content enters long-term memory BEFORE it leaves the view — MEMORY-DESIGN §Write paths 3
   finally gets its "pre-compaction" meaning.
3. Generate on the **utility slot** (falls back to main model — 4a): rolling summary = ONE
   generateText over [old summary text (if any) + rendered retiring span]. The summary PROMPT is
   designed per §3.2a below — NOT ad-hoc implementer prose.
4. `summaryRepo.upsert` — through_seq advances ONLY on full success (watermark discipline).
5. Counts-only log + `memory_events` NOT used (this is conversation infrastructure, not memory):
   pino line `{characterId, throughSeq, before, after}`.

### 3.2a Summary prompt design (research-bound; owner reviews the draft BEFORE 7b dispatch)

The prompt is a designed artifact with its own sources — authority compaction prompts are being
researched (`research/re-compaction-prompts.md`: Claude Code compact prompt, Codex compact
prompt, OpenClaw/Letta summarization prompts, verbatim + structural analysis). Fixed constraints
already ruled regardless of research outcome:
- R10 MEMORY_VOICE_RULE whole-constant import (tidy precedent) — her voice, not a clerk's.
- Absolute dates only (a summary ages; "today/yesterday" inside it becomes a lie — same rule the
  tidy prompt carries).
- COMPANION divergence from coding-agent templates (owner 2026-08-01): what must survive is
  relationship state — promises made, open threads, decisions, emotional beats, user's situation
  — not files/architecture/next-steps. Authority templates contribute STRUCTURE (sectioning,
  carry-forward discipline, rolling-merge rules), never their coding content taxonomy.
- Framing consistent with the base-prompt teaching line: the summary is HER OWN memory of that
  span (first-person continuity), never a machine artifact she quotes.
- Length control — FINAL OWNER RULING 2026-08-02: NO limit, NO truncation, NO length knob.
  Survey basis (re Part B/C6): the majority of authorities set no number at all (Claude Code
  demands "thorough/detailed"; Codex/OpenClaw give only direction words); Hermes removed its
  hard cap after it broke summaries. The knob `TAKI_COMPACT_SUMMARY_TOKENS` is DELETED from the
  design; the draft prompt's closing line "Aim for about N tokens" is REPLACED by Letta's
  quality closer: "Your notes are the sole record of that stretch of conversation. Every word
  should enable future continuity." (sourced, quality-oriented). Summary quality >> length
  management (owner): the quality levers are the prompt itself, the real-model probe, and
  OpenClaw-style audit-and-retry — never length policing. A long-but-faithful summary is
  harmless in a 128k+ window.
- System-reminder style role:user input framing + "you are NOT the primary agent; produce no
  user-visible text" (the 4b tidy-pass precedent, rc A2).
- The DRAFT prompt (line-by-line sourced, companion-ranked priority ladder, Hermes move-rules for
  the rolling merge) lives in `research/re-compaction-prompts.md` — owner reviews it before
  dispatch; the implementer receives the approved draft as the base text.
- Persona-voice watch-item (re, unprecedented): every sourced external summarizer asks its cheap
  model for NEUTRAL factual prose; we ask the utility tier for a persona-voiced artifact. If the
  quality probe shows voice displacing facts, the sourced fallback is OpenClaw's audit-and-retry
  (audit the produced summary for must-survive items; retry once with the failure reasons
  appended) — never a bigger prompt.

### 3.2b Layer overlap (memory × summary × live window — owner discussion 2026-08-01)

The three layers CAN restate one fact (flush wrote a promise to the pinned block; the summary's
priority-1 keeps it; the live window may still hold the original words). Decisions:
- Summary × live window: structurally disjoint (seq ranges split at through_seq) — no action.
- Memory × summary: benign duplication of TRUE facts is ACCEPTED (tokens are cheap under the
  revised budgets; Letta and OpenClaw both keep their memory writer and their summarizer fully
  independent — no surveyed system cross-reads). The summarizer does NOT read the memory store:
  coupling the layers would let one failure hole the other, and pruning "already-remembered"
  facts from the summary leaves its narrative unreadable (the summary is the chronological
  record; memory rows are timeless facts — different jobs).
- The one HARMFUL overlap case is INCONSISTENCY, not duplication: R18 corrects a memory row, but
  the summary is a periodic snapshot — it keeps restating the stale version until the next
  compaction rewrites it. Fix is free: the base-prompt teaching bullet gains ONE precedence line
  — when the memory store and the conversation summary disagree, the memory store wins (it gets
  corrected; the summary is a snapshot). Same family as card-wins.
- Cheap duplication-shrinker (no coupling): the summary prompt's drop-list gains one line —
  permanent facts about the user (name, fixed preferences, hard boundaries) belong to long-term
  memory, not this record; this record keeps what HAPPENED and what is ONGOING. That removes the
  largest duplication class (identity facts) with zero extra input. Promises stay deliberately
  double-covered: memory records THAT it exists, the summary tracks whether it has been kept.
- NOT adopted: feeding pinned/blocks content into the summarizer input as an exclusion list
  (owner's option-A). Reconsider only if real-machine observation shows repetition actually
  hurting replies — then it enters as an off-by-default switch.

### 3.3 Wall-hit visibility + teaching

- When the emergency cut (stage 4) drops NON-retired rows (cut boundary > through_seq), one
  counts-only warn (`mod:"chat"`) — the signal that the compactor is being outrun (R5 accepted
  this trade; the warn makes it observable).
- `base-prompt.ts` injected-context section: ONE bullet teaching `<conversation-summary>` (a
  condensed record of the older conversation, written by you earlier; treat as your own memory of
  that span, never recite or mention it). CAUTION from re: Hermes' over-strong "REFERENCE ONLY"
  framing on its re-entry prefix suppressed tool use for 7 consecutive turns in production until
  "your tools remain fully active" was added — our bullet must NOT imply restriction of anything
  beyond recitation. Existing pins untouched; body budget guard adjusted deliberately if hit
  (5b D1 precedent).

## 4. TDD table (RED-first where behavior changes)

| # | Test | File |
| --- | --- | --- |
| 1 | migration 012 mechanism (STRICT/PK) | db/migrations/012-*.test.ts |
| 2 | summary-repo get/upsert round-trip + overwrite | db/summary-repo.test.ts |
| 3 | substitution: covered rows dropped, head message present+fenced, no-summary = legacy byte-identical, summary-with-no-covered-rows = no head | conversation-store.test.ts |
| 4 | folds: snapshot keep-3-per-class (4th folds), fact-class only under pressure, args floor, trace formats (capturedAt time + char counts), under-budget = zero folds | agents/replay-folds.test.ts |
| 5 | pipeline idempotence: double render byte-equal; stored rows never mutated; stage order (substitution → folds → cut) | conversation-store.test.ts + replay-folds.test.ts |
| 6 | windowStart with summary = first live seq; batch-6 flush equality test extended with a summary present | conversation-store.test.ts + auto-memory.test.ts |
| 7 | trigger math: fires >ratio, not at/below; estimatedTokens exposed | compaction-pass.test.ts |
| 8 | pass sequencing: flush-before-retire (order-spied), through advances only on success, generate failure → warn + unchanged through + retry next trigger | compaction-pass.test.ts |
| 9 | rolling input carries old summary + retiring span; keep-turns guard (exactly the newest 40 survive); no length cut anywhere (owner ruling — assert the pass never truncates the model's text) | compaction-pass.test.ts |
| 10 | auto-memory chain order episodic→flush→tidy→compact; absent dep byte-identical | auto-memory.test.ts |
| 11 | utility-slot routing (slot model used; main-model fallback) | compaction-pass.test.ts |
| 12 | base-prompt summary bullet present; existing pins green | base-prompt.test.ts |
| 13 | wall-hit warn fires only when the cut outruns through_seq | conversation-store or compaction tests |

## 5. Frozen zones (byte-compare at check)

chat-agent.ts ENTIRELY (no new turn seams this batch — compaction is store/background side);
retrieval stack, blocks, tidy/sweeper/utility internals, assembler, prompt surfaces except the ONE
base-prompt bullet, turn-tail, window-calibrator/context-window internals EXCEPT the sanctioned
selectWindow-return extension (estimatedTokens already computed inside), overflow/usage seams,
e2e suite (no new e2e; compaction is unit/integration-proven — the L2 seed timeline is far below
any trigger).

## 6. Config numbers (R13: env + zod + fail-closed default)

Owner directive 2026-08-01: budgets are OPTIMISTIC — models trend toward 1M contexts, space is
abundant; fidelity first, length second. The error-direction supports this: declaring too HIGH
costs exactly one R2-self-healed request; declaring too LOW silently wastes capacity forever.

- Batch-6 defaults REVISED as a batch-7 rider (one-line default changes + test updates in
  `context-config.ts`): `TAKI_*_CONTEXT_TOKENS` 32768 → **131072**;
  `TAKI_CONTEXT_HISTORY_RATIO` 0.55 → **0.7**.
- New this batch: `TAKI_COMPACT_TRIGGER_RATIO` **0.8** (R5's ruled number — generosity comes from
  the larger denominator, not from moving the ruled ratio) · `TAKI_COMPACT_KEEP_MESSAGES` **40**
  (the single retention knob: compaction retires everything older; owner-corrected shape,
  2026-08-02 — no target-ratio knob exists). NO summary-length knob (owner 2026-08-02: no limit,
  no truncation — see §3.2a). In-code: args fold floor ~200 chars (LOCAL). All join
  context-config.ts.

## 7. Gates & verification

Standard gates (baseline core 1043 / shared 199 / desktop 143 / cli 18; cargo 141; e2e 26); boot
smoke must show `applied [1..12]`. Grep sweeps: `<conversation-summary>` tag unique; no
timeline-row writes from the compactor (repo append never called there). Real-model probe: NOT
authorized for batch 7 unless the owner extends the b6 allowance — a one-shot summary-quality
probe (compact a synthetic long chat, eyeball the summary voice) is RECOMMENDED to request.

## 8. Manual checks to queue at close

Long-chat compaction observation (trigger fires ~80%, summary head appears in outgoing, timeline
scroll-back untouched, no visible pause); summary voice/quality eyeball; wall-hit warn absence in
normal use.

## 9. Routing suggestion

7a pure projection (mechanical, test-heavy) + 7b compactor (concurrency-adjacent but chain-riding)
— fable for both, single implement agent acceptable if dispatched as 7a-then-7b in one brief
(the waves share every file; splitting agents would double the read-in for little isolation gain).
Check: fable.
