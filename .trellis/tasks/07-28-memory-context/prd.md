# PRD — T5: Memory redesign + context management

**Trellis task**: `07-28-memory-context`. No GitHub issue — this is m5 blueprint task-table item 6
(`docs/devlog/m5.md`), run BEFORE T4 by owner ruling 2026-07-27.
**Binding inputs**: `.trellis/workspace/pleia/t5-decisions.md` (T5-R0–R22) + ALL grill rulings in
`notes.md` (2026-07-28, owner-ratified). On conflict, `notes.md` wins as the later ruling.
**Research banks (LAW for their domains)**: `research/ra-retrieval-stack.md` (tokenizer migration,
segmenter, weights), `research/rb-projection-precedents.md` (placement, folds, ADR 0008),
`research/rc-letta-sleeptime-and-search-governance.md` (tidy recipe), `research/research-backlog.md`
(RB-1/RB-2 — deferred, do NOT research during implementation). Workspace surveys as secondary.

## 1. Goal

Memory is the product (T5-R0). Rebuild the memory system so that: (a) what she writes is worth
writing (Write Gate), (b) what must always be visible is deterministically pushed (Memory Blocks),
(c) the ONE permitted search hits (retrieval migration), (d) the store maintains itself (tidy pass),
(e) the context window is token-measured, with compaction as the final nice-to-have. The observed
defect this fixes end-to-end: user states their name → auto-written to `episodes` below the pin
line → unreachable ~200 turns later ("who am I" fails).

## 2. Explicitly OUT of scope (decided at grill — do not re-litigate, do not silently re-add)

- M-D1 MemorySource registry — DECLINED (the assembler section list IS the seam).
- Automatic feedback-distillation pipeline — replaced by three prompt legs (batch 5 + tidy clause).
- Over-search guard — closed by research (rc Part B); break-glass shape recorded in notes only.
- Eager pre-pressure fold — D52. Segmenter upgrades (bigram / jieba) — D53. Panel convergence — D54.
- R12's blocking boot read — superseded by deterministic push; only its "reading memory IS
  remembering" framing survives (batch 5 prompt).
- Write-time threat scan → #25. M-A2 tag VALUES → T4 (T5 ships the seam only). (b+) commitments,
  (c) self-config → T4/#25. D9 emotion capsule → 角色真实感 task (static placeholder stays).
  Semantic/vector retrieval → v2 (#30; batch 3 must not block it — Retriever keeps returning scores).
  croner wall-clock trigger → T4 (additive onto the same tidy fn). Panel UI → #26 (T5 ships config +
  WS surface only).

## 3. Architecture after T5 (build toward this shape)

Memory reaches the model via THREE coexisting paths (Letta shape, not pure pull):

1. **Deterministic push** — system prompt, byte-stable within a day: BASE + day line + persona +
   Identity Card + user-model block + R14 index block + pinned rows (non-truncatable `relationship`
   + `profile` ≥ threshold). Volatile context (minute line, activity block, perception card) rides
   the in-flight message tail, never persisted (ADR 0008).
2. **Agent pull** — `memory_search`, one deliberate call, prompt-taught triggers (T5-R12).
3. **Background prefill** — the tidy pass recomputes the index block and maintains the user-model
   block on the Utility Slot.

**User-info three-store split**: Identity Card = user-authored hard facts, wins ALL conflicts (R7);
user-model block = her consolidated inferred understanding, tidy-maintained, always visible (M-D4);
`profile` rows = raw searchable facts, the block's source material.

**Replay View (ADR 0008)**: stored timeline never rewritten; all context management at one seam
(`conversation-store.history()` + outgoing assembly); idempotent; ephemeral additions never persisted.

## 4. Batches (each = one implement → check cycle; gates green between batches)

### Batch 1 — Write side + entry schema

- **Write Gate (R15)**: episodic + flush prompts drop the "1 to 3 summaries" quota; the test is
  "likely to change future responses in similar situations", with a when-NOT-to-save list
  (short-lived / trivial / redundant / overly personal / translate-rewrite payloads), the override
  (explicit 记住 always saves), and explicit permission to write NOTHING. Every skip emits a skip
  event (event log; counts only, never content).
- **Layer choice + ceiling (Q11-1)**: the writer chooses `profile`/`relationship`/`episodes`/
  `intentions`; its importance output is CLAMPED below every pin threshold (registry-derived —
  `pinnedImportanceThreshold`, never hardcoded numbers).
