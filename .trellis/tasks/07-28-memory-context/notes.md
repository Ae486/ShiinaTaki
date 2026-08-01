# T5 kickoff notes — verified corrections + pending rulings (pre-PRD ledger)

> Working ledger so kickoff decisions survive context compaction. Superseded by prd.md once written.

## Numbering convention

`t4-decisions.md` and `t5-decisions.md` BOTH use bare R1–R12+ — same collision class the owner already
fixed for M-/D- numbers. From here on cite **T5-R#** / **T4-R#**; bare R# is ambiguous.

## Fact corrections vs t5-decisions (verified in code 2026-07-28, owner not yet confirmed)

1. **T5-R12 claims `disclosure` "is not in the index" — it IS.**
   `db/migrations/002-memory.ts:25`: `memory_fts(path UNINDEXED, disclosure, content, tokenize='trigram')`.
   The "index disclosure" work item does not exist.
2. **BM25 weights already set, direction OPPOSITE to T5-R12's intent.**
   `db/memory-repo.ts:82`: `bm25(memory_fts, 0.0, 1.0, 2.0)` — content 2x over disclosure. Using
   disclosure as the recall trigger means re-weighting an existing knob (and justifying direction), not adding one.
3. **The disclosure gate actively punishes natural-language triggers (NOT in the grill's defect list).**
   `fts5-retriever.ts:32` post-filters every hit through `disclosureMatches`;
   `disclosure-gate.ts:12-15` splits on whitespace/commas and requires a token to be a LITERAL SUBSTRING
   of the query. A Chinese NL trigger ("用户问自己叫什么的时候") is ONE token that must appear verbatim in
   the user's message — near-never. Empty disclosure = always eligible. Consequence: writing a trigger
   makes an entry HARDER to retrieve than leaving it blank. T5-R12's trigger-phrasing cannot land until
   this gate's semantics change (gate must become a RANKING boost, not an AND filter — exact shape is a
   kickoff decision).

## New design items surfaced 2026-07-28 (need kickoff ruling; not in t5-decisions)

- **N1 — Cache shape after T5-R6.** The time-awareness ruling placed the minute line at the system-prompt
  tail because "the retrieved section varies per turn anyway — marginal cache cost ~= 0". T5-R6 deletes
  the retrieved block, killing that premise: remaining volatile items (activity block, perception card,
  minute line — `chat-agent.ts:260-266` composes them into the SYSTEM message) become the sole per-turn
  variance, and the system message precedes ALL history, so any change busts the prefix cache for the
  entire conversation every turn. Candidate post-R6 shape: system prompt stable within a day (BASE + day
  line + persona + pinned/card), volatile blocks ride the CURRENT turn's in-flight tail (precedent: 1f
  costume notice — named additive seam on the D1-frozen turn, not persisted). "Volatile-late" corrects
  from "late in the system prompt" to "late in the REQUEST". Touches: same-day-tail-only unit test
  migration, base-prompt time-line guidance, transport-faithful tests for the new seam.
