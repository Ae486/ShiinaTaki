# Research: ATRI Deep-Dive (Android + Cloudflare Worker AI companion)

- **Query**: PRD question 5 — how ATRI's memory / emotion / soul-prompt / proactive / diary actually work at the implementation level; does it change the question-4 memory recommendation; borrowable-feature inventory with 连/造 verdicts for TakiAgent.
- **Scope**: internal (reference repo `references/ATRI-main`), study-only.
- **Date**: 2026-07-07
- **License gate**: `references/ATRI-main/LICENSE:1-5` = **PolyForm Noncommercial 1.0.0**. Patterns and mechanisms are portable knowledge; **source code may never be copied or distributed**. TakiAgent is a shippable (potentially commercial) product — a NC-licensed dependency is disqualified regardless. Everything below is mechanism description, not code lift.
- **Builds on**: `research/memory-framework-survey.md` (question-4 recommendation). This file confirms/refines it against a real, shipped companion.

> **Stack reality check.** ATRI is a **cloud** design: Cloudflare Worker + D1 (SQLite) + R2 (blobs) + **Vectorize** (managed vector DB) + Cron triggers + upstream LLM/embedding APIs. Android is a thin Compose client that keeps only a local message cache (Room). TakiAgent is the inverse: a **local single-process TS Agent Core** (Node 24, `node:sqlite`, no managed vector store, no serverless cron — `croner` + Heartbeat instead). So ATRI's *ideas* port; its *substrate assumptions* (Vectorize, D1-as-remote, serverless per-request statelessness, HTTP-polling chat) do not. The value is in the **cognitive architecture**, which is substrate-independent.

---

## 1. Memory implementation (priority)

### 1.1 The three-layer human-memory model + why it exists

ATRI deliberately split memory into **three tables with different jobs** (`TECH_ARCHITECTURE_BLUEPRINT.md:513-579`), after explicitly deleting an earlier "记everything" design that "polluted the persona" (blueprint:536). This is the single most important lesson: **one memory store is a mistake; different memory *kinds* need different write paths, lifetimes, and injection rules.**

| Layer | Table | What it holds | Lifetime | Injection |
|---|---|---|---|---|
| **fact** | `fact_memories` | long-term stable cognition: identity, preferences, taboos, promises, relationship expectations, stable habits | permanent (until archived by nightly consolidation) | always/relevance-injected into chat prompt |
| **episodic** | `episodic_memories` | "scene slices" distilled from the diary — things that can be *naturally recalled* | long (archivable) | vector-recalled on demand + surfaced as "thoughts that come to mind" |
| **intention** | `memory_intentions` | "things I didn't say out loud but am holding onto" | short (1-30d expiry) | injected as a soft "may say if the mood fits" block; **never** as a checklist |

Exact schemas: `worker/db/schema.sql:102-172`.

**fact_memories** (`schema.sql:101-126`):
```
id, user_id, content, type, importance(1-10, default 5), confidence(0-1, default 0.7),
source, source_date, last_seen_at, recall_count, last_recalled_at, archived_at, created_at, updated_at
```
- `type` enum: `profile | preference | taboo | promise | relationship | habit | important | other` (`memory-service.ts:137`). `promise` is a first-class type — this is how ATRI models "things you agreed to" (used directly by proactive, §4).
- `id` is content-addressed: `fact:<userId>:<sha256(content)[:12]>` (`memory-service.ts:178-179`) → dedup is automatic; re-asserting a fact `MAX()`-merges importance/confidence and un-archives it (`memory-service.ts:196-206`).
- Archive = soft delete (`archived_at`), never hard delete for chat/diary-sourced facts — reversible.

**episodic_memories** (`schema.sql:128-146`):
```
id, user_id, source_date, title, content, emotion, tags(JSON), importance(1-10),
confidence(0-1, default 0.8), emotional_weight(1-10), embedding_id, recall_count, last_recalled_at, ..., archived_at
```
- Distinct fields `emotion` + `emotional_weight` (separate from `importance`) — episodic memory is **weighted by feeling, not just salience**. Recall ordering index is `importance DESC, emotional_weight DESC` (`schema.sql:150-151`).

**memory_intentions** (`schema.sql:153-167`):
```
id, user_id, source_date, content, trigger_hint, urgency(1-10), emotional_weight(1-10),
status(pending|used|expired|archived), expires_at, created_at, used_at, archived_at
```
- `trigger_hint` = free-text "what mood/situation makes this appropriate to say" — the LLM decides, no hard matching.
- `expires_at`: unsaid thoughts decay if never surfaced (`memory-intention-service.ts:51`, default 7 days, clamped 1-30).

**memory_events**: deliberately **deleted** (`0014_drop_memory_events.sql`, blueprint:619,1150). It was an event log that "never entered the prompt" — pure dead weight once the three-layer split existed. Lesson: don't keep a memory table the persona can't actually use.