- **R10 voice**: ONE shared person/wording convention (first person, from her POV, preserve the
  user's actual words, "write only what appears in the transcript — do not infer") across episodic +
  flush prompts (compaction joins in batch 7). Extract the shared prompt fragment; no divergence.
- **origin (Q8, closes D47)**: frontmatter + entry codec gain `origin: "self" | "observed"`
  (default self); migration adds the `memory_meta` column + reindex; `image-description-writer`
  writes observed.
- **M-A2 seam**: `onTurnCompleted(characterId, origin = "primary")` — zero behavior change.
- **R9 dedupe→reinforce**: normalized-string near-dup check at write; on hit, bump importance +
  refresh recency on the EXISTING entry (no new row); reinforce event logged with turn seq.
- `memory_write` tool description gains per-layer importance guidance (profile included — closes the
  "relationship-only" gap).

### Batch 2 — Block foundation

- **block-store** module (Workspace-scoped, atomic writes, single-file deletable per D28) +
  **block registry** (declarative rows `{id, ownership, writer, injectPosition}`): `user-card`
  (global, writer:user), `memory-index` (per-character, writer:background), `user-model` (global,
  writer:background). Blocks = PURE markdown, zero frontmatter (policy lives in the registry), never
  indexed in FTS.
- Card loader clones the persona-provider shape (read + cache + safe fallback + strip-note);
  agent-side write tool REFUSES writer:user blocks.
- **selectPinned rework (R20/R14)**: pinned region = blocks (registry order, each rendered with its
  budget number) + non-truncatable `relationship` rows + `profile` ≥ threshold rows. Budget stays an
  absolute safety valve (config, R13).
- **Assembler fence (Q8)**: observed-origin entries render inside `untrusted-fence` wherever memory
  content enters the prompt.
- MEMORY-DESIGN.md gains §Blocks (tree sketch + tier rule) in the same batch.

### Batch 3 — Retrieval migration

- **Migration**: `memory_fts` → `fts5(path UNINDEXED, disclosure, content, search_terms,
  tokenize='unicode61')`; full reindex from files (rebuildable by design).
- **Segmenter seam (D53 hard constraint: NOTHING hardcoded)**: a small tokenizer interface;
  v1 impl = `Intl.Segmenter('zh', word)`; indexer writes deduped segmented terms of
  `disclosure + ' ' + content`; `buildFtsQuery` segments the query and ORs quoted tokens; LIKE
  fallback kept for degenerate input. Optional ~30-word stoplist (config).
- **Weights**: 4-column bm25 exposed as config; initial direction = disclosure & search_terms above
  content (per Nocturne A3 + ra §A.1 regressions); values re-derived against the A/B cases.
- **Gate removal (Q2)**: delete the `disclosureMatches` post-filter from `fts5-retriever`
  (`pickIntention`'s use is untouched).
- **Hits (Q2/Q8)**: `toHit` adds `disclosure` + `origin`; observed hit content is fenced.
- **Search events (其四)**: `memory_search` execute logs an event (characterId, turn seq, hit
  count) into the existing event log; thread the turn seq into `createMemoryTools`.
- Tests must include ra's failing classes: 2-char words (拉面/电影), NL questions (我对什么过敏),
  mixed CJK+ASCII (VSCode), plus reindex-equivalence.

### Batch 4 — Maintenance

- **Utility Slot (R11)**: provider config slot, falls back to main model; background tasks run
  serially; token spend reportable (media-usage method precedent).
- **Tidy pass (confirmed recipe — rc is LAW)**: triggers = write-count (default 40/character,
  config) + operator-only WS method `memory.tidy` (+ croner later, additive); skip-if-no-new-writes
  guard; per-character high-water mark; input = SQL health report (5 classes — missing-disclosure &
  layer-over-budget stated as FACTS; stale / near-duplicate / misfiled phrased as QUESTIONS, each
  with full content + crossed threshold) + the new-writes slice; system-reminder framing ("you are
  NOT the primary agent; produce no user-visible text"); prompt = six refinement principles +
  do-nothing permission + absolute dates + R10 voice; tools = row ops (reinforce / archive-and-
  supersede / set-disclosure / refile) + block rethink (writer:background blocks only) + explicit
  `finish` tool with a STRUCTURAL terminal rule + step cap (config, default ~12); clean store + no
  new writes = ZERO model calls. SQL never prescribes actions (R8 reversibility).
- **Index block (R14)**: tidy recomputes — a compact per-layer index of what exists, phrased as
  recall triggers (question vocabulary), never bulk content.
- **user-model block (M-D4)**: tidy maintains — patterns + well-supported inferences ONLY (Letta
  Infer-Sensibly constraint); (b)-leg-3: recurring same-class feedback consolidates into a rule here.
- **Retention sweeper (R8)**: extract the shared sweeper shape (3rd instance after attachment-GC +
  ambient-shot-GC); `activity` hard-delete past rolling window; `intentions` archive on expiry;
  `episodes` archive below importance cut after N days (config). The registry `retention` field
  finally gets its consumer.
- **R17** fix-on-read prompt rule (lands with batch 5's prompt work if cleaner — implementer's call,
  but the RULE ships in T5).

### Batch 5 — R6 removal + prompt overhaul + volatile relocation

- **R6**: delete the assembler retrieved section, `RETRIEVED_BUDGET/LIMIT`, `RECALL_WINDOW`,
  `recentText`; the retrieval engine serves `memory_search` only.
- **Q4**: `composeInstructions` = BASE + day line + assembled (persona / capsule placeholder /
  blocks / pinned) — day-stable; volatile set (minute line + activity + perception) moves into
  `buildOutgoing`'s in-flight tail (never persisted, no new turn boundary; transport-faithful tests
  per the D1 seam law); base-prompt wording updated (time-line positions + injected-tail contract);
  the same-day-stability unit test migrates to the new shape.
- **Prompt overhaul** (base prompt = truthfulness floors; assistant layer = tone — per the T2/T4
  split): T5-R12 trigger set (pattern-match primary "topic that should exist in your memory";
  index-fired disclosure triggers; epistemic backstop "about to say I don't remember → search
  first"; anaphora 上次/之前/还记得; unrecognized proper noun; NEVER answer from impression about
  the user's past) + non-triggers (present moment, already-pinned content, small talk); "reading
  memory is remembering, not looking up a database"; R16 pin-on-repeat; R18 supersede-don't-append +
  user-correction trigger ("不对/你搞错了" = a signal about the memory store); R19 experience shape
  (Baseline/Deviation/Outcome/Reusable-judgment, non-strict); card-wins rule.
- **Flagship L2 goes GREEN here**: name-recall scenario (user states name → 200+ turns of filler →
  "我是谁/我叫什么" answered correctly WITHOUT being told to search). Record the RED run first
  (against pre-batch-1 behavior or by reverting the gate), per the red→green proof rule.

### Batch 6 — Token window

- **R1 three tiers**: per-slot `contextTokens` declaration (config, fail-closed default); rolling
  calibration factor from real usage when present; estimator fallback (extend `token-estimator.ts`:
  tool-schema overhead, flat per-image estimate, message-envelope overhead). Message count survives
  ONLY as a hard backstop.
- `history()` windows by measured tokens against the effective window (ratio config, R13).
- **R2**: on provider overflow error → effective window := 90% of observed usage, retry ONCE,
  persist the recalibration. Never triggers compaction.
- **Flush coupling (coupling point 2)**: `auto-memory` computes "leaving the window" from the SAME
  token boundary — same slice, no drift window.
- **Q14**: `includeUsage` provider config (default OFF); leader runs the one-shot real-gateway test.
- **Q5**: state-snapshot tool results (screenshot describe / foreground / process list / clipboard /
  time) embed their capture timestamp at creation (byte-stable, persisted).

### Batch 7 — Compaction (LAST, per R0)

- **R3**: per-character overwritable summary record (text + covered seq range), persisted, survives
  restart; `history()` substitutes it as the HEAD message replacing the dropped prefix; NEVER a
  timeline row; scroll-back untouched.
- **R4 folds** (projection-only, idempotent, under pressure): gradient = tool-result → tool-call
  args → long assistant prose → user's words LAST; state-snapshot class folds FIRST with keep-window
  3; Hermes-style one-line traces (`[screenshot] described the screen at 14:02 (312 chars)`).
- **R5**: background pre-compact at ~80% (Utility Slot; reuses per-character turn serialization +
  auto-memory mutex — no new concurrency); wall-hit fallback = HARD TRUNCATION (drop oldest), never
  synchronous compaction.
- Summary prompt shares the R10 voice fragment.

## 5. Cross-batch constraints

- D1-frozen turn runtime: NAMED ADDITIVE seams only; transport-faithful mocks covering BOTH stream
  endings (abort part + thrown reason).
- OS-neutral core (invariant 8). **Zero new dependencies across the whole plan** — any dep is a
  stop-and-ask.
- Anti-sprawl caps (file ≤300 / fn ≤50 / params ≤3); module-contract headers; per-dir `index.md`
  updates; no barrel files.
- Every new number: config + zod validation + fail-closed default (R13). Panel surfaces are #26's.
- Retrieval maintainability (owner hard constraint 2026-07-28): segmenter, weights, ranking pipeline
  all behind swappable seams — v2 hybrid must be an addition, not a rewrite.
- Event log entries carry ids/counts/ranges only — memory content NEVER enters pino logs.
- Trellis flow per batch: implement → check (RED-proof every red→green claim) → leader verification.

## 6. Acceptance

- Flagship: name-recall L2 red→green (batch 5).
- Per batch: `pnpm -r typecheck && pnpm -w lint && pnpm -r test` + cargo (untouched: expect 141) +
  e2e net green. Baseline at kickoff: core 706 / shared 195 / desktop 143 / cli 18 / cargo 141.
- Manual checks queued to `docs/devlog/manual-checks.md`: identity-card hand-edit flow; `memory.tidy`
  WS invocation; user-model block content after real chats; volatile-tail behavior; usage
  calibration observation (post-Q14 test).

## 7. Post-T5 couplings (for T4/T6 kickoffs — record, do not build)

- T4: heartbeat turns have no user message — T4 picks its own injection point for the volatile tail;
  heartbeat memory access = blocks/index (per-turn retrieval no longer exists); M-A2 origin values;
  croner becomes tidy's primary trigger.
- T6 #26: every config exposed here needs a panel surface; D54 convergence on the owner's call.
- D29 comes due at the first `ws-client.ts` touch (#22).