- **N2 — Volatile-class eager fold in the history projection.** History accumulates tool results
  (D1 full-turn persistence): agent-initiated screenshot describes, get_current_time, memory_search,
  exec output. For the "system state at time T" class (screenshot describe / time / process list /
  clipboard / foreground), stale is not merely big — it is WRONG. Proposal: only the most recent instance
  keeps its payload; older ones fold to a one-line trace at `conversation-store.history()` render time
  (T5-R3's landing site), independent of the 80% compaction trigger. Stored timeline untouched (ADR 0005).
  Fact-class results (exec output, memory hits) fold only under T5-R4 pressure. Low volume today (ambient
  describes ride the perception card via instructionsExtra — `main.ts:335-336` — and never enter the
  timeline), so this is cheap insurance, priority low-medium.

## Rulings landed during grill (running log)

- 2026-07-28 **Q0 RULED (owner)**: T5 retrieval = keyword main line (three compensations: R10 wording,
  disclosure trigger channel, CJK segmentation); vector hybrid stays v2 (#30), shape unchanged
  (weighted union + degradation chain).
- Batch 1 (Q1–Q3) PARKED → awaiting `research/ra-retrieval-stack.md` (agent: retrieval-research).
  Q2 pre-finding: Nocturne's real disclosure mechanism = indexed + returned-with-hits + prompt rule;
  our AND gate is SillyTavern lorebook heritage, home scenario dies with R6. NEW GAP: `memory-tools.ts`
  toHit() drops `disclosure` — hits must return it.
- Batch 2 (Q4–Q6) PARKED → awaiting `research/rb-projection-precedents.md` (agent: projection-research,
  adversarial stance vs leader proposals P1 eager-tail-relocation / P2 volatile-class eager fold /
  P3 "Replay Projection" ADR). Owner delegation: Q4 leader may finalize if precedent confirms;
  Q5 recommended-accepted pending precedent check; Q6 leader's call after research.

- 2026-07-28 **Q7 RULED (owner)**: blocks = pure markdown files under workspace memory tree `blocks/`
  dirs (global + per-character); ZERO frontmatter — policy lives in a declarative block registry
  (`{id, ownership, writer, injectPosition}`); blocks never enter FTS; loader clones persona-provider
  shape (strip-note, cache, fallback); card writer=user (agent read-only), index writer=background.
  MEMORY-DESIGN gains §Blocks. CONTEXT.md: Memory Block + Identity Card terms added.
- 2026-07-28 **Q8 RULED (owner)**: entry frontmatter gains `origin: self | observed` (default self;
  image-description-writer writes observed); fence BOTH render sites (assembler + memory_search hit
  content) via existing untrusted-fence; migration adds origin column + reindex; toHit() also returns
  `disclosure` (Q2 gap) and `origin`; rides the first entry-schema batch. D47 CLOSES in T5.
- 2026-07-28 **Q9 RULED (owner)**: tidy triggers = write-count (~40/character default, R13-exposed)
  PLUS an explicit operator invocation (owner addition — operator-only WS method; panel/CLI consume
  later); after T4, croner wall-clock becomes the PRIMARY trigger (same tidy fn, additive source).
  R8 third sweeper extracts the shared sweeper shape.

- 2026-07-28 **Q11-1 RULED (owner)**: auto writer layer choice OPEN + importance ceiling BELOW the pin
  line (always-visible reached only via card / deliberate pin R16 / tidy promotion).
- 2026-07-28 **Q11-2 REDIRECTED (owner)**: tidy is MODEL-LED — "抄 Letta" (sleep-time agent shape);
  fixed code allowed for simple parts but model-first. Article digested (jishuzhan MemGPT/Letta ch.16:
  sleep-time = async background agent at idle; core-memory ~2000-token rule; keep prefs/facts/task-
  context, drop temp/failed/outdated/chit-chat; Letta Filesystem LoCoMo 74.0% > mem0 68.5%).
  NEW FACT: `references/letta-main` exists locally. → rc research (agent letta-tidy-research): docs
  first, then local source; deliver clean-room recipe. Five-defect SQL list demoted to candidate
  "health-report input" (Nocturne diagnostic pattern), not a gate. Q9 trigger rulings unchanged.
- 2026-07-28 **Q11-3 RULED (owner)**: both organizing legs (scheduled batch + fix-on-read prompt rule).
- 2026-07-28 **Q12 REDIRECTED (owner)**: supplement research before closing — rc part B sweeps
  adaptive-retrieval / when-to-retrieve literature + agent tool-frequency governance; verdict whether
  the "no standalone guard" conclusion survives.
- Q10 row-walkthrough IN PROGRESS: Round A = M-A1 / M-A2 / M-D1 (independent rows); M-A3 + M-D4 + (b)
  HELD until Letta research lands; trivial move rows queued after.

- 2026-07-28 **Q10 Round A RULED (owner)**:
  - M-A1: fence(T3a) + origin(Q8) + scrub(T3b) stand; write-time threat scan rides #25 (owner condition
    "viable + sourced" met: fence-not-scan IS the shipped project pattern + m5 principle 3 assigns the
    scanner to community imports; #25 kickoff re-verifies scanner shape with sources).
  - M-A2: T5 leaves the origin param seam on onTurnCompleted (default 'primary', zero behavior change);
    T4 fills values. Entity ships with T4 heartbeat per blueprint.
  - M-D1: DECLINED (owner criterion: keep only if sourced AND affects functionality — it affects none).
    Assembler section list is the de-facto seam; OpenClaw/Hermes precedent is a single pluggable ENGINE
    slot, not a per-source registry. Rationale → PRD rejected-alternatives; NOT a D-number debt.
  - Still held for rc (Letta) report: M-A3, M-D4, (b).

- 2026-07-28 **Q10 Round B RULED (owner)**: five move rows confirmed — M-D3→RB-1; (b+)→T4; (c)→T4+#25;
  D9 stays with the 角色真实感 task (T5 keeps the static capsule placeholder); compression = R1–R5.
- 2026-07-28 **Q14 RULED (owner)**: `includeUsage` provider config, default OFF; one empirical test on
  the owner's real gateway inside the token-window slice; estimator independent of usage regardless.
- **Q13 PARKED** pending rc Part B (owner challenges "nobody measured pull-only" — adaptive-retrieval
  literature is the check).

## Research digests + resulting rulings (2026-07-28, ra + rb landed; rc still running)

**ra (retrieval stack)** — `research/ra-retrieval-stack.md`:
- Framework question RULED (leader, sourced): NO library import. All JS candidates are in-memory
  indexes duplicating ours; LangChain BM25 whitespace-splits Chinese into ONE token; LlamaIndex
  keyword index = one LLM call PER NODE at index time. Engine stays SQLite FTS5.
- NEW FACT (changes the work item): a segmented aux column is INERT on a trigram table (2-char MATCH
  token → zero trigrams); Nocturne's own table is `unicode61`. So T5-R12(b) = tokenizer MIGRATION
  (trigram → unicode61 + `search_terms`), not adding a column. Measured A/B (30 rows / 25 queries):
  rank@1 17/25 → 24/25, in-top3 25/25, index SMALLER. All trigram misses are NL questions (R12 shape).
- Accepted regressions: ASCII infix lost (`scode`→VSCode dies; `token*` prefix works); `content`
  column near-dead for CJK-mixed rows under unicode61 → bm25 weights RE-DERIVED for the 4-column
  layout (Q1's original "flip 1.0/2.0" framing OBSOLETE; direction principle survives:
  question-vocabulary columns ≥ content, per Nocturne A3); CJK infix-within-token lost unless bigrams.
- **Q1 SUPERSEDED (leader)**: weight values re-derived empirically at implementation vs the new
  layout, exposed via R13; direction = disclosure/search_terms carry recall.
- **Q2 FINALIZED (leader, owner's 权衡 delegation, sourced)**: remove the AND post-filter on the pull
  path; disclosure recall rides bm25 weighting; hits return `disclosure` + `origin`; `disclosureMatches`
  survives ONLY in the intention gate. Nocturne precedent: no gate, weighted column, returned with hits.
- **Q3 PENDING OWNER**: Option 1 = Intl.Segmenter only (zero deps; full ICU 78.3 verified, dictionary+
  Viterbi) — leader rec; Option 1b = ∪ deterministic bigrams (kills substring-of-token class, restores
  CJK infix; ~1.6× index); Option 1c = @node-rs/jieba (cut_for_search + custom glossary words; prebuilt
  native ~3MB — binary-in-OS-neutral-package is an owner-level rule call). Escalation triggers recorded.
- sqlite-vec v2-readiness CONFIRMED (node:sqlite `allowExtension` verified locally; win/linux prebuilds;
  pre-v1 caveat). Retriever seam keeps returning scores for a later union.

**rb (projection precedents)** — `research/rb-projection-precedents.md`:
- **Q4 FINALIZED (leader, owner pre-delegated "verified ⇒ decide")**: volatile set (minute time line +
  activity block + perception card) moves to the in-flight tail INSIDE the outgoing user message (1f
  seam pattern: outgoing copy only, never persisted, no extra turn boundary). Day-date line stays in
  the system prompt; post-R6 the system prompt becomes day-stable. P1 CONFIRMED by Claude Code
  (`<system-reminder>` in messages, system prompt byte-identical for cache sharing), Codex
  (`<environment_context>` as user message, append-never-rewrite, no-op when unchanged), OpenAI cache
  guide verbatim. Counter-evidence absorbed: Hermes' system-tail needs Anthropic breakpoints (non-
  transferable); Codex's persisted-append variant rejected in ADR 0008 (relationship-stream pollution);
  strip/ephemeral hygiene = by construction (outgoing-only). Implementation touches: same-day-tail unit
  test migration, base-prompt time/injection wording (9f41646 line extended), transport-faithful seam
  tests. T4 coupling noted: heartbeat turns have no user message — T4 picks its own injection point.
- **Q5 REVISED, PENDING OWNER**: research CONTRADICTED two specifics of the accepted proposal —
  (1) K=1 keep-latest contradicted by every precedent (OpenClaw keeps 3 completed turns byte-stable
  for cache; CC keepRecent 5; Anthropic keep 3): unlagged fold mutates the cache-hot tail every
  sampling interval, fighting Q4's own payoff; (2) "stale is wrong" motive UNSOURCED — all seven
  mechanisms cite cache/size; surveyed staleness answers are ANNOTATE (CC memory-age stamps, Hermes
  STALE labels) or tool-layer guard; Anthropic's computer-use demo DISABLES its eager image fold when
  caching is on; our folded payloads are VLM text (~10× smaller than the image class precedents fold).
  REVISED SHAPE: (a) capture-time stamps INSIDE state-snapshot tool results at creation (persisted,
  byte-stable, staleness self-evident vs the current-time line); (b) R4 pressure fold orders the
  state-snapshot class FIRST, keep-window 3; (c) NO eager pre-pressure fold in T5 — deferred with
  trigger (raw images entering the timeline, or ambient always-on volume).
- **Q6 FINALIZED (leader, delegated)**: ADR 0008 written (`docs/adr/0008-replay-view-context-seam.md`);
  CONTEXT.md term = **Replay View** (follows OpenClaw's first-party "replay view"; "Replay Projection"
  coinage dropped — Letta uses "projection" for a different seam). Idempotence imported as an explicit
  ADR property (LangGraph #1316 counter-case).
- Survey stale-fact correction: `t5-context-management-survey.md:164` ("OpenClaw skips image tool
  results entirely") outdated — was bug #41789/#15045, fixed v2026.4.22 (PR #43045).

- 2026-07-28 **分词器 RULED (owner)**: Option 1 (Intl.Segmenter) first; stress-test then consider
  1b/1c. **CONSTRAINT (owner, load-bearing)**: retrieval is a LONG-TERM OPTIMIZATION module — v2
  hybrid will shrink keyword's share; nothing hardcoded: segmenter behind a swappable seam, weights
  configurable, pipeline composable (Retriever-interface philosophy extended to tokenizer + ranking
  internals).
- 2026-07-28 **Q5 RULED (owner)**: revised shape adopted — creation-time capture stamps in
  state-snapshot tool results + R4 pressure fold with class priority & keep-window 3 + NO eager
  pre-pressure fold (deferred with trigger).
- Wrap-up TODO: batch-register deferred-decisions.md entries (eager-fold trigger; 1b/1c escalation
  trigger; panel-convergence trigger pending Q15; M-D4 registration depends on rc). CONTEXT.md terms
  added this round: Write Gate, Visibility Ladder, Utility Slot.

- 2026-07-28 **Q15 前半 RULED (owner)**: panel-number convergence trigger = OWNER'S EXPLICIT CALL
  ("待需要做面板收敛时我会说明") — no automatic trigger; risk of permanent-complexity was presented
  and accepted. Register entry carries this verbatim.

**rc (Letta sleeptime + search governance)** — `research/rc-letta-sleeptime-and-search-governance.md`:
- Letta recipe verified at source: counter-mod-5 trigger + skip-if-nothing-new guard; per-character
  high-water mark; input = NEW transcript slice only, framed as role:user system-reminder ("you are
  NOT the primary agent"); prompt = sleeptime_v2 (permission-to-do-nothing; absolute dates only);
  tools = precise edits + whole-block rethink + finish with TerminalToolRule (STRUCTURAL exit, never
  "model just stops"); model INHERITS primary's config ("stronger model" is blog advice, not default
  — matches our utility-slot-falls-back-to-main design); output = shared blocks. NO deterministic
  health check — but only because Letta HAS no per-item metadata to compute one from (no dedup, no
  importance, no decay). Design principle: constrain the PROCESS deterministically, leave JUDGMENT
  entirely to the model.
- Health-report question ANSWERED (recipe for our tidy): SQL report enters as CANDIDATES + EVIDENCE,
  never verdicts — 2 fact classes stated flatly (missing disclosure; layer-over-budget = Letta's
  chars_current/chars_limit analogue), 3 hypothesis classes phrased as questions (stale "why was it
  never recalled?"; near-dupe "same thing or real distinction?"; misfiled) per Nocturne's audit-skill
  "ask why first"; PLUS the recent-writes slice (Letta's input) so fresh mistakes are caught young.
  Clean store + no new writes = ZERO model calls. SQL never prescribes actions (R8 reversibility).
  Cost bounded by defect count, not store size → croner-affordable later.
- **M-A3 CLOSED (leader)**: absorbed into the tidy design; layer-over-soft-budget = 5th detection
  class, stated flatly.
- **Q12 CLOSED (leader, per owner's research mandate)**: no standalone search guard. Adaptive-
  retrieval lit EXISTS (Self-RAG / FLARE / DRAGIN / Adaptive-RAG / TARG, active through 2026) but
  every effective variant needs logprobs / attention / a trained classifier — none portable; the one
  prompt-only variant is its own paper's WEAK baseline; ACL 2025 (AdaRAGUE): these gates show
  near-random self-knowledge; the field's direction is cutting ALWAYS-ON retrieval down to 5–25% —
  R6 already put ours at 0 by default. No system anywhere implements memory-search cooldowns/quotas.
  Break-glass shape recorded (NOT built): Letta `MaxCountPerStepToolRule` per-TURN cap, enforced by
  tool removal + stated in prompt; explicitly never: cross-turn cooldowns, query-similarity
  suppression (R9 reinterprets repeats as signal, not noise).
- Provenance caveats: Nocturne "every 30–50 new memories" cadence NOT found in its local docs
  (secondary source) — our N=40 stands as a TUNABLE, not a sourced constant. Letta's git-memory mode
  (block = md file WITH frontmatter for limits/read_only) is adjacent prior art to Q7's
  zero-frontmatter ruling — our registry carries what their frontmatter does; revisit only if
  per-instance block metadata is ever needed.
- PENDING OWNER (final four): tidy recipe confirm; M-D4 defer-with-trigger; (b) three-leg
  prompt-only; Q13 instrument.

- 2026-07-28 **tidy recipe CONFIRMED (owner)** — as synthesized (Letta process × Nocturne diagnostics
  × our substrate).
- 2026-07-28 **M-D4 OVERTURNED by owner → BUILD in T5**: `user-model` block — always-in-context,
  maintained by the tidy pass (Letta human-block pattern: "identify patterns in user behavior, make
  inferences based on the memory"; Infer-Sensibly constraint). Block-registry row (ownership: global
  — leader pick, registry flip trivial); budget number rendered beside content. Three-store split:
  Identity Card = user-authored hard facts (wins all conflicts, R7); user-model block = her
  consolidated inferred understanding (always visible); profile rows = raw searchable facts (the
  block's source material).
- 2026-07-28 **(b) RULED (owner)**: 做法 B — three prompt legs (R18 correction-trigger + R19
  deliberate experience writes + tidy consolidation clause, distilled rules land in the user-model
  block). Owner addition recorded: user-editable system/persona prompt cards are a PARALLEL guarantee
  layer ("多重保证让 agent 逐渐变成用户需要的样子") — surface already exists (assistant-layer.md +
  persona cards), PRD prompt slice notes it. No automatic distillation pipeline.
- 2026-07-28 其四 REFRAMED after owner pushback: "bet/判输" framing RETRACTED — pull-path is
  Nocturne's SHIPPED pattern (not ours); post-grill our shape is Letta's three-path coexistence
  (deterministic push + agent pull + background prefill), nothing original; "nobody measured" means
  nobody PUBLISHES telemetry, not that the design is novel. Deflated proposal: extend the EXISTING
  memory event log (writes + R15 skip log already mandated) to also record memory_search invocations;
  diagnosis = join events by turn id (no write-time cross-mark machinery). Pending final confirm.

- 2026-07-28 **其四 RULED (owner)**: memory_search invocations enter the EXISTING event log (turn id +
  hit count; query text never in pino). Diagnosis = post-hoc SQL join across events; no new machinery,
  no UI. GRILL COMPLETE — every question resolved.

## Final slicing (proposed at wrap-up, pending owner approval)

1. **写入侧+schema** — R15 write gate + skip log; layer-choosing writer + importance ceiling (Q11-1);
   R10 unified first-person voice; origin schema + migration (Q8, D47 closes); M-A2 origin param seam;
   R9 lexical dedupe→reinforce.
2. **块地基** — block store + registry (Q7); R7 identity card (works immediately, hand-editable);
   selectPinned rework (blocks + non-truncatable rows; budget = safety valve); assembler fences
   observed entries.
3. **检索** — tokenizer migration trigram→unicode61 + search_terms (Intl.Segmenter behind swappable
   seam, D53 constraint); query-side segmentation; 4-column bm25 weights (config); remove pull-path
   disclosure gate (intention gate untouched); hits return disclosure+origin (fenced); search events
   into event log (其四).
4. **维护** — tidy pass full recipe (confirmed); R14 index block + M-D4 user-model block (tidy is
   their writer); R8 retention sweeper (shared sweeper shape, 3rd instance); R17 spot-fix rule;
   R11 utility slot (serial, reportable).
5. **R6 删除 + 提示词大修 + Q4 迁移** — delete retrieved block + RECALL_WINDOW/RETRIEVED_*;
   retrieval serves memory_search only; R12 triggers/non-triggers + R16 promotion + R18 contradiction
   + R19 experience (base prompt + assistant layer split per T4 convention); volatile blocks →
   in-flight tail (Q4), day line stays; same-day test migration. Flagship L2 (name-recall red→green)
   goes green here.
6. **token 窗口** — R1 three-tier measurement + message-count backstop; R2 overflow recalibration;
   flush boundary coupling (auto-memory REPLAY_WINDOW → token-based, SAME slice); Q14 includeUsage
   (default off + gateway test); Q5 capture-time stamps on state-snapshot results.
7. **压缩（最后，R0）** — R3 summary-as-head-message (persisted overwritable record, seq range);
   R4 fold gradient (state-snapshot class first, keep-3); R5 background pre-compact ~80%, wall-hit =
   hard truncation; summary prompt shares R10 voice.

Boot read from R12: NOT adopted — deterministic push (blocks injected by code) supersedes a
tool-call boot read; the "reading memory is remembering" framing goes to the base prompt.

- 2026-07-28 IMPLEMENTATION CLARIFICATION (leader, pre-batch-1): Q11-1's ceiling implies the AUTO
  writer's layer choice set EXCLUDES pinned-policy layers (relationship is pinned by POLICY at any
  importance — choosing it would mint rung-1 visibility regardless of the importance clamp). Auto
  writer chooses among writable non-pinned layers (profile/episodes/intentions), importance clamped
  below `pinnedImportanceThreshold`. Promises reach `relationship` via the EXPLICIT in-conversation
  tool path (user says 记住 → she writes relationship/10 deliberately — R16 family) or tidy
  promotion. This is what makes Q11-1's accepted description ("误判代价限于多一条可检索记忆") true.
- 2026-07-28 EVENTS SUBSTRATE (leader call): memory events land in a NEW `memory_events` DB table
  (kind/character_id/turn_seq/entry_id/created_at; batch 1 kinds: skip, reinforce; batch 3 adds
  search) — DB is local+private and SQL-joinable for 其四 diagnosis; pino keeps count-only summary
  lines per logging-guidelines.
- 2026-07-29 BATCH-1 CHECK RULING (leader, check finding F2): the flush writer IS an automatic
  pass, so the Q11-1 ceiling applies to it too — its ToolSet gets a RESTRICTED memory_write
  (layer enum = AUTO_WRITABLE_LAYER_IDS, importance clamped via clampAutoImportance, description
  matching the restricted reality). This keeps the accepted Q11-1 property literal (NO automatic
  path can mint always-visible rows) and makes the conversation tool's "the background writer
  never can" sentence true. A 记住 promise the in-conversation path missed still gets SAVED by
  the flush (R15's override protects saving, not the rung), just below the pin line; recovery to
  always-visible = R16 pin-on-repeat (batch 5 prompt) or tidy promotion (batch 4). Cost accepted:
  such a promise is not always-visible until then.
- 2026-07-29 BATCH-4 PLANNING NOTES (from batch-1 check, informational): (1) R9 reinforce keeps
  the EXISTING entry's disclosure and discards the incoming one — confirmed as R9-literal; tidy's
  set-disclosure op is the improvement path. (2) `intentions` is now auto-writable but nothing
  sets `expires` (the memory_write tool has no expires field either — pre-existing gap); batch 4's
  "intentions archive on expiry" sweeper must decide how null-expiry intentions age, or it will
  never reach them.
- 2026-07-29 BATCH-2 LEADER RULING (block order): PRD §3 prose order WINS — `V1_BLOCKS` =
  [user-card, user-model, memory-index] (hard facts, then her interpretation of the user, index
  last as navigation). The batch-2-design §3 array (card, index, model) was the leader's
  transcription slip against the owner-approved PRD; the batch-2 check applies the reorder (and
  moves the "above" wording in the user-model header with it).
- 2026-07-29 BATCH-4 PLANNING NOTES (from batch-2): (3) `main.ts` sits at 299/300 lines — the
  memory bootstrap block (persona provider + block store + engine + reconcile logging) needs
  extraction at batch-4 kickoff; note `memoryRoot` is still read later by the mediaUsage
  registration, so the extraction carries a small seam decision. (4) `memory-index`
  budgetTokens=400 is a LOCAL choice with no external source (flagged per source-grounding) —
  revisit when batch 4 gives the block real content.
- 2026-07-31 BATCH 4 CLOSED (waves 4a+4b; owner-approved commit). Implement 4a report lost with
  its agent (work leader-verified); 4b report delivered; check reconstructed 4a per design row
  and passed BOTH waves with ZERO defects and zero self-fixes. Six mutation audits closed
  (finish-stop, step-cap, zero-call clean exit, below-threshold spy, store-enforced card refusal,
  R9 age anchor). Eight implementer deviations ALL ruled grounded: isStepCount is ai@7.0.17's
  real export (`stepCountIs` only an alias); block used/limit estimates FULL content (rethink
  needs the whole file); stale/missing-disclosure scoped to search-reliant rows via exported
  `isPinnedEligible`; reinforce keeps importance; archive_supersede is the SANCTIONED unclamped
  promotion path (Q11-1 exception per notes:78/292 + t5-decisions:409, reachable only from tidy
  tools); internal "failed" never crosses protocol; shared 195→199 (invariant 3); report renders
  blocks in full (user-card READ-ONLY-labelled, refusal store-enforced). Gates at close:
  core 936 / shared 199 / desktop 143 / cli 18 / cargo 141 / e2e 25; frozen zones byte-clean;
  boot smoke clean (migrations [1..10], no orphans). Known first-run semantics: with lastTidyAt
  NULL the stale class is 0 and old rows fold into the new-writes review (manual check 85 warns).
  Manual checks 85-88 queued.
- 2026-07-31 BATCH 5 CLOSED (waves 5a+5b; commit pending owner approval). 5a: R6 removal
  (assembler retrieved section + RECALL_WINDOW/recentText; retrieval serves memory_search only;
  AssembleParams {characterId, currentMessage}) + Q4 relocation (`<turn-context>` in-flight tail
  on the outgoing user message — third named additive seam on the D1-frozen turn; instructions
  now same-day byte-stable, pinned by test). 5b: base-prompt "Memory (non-negotiable)" section
  (R12 OpenClaw-shaped procedure + non-triggers + post-miss "say you checked" + card-wins last;
  R16/R17/R18+correction-signal/R19), assistant-layer memory section rebuilt on the single
  "reading memory is remembering" criterion, tool-description grain hints (R18 preference line
  byte-identical across its two sanctioned surfaces; old R18-flow parenthetical removed from
  memory_write). Drafting style bound to research/rd-prompt-philosophy.md (owner-ordered survey:
  Anthropic incl. July-2026 reversal, OpenAI Model Spec + GPT-4.1, OpenClaw, Manus).
  FLAGSHIP FINDING: the design-§5 RED run came back GREEN 3x pre-overhaul (real key) — the
  batch-1..3 infrastructure (disclosure question-vocabulary bridge + unicode61 migration) already
  carried the name-recall scenario; flagship reframed as RETENTION per the design's own
  pre-authorization (post-overhaul GREEN confirmed by implementer + leader full-suite run).
  Check: PASS, 5 self-fixes (R18 bullet 2-line cap split, budget-comment off-by-one, stale
  prompt/README.md + MEMORY-DESIGN §assembly retrieved references, manual checks 89-90 queued);
  4 mutation audits closed; volatileContext throw-probe: no HIGH (risk relocated not created;
  seam tolerates only non-throwing wirings — future wirings guard at composition root, D55 shape).
  Gates at close: core 948 / shared 199 / desktop 143 / cli 18 / cargo 141 / e2e 26 (incl. L2);
  boot smoke clean. T4 handoff items from the prompt audit (leader, vs rd rules): converge the
  base/assistant-layer Truthfulness bullet-1 restatement to one home; screenshot/observation
  tools lack non-triggers (turn-context now carries a screen card — overtrigger risk); skills
  list lacks a multi-skill decision procedure; shipped assistant-layer default has no snapshot
  pin. Registered D56 (episodic JSON-vs-tool-call unification, deferred with trigger).
  Batch-6 watchout: main.ts at 289/300 counted lines — 11 lines of headroom.

## Standing kickoff agenda (from earlier session rounds)

- Grill scope decision pending owner: terminology→CONTEXT.md (block vs row tiers, identity card, write
  gate, index rung, utility slot, visibility ladder), ADR boundary check (T5-R3 projection semantics vs
  ADR 0005; T5-R20 block store vs MEMORY-DESIGN one-entry-per-file + D28 constraint), the 3 corrections
  above, N1/N2, and the t5-decisions open items (post-hoc scoring -> RB-1, over-search guard, panel
  convergence trigger, streaming-usage empirical check, pull-bet observable). R0–R22 NOT reopened.
- Batch shape proposal (accepted direction, exact slicing at PRD): write-side+push-side first, pull-side
  second, R6 removal third, maintenance+utility-slot fourth, token-window parallel, compaction last.
- Research backlog established: `research/research-backlog.md` (RB-1 usage-signal importance, RB-2 stale
  tool results). Model roster 2026-07-28: Opus 5 (replaces Opus 4.8) + Fable 5.