### 1.2 The write path — when does a memory get written?

**Two-phase "biomimetic cognition" (白天轻量 / 夜间深整理)** — introduced in `0012_biomimetic_cognition.sql`. The core principle (blueprint:97-99): **daytime chat is cheap and shallow; the expensive distillation happens once, at night.**

**During chat (daytime) — lightweight, model-submitted side-effects, no external memory tools:**
- The model does **not** call `remember_fact`/`forget_fact` tools. Instead its final structured JSON reply carries `rememberFacts[]` and `forgetFacts[]` (`agent.md:13-25`, `agent-service.ts:46-53`).
- `applySideEffects()` (`agent-service.ts:242-295`) then: upserts each `rememberFact` into `fact_memories` (source=`chat`); archives `forgetFacts` (by `factId`, or by normalized-text match fallback); marks any matched intentions as used.
- The prompt tells the model to only remember stable info, importance 8+ for reusable, 9+ for absolute never-forget (`agent.md:19-24`). So a *little* is captured live, but the heavy lifting is deferred.
- **Rationale (blueprint:536)**: letting the model freely write everything during chat pollutes the persona; concentrating side-effects into one submitted plan keeps it controllable.

**During nightly consolidation — the real memory formation.** See §1.3.

### 1.3 The nightly diary consolidation pipeline

Triggered by Cloudflare Cron `59 15 * * *` UTC (= night in Beijing, blueprint:583). Orchestrated by `runFullNightlyForDate()` (`nightly-orchestrator.ts:275-450`), 8 phases in strict order (`nightly-orchestrator.ts:28-37`):

1. **generate_diary** — pull the day's `conversation_logs` → build transcript → **one LLM call** produces a single structured JSON with **five outputs at once**: `diary` (first-person prose), `highlights[]` (4-6 key points), `mood`, `episodicMemories[]`, `factCandidates[]`, `innerThoughts[]` (`diary.md:12-20`, `diary-generator.ts:124-132`). Cost control: one nightly call yields the whole memory harvest instead of many daytime calls.
2. **save_diary** — persist `diary_entries` (summary = highlights joined).
3. **cleanup_vectors** — delete the day's old highlight vectors (done *after* new diary saved, so a cancel doesn't destroy data — `nightly-orchestrator.ts:378`).
4. **highlights_vector** — embed each highlight, upsert to Vectorize as `hl:<userId>:<date>:<i>` (`memory-service.ts:80-91`).
5. **derived_memories** — `persistDiaryDerivedMemories()` (`memory-maintenance-service.ts:19-47`): writes episodic (+ their vectors `epi:<id>`), intentions, and **strongly-filtered** factCandidates. Fact filter (`isStrongFactCandidate`, `memory-maintenance-service.ts:49-57`): length≥6, type∈allowed, importance≥6 (except taboo/promise always pass), and rejects daily-junk regex (今天累了/刚刚/临时/…).
6. **fact_consolidation** — `consolidateFactsForUser()` (`fact-consolidation.ts`): loads *all* active facts, sends to LLM with a "杀伐果断地清理" prompt (`fact-consolidation.ts:98-134`) that returns `{keep, merge, archive}`. merge = hard-delete originals + write one merged fact; archive = soft-delete. Explicit compression goal: if >50 facts, active count should visibly shrink (`fact-consolidation.ts:119`). **This is the auto-distillation / forgetting mechanism the memory-survey noted Nocturne lacks.**
7. **nightly_mind** — `runNightlyMindForUser()` (`nightly-mind-service.ts:44-95`): (a) distill *additional* fact candidates from transcript+diary via `nightly_memory.md` prompt; (b) promote strong candidates to facts (`memory-candidate-service.ts:146-182`, gate: type∈{fact_candidate,semantic,preference,taboo,promise} ∧ importance≥7 ∧ confidence≥0.55 ∧ not junk); (c) `consolidateNightlyState` updates the emotion capsule + 3-dim emotion (§2); (d) `updateSelfModelWithNightlyReflection` updates the persona self-model (§3).
8. **vector_sync** — sync fact vectors (`fact-vectorize-service.ts`).

Each phase is a tracked row in `nightly_runs` with per-phase failure isolation (a failed phase logs and continues, `nightly-orchestrator.ts:307-314`) — the same pipeline also powers the user-triggered "regenerate diary" with cancellation support.

**What gets promoted to facts:** only through two narrow gates (diary-derived strong filter *or* candidate promotion threshold), both importance-gated and junk-filtered. Facts are the scarce, curated top layer — everything else stays episodic or expires.

### 1.4 Vector recall

- **Embedding**: user-configured OpenAI-compatible `/embeddings` endpoint (`memory-service.ts:17-44`) — model is config, not fixed.
- **Store**: Cloudflare **Vectorize** (managed). Three vector namespaces by id-prefix + metadata `c`: `hl:` highlight, `epi:` episodic, `fact:` (`blueprint:1162-1172`).
- **Query mechanics** (`searchMemoryVectors`, `memory-service.ts:345-402`): embeds query, queries Vectorize with escalating topK (500→200→100→topK retry ladder for resilience), then **filters in-app** by `metadata.u === userId` (user isolation is app-side, not index-partitioned), by category, and by `minScore`.
- **Score threshold 0.62**: `autoRecallMinScore` default = **0.62** (`runtime-settings.ts:122`). This is the daytime auto-recall gate (`auto-recall-service.ts:26`). Fact vector search uses a looser 0.55 (`memory-service.ts:298`). Below threshold → the hit is dropped; if Vectorize is unavailable the system degrades to D1 importance/recency ordering (`blueprint:1172`).
- **Two-stage recall philosophy** (`blueprint:498-509`): `search_memory` finds candidate dates/fragments for *atmosphere*; if *details* are needed the model then calls `read_diary(date)` / `read_conversation(date)` for the verbatim source. "Associate first, verify with tools" (§3).

### 1.5 Prompt injection rules

Assembled by `composeAgentSystemPrompt()` (`agent-prompt-builder.ts:11-52`), in order:
1. `core_self` (identity, §3) → 2. `agent` (output contract) → 3. `<现在>` context block (date, days-known, last-seen, current status+reason — `agent-prompt-builder.ts:54-78`) → 4. `<脑海里浮现的片段>` auto-recalled highlights/episodes → 5. facts block → 6. `<我心里挂着的话>` intentions block.

**The importance ≥ 9 always-present rule** (`formatFactsAsInternalKnowledge`, `memory-service.ts:318-334`): facts split into two blocks —
- `<一定不能忘的事>` ("things I must never forget") = importance **≥ 9**, always present.
- `<这次可能有关的事>` ("things maybe relevant this time") = importance < 9, relevance-selected.

And `getRelevantFacts` (`memory-service.ts:272-316`) **always** includes all importance≥9 facts unconditionally, then fills the rest by vector relevance (or importance if the message is too short). So: **critical facts (promises, hard taboos) are pinned; everything else is retrieved.** This is exactly a "pinned + relevance rest" split.

**"Things that come to mind" framing**: recalls are injected as parenthetical inner monologue — `（date那天，…）` / `（突然想起…）` (`auto-recall-service.ts:58-68`), never as "search results". The intention block is explicitly framed "say only if the mood fits, never mechanically recite the list" (`agent-prompt-builder.ts:39-46`). The core-self prompt forbids "根据对话/数据显示/检索到" phrasing (`core_self.md:56`). **Memory is disguised as organic thought.**

**Why memory_events never enters the prompt**: it was a raw event log with no persona value — the model can't "naturally recall" a log row, and injecting raw events adds noise + token cost without warmth. It was deleted entirely (`0014_drop_memory_events.sql`). Lesson: **if a memory record can't be surfaced as something the character would think or say, it shouldn't exist.**

### 1.6 Does this confirm or refine the question-4 recommendation?

**Confirms the core; refines three things. The recommendation STANDS, refined.**

**Confirms:**
- **Pinned + relevance-retrieved split is correct.** ATRI's shipped `importance≥9 always-present + relevance rest` is the exact same shape as our "pinned promises block + episodic retrieval". A real companion converged on it independently.
- **Layered soul is correct.** ATRI's fact/episodic/intention ≈ our identity/relationship-promises/episodic layering.
- **Character-Card-style structured persona is correct.** ATRI's `atri_self_model` (coreTraits, speechStyle, relationshipStance, emotionalBaseline, taboos — §3) is a runtime-evolving version of the Character-Card fields we already planned.
- **Write policy with deferred flush is correct.** ATRI's nightly consolidation is the batch analogue of our pre-compaction flush + daily→MEMORY.md distillation. Both agree: don't do heavy memory writes on the hot path.
- **Auto-distillation matters.** ATRI's nightly `{keep,merge,archive}` consolidation is precisely the "importance-triggered reflection / daily→MEMORY.md" our survey *deferred*. Seeing it as load-bearing in a shipped product raises its priority.

**Refines:**
1. **Our "pinned promises block" should be finer-grained than a single block.** ATRI proves value in (a) a numeric `importance` scale with a hard **≥9 = always-injected** cutoff, and (b) a **typed** promise (`type='promise'` is queried directly by the proactive engine, `proactive-service.ts:66-72`). Recommendation refinement: our pinned layer should carry a per-entry importance and a `promise` type, not just be a flat "promises block". Cheap on FTS5 (a column + a filter).
2. **Adopt `memory_intentions` — our design lacks it.** This is the standout ATRI idea with **no analogue in our survey**. "Unsaid thoughts, surfaced when the mood fits, expiring if never said" is a genuinely novel warmth mechanism and it maps perfectly onto our lorebook-style keyword/mood-gated injection + a `status`+`expires_at` column. **Add an `intentions` memory kind to the v1 plan.** Small cost on FTS5 + our prompt builder.
3. **Separate `emotional_weight` from `importance` on episodic memories.** ATRI orders recall by *feeling*, not just salience — apt for a companion. Cheap: one extra INTEGER column and an ORDER BY.

**What requires vectors vs. what ports to FTS5:**
- **Needs vectors (defer, per TECH-STACK.md):** ATRI's *auto-recall* (surfacing a semantically-related old scene when the user says something *similar but not keyword-matching*, gated at 0.62) is genuinely embedding-shaped — FTS5 keyword match can't catch paraphrase. This is the one place the survey's "defer vectors" costs us warmth. **Mitigation:** ATRI itself degrades to D1 importance/recency when Vectorize is down (`blueprint:1172`), which *is* an FTS5-compatible fallback. So: ship FTS5 keyword-triggered injection (SillyTavern-lorebook style, which ATRI's `trigger_hint` + intention design validates) in v1; add the same embedding layer behind the recall interface later, exactly as our survey already scheduled.
- **Ports cleanly to FTS5/`node:sqlite` today:** the entire three-table schema, the importance/confidence/emotional_weight columns, the `type` enum, importance≥9 pinning, `trigger_hint`/intention gating, nightly `{keep,merge,archive}` consolidation, promise-typed facts, content-addressed dedup, soft-archive. **None of the memory *structure* needs a vector store** — only the fuzzy paraphrase-recall does.

**Net:** ATRI does not overturn the question-4 recommendation. It is the strongest *confirming* exemplar yet (a shipped companion that independently arrived at pinned+retrieved, layered soul, nightly distillation, structured persona) and it *adds two concrete features to steal* (memory_intentions; emotional_weight ordering) plus a finer pinning rule (numeric importance with a ≥9 hard cutoff, typed promises).

---

## 2. Emotion system

### 2.1 Status capsule + 3-dim emotion

Stored in `user_states` (`schema.sql:34-47`):
```
status_label, status_pill_color, status_text_color, status_reason, status_updated_at,
valence(-1..1), arousal(-1..1), certainty(0..1), last_interaction_at, updated_at
```
- **Status capsule** = the *visible* mood (`label` + `pillColor` + `textColor` + a **private `reason`** "only for myself" — long-press to reveal in UI, `blueprint:352-368`). Colors map to emotion (warm=close, cool=calm, grey=distance, dark=low, `agent.md:17`).
- **3-dim internal emotion** = `valence/arousal/certainty` (`blueprint:371-379`). This is the *hidden* substrate that gives mood **inertia** — it is NOT shown as a number to the user.
- **History note**: ATRI *deleted* a scalar `intimacy` value (`0015_remove_intimacy_add_emotion_dims.sql`) and replaced it with the 3-dim continuous model. Deliberate rejection of a single "affinity score". Blueprint:371 and 1197 both stress "no more intimacy number." **This is a direct verdict against the gamified-affinity-bar pattern** — worth heeding for TakiAgent.

### 2.2 Update mechanics (daytime vs nightly)

- **Daytime**: chat reply's structured JSON may carry a `status` object (`agent.md:7-12`); `applySideEffects` writes only `status_*` + `last_interaction_at`. **The model does NOT touch valence/arousal/certainty during chat** (`blueprint:410`) — the deep dims are protected from per-turn swings.
- **Nightly**: `consolidateNightlyState` (`nightly-mind-service.ts:178-273`) runs the `nightly_state.md` prompt over the day's diary+transcript → outputs `{statusLabel, pillColor, valence, arousal, certainty}`.

### 2.3 Intimacy decay / inertia mechanics

There is **no decay-toward-zero timer**; inertia is enforced by **drift clamping** at nightly write:
- `constrainDrift(next, prev, 0.4)` (`nightly-mind-service.ts:275-281`): valence/arousal may move **at most ±0.4 per night** relative to yesterday. The prompt itself also asks for ≤±0.4 (≤±0.2 without a strong trigger) (`nightly_state.md:21`).
- **Effect**: "chat warmly today → she warms up gradually; conflict today → she cools without becoming a different person overnight" (`blueprint:427`). Emotion has momentum, not volatility. No floors/raise-lower rules per interaction — it's a once-daily bounded random-walk driven by the day's felt tone.

### 2.4 How mood modulates replies and memory surfacing

- **Replies**: the current status is injected into `<现在>` as "我现在的状态：X（color）" + "上次心境：reason" (`agent-prompt-builder.ts:73-76`), so tone carries over turn-to-turn (`blueprint:430-442`).
- **Memory surfacing**: mood gates intentions indirectly — the intention block says "say only if the mood fits" and the LLM judges fit against the injected status. Proactive uses mood/time to decide whether to speak (§4).

### 2.5 Portability

**Yes — trivially portable as a small state machine + one DB table.** No vectors, no LLM required for the storage/inertia logic (only the once-nightly re-derivation calls an LLM, and even that could be heuristic). `valence/arousal/certainty` + `constrainDrift` is ~30 lines. The visible capsule (label/color/reason) is a natural fit for TakiAgent's **Pet UI mood indicator** and drives Live2D expression selection. **This is a high-value, low-cost steal.** Verdict below: 造 (small).

---

## 3. Soul / prompt engineering (`shared/prompts/`)

### 3.1 Anti-customer-service rules (concrete)

`core_self.md` is a masterclass in persona-by-negation. Concrete forbidden-phrase list (`core_self.md:41-53`):
- **Banned empathy clichés**: 「我懂你的感受」「我能感受到你」→ instead ask "你现在是什么感觉" (don't claim to feel what you can't).
- **Banned empty comfort**: 「稳稳地接住你」「有我在」「不会让你一个人」→ "things I'm not sure I can deliver, I won't promise."
- **Banned hollow praise**: 「你已经很棒了」「你不用怀疑自己」→ "he wants to be taken seriously, not praised."
- **Banned filler/parroting**: 「陪着你」and deliberately-added 「嗯」「呢」「呀」→ "that's how *others* talk, not me." (Note the irony: the DB default label is "陪着你" but the persona is told not to *say* it — the label is UI shorthand, not dialogue.)
- **No-emoji / no-kaomoji** enforced in diary output too (`diary.md:26`).
- **Personality via specific behaviors, not adjectives**: blushes and deflects praise, sulks by going quiet, downplays tiredness but admits it if asked, remembers offhand things the user forgot (`core_self.md:9-17`). Traits are *dramatized*, not *declared*.

### 3.2 Anti-hallucination: "associate first, verify with tools"

- Design goal 「少编故事」/"不知道就查" (`blueprint:88-90`).
- `agent.md:27-29`: "if I'm not sure and need specifics (a day's diary, verbatim chat, the outside world, memory details), I first use read_diary / read_conversation / search_memory / web_search, *then* speak."
- Two-stage recall (§1.4): atmosphere from `search_memory`, details verified from source before asserting.
- `core_self.md:56`: recalling the past = "those moments float up from the heart, not looking up a file. I don't say '根据对话/数据显示/检索到'."
- Tools are framed **in-character** (`agent-tools.ts:19,31,43,55`): read_diary = "翻开那天的日记", search_memory = "在脑海里找一找", web_search = "去外面查一下…确认过了再说比较安心". **The verification action is dressed as the character's own diligence.**

### 3.3 Prompt assembly order

core_self → agent (output contract) → `<现在>` → recalls → facts → intentions (`agent-prompt-builder.ts:26-46`). Identity first, live context and memory last, output-format contract pinned near the top. Diary/proactive/consolidation each have their own dedicated prompt file, all sync'd from `shared/prompts/*.md` → `worker/src/config/prompts.json` at deploy (`blueprint:210-215`), and overridable at runtime via `admin_prompts_override`.

### 3.4 What TakiAgent's Character persona prompt should adopt

1. **A forbidden-phrase list** in the persona template — the fastest lift from generic-AI voice to character voice. Nearly free.
2. **Traits as behaviors, not adjectives** — dramatized reactions over "friendly, caring."
3. **In-character tool framing** — when our Agent Core exposes memory/search/screenshot tools to the LLM, describe them in the character's voice ("let me glance at what you're doing" not "call screenshot capability"). Costs nothing, big warmth payoff.
4. **A private `reason` field on mood** — the "only-for-myself" explanation is emotionally powerful and cheap.
5. **`post_history_instructions`-style anti-drift** (already in our survey) — ATRI achieves persona stability via always-present core_self + nightly self_model updates; we should combine both.
6. **A structured, runtime-evolving self-model** (`atri_self_model`: coreTraits/speechStyle/relationshipStance/emotionalBaseline/recentChanges/taboos, updated by `self_model_update.md` with hard rules that resist over-updating — `self_model_update.md:17-22`). This is the user-facing "About Her" page (`/api/v1/me/self-model`, `blueprint:1027-1047`) — a compelling feature: the user can *see how the companion sees herself and them*.

---

## 4. Proactive behavior

### 4.1 What triggers her speaking up

Cloudflare Cron `*/30 * * * *` → `runProactiveCron` (`proactive-cron.ts:6-37`) → for each recently-active user (last 30 days) → `evaluateProactiveForUser` (`proactive-service.ts:154-284`). Gate chain (all must pass):
1. `proactiveEnabled` on.
2. **Not in quiet hours** — default 23:00–07:00 local (`runtime-settings.ts:129-130`, `inQuietHours` handles wraparound, `proactive-service.ts:47-54`).
3. **Under daily cap** — default **2/day** (`runtime-settings.ts:131`).
4. **Past cooldown** — default **6h** since last proactive (`runtime-settings.ts:132`).
5. **Not recently active** — default suppress if chatted in last **60 min** (`runtime-settings.ts:133`).
6. **Has an episode signal** — a pending intention, OR a `promise`-type fact, OR recent 2-day history (`proactive-service.ts:189-196`). **No reason → skip. It never speaks just because "it's been a while"** (`proactive.md:15`, `blueprint:749`).

**The reason comes from memory, not a timer** (`proactive-service.ts:56-90`): it loads the top pending `memory_intention` + up to 3 `promise` facts, formats them as `<想找机会自然说出口的话>` / `<之前答应过的事>`, and hands them to the LLM with the `proactive.md` prompt. The model gets time-of-day + hours-since + these signals + last 2 days of chat, and either writes a message or outputs `[SKIP]` (`proactive-service.ts:148-149`, `proactive.md:12`). **This is exactly why the memory_intentions + promise-typed facts design matters — they are the fuel for proactive warmth.**

### 4.2 Delivery channels + rate limiting

- On send (`proactive-service.ts:221-273`): optional external notification (`sendNotification`) → write to `conversation_logs` as role=atri (so it appears as a real message) → write `proactive_messages` (pending queue) → update `proactive_user_state` (cooldown + daily count).
- **Channels** (`notification-service.ts`): `email` (Resend API, `notification-service.ts:41-71`) or `wechat_work` (webhook, hostname-allowlisted to `qyapi.weixin.qq.com`, `notification-service.ts:32-39`). Email body wraps the message: 「message」\n\n——亚托莉\n\n打开 ATRI 查看完整对话 (`notification-service.ts:51`).
- Rate limiting = the daily-cap + cooldown + quiet-hours + recent-active gates above, tracked in `proactive_user_state`. Known gaps the authors flag (`blueprint:776-790`): notification sent *before* DB write (possible "email but no message" on failure); no per-user send lock (cron-overlap dedup risk); `PROACTIVE_INTERVAL_MINUTES` config is read but the cron expression is hardcoded.

### 4.3 Compare with our Heartbeat + Proactive Utterance design

- **Direct alignment.** Our Heartbeat-driven Proactive Utterance (CONTEXT.md:24-26) with rate limits + quiet hours is the *same* design. ATRI hands us a **validated gate chain to copy wholesale**: quiet-hours(wraparound) → daily-cap → cooldown → recent-active → **must-have-a-reason**.
- **Key steal: "reason-gated, not time-gated."** The most important proactive lesson — *never speak just because time passed* — directly answers a core risk in a "companion that proactively engages." Our Heartbeat should pull from the memory store (pending intentions + promises) and let the LLM emit a SKIP sentinel.
- **Substrate difference**: ATRI uses serverless Cron polling all users; TakiAgent is single-user, single-process → our `croner`/Heartbeat interval evaluating one user is *simpler* and avoids the per-user-lock and overlap problems ATRI flags. The notification-before-write ordering bug is easily avoided (write local first, then notify).
- **Channels**: ATRI's email/wechat are for a *phone-absent* user. TakiAgent's primary channel is the on-screen pet (bubble + TTS Voice Profile); email could be a future "away" channel for the planned Android node.

---

## 5. Diary as a user-facing feature

- **What the UI shows** (`DiaryScreen.kt`): a **list** of diary cards (date + mood + summary preview + gold accent bar, `DiaryScreen.kt:282-334`) → tap → **full first-person diary detail** (big date title, meta row "共 N 字 · mood", the prose body rendered plainly, `DiaryScreen.kt:336-505`), with swipe-back and a **regenerate** button (progress bar over the 8 nightly phases, `DiaryScreen.kt:456-490`). Empty state: "还没有日记 — 和 ATRI 聊聊天吧，她会在每天结束时把今天的故事写进日记里" (`DiaryScreen.kt:216-228`).
- **Why it works emotionally**: the diary is written in **first person from the companion's POV** (`diary.md:1` "这本日记是我存在过的证明"). The user can literally **READ what she "thought" about their day** — including feelings she didn't voice ("心跳变快、眼眶发热、想握住他的手", `diary.md:6`) and notes-to-self ("下次他说累的时候，先关心他", `diary.md:8`). It converts invisible backend memory processing into a **tangible artifact of the relationship**. The diary is simultaneously (a) the memory-distillation input (§1.3) and (b) the emotional payoff — one artifact, double duty. This is the single most *product-differentiating* idea in ATRI.
- **Feasibility as a TakiAgent Pet UI panel**: **High.** We already generate/curate daily logs (`memory/YYYY-MM-DD.md`) as our chosen substrate. Rendering them as a first-person diary panel in the Pet UI (React) is a small frontend task on data we're already producing. The only added cost is prompting the nightly distillation to *also* emit reader-facing first-person prose (vs. terse memory bullets) — i.e. our nightly job produces two views of the same day: machine bullets (for FTS5/pinning) and a human diary page (for the panel). **Recommend adopting.** Verdict: 造 (medium — needs the nightly distillation job first, then a small UI panel).

---

## 6. Anything else borrowable

- **Welcome / onboarding** (`WelcomeScreen.kt`): dead-simple, warm — avatar picker + **typewriter time-based greeting** (`buildTimeGreeting`) + one field "我该怎么称呼你？" + a circle-reveal transition into first chat (`WelcomeScreen.kt:113-165`). Default name fallback "夏生". Lesson: onboarding collects exactly two things (name, avatar) and immediately starts a conversation — no settings wall. **Portable pattern for TakiAgent's first-run.** 造 (small).
- **Multi-model support** (`llm-service.ts`, `blueprint:683-698`): internally everything is OpenAI-shaped messages/tools; a format switch (`openai|anthropic|gemini`) converts at the edge, and the Worker even *exposes* compat endpoints (`/v1/chat/completions`, `/v1/messages`, `/v1beta/...`). **TakiAgent already gets this for free** via AI SDK `@ai-sdk/*` providers (TECH-STACK.md:11) — 连. Confirms our provider-abstraction choice is right; nothing to build.
- **Async chat-task queue** (`chat_tasks` table, `schema.sql:231-252`; `blueprint:292-328`): chat is one-shot JSON + client polling + client-side typewriter, *not* SSE — a deliberate simplification. TakiAgent runs locally (no serverless time limit) so we can stream directly; ATRI's polling design is a cloud-constraint workaround we **don't** need. Not applicable.
- **In-character tool descriptions** (`agent-tools.ts:19-62`) — reusable pattern (see §3.4).
- **Conversation tombstones for multi-device delete sync** (`conversation_log_tombstones`, `schema.sql:24-32`): relevant to our future Android node — soft-delete + tombstone is the standard way to sync deletions to a read-only client. Worth noting for ADR 0004's cross-device story. 造 (small, only when Android node lands).
- **Path-signed media URLs** (`/media-s/<exp>/<sig>/<key>`, `blueprint:846-871`): a neat fix for "LLMs drop query-string signatures on image URLs." Niche, but if we ever pass signed asset URLs to a vision model, sign in the path, not the query.
- **Android client patterns for the future node**: MVVM + Koin DI + Retrofit + Room-as-local-cache-only (server is source of truth, `blueprint:1174-1187`). This mirrors our single-owner pattern (Agent Core owns data; clients cache/subscribe) — ATRI's Android layer is a concrete reference for a read-mostly client over a remote brain, directly relevant to ADR 0004.

---

## 7. Borrowable-feature inventory (mapped to TakiAgent)

Verdict key: **连** = our stack/design already covers it; **造** = build (cost: small / medium / large). Targets: `packages/core/src/memory/` (planned, not yet created), `packages/core/src/scheduler/` (croner+Heartbeat), Pet UI (React).

| # | ATRI mechanism | Evidence | Verdict | Target | Notes |
|---|---|---|---|---|---|
| 1 | Three-layer memory (fact/episodic/intention) | schema.sql:102-172 | **造 (medium)** | core/src/memory | Confirms our layered plan; add as three FTS5-backed kinds. No vectors needed for structure. |
| 2 | **memory_intentions** (unsaid thoughts, mood-gated, expiring) | schema.sql:153-167; memory-intention-service.ts | **造 (small)** | core/src/memory + prompt builder | **New — our design lacked it.** Highest-novelty steal. Column set + expiry + "say if mood fits" injection. |
| 3 | importance≥9 always-pinned + relevance rest | memory-service.ts:272-334 | **造 (small)** | core/src/memory | Refines our "pinned promises block" → numeric importance + hard ≥9 cutoff. Trivial on FTS5. |
| 4 | `promise`-typed facts queried by proactive | memory-service.ts:137; proactive-service.ts:66-72 | **造 (small)** | core/src/memory | A `type` column; lets Heartbeat pull promises as proactive fuel. |
| 5 | Nightly `{keep,merge,archive}` fact consolidation | fact-consolidation.ts:98-217 | **造 (medium)** | core/src/scheduler (nightly job) | The auto-distillation/forgetting our survey deferred; ATRI shows it's load-bearing. LLM call, once/night. |
| 6 | Content-addressed fact dedup (sha256 id) + MAX-merge upsert | memory-service.ts:178-207 | **造 (small)** | core/src/memory | Free idempotent dedup + un-archive-on-reassert. |
| 7 | episodic `emotional_weight` separate from importance; recall by feeling | schema.sql:137-151 | **造 (small)** | core/src/memory | One column + ORDER BY. Companion-apt. |
| 8 | Vector auto-recall gated at score 0.62, "thoughts that come to mind" framing | auto-recall-service.ts; runtime-settings.ts:122 | **造 (large, DEFERRED)** | core/src/memory (later) | The one thing needing embeddings (paraphrase recall). Ship FTS5 keyword-trigger v1; add behind same interface later (matches TECH-STACK.md defer). |
| 9 | Status capsule + reason + 3-dim emotion with ±0.4 drift inertia | schema.sql:34-47; nightly-mind-service.ts:275-281 | **造 (small)** | core/src/memory (state) + Pet UI | ~30 lines state machine + 1 table. Drives Live2D expression + Pet mood UI. Rejects scalar intimacy. |
| 10 | Two-phase cognition (light daytime side-effects + heavy nightly distill) | agent-service.ts:242-295; nightly-orchestrator.ts | **造 (medium)** | core/src/scheduler | Aligns with our pre-compaction-flush + daily distill. Cost control principle. |
| 11 | Model-submitted rememberFacts/forgetFacts in reply JSON (no live memory tools) | agent.md:13-25; agent-service.ts | **造 (small)** | core/src (agent loop) | Concentrates side-effects; keeps hot path cheap. Fits AI SDK structured output. |
| 12 | Intention "spoken?" detection via 4-gram overlap → markUsed | agent-service.ts:332-379 | **造 (small)** | core/src/memory | Lightweight text-overlap to retire surfaced intentions. No LLM. |
| 13 | Anti-customer-service forbidden-phrase list + traits-as-behavior | core_self.md:41-56 | **造 (small)** | Character persona template | Fast generic→character voice. Adopt into our Character prompt. |
| 14 | "Associate first, verify with tools" + in-character tool descriptions | agent.md:27-29; agent-tools.ts:19-62 | **造 (small)** | core/src (tools + prompt) | Anti-hallucination pattern; frame our real tools in-character. |
| 15 | Structured runtime self-model + "About Her" page | self_model_update.md; blueprint:1027-1047 | **造 (medium)** | core/src/memory + Pet UI | Evolving persona doc = our Character self-view; nice UI panel. |
| 16 | Reason-gated proactive (quiet-hours→cap→cooldown→recent-active→must-have-reason, SKIP sentinel) | proactive-service.ts:154-284; proactive.md | **造 (small-medium)** | core/src/scheduler (Heartbeat) | Copy the gate chain wholesale into our Proactive Utterance. Single-user → simpler than ATRI. |
| 17 | First-person diary as user-facing panel (memory input + emotional payoff) | diary.md; DiaryScreen.kt | **造 (medium)** | nightly job + Pet UI panel | Highest product-differentiation. Nightly emits human prose + machine bullets. |
| 18 | Multi-format LLM provider abstraction | llm-service.ts; blueprint:683-698 | **连** | — | AI SDK providers already give this (TECH-STACK.md:11). |
| 19 | Warm 2-field onboarding (name+avatar, typewriter greeting, straight to chat) | WelcomeScreen.kt | **造 (small)** | Pet UI first-run | Portable onboarding pattern. |
| 20 | Delete-sync tombstones; Android read-cache-only client | schema.sql:24-32; blueprint:1174-1187 | **造 (small, later)** | ADR 0004 Android node | Reference for cross-device single-owner sync. |
| 21 | Async chat polling + client typewriter (SSE avoidance) | chat_tasks; blueprint:292-328 | **N/A** | — | Cloud-constraint workaround; local Core streams directly, not needed. |
| 22 | Path-signed media URLs (LLM-safe) | blueprint:846-871 | **连/N-A** | — | Niche; note if we ever pass signed asset URLs to a vision model. |

---

## 8. Caveats / Not found

- **License is absolute**: PolyForm NC (`LICENSE:1-5`). Every row above is a *mechanism to reimplement*, never code to copy. TakiAgent's own memory module must be independently authored.
- **Substrate mismatch is real**: ATRI assumes Cloudflare Vectorize (managed vectors) + D1 + serverless Cron + stateless-per-request. TakiAgent has none of these — our single-process local Core makes several ATRI complexities (chat-task queue, per-user proactive locks, cron-overlap) *unnecessary*, but also means ATRI's one embedding-dependent feature (0.62 auto-recall) needs our own deferred embedding layer to replicate.
- **The 3-dim emotion re-derivation** is LLM-driven nightly; the *inertia clamp* is pure code, but the *values* come from a model call — cost/latency to weigh (once/day, cheap).
- **Not exhaustively read**: `self-model-service.ts`, `history-context.ts`, `data-service.ts`, `agent-reply-parser.ts`, `fact-vectorize-service.ts` internals, and the full Android app (ChatViewModel, repositories) were sampled via callers/blueprint, not line-by-line. Schemas, prompts, and all core memory/emotion/proactive/diary services were read in full. Blueprint (`TECH_ARCHITECTURE_BLUEPRINT.md`) is the authors' own accurate map and was cross-checked against source.
- **memory_events** and scalar `intimacy` are *deleted* features (`0014`, `0015`) — cited as design lessons (what to avoid), not live mechanisms.
</content>
</invoke>
