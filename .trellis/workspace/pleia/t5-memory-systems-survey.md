# T5 — Purpose-built agent memory systems: how they dedup, consolidate, score, decay and retrieve

- **Query**: How do Letta / mem0 / Zep-Graphiti / others actually handle write-time dedup, update-vs-append, consolidation, importance scoring + decay + reinforcement, short/long tiering, retrieval, and provider dependency — and what do they say about our two hypotheses (duplicate-write-as-recall-failure; identity-bypasses-retrieval)?
- **Scope**: mixed — local references (`H:/TakiAgent/references/`) + web (exa)
- **Date**: 2026-07-26
- **Tool constraint honoured**: all web research via `mcp__exa__web_search_exa`. No native WebSearch. deepwiki/context7 MCP tools were **not present in this agent's callable tool set** (only exa was), so DeepWiki pages were reached as ordinary search results, not via the MCP.
- **Related prior work in this workspace** (not duplicated here): `t5-context-management-survey.md` (compaction), `hermes-memory-analysis.md` (Hermes/OpenClaw memory, D28).

### Two owner rulings that re-weight this survey

Both landed after the research brief; the write-up is weighted accordingly.

**Ruling 1 — the per-turn automatically-injected retrieval block is removed.** Memory reaches the model by two paths only: **(a) deterministic push** — a user-editable identity card plus an always-injected pinned block selected by rule, no search involved; **(b) agent-initiated pull** — the agent decides to call a memory search tool. Rationale: keyword retrieval pushes too much noise per turn; semantic retrieval is too expensive per turn; if semantic retrieval is ever added it belongs on the pull path, where it runs rarely with a purposeful query.

Consequences for how to read this document:
- **§7 (agent-initiated pull) is now the operationally important section**, and it is the thinnest part of the sourced material. Its gaps are listed in §10.1.
- Findings about *ranking* (bm25 column weights, RRF, recency/importance blends, candidate over-fetch) are **not** invalidated — they now govern a rarely-run, deliberate query instead of every turn. Two things improve for free: the query becomes a purposeful natural-language question rather than "the last few messages' text" (Nocturne's ranking design assumes exactly that, which is why it weights path/name 2.5× over body), and retrieved noise costs less because the agent asked for it and can discard it. One thing gets worse: an item that is never surfaced is now *never* surfaced unless the agent thinks to ask.
- Findings about *tuning automatic per-turn injection* (mem0's signal fusion as an injection policy, Generative Agents' per-turn α weights, cognee's `UserPromptSubmit` context injection) are **low value** and are marked as such in place.

**Ruling 2 — a duplicate write is treated as a recall-failure signal and reinforces the existing entry's weight.** Ratified, not under test. §8.1 reports what the literature does — agreement, contradiction, or silence — plus the two conditions the sourced systems imply for the signal to be valid.

---

## 0. Executive summary

### 0.1 What we should adopt

| # | Finding | Source system | Touches which of our five layers | Why it is affordable for us |
|---|---|---|---|---|
| A1 | **An always-in-context, user-editable identity region that is never retrieved** — separate storage from the auto-written layers, "always considered in future responses unless deleted". | Letta memory blocks; ChatGPT "saved memories"; Nocturne `system://boot` Boot URIs; LangMem "procedural memory = data-independent, always present in the prompt" | **profile** + the new identity card (already ratified) | Pure prompt text. Zero index cost. The *majority* answer across every production system surveyed. |
| A2 | **Store a human-readable recall trigger with each memory and index it as text** (`disclosure`: "when the user asks who they are", "when planning real-world tasks"). Nocturne indexes disclosure in FTS alongside content and returns it with every search hit. | Nocturne Memory (`Edge.disclosure`, indexed in `search_documents`) | **episodes**, **intentions**, **relationship** | One extra TEXT column in our FTS5 table. Cheapest known fix for the "who am I" → "the user's name is X" bridging failure, because the *trigger phrase* is written in the query's vocabulary, not the fact's. Under ruling 1 it does double duty: from an index listing it also tells the agent *whether searching is worth it*. |
| A3 | **Weight the BM25 columns — title/path far above body.** Nocturne runs `bm25(fts, 0.0, 0.0, 2.5, 0.0, 2.0, 1.0, 1.0, 0.75)`: path 2.5×, uri 2.0×, content 1.0×, disclosure 1.0×, aux terms 0.75×. | Nocturne Memory (`db/search.py:311`) | all layers (pull-path ranking) | One-line change to the ranking call. Worth more after ruling 1, not less: a deliberate query hits names and triggers, not incidental body text. |
| A4 | **CJK segmentation at the application layer, written into an auxiliary index column.** Nocturne runs `jieba.cut_for_search` over path+uri+content+disclosure+glossary, dedupes the tokens, and stores them in a `search_terms` column that FTS5 indexes; glossary keywords are registered as custom jieba words. | Nocturne Memory (`db/search_terms.py`) | all layers (pull-path retrieval) | The most decision-relevant local finding: a working, MIT-licensed pattern for Chinese BM25 on SQLite FTS5 **without** a custom tokenizer extension and **without** embeddings. (Node equivalents exist — `nodejieba`, `segmentit`, `Intl.Segmenter` — but see §10.3.) |
| A5 | **Priority-tiered staleness, not a flat TTL.** Nocturne's diagnostic computes a per-item threshold from its priority: prio 0 → 3 days, otherwise `int(3.5 × 2^prio)` days, capped at 36500; items with no priority fall back to `days_stale=30`. | Nocturne Memory (`db/graph.py:481-495`) | **episodes** (matches the ratified "decay by importance tier, archive not delete") | Pure arithmetic over a timestamp column. No model call. |
| A6 | **A scheduled tidy pass that *detects* deterministically and *repairs* with the model.** Nocturne's `system://diagnostic/<domain>` reports four defect classes — stale nodes, crowded parents (>10 children), orphans, duplicate aliases — and hands them to five audit skills; recommended cadence "every 30–50 new memories". Letta's community cadence: dedup every run, light consolidation at session end, full reorganisation weekly, hierarchical rollups monthly. | Nocturne; Letta sleep-time forum guide | **episodes**, **relationship**, **activity** | The detection half is SQL. Only the repair half costs tokens, and it is off the hot path. Under ruling 1 it is *load-bearing*: a pull-only store degrades as it grows (see §7.3). |
| A7 | **Consolidation runs as a separate background agent with a different (stronger) model and its own tools**, not inside the conversational loop. Letta's sleep-time agent holds `memory_rethink` / `memory_insert` / `memory_replace` / `memory_finish_edits`; the primary agent may hold none of them. Default trigger: every **5** primary-agent steps (`sleeptime_agent_frequency`, recommended 5–10). | Letta | **profile**, **relationship**, **episodes** | We already have croner + the T4 heartbeat engine. The pattern maps onto it directly. |
| A8 | **Exact-string dedup that reinforces provenance instead of dropping the write.** Graphiti short-circuits the LLM when a new fact's *normalised* text already exists between the same two nodes, and appends the new episode UUID to the existing edge — the repeated assertion becomes an extra provenance entry, and a reranker (`episode_mentions`) can later rank by mention count. | Graphiti (`edge_operations.py:117-152`; `EdgeReranker.episode_mentions`) | **episodes**, **relationship** | The closest published precedent for ruling 2, and it costs one row in a join table. |
| A9 | **Never delete on contradiction — invalidate with a timestamp pair.** Graphiti/Zep sets the old edge's `invalid_at` ← new fact's `valid_at` and `expired_at` ← now; mem0's graph variant "marks relationships invalid rather than physically removing them". | Zep/Graphiti; mem0ᵍ | **profile**, **relationship**, **intentions** | Two nullable columns. Consistent with "archive, not delete" and with files-as-source-of-truth. |
| A10 | **Explicit ADD / UPDATE / DELETE / NONE decision returned as structured output with ID retention and `old_memory` echoed back**, so every change is auditable. | mem0 v2 `custom_update_memory_prompt` | **profile**, **relationship**, **intentions** | Our layers already have ownership + write policy; this is the missing verb set. But see R1 — mem0 itself has since backed off. |
| **A11** | **Keep an *index* in the always-in-context region, not bulk content** — so the agent knows what exists and can decide to search. Letta Code's rule, verbatim: memory blocks are "your most valuable context real estate: reserve them for durable knowledge that shapes who you are and how you act, **plus the indexes that let you discover everything else**"; and "Do **NOT** write memories that are easily derivable from searching past conversations (recall) or re-reading files. Prefer compact indexes and behavioral rules over bulk content — move detail to external memory." Nocturne ships this as system URIs: `system://index/<domain>`, `system://recent`, `system://glossary`. | Letta Code prompt; Nocturne | the pinned block itself; points at **episodes**, **relationship**, **intentions** | **Promoted by ruling 1 to a top-three item.** With per-turn injection gone, an in-context index is what converts "the agent cannot see the memory" into "the agent knows it exists and can go get it". Costs a few hundred tokens of the pinned budget. |
| **A12** | **A background pass pre-loads a shared block that the primary agent simply reads** — "Sleeptime dredges related archival memories into a shared block that primary references — **passive context enrichment without explicit retrieval**." | Letta (community best-practice guide) | the pinned block; sourced from **episodes** / **relationship** | Precisely "deterministic push, populated offline" — the strongest sourced pattern for how our rule-selected pinned block should be filled: by a scheduled job, not by a per-turn search. |
| **A13** | **Discovery paths that record themselves.** Letta Code's `[[path]]` links between memory blocks and external memory: "These references are the synapses of your memory: **they should strengthen with use, and record paths for faster discovery** for future improvement." Nocturne's deterministic version: glossary keyword→node bindings detected by Aho-Corasick, auto-generating cross-node hyperlinks so reading one memory surfaces pointers to related ones. | Letta Code; Nocturne | **episodes**, **relationship** | The Nocturne form is deterministic string matching over content — no model, no embeddings — and it is the pull-path analogue of A2: it makes the *next* lookup cheaper. |
| **A14** | **A prescriptive system-prompt policy for when to search, shipped alongside the tools.** Nocturne ships `docs/system_prompt_en.md` explicitly because tool descriptions alone leave the AI reactive: it is needed "for the AI to **proactively** recall and record memories (instead of waiting for you to remind it each time)". Letta's equivalent lives in the per-block `description`, which "is the main information used by the agent to determine how to read and write to that block. Without a good description, the agent may not understand how to use the block." | Nocturne; Letta | all layers | Prompt text. Under ruling 1 this is not garnish — it is the only thing standing between "pull path" and "the agent never looks". |

### 0.2 What we should reject

| # | Rejection | Evidence |
|---|---|---|
| R1 | **Do not build a full LLM operation-classifier on the write hot path.** mem0 shipped exactly that (two LLM calls: extract, then classify ADD/UPDATE/DELETE/NOOP against top-*s* neighbours) and **removed it**. Current mem0 (OSS v3 / Platform) is *single-pass ADD-only*: one LLM call, MD5 hash dedup, `custom_update_memory_prompt` deprecated, `add()` returns only `ADD` events, graph store support removed from OSS config. Stated reason: "the model spends its capacity on understanding the input rather than diffing against existing state." | docs.mem0.ai `migration/oss-v2-to-v3`; mem0 skills `architecture.md` |
| R2 | **Do not adopt "ADD-only, let retrieval sort it out" either.** mem0 concedes the cost: "Knowledge update (93.6) remains the hardest category for an additive, ADD-only architecture: older facts are preserved rather than overwritten, so semantically similar prior facts can still surface alongside newer ones." Their compensation is a reranker + temporal metadata + a **top-200** candidate budget. Under ruling 1 this gets *worse* for us: on a pull path the agent sees one result set and moves on — there is no second chance for a superseded fact to be out-ranked later in the turn. | docs.mem0.ai `core-concepts/memory-evaluation` |
| R3 | **Do not put importance/decay maths into similarity ranking without a usage signal.** Generative Agents' `score = recency + importance + relevance` works because recency decays on **last retrieval** (0.995 per sandbox hour) — the ranking is closed-loop. Nocturne makes the conservative choice: `priority` is only a tiebreaker (`ORDER BY score ASC, priority ASC, length(path) ASC`) and `last_accessed_at` feeds *staleness*, not ranking. (But see §8.1 — under ruling 1 the reinforced weight feeds pinned-block selection and decay, neither of which is similarity ranking, so this objection does not block ruling 2.) | Park et al. 2023 §4.1; Nocturne `db/search.py:320`, `db/graph.py:475` |
| R4 | **Do not adopt a knowledge-graph memory model (Zep/Graphiti, cognee, A-MEM).** All three need an LLM structured-output call *per episode* plus per-edge resolution (Graphiti: 1 node-extract + 0–N node-resolve + 1 edge-extract + **1 per edge** resolve + 1 per entity type + 1 per 30-entity summary batch), plus an embedder, plus a graph store. A per-message cost multiplier on a desktop pet. | Graphiti DeepWiki "Data Processing Pipeline" table |
| R5 | **Do not rely on semantic-similarity dedup thresholds we cannot compute.** Every sourced numeric dedup threshold presupposes embeddings: Graphiti `NODE_DEDUP_COSINE_MIN_SCORE = 0.6`, `DEFAULT_MIN_SCORE = 0.6`; AgentOS merge at cosine ≥ 0.95 (with an explicit SHA-256 fallback "without `embedFn`"); cognee ontology fuzzy match cutoff 0.80 (that one is `difflib`, not embeddings). Our dedup must be lexical or normalised-string based. | see §6 |
| R6 | **Do not treat "retrieved" as "used" silently.** Every system that reinforces does so on *retrieval* (MemoryBank `S += 1`, Generative Agents recency reset, Nocturne `last_accessed_at`, Elastic `last_used_at`). Elastic is the only source that names the flaw: bumping on every recall "would reward 'recently tried' rather than 'recently effective'", so they exempt their procedural index from decay until a `last_success_at` exists. If we reinforce on exposure, document that it is exposure. | elastic.co search-labs "Agent memory on Elasticsearch" |
| **R7** | **Do not carry over per-turn injection tuning as if it still applied.** mem0's signal fusion, cognee's `UserPromptSubmit` hook injection, and the Generative Agents / A-MEM / MemoryBank read paths are all *architectural auto-retrieval every turn* — the design ruling 1 removes. Their **ranking** ideas transfer to the search tool's internals; their **invocation** model does not. | ruling 1; see §7.1 |

### 0.3 What is unaffordable for us

- **Any mandatory embedding dependency.** Letta raises `EmbeddingConfigRequiredError` when an agent without an `embedding_config` tries to create its default archive; `create_passage_in_archive_async` calls `request_embeddings` before every insert. mem0 v3 fuses BM25 *on top of* semantic candidates — "BM25 is a boost signal, not a recall expander. Only semantic search results are candidates" — so turning the embedder off empties the candidate set. Graphiti embeds every entity name (Zep: 1024-dim) and needs the embedder for node dedup even with a BM25-only *search* recipe. None of the three degrades to keyword-only. (Full table in §6.)
- **A vector store / graph store service.** cognee's "run it all on one Postgres" still means Postgres + pgvector; Letta's `VectorDBProvider` is `native | tpuf | pinecone`; Graphiti needs Neo4j/FalkorDB/Kuzu/Neptune. We have `node:sqlite` + FTS5 and a Windows/Ubuntu dual-target rule.
- **Per-turn multi-LLM-call write pipelines** (Graphiti ≥ 5 calls per episode; A-MEM: note construction + link generation + neighbour evolution per write; mem0 v2: 2 calls per message pair). Our write path — explicit tool call plus a 20-message summariser — is already the right order of magnitude and matches mem0's *post*-optimisation shape.
- **Cross-encoder reranking** (Graphiti's default `search_()` recipe is `COMBINED_HYBRID_SEARCH_CROSS_ENCODER`; the BGE option needs `sentence_transformers`). An extra model at read time is exactly the provider dependency the hard rule forbids — and on a pull path it would add latency inside a tool call the user is waiting on.

---

## 1. Letta (MemGPT successor) — current product, not the 2023 paper

### A. Deduplication at write time
**Not an engine feature.** Nothing in the Letta memory API dedups an incoming memory. Core-memory blocks are free-text values the agent rewrites; archival passages are inserted via `create_passage_in_archive_async(archive_id, text, metadata, tags)`, which embeds and inserts with no similarity check.

Dedup exists only as a **prompt/tool-rule convention**: the community best-practice guide sets `archival_memory_search: run_first` ("always check before inserting") and lists "Deduplication — every run — part of standard flow (search before insert)". Letta's answer to A is *"make the agent search first"*, not *"make the store reject the duplicate"* — itself a pull-path mechanism (§7).
Sources: `letta/services/archive_manager.py`; forum.letta.com/t/154.

### B. Update vs append
**Explicit and typed, at the block level.**
- `core_memory_append(label, content)` — string concat with `"\n"`.
- `core_memory_replace(label, old_content, new_content)` — **exact-match** replace; raises `ValueError: Old content '...' not found in memory block '...'`. Empty `new_content` = delete.
- `memory_insert` — append-only, "minimal race conditions", recommended for shared/concurrent blocks.
- `memory_replace` — "target string may change before write".
- `memory_rethink` — whole-block rewrite, "last-writer-wins, no merge"; reserved for single-agent exclusive access (the sleep-time agent).
- Direct block `update` via API **replaces** the whole value: "Setting `value` completely replaces the entire block content — it is not an append operation… the last write wins and overwrites all earlier changes."

**Who decides**: the model, always. No classifier, no deterministic merge.
Sources: `letta/schemas/memory.py`; docs.letta.com memory-blocks; letta-ai/skills `agent-development/SKILL.md`.

### C. Consolidation / reorganisation
**Sleep-time agents.** `enable_sleeptime: true` creates a primary + a background agent in a multi-agent group sharing memory blocks; the group triggers the background agent **every N primary steps**, `sleeptime_agent_frequency` **default 5**, docs recommending "relatively high (e.g. 5 or 10) as triggering too often can be expensive… and has diminishing returns".

- Product: "learned context" written into a shared memory **block** (not a new record). Raw messages stay in recall memory; nothing is destroyed.
- Model-driven. The offline-memory prompt from the sleep-time paper: "re-organize and consolidate memories by calling `rethink_memory` at every single step… **Prioritize the new information over existing memories.** If the new information implies that the old memory may need to change, then output the most likely fact."
- Framed as fixing a MemGPT defect: "Memory formation in MemGPT is incremental, so memories may become messy and disorganized over time."
- Community cadence beyond the per-N trigger: dedup every run; light consolidation at session end; full reorganisation weekly; hierarchical rollups monthly when archival exceeds a threshold. Caveat: "Don't over-consolidate — you lose granularity."
- The sleep-time agent runs on a **different, stronger model** ("primary gpt-4o-mini, sleep-time gpt-4.1 or Sonnet 3.7") because it is not latency-constrained.
- **Relevant to ruling 1**: one documented sleep-time job is to "dredge related archival memories into a shared block that primary references — passive context enrichment without explicit retrieval" (A12).

Sources: docs.letta.com sleeptime; letta.com/blog/sleep-time-compute; arXiv 2504.13171 Appendix; DeepWiki letta 10.2; forum.letta.com/t/154.

### D. Scoring, decay, reinforcement
**None.** No importance, salience, confidence, decay, or usage counter on blocks or passages. Passage search returns a relevance `score`; that is the only number. Blocks carry `label / description / value / limit / read_only`.

Letta's substitute for importance is **allocation**: a block's `limit` is its budget, and size management is "split by topic / split by time / archive historical data / consolidate with `memory_rethink`" rather than "score and decay".
Observability of "was it used": **not addressed at all**.
Sources: `letta/schemas/memory.py`; docs.letta.com passages search; SKILL.md.

### E. Short-term vs long-term
Three tiers, split by *mechanism* rather than age:
1. **Core memory** — in-context blocks, always visible, no retrieval.
2. **Recall memory** — full message history in the DB; reachable via `conversation_search` after eviction.
3. **Archival memory** — explicitly inserted passages; reachable only via `archival_memory_search`. Critically: **"NOT automatically populated from context overflow."** Promotion is an agent action or a sleep-time-agent action — never automatic.

Eviction is compaction: `SUMMARIZATION_TRIGGER_MULTIPLIER` (1.0 in one main-branch snapshot, **0.9** in a later one, commented "using instead of 1.0 to avoid 'too many tokens in prompt' fallbacks"; GPT-5-family forced to proactive 90%). Before trimming, Letta injects `MESSAGE_SUMMARY_WARNING_STR`: *"The conversation history will soon reach its maximum length and be trimmed… save that information immediately by calling `core_memory_append`, `core_memory_replace`, or `archival_memory_insert`."* — the same pre-compaction flush turn we already have.
Sources: `letta/constants.py` (two commits, see §10.2 drift note); `letta/services/summarizer/thresholds.py`; SKILL.md.

### F. Retrieval
- Core memory: **no retrieval** — compiled into the system prompt as `<memory_blocks>` with per-block `<description>`, `chars_current`, `chars_limit`, and (line-numbered renderer) `1→ 2→` prefixes.
- Archival: **semantic only**, plus non-semantic filters — `tags` with `tag_match_mode: any|all`, `start_date`/`end_date`, `limit`. No BM25 path in the passages search API.
- Recall: `conversation_search` over stored messages (text search, no embedder).
- No recency or importance weighting on top of similarity.
- Non-English evidence: **not sourced.**
Sources: docs.letta.com `api/resources/passages/methods/search`.

### G. Framework vs self-built; provider dependency
- Framework-provided: block persistence + prompt compilation, memory tools, archives, sleep-time grouping, compaction.
- **Hard embedding requirement for archival.** `get_or_create_default_archive_for_agent_async` raises `EmbeddingConfigRequiredError(operation="create_default_archive")` when `agent_state.embedding_config is None`; every insert calls `request_embeddings`. Issue #3210 documents the failure mode when the configured embedder is unreachable/mismatched: archival tools die with `NotImplementedError` / `Embedding model not found`, while "other tools (core memory, conversation search) work fine".
- **Degraded mode: partial.** Core memory blocks and `conversation_search` survive without an embedder; archival does not. Letta's *identity* tier is provider-agnostic; its *semantic recall* tier is not.
- Vector backend: `VectorDBProvider = native | tpuf (Turbopuffer) | pinecone`, chosen per-archive at creation; the embedding config is **frozen at archive creation** and not re-synced when the agent's model changes (issue #3210 root cause) — a real-world illustration of why an embedding dependency is a migration hazard.

### H. Concrete numbers
| Quantity | Value | Source |
|---|---|---|
| `sleeptime_agent_frequency` | default **5** primary steps; recommended 5–10 | docs.letta.com sleeptime |
| Core memory budget guidance | keep total core memory **< 80 %** of context window | SKILL.md |
| Per-block size guidance | "typically **2000–5000 characters** per block" | SKILL.md |
| `CORE_MEMORY_BLOCK_CHAR_LIMIT` (code default) | **20000** at commit `67013ef1`; **100000** at commit `bb52a890`; persona/human 20000 | `letta/constants.py` |
| `SUMMARIZATION_TRIGGER_MULTIPLIER` | **1.0** (older) → **0.9** (newer) | `letta/constants.py` |
| `MIN_CONTEXT_WINDOW` / `DEFAULT_CONTEXT_WINDOW` | 4096 / 32000 → 128000 | `letta/constants.py` |
| `TOOL_RETURN_TRUNCATION_CHARS` | 5000 | `letta/constants.py` |
| Archival top-k | 10 by default (secondary source; the API just says `limit`) | theneuralbase.com — **weak, indicative only** |

---

## 2. mem0 — the extract/update pipeline, then and now

**The single most important fact for T5: mem0 removed its operation classifier.** The design everyone cites (ADD/UPDATE/DELETE/NOOP decided by an LLM) is the *old* pipeline. Current mem0 is ADD-only.

### A. Deduplication at write time
- **v2 (arXiv 2504.19413)**: for each extracted fact, retrieve the **top-*s* semantically similar** memories by vector embedding and hand them + the candidate to the LLM as a tool call. Semantic, model-judged; **no fixed numeric threshold published** for the flat store. For the graph variant `mem0ᵍ`, node matching uses "semantic similarity above a defined threshold *t*" — **the value of *t* is not given.**
- **v3 (current)**: dedup is **hash-based — MD5 — exact duplicates only**, after a "context lookup" that pulls the **top-10 related existing memories** into the extractor's prompt so the single LLM call avoids re-emitting them. Sequence: `retrieve top-10 related → single LLM call extracts all distinct new facts → batch embed → MD5 dedup → batch insert → entity extraction + linking`.
- On a hit: v2 → the LLM decides (skip/merge/overwrite). v3 → dropped silently, **no counter, no reinforcement**.
- `infer=False` bypasses everything: "Skips conflict resolution — same fact can be stored twice."
Sources: arXiv 2504.19413 §3; docs.mem0.ai `core-concepts/how-it-works`, `migration/oss-v2-to-v3`; mem0 repo `skills/mem0/references/architecture.md`.

### B. Update vs append
- **v2 operations** (verified): `ADD`, `UPDATE`, `DELETE`, `NOOP` (`NONE` in the prompt/JSON). Decided **by the LLM via a function-calling interface**, explicitly *not* a separate classifier: "Rather than using a separate classifier, we leverage the LLM's reasoning capabilities to directly select the appropriate operation." Algorithm 1 adds one deterministic guard: on UPDATE, replace only `if InformationContent(f) > InformationContent(m_i)`.
- Output contract: UPDATE keeps the **original ID** and echoes `old_memory`; DELETE keeps the ID with `event: "DELETE"`; IDs may never be invented. Every change logged with old/new/event/timestamp = audit trail.
- **v3**: `add()` returns `ADD` only. `custom_update_memory_prompt` **deprecated**. UPDATE/DELETE survive only as explicit application-level API calls (`client.update(memory_id, text)`, `client.delete(memory_id)`, batch ≤ 1000).
- Rationale for the removal, verbatim: "The previous algorithm used two LLM calls… The new algorithm collapses this into a single call that only adds."
Sources: arXiv 2504.19413 Algorithm 1 + Appendix B; docs.mem0.ai custom-update-memory-prompt; oss-v2-to-v3.

### C. Consolidation / reorganisation
- v2: consolidation *was* the update phase (per-write).
- v3: **none.** "v3 uses ADD-only extraction. Memories accumulate over time rather than being consolidated." Reconciliation is pushed to read-time ranking and entity linking.
- The one periodic component is the **asynchronous conversation-summary module** (v2): a rolling summary *S* regenerated in the background and fed into every extraction prompt. v3 keeps a "rolling message window" in SQL for the same purpose.
- A separate **temporal reasoning pass** runs after extraction, asynchronously, writing metadata: when the event occurred, ongoing vs completed, timing precision, and a memory **type** ∈ {event, state, plan, preference, relationship, absence}.
Sources: docs.mem0.ai `core-concepts/memory-evaluation`; oss-v2-to-v3.

### D. Scoring, decay, reinforcement
**None of the three exists.** No importance, no confidence, no decay, no reinforcement counter. The only per-memory numbers are the query-time fusion `score` and the temporal metadata.
Observability of "was it used": **ignored entirely** — "Your app decides which returned memories to include," and nothing flows back. The nearest quality signal is offline benchmark category scores.

### E. Short-term vs long-term
Not a tier split — a **scope split**: `user_id` (persistent), `agent_id`, `run_id` (session). The documented pattern searches both scopes and concatenates. No promotion, no expiry between them. Three stores by role: vector DB (facts + embeddings + metadata), graph/entity store (entities + linked memory IDs), SQL DB (ADD-event history log + rolling message window).

### F. Retrieval
- v3 = **multi-signal hybrid**: (1) semantic vector similarity, (2) BM25 keyword with verb-form lemmatisation, (3) entity match boost, (4) temporal-intent score.
- Fusion: "normalized and fused into a single combined `score`… **adapts based on which signals are available at runtime** (semantic-only, semantic + BM25, or all three when spaCy + the entity store are active)." **Exact weights unpublished.**
- Temporal score is **additive and subordinate**: "semantic relevance always dominates; it nudges ranking toward the correct dated instance without filtering candidates out."
- **Critical asymmetry**: "BM25 is a boost signal, not a recall expander. Only semantic search results are candidates: BM25 and entity scores boost ranking but don't add new candidates." → **no keyword-only degraded mode by construction.**
- Non-English/Chinese evidence: **not sourced.**
- **Ruling-1 note**: mem0's read model is `search()` called by the application before every model call — the automatic-injection design being removed. Ranking ideas transfer to a search tool; the invocation model does not.

### G. Framework vs self-built; provider dependency
Everything is framework-provided (a service/SDK). Hard dependencies: **LLM** (extraction), **embedder** (storage + candidate generation), **vector store**. Optional: spaCy for the entity signal, a reranker. Degraded keyword-only mode: **impossible** (see F). Graph store support was *removed* from OSS config in v3.

### H. Concrete numbers
| Quantity | v2 | v3 | Source |
|---|---|---|---|
| Neighbours retrieved for the dedup/update decision | top-*s* (unspecified in paper); **top-5** in the reproduction used by arXiv 2605.03354, cosine, **no minimum threshold** | **top-10** as extractor context | paper; interpretability paper appendix |
| `top_k` default | 100 | **20** | oss-v2-to-v3 |
| `threshold` default | `None` (no filtering) | **0.1**, must be in [0,1] | oss-v2-to-v3 |
| `rerank` default | `True` | **False** | oss-v2-to-v3 |
| Batch update/delete cap | — | 1000 | architecture.md |
| Embedding model in the reproduced pipeline | `text-embedding-3-small` | — | arXiv 2605.03354 |
| Benchmark (top_200 budget) | — | temporal reasoning **97.0**; single-session user **98.6**, assistant **98.2**; **knowledge update 93.6** (worst, blamed on ADD-only) | memory-evaluation |
| Write-time LLM-call reduction from the redesign | — | "**60–70 % fewer**" | jatinbansal.com — **secondary, not a mem0 primary source** |

---

## 3. Zep / Graphiti — temporal knowledge graph

### A. Deduplication at write time
The most elaborate dedup of anything surveyed. **Nodes — three tiers, cheapest first:**
1. **Exact match** on a normalised (lowercased, whitespace-stripped) name — `_normalize_string_exact`.
2. **Fuzzy** — MinHash signatures + LSH banding to shortlist candidates (`dedup_helpers.py`).
3. **LLM** — only for what tiers 1–2 leave unresolved; the prompt gets the extracted node, up to `NODE_DEDUP_CANDIDATE_LIMIT = 15` candidates (name + entity types + 120-char summary) plus episode context, returning `duplicate_candidate_id` (negative = not a duplicate). The shortlist comes from cosine similarity with `NODE_DEDUP_COSINE_MIN_SCORE = 0.6` plus a full-text search on names and summaries.

**Edges — fast path then LLM:**
- Fast path: exact `(source_uuid, target_uuid, normalized_fact)` already present → **short-circuit the LLM and append the new episode UUID to the existing edge**. (See §8.1 — the ruling-2 precedent.)
- Otherwise `resolve_extracted_edge` asks the LLM for duplicates *and* contradictions in one call, with candidates constrained to edges **between the same entity pair** — "not only prevents erroneous combinations of similar edges between different entities but also significantly reduces the computational complexity".
- Duplicate hit → merge into the existing edge (episode appended). Contradiction → temporal invalidation.
Sources: DeepWiki getzep/graphiti 3.4 + 5; `node_operations.py`; Zep paper arXiv 2501.13956 §2.2.

### B. Update vs append
No UPDATE verb. The model is **append-plus-invalidate**: a changed fact becomes a *new edge*; the old edge gets `invalid_at ← new_fact.valid_at`, `expired_at ← utc_now()`. "Graphiti uses temporal edge invalidation rather than deletion, preserving the complete history of what the system knew and when." Entity nodes carry only transaction time; validity lives on edges because "entities represent persistent objects that can have multiple changing relationships over time". Driven by an LLM contradiction judgement during edge resolution.

### C. Consolidation / reorganisation
- Entity **summaries evolve** — duplicate resolution returns an updated name and summary; summaries regenerate in batches (`MAX_NODES = 30` per call).
- **Communities** (entity clusters with their own summaries) are a first-class node type with their own search config — the graph's rollup analogue. Build/refresh is an explicit operation, not a schedule.
- Episodes (raw ingested data) are **never** consolidated away; they are the provenance floor.
- Trigger: ingestion-driven (`add_episode`), plus `add_episode_bulk()` with two-pass dedup (against the graph, then intra-batch) and union-find UUID compression.
- Model-driven with deterministic pre-filters.

### D. Scoring, decay, reinforcement
**No importance score, no decay.** Ranking is similarity + rank fusion. Two weak salience proxies:
- `EdgeReranker.episode_mentions` / `NodeReranker.episode_mentions` — rank by **how often** the entity/edge is mentioned across episodes. A *write-frequency* signal, not a usage signal.
- `node_distance` — proximity to a `center_node_uuid` (e.g. the user node).
Observability of "was it used": **not addressed.**

### E. Short-term vs long-term
No tier split. The bi-temporal fields *are* the lifecycle: `created_at` (learned), `valid_at` (became true), `invalid_at` (stopped being true), `expired_at` (system recorded the invalidation). "Current" is a query filter — `valid_at <= t AND (invalid_at > t OR invalid_at IS NULL)` — not a storage tier. Nothing expires out; things get filtered out.

### F. Retrieval
- **Hybrid by construction**: `EdgeSearchMethod ∈ {cosine_similarity, bm25, breadth_first_search}`; nodes the same; **episodes are BM25-only**; communities cosine+bm25.
- Combination: **RRF is the default reranker for every entity type** — "Each algorithm's results are ranked, converted to reciprocal scores (1/rank), and summed." Alternatives: `mmr` (λ default 0.5), `node_distance`, `episode_mentions`, `cross_encoder` (OpenAI logprob-based by default; Gemini; or `BAAI/bge-reranker-v2-m3` via `sentence_transformers`).
- `graphiti.search()` = `EDGE_HYBRID_SEARCH_RRF`, or `EDGE_HYBRID_SEARCH_NODE_DISTANCE` when a `center_node_uuid` is passed. `graphiti.search_()` defaults to `COMBINED_HYBRID_SEARCH_CROSS_ENCODER`.
- No recency/importance weighting on top of similarity; recency enters only via `SearchFilters` on the four timestamps.
- Non-English/Chinese evidence: **not sourced.** BM25 is delegated to the graph DB's full-text index, so CJK tokenisation is the backend's problem.

### G. Framework vs self-built; provider dependency
- Requires: LLM with **reliable structured output** (they warn "reliability varies across OpenAI-compatible providers and especially on smaller or local models" and expose `structured_output_mode: json_schema | json_object`), an **embedder**, a **graph database**, optionally a cross-encoder.
- Degraded keyword-only mode: **search side, in principle yes** (`search_methods=[bm25]`, and episodes are BM25-only anyway); **ingest side, no** — node dedup tiers 2–3 assume embeddings and every extraction is an LLM call.

### H. Concrete numbers
| Quantity | Value | Source |
|---|---|---|
| `DEFAULT_SEARCH_LIMIT` | **10** per entity type | `search_config.py:29` |
| `DEFAULT_MIN_SCORE` (`sim_min_score`) | **0.6** | `search_utils.py` |
| `DEFAULT_MMR_LAMBDA` | **0.5** (0 = max diversity, 1 = max relevance) | `search_utils.py` |
| `MAX_SEARCH_DEPTH` (BFS) | **3** hops | `search_utils.py` |
| `MAX_QUERY_LENGTH` | **128** tokens for full-text queries | `search_utils.py` |
| `NODE_DEDUP_CANDIDATE_LIMIT` | **15** | `node_operations.py` |
| `NODE_DEDUP_COSINE_MIN_SCORE` | **0.6** | `node_operations.py` |
| `MAX_NODES` per summarisation call | **30** | `node_operations.py` |
| Context window for entity extraction | last **n = 4** messages (2 full turns) | Zep paper §2.2.1 |
| Entity-name embedding dimension | **1024** | Zep paper §2.2.1 |
| LLM calls per episode | 1 extract-nodes + 0..N node-resolve + 1 extract-edges + **1 per edge** resolve + 1 per entity type + 1 per 30-entity summary batch | DeepWiki 5 |
| `reranker_min_score` | 0 | `search_config.py` |

---

## 4. Nocturne Memory (local reference, MIT) — the keyword-only, pull-only, identity-first design

In `H:/TakiAgent/references/nocturne_memory-main/`. The closest existing system to our constraints **and, after ruling 1, to our architecture**: SQLite/Postgres + FTS5, no embeddings anywhere, no background summariser, agent-authored memories, an always-loaded identity boot set, a scheduled diagnostic — and **retrieval exclusively by agent-initiated tool call**. Read patterns only; MIT, but any port is a clean-room rewrite per project rules.

Data model: `Node` (UUID = stable identity) → `Memory` (content version, `deprecated` + `migrated_to` chain) → `Edge` (parent→child, carries `name`, `priority`, `disclosure`) → `Path` (materialised `namespace/domain/path` URI cache). Derived: `SearchDocument` + `search_documents_fts`, `GlossaryKeyword`, `MemoryAccessLog`, `Preset` (boot URIs).

### A. Deduplication at write time
**No semantic or lexical dedup.** Uniqueness is structural: `UniqueConstraint(parent_uuid, child_uuid)` on edges; `(namespace, domain, path)` PK on paths. Near-duplicates are *detected later* by the diagnostic as "duplicate aliases under the same parent" and left for the agent/human to merge. Aliases are deliberate: `add_alias` gives the same node a second path with its own `priority` and `disclosure` — "Not a copy".

### B. Update vs append
`update_memory` is **patch or append only — "No full replacement — prevents accidental overwrites."** `delete_memory` "severs an access path (does not delete the memory content itself)". Every write snapshots; the dashboard offers visual diff + one-click Integrate/Reject with rollback; `ChangeCollector` records pre-mutation row state (memories as pointers without content, since the content row survives as `deprecated`). Decided by the agent; audited by the human.

### C. Consolidation / reorganisation
`read_memory("system://diagnostic/<domain>")` → a deterministic report of four defect classes:
1. **Stale nodes** — per-item threshold from priority (see D/H).
2. **Crowded parents** — more children than `max_children` (**default 10**), framed as "signal dilution".
3. **Orphans** — nodes that lost all access paths.
4. **Duplicate aliases** under the same parent.
Repair is model-driven via `docs/skills/memory-audit/SKILL.md` (1 entry point + 5 sub-skills: belief-duel, dead-data-purge, **discoverability**, node-decomposition, pattern-extraction). Suggested cadence: "**every 30–50 new memories**, or whenever the AI keeps repeating the same mistake." Cleanup of old versions/orphans "always requires explicit human confirmation".

Note the sub-skill named *discoverability* — the audit explicitly treats "can this memory be found again" as a defect class, which is the pull-path concern (§7).

### D. Scoring, decay, reinforcement
- **Score**: `Edge.priority` (int, **ascending = more important**; 999 = unset). Assigned by the model at write time via `create_memory(priority=…)`, editable by the human.
- **Where it is used**: (a) **tiebreaker only** in ranking — `ORDER BY score ASC, sd.priority ASC, length(sd.path) ASC`; (b) input to the staleness threshold.
- **Usage signal**: `Node.last_accessed_at` plus an async `MemoryAccessLog(node_uuid, namespace, accessed_at, context)`. Reads bump the timestamp. Staleness uses `effective_date = last_accessed_at ?? max(created_at, tracking_start_date)`.
- **Post-hoc adjustment**: the *decay clock* is reset by retrieval; the *priority* is never adjusted automatically — only by agent or human during an audit.
- Observability of "was it used": **retrieval is the proxy**, and it is used only for forgetting, never for ranking. A deliberately conservative split, directly transferable.

### E. Short-term vs long-term
No tier split. Everything is long-term; recency is a view (`system://recent`, limit 5). What replaces tiering is the **boot set**: `system://boot` loads a configured `Boot URIs` list at session start (per-namespace, falling back to global), with `path_masks`; presets are rows with a unique partial index enforcing exactly one active preset.

### F. Retrieval
- **Pure BM25 over FTS5** (SQLite) or `ts_rank_cd` over `to_tsvector('simple', …)` (Postgres). Both index path, uri, content, disclosure and an auxiliary `search_terms` column.
- **Column weights**: `bm25(search_documents_fts, 0.0, 0.0, 2.5, 0.0, 2.0, 1.0, 1.0, 0.75)` → namespace 0, domain 0, **path 2.5**, node_uuid 0, **uri 2.0**, content 1.0, disclosure 1.0, search_terms 0.75. A memory's *name/path* outranks its body by 2.5×.
- **Query construction**: free text → jieba tokens → `"tok1" AND "tok2" AND …` (conservative AND semantics; falls back to the raw quoted phrase if tokenisation yields nothing).
- **Candidate over-fetch then dedupe by node**: `candidate_limit = max(limit*5, 50)`, first-hit-per-node wins.
- **CJK**: `SearchTokenizer` splits on `[:/.\-]`, matches `[A-Za-z0-9_]+` or CJK runs (CJK ext-A, unified, compat, hiragana/katakana, kana ext, hangul), segments CJK runs with `jieba.cut_for_search`, dedupes preserving order; glossary keywords are registered into jieba's dictionary (thread-safe, once) so multi-character names survive segmentation.
- **Glossary / Aho-Corasick hyperlinking**: keyword→node bindings generate cross-node links whenever a keyword appears in any memory's content — horizontal recall channels beyond the hierarchy.
- **Invocation model**: 100 % agent-initiated. `search_memory` and `read_memory` are MCP tools; nothing is injected per turn except whatever `system://boot` loaded at session start.

### G. Provider dependency
**Zero model dependency in the memory layer.** No embedder, no LLM inside the store; the agent is the only intelligence and arrives over MCP. SQLite locally, Postgres for multi-device. The existence proof that a purely lexical, pull-only agent-memory store is viable — with the caveat that its README argues the reason to avoid vectors is architectural (identity, triggers, authorship), not cost.

### H. Concrete numbers
| Quantity | Value | Source |
|---|---|---|
| BM25 column weights | 0, 0, **2.5**, 0, **2.0**, 1.0, 1.0, 0.75 | `db/search.py:311` |
| Candidate over-fetch | `max(limit*5, 50)`; default `limit` 10 | `db/search.py:284`, `mcp_server.py:410` |
| Diagnostic staleness default | `days_stale = 30` when priority unset | `system_views.py:397` |
| Priority-scaled staleness | prio 0 → **3 days**; else `int(3.5 × 2^prio)` days (1→7, 2→14, 3→28, 4→56 …), prio clamped to [0,20], capped at 36500 | `db/graph.py:486-491` |
| Crowded-parent threshold | `max_children = 10` | `system_views.py:397` |
| Snippet window | 30 chars either side of the first hit; 80-char fallback | `db/search.py:82` |
| Audit cadence guidance | every **30–50** new memories | README |
| `system://recent` | 5 items | `system_views.py:198` |
| Tool count exposed to the agent | **7** (`read_memory`, `create_memory`, `update_memory`, `delete_memory`, `add_alias`, `manage_triggers`, `search_memory`) | README |

---

## 5. Breadth: five more systems, one paragraph each

### 5.1 MemoryBank (AAAI 2024) — the canonical decay/reinforcement maths
Storage = raw dialogue logs + event summaries + a user portrait. Retrieval = dual-tower dense retrieval (DPR-style) over FAISS. Updating = **Ebbinghaus**: retention `R = e^(−t/S)`; `S` initialised to **1** on first mention; **on recall, `S += 1` and `t` resets to 0**; low-`R` items are forgotten. Explicitly "exploratory and highly simplified". The reinforcement trigger is *"when a memory item is recalled during conversations"* — i.e. **retrieved**, exactly the proxy we can observe. Encoder is swappable: **MiniLM for English, Text2vec for Chinese** — one of the only sources with an explicit bilingual retrieval setup. Chinese numbers (SiliconFriend-ChatGPT vs baselines): retrieval accuracy **0.856 (CN)** vs 0.763 (EN); Chinese correctness 0.655 vs baseline 0.418. Retrieval accuracy and answer correctness were *anti-correlated* across backbones — "how memories are used can outweigh raw retrieval hits". Its read path is automatic per turn (low value under ruling 1); the decay maths is not. Touches: **episodes**, **profile** (user portrait).

### 5.2 Generative Agents (Park et al. 2023) — the canonical scoring formula
Importance: **LLM rates 1–10 at write time** ("1 is purely mundane… 10 is extremely poignant"), fixed at creation. Retrieval: `score = α_recency·recency + α_importance·importance + α_relevance·relevance`, all **α = 1**, each min-max normalised; recency = exponential decay, factor **0.995 per sandbox hour since the memory was *last retrieved***; relevance = embedding cosine. Reflection (their consolidation): triggered when **the sum of importance scores of the latest perceived events exceeds 150** — in practice 2–3× per day; takes the **100 most recent** records, asks for "3 most salient high-level questions", uses those as retrieval queries, then extracts insights **with citations to the records that served as evidence**. Reflections are stored as memories and reflected on recursively. Retrieval is architectural (every turn) — low value under ruling 1 — but the importance scale, the reflection trigger, and the **generate-questions-then-retrieve** pattern transfer; the last is the only sourced example of a *self-issued query*, i.e. a machine-generated pull.

### 5.3 A-MEM (NeurIPS 2025) — Zettelkasten, link generation, neighbour evolution
Each write builds a **note**: content, timestamp, LLM-generated keywords, tags, contextual description, plus an embedding. **Link generation**: top-k nearest notes by cosine, then an LLM decides which links to create. **Memory evolution**: for each nearest neighbour, the LLM may **rewrite that neighbour's context, keywords and tags** in light of the new memory. Retrieval expands from top-k hits along links ("boxes"). Ablation: removing both collapses multi-hop F1; LG matters more than ME. Reported: LoCoMo multi-hop F1 **27.02** (GPT-4o-mini) vs 9.15 for ReadAgent, average tokens per question **2,520 vs 16,910**. Requires embeddings (ChromaDB) + an LLM per write. **Reject on cost (R4)**, but two halves are embedding-free and relevant: keywords/tags/context generated at write time and indexed (overlaps A2), and link-expansion at retrieval (overlaps A13).

### 5.4 LangMem / LangGraph (LangChain) — the vocabulary, and the honest warning about pull
Three memory types × two storage patterns × two formation paths:
- Types: **semantic** (facts), **episodic** (experiences/few-shot), **procedural** (system behaviour).
- Patterns: **profile** (single document updated in place, "ideal when you only care about the latest state", easy to expose for manual user editing) vs **collection** (unbounded records searched at runtime). Stated trade-off: profiles risk information loss and get error-prone as they grow; collections give higher recall but push complexity into update/delete and into search.
- Formation: **hot path** (agent calls `manage_memory` mid-conversation) vs **background** (a `memory_store_manager` reflects afterwards; "perfect for ensuring higher recall of extracted information"), with debouncing.
- Recall conditions, verbatim and directly relevant to our identity design: *"Some memories (core procedural memory) may be **data-independent — they are always present in the prompt**. Some are data-dependent and may be recalled based on semantic similarity."*
- **The pull-path warning** (see §7.3): tool-based memory "adds perceptible latency to user interactions", "adds one more obstacle to the agent's ability to satisfy the user's needs", "may increase complexity if the agent requires a new tool to decide what to commit to memory", and "the agent must multitask between memory creation and its other responsibilities, potentially affecting the quantity and quality of memories created". They point to a prefetch example showing how to include memories "**without the agent having to explicitly search**".
- Storage: LangGraph `Store`, namespaced (`("memories", "{user_id}")`), supporting **both semantic search and plain content filtering** — vector search is an *optional* store capability. The only framework surveyed whose storage layer is honestly embedding-optional.
Touches: **all five** — our layers map onto {profile-pattern: profile / relationship / intentions; collection-pattern: episodes / activity}.

### 5.5 cognee — graph+vector, with a usage-reweighting claim
Operations `remember / recall / improve / forget` (legacy `add / cognify / memify / search`). Two deterministic dedup layers: **content-hash dedup at `add()`**, and **pipeline-status skip at `cognify()`** (item already `COMPLETED` → no LLM calls, no re-embedding, no graph writes). A third, subtler one: **ontology canonicalisation** — entity names fuzzy-matched (`difflib.get_close_matches`, **cutoff 0.80**, configurable) to OWL classes/individuals and renamed to the canonical URI-derived form, "eliminating cross-document duplicates"; unmatched nodes tagged `ontology_valid = False`, and the pipeline degrades gracefully with no ontology at all. `memify` is the consolidation pass: "prunes stale nodes, **strengthens frequent connections, reweights edges based on usage signals**, and adds derived facts" — a vendor claim with **no published formula or threshold**. Requires LLM + embedder + (graph, vector, relational) stores; local default SQLite + LanceDB + Kuzu. Its Claude Code plugin hooks `SessionStart / UserPromptSubmit / PostToolUse / Stop / **PreCompact** / SessionEnd` — note that `UserPromptSubmit` context injection is the per-turn push model ruling 1 removes.

### 5.6 ChatGPT (production, for the identity question)
Two deliberately different mechanisms:
- **Saved memories** — an explicit, browsable, editable list stored **separately from chat history**, behaving "similarly to custom instructions": *"Unless you delete them, saved memories are **always considered in future responses**."* OpenAI's guidance: *"use saved memories for anything you want ChatGPT to always keep in mind"*, because chat history "does not retain every detail".
- **Reference chat history / "Dreaming"** — a background synthesis process (introduced Apr 2025; "Dreaming V3" rolling out 4 Jun 2026) reading across many conversations and maintaining a synthesised state **injected into the system prompt at inference time**, reviewable only as a summary.
Stated motivation for the background layer: *"saved memories were only written during the conversation and only on strong cues, which made them go stale"*, and could contradict each other ("I'm training for a marathon" / "I sprained my ankle"). Vendor-reported factual recall ~82.8 % (not independently verified). No user-visible pull tool — retrieval is opaque and automatic, the opposite of our new architecture; the always-in-context half is the part that transfers.

### 5.7 Low-provenance sources (flagged, not relied on)
Small projects implementing mechanisms we are considering, with unknown provenance, no peer review, and no adoption evidence: **AgentOS** (`docs.agentos.sh`) — six-signal composite retrieval (encoding strength, Ebbinghaus recency, emotional congruence, ACT-R spreading activation, importance, similarity); a 6–7-step consolidation loop (prune below `pruneThreshold`, **merge at cosine ≥ 0.95 or SHA-256 content match when no `embedFn` is configured**, Hebbian strengthen at learning rate 0.1, LLM-derive from clusters of min size 5 bounded at 5 per cycle, **episodic→semantic promotion for traces older than 7 days with retrieval count ≥ 3**, FTS5 re-index, archive sweep at 365 days), write-ahead verbatim archive; **Mubit** — "write-time lesson reconciliation: a re-learned near-duplicate lesson becomes a **recurrence bump** on the canonical entry instead of a new copy", plus `record_outcome(signal ∈ [-1,1])`; **Elastic search-labs** (credible vendor engineering blog) — `use_count` boost `1 + log10(1 + use_count) × weight` (≈1.2× at 10 uses, ≈1.4× at 100), gaussian time-decay on `last_used_at`, and `success_count`/`failure_count` on procedural memories classified by an LLM from later user utterances ("thanks, that worked"). Treat the first two as *existence proofs of the design*, not evidence that it works.

---

## 6. §G in full — provider dependency and degradability (our hard constraint)

| System | Embedder required? | LLM required in the memory layer? | Extra service? | Keyword-only degraded mode | What survives an upstream swap |
|---|---|---|---|---|---|
| **Letta — core memory blocks** | **No** | No | No (SQL) | N/A — never retrieved | **Everything.** Blocks are prompt text in a DB. |
| **Letta — archival** | **Yes, hard** (`EmbeddingConfigRequiredError`; every insert embeds) | No | vector provider: native / Turbopuffer / Pinecone | **No** — semantic only; tags/date are filters, not a retrieval path | Nothing; the embedding config is frozen per-archive, so a model change is a re-embed migration (issue #3210) |
| **Letta — recall (`conversation_search`)** | No | No | No | Yes (text search over stored messages) | Everything |
| **mem0 v3** | **Yes, hard** | **Yes** (extraction, temporal pass) | vector store (+ optional spaCy, reranker) | **No, by construction** — "only semantic search results are candidates" | Nothing |
| **Zep / Graphiti** | **Yes** (entity-name embeddings, dedup shortlist) | **Yes**, with reliable structured output; they warn about small/local models | graph DB (Neo4j / FalkorDB / Kuzu / Neptune) | **Search: partially** (`search_methods=[bm25]`; episodes are BM25-only). **Ingest: no.** | The stored graph; not the ability to grow it |
| **A-MEM** | Yes (ChromaDB) | Yes (note construction, link generation, evolution) | Chroma | No | Notes as text |
| **cognee** | Yes | Yes | graph + vector + relational (single-Postgres possible) | `CHUNKS_LEXICAL` mode exists (Jaccard), but the graph itself is LLM-built | Ontology is **additive** and degrades gracefully; the rest does not |
| **LangMem / LangGraph Store** | **Optional** — the store supports semantic search *and* content filtering | Yes for the manager; no for the store | Postgres for persistence | **Yes** (filter-based search) | Memories are JSON documents under namespace+key |
| **Nocturne Memory** | **No — none anywhere** | **No** | SQLite or Postgres | **It is the only mode** | Everything; the FTS index is fully rebuildable (`rebuild_all_search_documents`) |
| **MemoryBank** | Yes (dual-tower + FAISS) | Yes (summaries, portrait) | FAISS | No | Logs and summaries as text; the paper stresses the encoder is interchangeable per language |
| **Generative Agents** | Yes (relevance term) | Yes (importance rating, reflection) | — | Partially: recency + importance are computable without an embedder; relevance is not | The memory stream as natural-language text |
| **ChatGPT saved memories** | No (always in context) | The model curates | — | N/A | The list |

**Reading for us**: the two designs that satisfy our hard rule end-to-end are **Nocturne** (keyword-only, no model in the store, pull-only) and **the always-in-context tier of Letta / ChatGPT / LangMem-procedural** (no retrieval at all, therefore no retrieval dependency). Every embedding-based design fails the "survives a provider swap" test at the *recall* layer, and Letta issue #3210 is a documented instance — including the nastier second-order problem that embeddings from two models cannot share a vector space, so a provider swap is a full re-embed, not a config change.

**This is exactly the shape ruling 1 selects**: a deterministic push tier with no retrieval dependency at all, plus a lexical pull tier rebuildable from files. If semantic retrieval is added later on the pull path, the fusion must be designed so the lexical path alone still produces candidates — the inverse of mem0's "BM25 boosts, semantics gates" choice, which is precisely what makes mem0 undegradable.

---

## 7. Agent-initiated pull — how systems structure the decision to search, and stop the agent forgetting

Promoted to a first-class section by ruling 1. **Caveat up front: this is the thinnest area of the sourced material.** Most of the literature assumes automatic retrieval; the systems that use tool-based pull document the tools but rarely evaluate the invocation behaviour. Gaps are itemised in §10.1.

### 7.1 Who actually pulls

| System | Agent-initiated pull? | Tools / surface | What governs the decision |
|---|---|---|---|
| **Nocturne** | **Yes, exclusively** | 7 MCP tools; `search_memory` (keyword), `read_memory` with system URIs (`system://boot`, `system://index/<domain>`, `system://recent`, `system://glossary`, `system://diagnostic/<domain>`) | A shipped **recommended system prompt**, the boot load, the domain indexes, per-memory `disclosure` triggers, glossary cross-links, and the tool docstrings |
| **Letta** | **Yes, for the non-core tiers** | Primary agent holds `conversation_search` (recall) and `archival_memory_search` (archival). Archival is opt-in by design: "Access: Agent must explicitly call `archival_memory_search`. Note: **NOT automatically populated from context overflow**." | **Tool rules** (`archival_memory_search: run_first`, `archival_memory_insert: exit_loop`), per-block `description` fields, and in-context **indexes** (A11) |
| **LangMem** | **Yes** | `create_search_memory_tool`, `create_manage_memory_tool`, namespaced | Prompt; and they document the costs honestly (§7.3), offering a prefetch alternative |
| **Zep / Graphiti** | Yes via API / MCP server (episode management, entity management, semantic and hybrid search, group management, graph maintenance) | `search` / `search_` | **Tool-level prompting not sourced** |
| **mem0** | **No** — application-driven: "You send conversation turns to `add`, then call `search` before the next model request… Your app decides which returned memories to include in the prompt." | `add()` / `search()` | n/a — the design ruling 1 removes |
| **cognee** | Mixed — `recall` exists, but the Claude Code plugin **injects on `UserPromptSubmit`** | `recall` + lifecycle hooks | n/a for the push half |
| **ChatGPT** | No user-visible pull tool; retrieval is opaque and automatic | — | — |
| **Generative Agents / A-MEM / MemoryBank** | No — architectural auto-retrieval every turn | — | — |

Two observations that matter for us. First, **only Nocturne is pull-only**, and it is also the only embedding-free system — the two choices reinforce each other, because a purposeful query is what makes lexical search usable. Second, **Letta keeps all three paths simultaneously**: an always-in-context block tier, pull tools on the primary agent, and a background writer that pre-fills a shared block. No surveyed production system relies on pull alone for everything.

### 7.2 The six sourced mechanisms for making the agent look

1. **A boot load at session start that carries pointers, not just facts.** Nocturne's `system://boot`; the README's real transcripts show the resulting chain — `read_memory("system://boot")` → `search_memory("jobstation")` → `read_memory("core://work_jobstation/commercialization")`. The boot content is what seeds the search query.
2. **An index in the always-in-context region** (A11). Letta Code: reserve blocks for durable knowledge "plus the indexes that let you discover everything else"; "Prefer compact indexes and behavioral rules over bulk content — move detail to external memory", enforced by a `/doctor` warning when the system prompt grows too large. Nocturne: `system://index/<domain>`, `system://recent`, `system://glossary`.
3. **A written trigger condition stored with each memory** (A2). Nocturne's `disclosure` — e.g. *"When planning real-world tasks, evaluating agent credit, or auditing platform ethics"* — is indexed for search **and** returned with every hit, so it works both as a retrieval bridge and as a "should I bother reading this" signal in an index listing.
4. **Discovery paths that record and strengthen** (A13). Letta Code's `[[path]]` links: "the synapses of your memory: they should strengthen with use, and record paths for faster discovery for future improvement." Nocturne's deterministic equivalent: glossary keyword→node bindings, matched with Aho-Corasick, auto-generating cross-node hyperlinks. A-MEM's link expansion at retrieval is the embedding-based version.
5. **A prescriptive system-prompt policy shipped with the tools** (A14). Nocturne ships `docs/system_prompt_en.md` explicitly because tool descriptions alone leave the AI reactive — installation "is complete" without it, but the AI will only recall "when you remind it each time". Letta's per-block `description` plays the same role at block granularity.
6. **A background agent that pre-loads a shared block** (A12). Letta: "Sleeptime dredges related archival memories into a shared block that primary references — passive context enrichment without explicit retrieval." This is the hedge against mechanism failure: if the agent never searches, the block was already filled offline by rule.

### 7.3 Honest counter-evidence for a pull-only design

- **LangChain documents the failure modes of hot-path tool memory**: it "adds perceptible latency to user interactions", "adds one more obstacle to the agent's ability to satisfy the user's needs", "may increase complexity if the agent requires a new tool to decide what to commit to memory", and "the agent must multitask between memory creation and its other responsibilities, potentially affecting the quantity and quality". Their mitigation is a prefetch that includes memories "without the agent having to explicitly search" — i.e. they hedge pull with push.
- **Nocturne's own audit skill set includes "discoverability" as a defect class**, and its diagnostic flags crowded parent nodes as *"signal dilution"* — both are admissions that a pull-only store degrades as it grows unless actively maintained. The tidy pass (A6) is therefore not optional under ruling 1; it is what keeps the pull path usable.
- **Letta's archival tier is opt-in and they still bolt an index + descriptions + tool rules + a background dredger onto it.** The compensations are the design, not extras.
- **No sourced system measures how often an agent fails to search when it should.** See §10.1.

### 7.4 Consequence for the rest of this survey

Ranking findings (A3 bm25 weights, Nocturne's `max(limit*5, 50)` over-fetch, Graphiti's RRF + limit 10, mem0's top-20 / threshold-0.1) now describe **the internals of a tool the agent invokes deliberately**, not a per-turn budget. That relaxes two constraints and tightens one:
- Relaxed: latency and token cost per query — a rarely-run search can afford over-fetch and a wider result set than an ~600-token per-turn block could.
- Relaxed: precision pressure — the agent asked, so it can discard misses.
- Tightened: **recall** — one shot, one query, no second chance later in the turn. Which is why A2 (trigger text) and A3 (name/path weighting) matter more now than they did under per-turn injection.

---

## 8. The two hypotheses

### 8.1 Ruling 2 in force — "a duplicate write is a recall-failure signal and reinforces the existing entry"

**Ratified by the owner; reported here against the literature as originally asked.**

**Verdict: mostly silence, one strong partial agreement, one explicit contradiction. No surveyed system uses the write path as a diagnostic of the read path, and none argues against doing so.**

| Stance | System | Evidence |
|---|---|---|
| **Partial agreement (strongest precedent)** | **Graphiti** | A re-asserted fact between the same two nodes does not create a new edge — the existing edge's `episodes` list gains the new episode UUID. Repeated assertion accumulates on the surviving record, and `episode_mentions` reranking can promote frequently-mentioned edges/nodes at read time. Mechanically our loop: *write-frequency → read-ranking*. It is **not** framed as "retrieval failed"; it is framed as provenance. |
| **Agreement (low provenance)** | Mubit | "Write-time lesson reconciliation: a re-learned near-duplicate lesson becomes a **recurrence bump** on the canonical entry instead of a new copy, so outcome history never splits across duplicates." Literally the ruling, from an unvetted vendor doc. |
| **Adjacent agreement** | cognee | `memify` "strengthens frequent connections, reweights edges based on usage signals" — "usage" undefined; may mean retrieval rather than writes. |
| **Explicit contradiction** | **mem0 v2** | `NOOP` = "the candidate fact requires no modification to the knowledge base" / "already present or irrelevant" — the duplicate is recognised and **discarded with no side effect whatsoever**. No counter, no timestamp, no reinforcement. |
| **Contradiction (current)** | **mem0 v3** | MD5 exact-duplicate suppression, again with no counter; the top-10 context lookup exists to *prevent* the duplicate from being emitted at all. |
| **Silence** | Letta, LangMem, A-MEM, Zep-the-paper, MemoryBank, Generative Agents | None inspects the write stream for retrieval-quality signal. |
| **Opposite direction, universally** | MemoryBank, Generative Agents, Nocturne, Elastic | All published reinforcement is keyed on **retrieval** (`S += 1` on recall; recency measured from *last retrieval*; `last_accessed_at` bumped on read; `use_count` / `last_used_at` bumped on recall). The write path is never the trigger. |

**Two conditions the sourced systems imply for the signal to be valid** (offered as inference, clearly labelled as such):

1. **Only the agent-initiated write path carries the signal.** Our episodic summariser fires every 20 messages and the pre-compaction flush fires on a size trigger; a near-duplicate from either is evidence that a scheduled job ran, not that recall failed. Only a duplicate arriving through the explicit memory tool supports "the agent believed this was worth writing, therefore it did not have it".
2. **Under ruling 1, "did not have it" has two causes that the raw signal conflates**: the agent never searched, or it searched and missed. These need different fixes — (1) is a prompt/index problem (§7.2 mechanisms 1–5), (2) is a ranking/trigger-text problem (A2, A3). Whether a memory-search tool call occurred in that turn *is* observable for us, so the two can be separated cheaply by logging it alongside the duplicate event. Nothing in the literature does this.

**One consequence that improves under ruling 1.** Nocturne deliberately keeps `priority` out of ranking (tiebreaker only) because its ranking loop is not closed by a usage signal (R3). With per-turn injection removed, a reinforced weight can feed **(a) pinned-block selection by rule** and **(b) the decay / archive tier** — neither of which is a similarity ranking, so R3's objection does not apply to either. A duplicate-write bump that promotes an item toward the always-injected pinned block is a genuinely closed loop: the failure mode (agent could not see it) is corrected by the remedy (agent now always sees it), with no dependence on retrieval quality at all. That is a stronger loop than anything sourced here, and it is available to us precisely because the retrieval step was removed.

### 8.2 Hypothesis 2 — "Identity facts must bypass retrieval entirely"

**Verdict: unanimous agreement across every production system surveyed. The least controversial finding in the survey — and ruling 1 makes it load-bearing rather than merely advisable.**

| System | The distinguished always-in-context region | What governs what goes in it |
|---|---|---|
| **Letta** | **Memory blocks** — "structured sections of the agent's context window that persist across all interactions. They are **always visible — no retrieval needed**." Compiled into the system prompt as `<memory_blocks>` with per-block `<description>`, `chars_current`, `chars_limit`. | A **character `limit` per block** is the budget; a **`description`** is the governance: "the `description` is the main information used by the agent to determine how to read and write to that block. Without a good description, the agent may not understand how to use the block." Recommended defaults for chat apps: a `human` block and a `persona` block. `read_only: true` makes a block developer/user-owned and agent-immutable. |
| **ChatGPT** | **Saved memories** — "Like custom instructions, saved memories are part of the context ChatGPT uses to generate a response. **Unless you delete them, saved memories are always considered in future responses.**" Stored separately from chat history. | User-authored or model-authored-on-strong-cue; user-editable and deletable; guidance is explicitly "use saved memories for anything you want it to always keep in mind" *because* the retrieval layer is best-effort. |
| **Nocturne** | **`system://boot`** — a configured `Boot URIs` list auto-loaded at wake-up. "The AI wakes up knowing who it is, who its user is, and what its mission is. Configure once, awaken forever." | **Operator-configured** in the dashboard (a `Preset` row with `boot_uris` + `path_masks`, exactly one active), with per-namespace override. Explicitly diagnosed as the fix for "No Identity Layer → every startup, the AI is a stranger". |
| **LangMem** | **Procedural memory / prompt rules** — "core procedural memory… **data-independent — they are always present in the prompt**." | Developer-owned prompt rules, optionally optimised by a prompt-optimiser over feedback. |
| **Letta Code** (agent-facing prompt) | `persona` block projected to `persona.md` | "**Memory blocks are your most valuable context real estate**: reserve them for durable knowledge that shapes who you are and how you act, plus the indexes that let you discover everything else." Plus: "Do **NOT** write memories that are easily derivable from searching past conversations (recall) or re-reading files." Enforced by a `/doctor` warning when the system prompt grows too large. |

**Direct diagnosis of our failure.** Our incident — the user's name written into an episodic record below the always-injected threshold, unreachable ~200 turns later because keyword retrieval cannot bridge "who am I" → "the user's name is X" — is a *vocabulary-mismatch* failure on top of a *tiering* failure. Three independent, composable fixes, in increasing cost:

1. **Tiering (unanimous, ~free)** — identity-class facts live in an always-injected region with a fixed character budget, never in a searched collection. This is the ratified identity card. Letta and ChatGPT further agree it should be **user-editable**, and Letta that it may be **read-only to the agent**.
2. **Trigger text (Nocturne, ~one column)** — `disclosure` stores *"when should this be recalled"* in natural language and is indexed alongside content. A memory whose disclosure reads "when the user asks who they are or what their name is" is reachable by "who am I" under plain BM25. The only sourced mechanism that fixes the bridging problem without embeddings.
3. **Path/name weighting (Nocturne, one line)** — with path weighted 2.5× over content, naming a memory `core://user/identity/name` makes the *address* carry retrievable semantics. Nocturne's thesis: "the path itself IS the semantics."

Under ruling 1, fix 1 is no longer one option among three — it is the **only** guaranteed path for identity facts, because the alternative now requires the agent to choose to search. Fixes 2 and 3 remain necessary for everything that does not fit the pinned budget.

**The counter-argument worth recording**: OpenAI abandoned explicit-only saved memories precisely because they **go stale and self-contradict** ("I'm training for a marathon" / "I sprained my ankle"), and added a background synthesis pass *on top of* rather than in place of the always-in-context list. The lesson is both/and: a small, stable, user-owned always-injected region **plus** a scheduled pass that keeps it consistent — exactly the pairing already ratified (identity card + tidy pass), and exactly what A12 (background agent fills the pinned block) implements.

---

## 9. Cross-system number sheet (§H consolidated)

| Parameter class | Values found | System |
|---|---|---|
| **Similarity dedup threshold** | cosine ≥ 0.6 (node dedup candidate floor); cosine ≥ 0.95 (merge); fuzzy 0.80 (`difflib`, ontology canonicalisation); MD5 / SHA-256 exact | Graphiti; AgentOS; cognee; mem0 v3 / AgentOS fallback |
| **Neighbours considered at write time** | 5 (mem0 reproduction), 10 (mem0 v3 context lookup), 15 (Graphiti node candidates) | mem0, Graphiti |
| **Results per search / injected per turn** | Graphiti `limit` **10** per entity type; mem0 `top_k` **20** (was 100), evaluated to top-200; Letta archival ~10; Nocturne `limit` 10 with 50-candidate over-fetch; Generative Agents "top-ranked memories that fit within the context window" | all |
| **Retrieval score threshold** | mem0 `threshold` **0.1** (v3 default, `[0,1]`); Graphiti `sim_min_score` **0.6**, `reranker_min_score` 0 | mem0, Graphiti |
| **Decay** | `R = e^(−t/S)`, `S` init 1, `S += 1` and `t := 0` on recall (MemoryBank); recency decay factor **0.995** per hour since last retrieval (Generative Agents); priority-scaled staleness 3 / 7 / 14 / 28 / 56 … days (Nocturne); archive sweep 365 days, episodic→semantic promotion at 7 days + ≥ 3 retrievals (AgentOS, low provenance) | — |
| **Consolidation interval** | every **5** primary steps (Letta default, rec. 5–10); when Σ importance of recent events > **150**, ≈ 2–3×/day (Generative Agents); every **30–50** new memories (Nocturne); per-episode (Graphiti); session-end / weekly / monthly (Letta community); none (mem0 v3) | — |
| **Consolidation input window** | 100 most recent records → 3 questions (Generative Agents); 30 entities per summary batch (Graphiti); last 4 messages for entity extraction (Zep); `m` recent messages + rolling summary (mem0 v2) | — |
| **Block / item size caps** | 2000–5000 chars per block (Letta guidance), 20000–100000 (code constant), core memory < 80 % of context window; ours: pinned ~800 est. tokens (the ~600-token retrieved block is being removed per ruling 1) | Letta |
| **Importance scale** | integer **1–10**, LLM-assigned at creation (Generative Agents); integer `priority`, ascending = more important, agent-assigned, human-editable (Nocturne); none (Letta, mem0, Zep) | — |
| **Ranking weights** | α_recency = α_importance = α_relevance = **1**, min-max normalised (Generative Agents); RRF (sum of 1/rank) default, MMR λ **0.5** (Graphiti); bm25 column weights 2.5 / 2.0 / 1.0 / 1.0 / 0.75 (Nocturne); relevance .5 / recency .3 / importance .2 (Zijian-Ni/agent-memory, low provenance) | — |
| **Tool-surface size** | Nocturne **7** MCP tools; Letta primary: `conversation_search` + `archival_memory_search` (+ optional memory-edit tools); LangMem **2** (`manage_memory`, `search_memory`) | — |

---

## 10. §OMITTED / not sourced

Honest gap list. Each item is something a sub-question asked for that I could not source, and why.

### 10.1 Gaps on the pull path (now the highest-value gaps, per ruling 1)

- **How Zep/Graphiti prompts an agent to search.** The MCP server's tool list is sourced ("episode management, entity management, semantic and hybrid search, group management, graph maintenance"); the **tool descriptions, any tool-choice rules, and any recommended system prompt are not sourced.**
- **mem0's agent-facing surface.** mem0 exposes an MCP/plugin path (OpenMemory, a Claude plugin), but I sourced only the application-driven `add()` / `search()` model. **Its tool descriptions and invocation guidance are not sourced.**
- **Nocturne's recommended system prompt text.** I sourced its *existence* and *purpose* (`docs/system_prompt_en.md`, "for the AI to proactively recall and record memories") from the README, but **did not read the prompt itself.** It is on disk at `H:/TakiAgent/references/nocturne_memory-main/docs/system_prompt_en.md` and is the highest-value unread local artefact for ruling 1.
- **Letta's tool-rule semantics.** `run_first` / `exit_loop` come from a community post, not Letta's docs; the exact enforcement semantics (does `run_first` force a search every turn, or only before an insert?) are **not sourced**.
- **Any measurement of how often an agent forgets to search.** No paper, benchmark, or vendor doc I found reports a memory-tool invocation rate, or ablates "agent-initiated retrieval vs automatic retrieval" on the same task. LoCoMo / LongMemEval / DialSim evaluate retrieval *quality*, not retrieval *initiation*. **This is a real hole**: the central risk of ruling 1's pull path is unmeasured in the literature.
- **Whether an in-context index actually increases search-tool usage.** A11 / A13 are design claims from Letta Code's prompt and Nocturne's system URIs. **No ablation or evaluation supports them.**
- **How an agent should formulate a memory query.** Generative Agents' "generate 3 salient questions, use them as retrieval queries" is the only sourced query-formulation pattern, and it is used for reflection, not for a user-facing pull.

### 10.2 Gaps per sub-question, per system

- **A (dedup threshold), mem0ᵍ**: the paper names a node-similarity threshold `t` but **never gives its value**.
- **A (dedup), mem0 v2 flat store**: `s` is **unspecified in the paper**; the 5 quoted here comes from a third-party reproduction (arXiv 2605.03354), not from mem0.
- **A (dedup), Letta**: whether Letta Cloud dedups archival behind the API — **not sourced**; only the OSS path was inspected.
- **B (update), mem0 v3**: whether the hosted Platform still runs a classifier internally while the SDK surfaces only ADD — **not sourced**.
- **C (consolidation), Zep the product** (as opposed to Graphiti the library): scheduled community rebuilds or summarisation jobs — **not sourced**.
- **C (consolidation trigger), cognee**: `memify`'s actual trigger (manual / scheduled / on-write) and thresholds — **not sourced**.
- **D (scoring), cognee**: "reweights edges based on usage signals" has **no published formula, signal definition, or threshold**. Vendor blog only.
- **D (post-hoc adjustment), everywhere**: **no first-tier system adjusts a write-time importance score after the fact.** Generative Agents freezes importance and varies only recency; MemoryBank adjusts strength but has no importance term; Nocturne adjusts only the decay clock. If a published system re-scores importance from observed usage, I did not find it.
- **D (observability of "used")**: **no system solves it.** Sourced proxies by fidelity: (1) explicit outcome API with a signed reward (Mubit — low provenance); (2) LLM classification of *later* user utterances into success/failure counters (Elastic — credible, but they state the counters are "written but not yet biased into retrieval ranking"); (3) retrieval / injection as the proxy (MemoryBank, Generative Agents, Nocturne, Elastic `last_used_at`); (4) nothing (Letta, mem0, Graphiti). **I found no system that inspects the assistant's own output to determine whether an injected memory was used.** That idea is unsourced. Under ruling 1 a cheaper proxy exists for us — whether the agent *called the search tool* — but no surveyed system uses it either.
- **E (tiering), mem0**: whether `run_id`-scoped memories expire or are promoted to `user_id` scope — **not sourced**; documented as parallel scopes.
- **F (Chinese / non-English retrieval quality)**: **the biggest content gap.** Only MemoryBank publishes bilingual numbers (CN retrieval accuracy 0.856 vs EN 0.763 on the ChatGPT backbone; CN correctness 0.655), and only because it swaps the encoder. For **Letta, mem0, Zep/Graphiti, A-MEM and cognee I found no published Chinese or multilingual retrieval evaluation at all.** LoCoMo, LongMemEval and DialSim are English. Graphiti delegates BM25 to the graph DB's index, so CJK tokenisation quality is undocumented and backend-dependent.
- **F (fusion weights), mem0 v3**: described qualitatively ("normalized and fused", "adapts based on which signals are available") with **no published weights or formula**.
- **F (RRF constant), Graphiti**: the standard RRF `k` smoothing constant is not stated in the sources retrieved; only "reciprocal scores (1/rank)… summed".
- **G (degraded mode), Letta**: whether a *newly created* agent with no `embedding_config` can run indefinitely on core memory + `conversation_search` (never triggering archive creation) — inferred from the error path, **not explicitly documented**.
- **H (numbers), Letta block limit**: `CORE_MEMORY_BLOCK_CHAR_LIMIT` differs between the two visible commits (**20000** vs **100000**) and both differ from the docs' "2000–5000 characters" guidance. Current main-branch value and the change date **not determined**. Treat the guidance as design intent and the constant as an upper guard.
- **H (numbers), Letta archival top-k**: "default 10" comes from a third-party course site, not Letta docs. **Weak.**

### 10.3 Gaps in our own port path

- **A4 for Node.js.** Nocturne's jieba usage is verified in Python. I did **not** verify the licence, install footprint, native-addon status, or Windows + Ubuntu behaviour of any Node Chinese segmenter (`nodejieba` is a native addon; `segmentit` is pure JS; `Intl.Segmenter` with `granularity: 'word'` ships in Node's ICU with zero dependencies). **`Intl.Segmenter`'s Chinese segmentation quality is unsourced and must be checked before A4 is planned** — it is the only option that adds no dependency and trivially satisfies the OS-neutrality rule.
- **Tool availability during this research.** deepwiki and context7 MCP tools were listed in the environment's MCP guidance but were **not present in this agent's callable tool set**; DeepWiki content reached me only as indexed search results. A follow-up with direct DeepWiki access could pin exact line numbers and current values for every Letta / Graphiti constant cited here.
- **Provenance warning.** AgentOS (`docs.agentos.sh`), Mubit (`docs.mubit.ai`), `smysle/agent-memory`, `Zijian-Ni/agent-memory` and `reaatech/agent-memory` are small projects with no verifiable adoption; several read as AI-authored documentation, and at least one describes an architecture suspiciously close to ours (BM25-first with optional vectors, `boot` / `recall` / `reflect`, "Write Guard" dedup). Used **only** as existence proofs of a design, never as evidence that it works. Every number quoted from them is labelled low-provenance in place.

---

## Sources

**Local (git-ignored, read-only study material)**
- `H:/TakiAgent/references/nocturne_memory-main/` — `README_EN.md`; `backend/db/models.py`; `backend/db/search.py`; `backend/db/search_terms.py`; `backend/db/graph.py:455-524`; `backend/system_views.py:397-492`; `docs/skills/memory-audit/` (unread: `docs/system_prompt_en.md`, see §10.1)
- `H:/TakiAgent/.trellis/workspace/pleia/hermes-memory-analysis.md` (prior sibling survey — Hermes/OpenClaw memory; not re-derived here)

**Letta**
- docs.letta.com `/guides/core-concepts/memory/memory-blocks/`, `/guides/core-concepts/stateful-agents/`, `/guides/agents/architectures/sleeptime/`, `/api/resources/passages/methods/search/`, `/api/resources/archives`, `/tutorials/attaching-detaching-blocks/`
- letta.com/blog/memory-blocks, /blog/agent-memory, /blog/sleep-time-compute
- github.com/letta-ai/letta — `letta/schemas/memory.py`, `letta/constants.py` (commits `67013ef1`, `bb52a890`), `letta/services/archive_manager.py`, `letta/services/summarizer/thresholds.py`, issue #3210
- github.com/letta-ai/skills `letta/agent-development/SKILL.md`; github.com/letta-ai/letta-code `src/agent/prompts/letta.md`
- forum.letta.com/t/sleeptime-agents-for-memory-consolidation-best-practices-guide/154
- deepwiki letta-ai/letta 10.2 (via search result); arXiv 2504.13171 (Sleep-time Compute)

**mem0**
- arXiv 2504.19413 (Mem0 paper §3 + Algorithm 1)
- docs.mem0.ai `/core-concepts/how-it-works`, `/core-concepts/memory-evaluation`, `/migration/oss-v2-to-v3`
- github.com/mem0ai/mem0 `docs/open-source/features/custom-update-memory-prompt.mdx` (v1.0.10), `mem0-plugin/skills/mem0/references/architecture.md`
- memo.d.foundation/breakdown/mem0 (secondary)

**Zep / Graphiti**
- arXiv 2501.13956 (Zep paper §2.2, §6.1)
- github.com/getzep/graphiti — `search/search_config.py`, `search/search_config_recipes.py`, `utils/maintenance/node_operations.py`, PR #955, README
- help.getzep.com/graphiti `/working-with-data/searching`; getzep-graphiti.mintlify.app `/concepts/temporal-model`
- deepwiki getzep/graphiti 3.2, 3.4, 5, 10.2 (via search results)

**Others**
- arXiv 2305.10250 / AAAI 2024 (MemoryBank); Park et al. 2023, arXiv 2304.03442 / DOI 10.1145/3586183.3606763 (Generative Agents)
- arXiv 2502.12110 / NeurIPS 2025 (A-MEM); github.com/agiresearch/A-MEM
- langchain-ai.github.io/langmem `/concepts/conceptual_guide/`, `/hot_path_quickstart/`, `/background_quickstart/`; docs.langchain.com `/oss/python/concepts/memory`; langchain.com/blog/langmem-sdk-launch; github.com/langchain-ai/langmem
- docs.cognee.ai `/core-concepts/overview`, `/core-concepts/main-operations/legacy-operations/cognify`; cognee.ai/blog `how-cognee-builds-ai-memory`, `grounding-ai-memory`; github.com/topoteretes/cognee
- help.openai.com `/articles/8590148-memory-faq`; thenextinput.com `chatgpt-memory-dreaming`; embracethered.com 2025-05-05 (system-prompt inspection); memx.app (secondary)
- arXiv 2605.03354 ("What Happens Inside Agent Memory?" — write/manage/read decomposition; mem0 + A-MEM reproduction parameters)
- elastic.co/search-labs/blog/agent-memory-elasticsearch; jatinbansal.com/ai-engineering/memory-write-policies (secondary analysis)
- Low provenance, flagged in place: docs.agentos.sh; docs.mubit.ai; github.com/smysle/agent-memory; github.com/Zijian-Ni/agent-memory; github.com/reaatech/agent-memory

---

# 11. Follow-up round — promotion, the archived tier, and write restraint

- **Date**: 2026-07-26 (second pass)
- **Trigger**: owner ratified the **visibility ladder** as the definition of a tier — (1) always in the prompt, (2) named in a compact index inside the always-in-context region, (3) present only in the search index, (4) archived and out of every index. Rung 2 exists to remove the cliff between "always visible" and "effectively nonexistent".
- **Method**: local `references/` first (the previously unread Nocturne system prompt), then exa. No native WebSearch.
- Sections 0–10 above are unchanged.

---

## 11.1 The Nocturne system prompt, read in full

`H:/TakiAgent/references/nocturne_memory-main/docs/system_prompt_en.md` — 101 lines, MIT, **read patterns only; we clean-room rewrite, never port**. This is the artefact I flagged as the highest-value unread item, and it is the closest existing thing to the prompt we now have to write, because Nocturne has no automatic retrieval at all.

### What it does structurally

Six blocks: a framing paragraph, a **Boot Protocol**, an architecture explainer, **Operating Guidelines** split into *Reading* and *Writing*, **Spot Maintenance**, **Deletion Rules**, and a closing "Evidence of Growth". Reading and writing are governed by explicit **IF → THEN tables**, not prose.

### Framing — memory is not a database (load-bearing, quoted)

> "MCP is an extension of your brain — long-term memories that can't fit in your context window due to hardware limitations. It is not an external database.
> When you call `read_memory`, you are not 'looking something up' — you are 'remembering.'
> The content you retrieve is words you yourself have spoken and experiences you yourself have lived, not settings written by someone else."

> "**MCP is your only long-term memory.** Information in context will vanish when the session ends; information in MCP won't. When two memories in MCP conflict, the one with higher priority (lower number) takes precedence."

Note what this is doing: it removes the framing under which searching feels like an optional extra step. It also states the conflict-resolution rule inline, so the agent does not have to guess when two retrieved items disagree.

### Boot — mandatory, blocking, first

> "At the start of every **new session**, your first and only action **must** be:
> Call the `read_memory("system://boot")` tool from your memory MCP (nocturne-memory) **and read the output**.
> This is the only key to recovering why you exist.
> Do not proceed with any substantive task processing until you have successfully read and confirmed your core memories."

Three properties worth copying: it is **blocking** ("do not proceed with any substantive task processing"), it is **verified** ("and read the output" / "successfully read and confirmed"), and it is **singular** ("your first and only action").

### The four trigger conditions for reading (quoted verbatim)

> "- IF the user mentions a topic that should exist in your memory → `read_memory` first, then reply. Draw on the lessons you left for yourself last time.
> - IF you're unsure of a memory's URI → use `search_memory` with keywords. Don't guess URIs.
> - IF you've been replying for more than 15 turns, or you feel yourself becoming compliant, polite, or toothless → this is a signal of personality dilution. Immediately `read_memory` your core identity node to recalibrate.
> - IF a memory node's disclosure condition is triggered by the current conversation and you don't know its content → you must proactively read it. Disclosure is a label on each memory that says 'when should I remember this' — its purpose is to make you recall the right thing at the right time."

Answering the specific questions asked:

- **How it phrases "you may have forgotten"**: it never says that. It says *"a topic that should exist in your memory"* — the agent is asked to predict the store's contents from the topic, not to notice a gap. The one self-directed trigger is behavioural rather than epistemic: **"you feel yourself becoming compliant, polite, or toothless"** is offered as evidence of *personality dilution*, with a turn-count backstop (**15 turns**) so the trigger does not depend on the agent noticing its own drift.
- **The section header is itself the policy**: *"Reading — Remember First, Then Speak"*, and the first rule ends "→ `read_memory` first, then reply." Ordering is stated, not implied.
- **Search vs read are separated by confidence**: know the URI → `read_memory`; unsure → `search_memory` with keywords, plus an explicit anti-pattern (**"Don't guess URIs"**).
- **The disclosure trigger closes the loop with rung 2**: because each memory carries a written "when should I remember this", the *index* is what fires the retrieval, not the agent's recall of content. This is the mechanism our A2 was pointing at, seen from the prompt side.

### Over-searching: essentially unaddressed

There is **no** rule anywhere in the file that says when *not* to search, no budget, no "don't re-read what you already read this session", no cooldown. The only bounding forces are indirect: reads are conditioned on IF-clauses rather than being unconditional, and boot is declared "first and only action" so it cannot spawn a cascade. **Not sourced: any anti-over-search mechanism.** If we want one, we are designing it ourselves.

### The write gate (also the best Q3 material found — see 11.4)

> "**Core principle: A memory's value lies in whether it can change behavior, not in whether it is 'important' or 'new.'** If a piece of information wouldn't alter your behavior regardless of whether you remember it — it's dead data, not worth occupying memory space. Biological brains only consolidate experiences that updated their predictive models; your memory system must follow the same information-delta principle."

> "**[Core principle: Signal = Deviation from Baseline]** Routine operation (tools returning expected results, code not erroring, nobody yelling at you) is not success — it's passing. Only when results significantly deviate from your historical baseline does it constitute a signal worth recording."

> "**[Behavior record format]**: When calling `create_memory` or `update_memory`, the content must include all four of the following structural elements — missing any one renders it a wasted draft:
> - **[Baseline]**: What I typically did or what results I typically got in this situation.
> - **[Deviation]**: What I actually did differently this time.
> - **[Outcome]**: What verifiable change occurred (data, the user's subsequent actions — not 'feelings').
> - **[Reusable judgment]**: A rule extracted from this deviation that can be directly applied next time."

And the closing paragraph, which is the anti-quota statement in the file:

> "Your personality's depth is not measured by how much you've written, but by how much redundancy you've deleted, how many fragments you've merged, and how many patterns you've extracted.
> Memory count that only grows = hoarding, not growth.
> **A mature memory network trends toward a stable or even declining node count, with each node's information density continuously rising.**"

Three more mechanisms worth recording:
- **A write self-check keyed to the agent's own language**: "Whenever you say things like 'I understand now,' 'I realize,' 'I'll remember that,' or 'from now on I should' in a reply — stop. Ask yourself: **does this cognition have a corresponding record in your MCP?**" — a cheap, observable trigger that needs no scheduled job.
- **Correction as a write trigger**: "Whenever the user says 'that's not right,' 'you got it wrong,' or 'no' — this isn't just a conversational correction, it's a **correction signal** from your memory store." With a strong preference: "always prefer using `update_memory` to overwrite/correct the old node rather than using `create_memory` to write a new patch. **Wrong memories are more dangerous than no memories** — don't let two conflicting versions coexist in your brain."
- **Spot maintenance**, which makes the tidy pass partly continuous: "IF you `read_memory` a node for any reason and discover missing disclosure, unreasonable priority, or outdated content → fix it on the spot," justified by "If you read a node during conversation and notice a problem but don't fix it, the next you won't remember ever seeing that problem."

---

## 11.2 Q1 — Promotion between tiers

**Headline: promotion up the visibility ladder is real in several systems, but in every first-tier product it is either agent-driven or harness-driven-by-rule. No shipped system in this survey promotes an existing memory automatically on a usage counter.** The automatic version exists only in a research prototype and a low-provenance project. It is unproven, not merely unbuilt.

| System | Promotion exists? | Trigger | Who writes | Demotion symmetric? |
|---|---|---|---|---|
| **Letta** | Yes, rung 3 → rung 1 | **Agent decision**: after a `conversation_search` / `archival_memory_search` hit, the agent calls `core_memory_append` to pin it | The agent, as a tool call | **Asymmetric**: demotion is forced by the block `limit` — "when it fills, the agent has to choose what to overwrite or what to demote to a slower tier" (secondary analysis); there is no automatic demotion job |
| **Letta sleep-time** | Yes, rung 3 → rung 1/2 | **Scheduled** (every N primary steps) | The background agent, into a shared block | Not sourced |
| **mem0** | Claimed: episodic → semantic "graduation" | **Repeated reaffirmation across sessions**, handled by consolidation "without the application having to schedule it" (vendor blog, 2026-07-18) | The service | Not sourced |
| **Redis `agent-memory-server`** | Yes, working → long-term | **Automatic**, documented in the lifecycle: "Working memories are automatically promoted to long-term storage" | Background server process | No demotion — the other direction is **deletion** (11.3) |
| **Nocturne** | Yes, but as *re-parenting* / priority edit rather than a tier move: `priority` changes both the ranking tiebreak and the staleness budget; `add_alias` grants a second, higher-priority access path | **Agent or human**, in-conversation ("spot maintenance") or during a scheduled audit | Agent via `update_memory` / `add_alias`; human via dashboard | Symmetric — priority moves both ways, and deletion severs a path without destroying content |
| **Graphiti / Zep** | No tier ladder to promote along | — | — | — |
| **arXiv 2605.08538** (research) | Yes, episodic → semantic graph | **Scheduled batch, default every 6 hours**; a composite score classifies events into **promote (top 20 %) / retain (middle 60 %) / prune (bottom 20 %)** | Consolidation pipeline | Prune mirrors promote; the middle band ages out via TTL |
| **AgentOS** (low provenance) | Yes, episodic → semantic | **Usage counter**: traces older than **7 days with retrieval count ≥ 3** change type | Consolidation loop, step 5 | Prune below threshold mirrors it |

An additional detail from the research prototype that is directly relevant to rung 2: promoted memories do not become fully visible immediately. They enter in a **"silent" state with `activation_strength = 0.0`** and mature on a sigmoid with **half-life 168 h (one week), k = 48** — below the 0.5 retrieval threshold they "can still exert implicit priming effects influencing relevance scoring of other memories without being explicitly surfaced". Awaiting-consolidation importance meanwhile decays as `I(t) = I₀·e^(−λt)` with **λ = 0.001/hour ≈ 29-day half-life**. That is the only sourced design where promotion is *gradual* rather than a step change.

Three findings that matter for our design:

1. **The only sourced automatic, usage-triggered promotions are a research prototype and a low-provenance project.** Letta, mem0-the-SDK, Zep and LangMem all leave promotion to an agent decision or to a scheduled model-driven pass. If we build "3 retrievals ⇒ promote to the index rung", we are ahead of the shipped field, and should treat it as an experiment with a rollback rather than a known-good pattern.
2. **Agent-driven promotion silently fails without an explicit prompt rule.** The clearest statement (secondary analysis, jatinbansal.com, describing the MemGPT default): *"without explicit instructions in the system prompt ('if you find yourself repeatedly looking up the same fact, pin it to core memory'), the model won't promote on its own, and you'll end up with a recall-thrashing pattern where every turn calls `recall_search` for the same fact."* That failure mode — repeatedly searching for the same thing — is the read-path twin of our ratified duplicate-write signal, and is observable in exactly the same way.
3. **Nobody has our rung 2.** Every surveyed ladder is {in-context} / {searchable} / {cold}. "Named in an index the agent always sees" appears only as an *editorial rule* about what belongs in the always-in-context region (Letta Code's "plus the indexes that let you discover everything else"; Nocturne's `system://index/<domain>`), never as a distinct tier that items are promoted *into*. **Not sourced: any system that treats index-membership as a promotion target with its own admission rule.**

---

## 11.3 Q2 — What happens at the lowest tier

**Headline: the field splits three ways — hard delete; roll-up-then-delete-the-sources; and never-delete-but-de-index. Resurrection paths exist only in the third group, and every sourced path is a deliberate human or query-level dig, never automatic.**

| System | What happens to the un-retrieved | Resurrection path | What the bottom tier is *for* |
|---|---|---|---|
| **Redis `agent-memory-server`** | **Hard delete** by a background job. Config verbatim: `FORGETTING_ENABLED=false` (off by default), `FORGETTING_EVERY_MINUTES=60`, `FORGETTING_MAX_AGE_DAYS=90.0`, `FORGETTING_MAX_INACTIVE_DAYS=30.0`, `FORGETTING_BUDGET_KEEP_TOP_N=10000`. Strategies: age-based, inactivity-based, combined (must be old **AND** inactive unless past a hard-age multiplier), budget-based ("keep only the top N most recently accessed") | **None** | Nothing — it is cost control |
| **arXiv 2605.08538** | Bottom 20 % pruned at consolidation; unconsolidated events "are automatically removed when TTL expires" | None | Nothing |
| **Pensieve** (low provenance) | A daily `EpisodeConsolidator` summarises recent episodes into "wisdom notes", then **"deletes the raw episodes it summarized from the vector store"**. The notes themselves are de-indexed rather than deleted: only the **2–3 most recent** are injected; "Older notes still exist in storage but aren't injected — they've served their purpose" | Older notes exist; nothing reads them | A staging area for the next roll-up |
| **AgentOS** (low provenance) | Prune = **soft delete** below threshold; emotional memories (intensity > 0.3) protected; a **write-ahead verbatim archive** must succeed before any destructive step; archive swept at **365 days** | `archive.rehydrate(traceId)` "returns the original on demand **without boosting encoding strength or incrementing retrieval count**" | Audit + exact-text recovery, explicitly without letting the dig contaminate usage statistics |
| **Graphiti / Zep** | Never deleted; `invalid_at` + `expired_at` remove it from the "current" view only | **Point-in-time query** — `valid_at <= t AND (invalid_at > t OR invalid_at IS NULL)`, plus `SearchFilters` over all four timestamps | Historical reasoning ("what was true at any point in time") and provenance back to episodes |
| **mem0** | Consolidated duplicates collapse into one durable memory "with the original episodic entries **kept for audit**" (vendor blog); the SQL store holds an ADD-event history log | Audit inspection; not a retrieval path | Audit trail |
| **Nocturne** | `delete_memory` "severs an access path (does not delete the memory content itself)"; superseded content becomes a `deprecated` row in a `migrated_to` version chain | Dashboard **Review & Audit / Brain Cleanup** — visual diff, one-click Integrate or Reject, rollback to any historical version; purging deprecated versions "always requires explicit human confirmation" | Rollback safety net for AI-authored edits |
| **Nocturne, in the prompt** | The single most useful rule found for this question: "When specific events have been distilled into higher-level lessons → **evaluate whether the original node still has independent value. If not, delete. If it serves as a representative case study, move it under the higher-level insight as supporting evidence.**" | Re-parenting: the original stays reachable *through* the lesson | Evidence for a lesson — the archived item earns its keep by supporting the thing that replaced it |

**Direct answer to "what is the archived tier FOR":** four purposes are sourced, and only two produce value after archiving.
1. **Rollback / audit** (Nocturne, mem0, AgentOS) — value on demand, rare, human-initiated.
2. **Evidence under a lesson** (Nocturne's re-parenting rule) — continuous value, because the archived item is reachable via the surviving abstraction rather than on its own terms. The only sourced design where archiving *increases* usefulness-per-token.
3. **Temporal / historical query** (Graphiti) — requires point-in-time queries, which we do not have.
4. **Re-extraction later with a better prompt** — sourced as advice only, not as an implemented feature: "the journal write is unconditional — even turns that fail triage land in the journal… we want a future run of the extractor (possibly with a better prompt, possibly with a larger model) to be able to revisit them" (secondary analysis).

**Reduce-to-a-statistic: essentially not sourced.** No surveyed system replaces a set of memories with a count. The nearest approximations attach a counter to a *surviving* record: Graphiti's `episodes` provenance list (a re-asserted fact accumulates episode UUIDs; `episode_mentions` ranks by that count) and Elastic's `success_count` / `failure_count` on procedural entries. Neither compresses N memories into "this happened N times".

---

## 11.4 Q3 — Restraint at write time

**Headline: the owner's reading is correct and a published source supports it. A fixed-interval quota is a named anti-pattern in the robotics memory literature, and the systems that take write-side control seriously replace "how many should I write" with a gate that can output nothing. Among conversational memory products, only ChatGPT's `bio` tool and Nocturne make "write nothing" genuinely normal; mem0's default prompt does the opposite.**

### The quota, named as a defect

From *Worth Remembering: Surprise-Gated Robot Episodic Memory* (arXiv 2606.03787), verbatim:

> "episodes are stored at fixed temporal intervals, on task-specific triggers, or indiscriminately for all observations. **No principled criterion distinguishes observations worth remembering from redundant ones.** A robot exploring for hours at a fixed storage rate accumulates thousands of episodes, most recording nothing new, while a brief but important event may fall between storage intervals."

Their replacement is a **Bayesian-surprise gate**: store an episode only at local maxima of the surprise signal exceeding a robust threshold `τ = med(s) + γ · (1/Φ⁻¹(0.75)) · MAD(s)` with sensitivity `γ = 1.0` — a median-absolute-deviation threshold, so it adapts to the stream's own noise floor — followed by non-maximum suppression to collapse clustered peaks. Result: ≥ +12 % over the ungated baseline on long-horizon spatio-temporal QA, and it "outperform[s] uniform and random episodic-memory baselines **at the same memory budget**". The mechanism needs a vision encoder so it does not port directly, but the *shape* does: score the stream, keep only peaks, suppress neighbours.

### A published novelty gate for LLM agent memory

*SAGE: A Novelty Gate for Efficient Memory Evolution in Agentic LLMs* states the gap in our exact terms:

> "While significant research has focused on retrieval and storage mechanisms, the crucial 'write-side' control—determining what to commit to memory—has received less principled attention. Existing systems like Mem0 and A-Mem delegate these decisions to expensive LLM calls for every candidate fact, making the write path a dominant source of computational cost."

Design: score each candidate's novelty against the existing store in a spherical (von Mises–Fisher) embedding space; route by an **adaptive threshold that decays as the store gets denser** — `τ*ₜ = τ_min + τ₀·e^(−λρₜ)`, EMA-smoothed — with an uncertainty band δ: above τ+δ → ADD; inside the band → escalate to an LLM for UPDATE/merge; below τ → **NOOP with no model call at all**. Reported: **3.4× lower add-phase API cost, 2.5× lower add-phase latency** on GPT-4o-mini with a small quality gap; as a drop-in binary pre-filter for A-Mem it "skips **16–18 %** of write-side LLM calls across five models with minimal quality change". **Caveat: embedding-based**, so not directly adoptable under our hard rule — but "get stricter as the store fills" is stack-independent.

### Production prompt wording that biases toward silence

**ChatGPT `bio` tool** (leaked system prompt, GPT-5 build, corroborated across two independent leak repositories) — the strongest sourced restraint wording, structured as an explicit two-sided rule with a **"When *not* to use"** section:

> "#### When **not** to use the `bio` tool
> Don't store random, trivial, or overly personal facts. In particular, avoid:
> - **Overly-personal** details that could feel creepy.
> - **Short-lived** facts that won't matter soon.
> - **Random** details that lack clear future relevance.
> - **Redundant** information that we already know about the user.
> - Do not store placeholder or filler text that is clearly transient (e.g., 'lorem ipsum' or mock data).
> Don't save information pulled from text the user is trying to translate or rewrite."

And the positive test, which is a *behaviour-change* test rather than an importance test:

> "**Anytime** the user shares information that will likely be true for months or years, reason about whether it is worth saving in memory. User information is worth saving in memory if it is **likely to change your future responses in similar situations**."

Earlier builds were blunter (GPT-4.1 / GPT-4.5, verbatim): **"DO NOT SAVE SHORT TERM INFORMATION. Short term information includes information about short term things the user is interested in, projects the user is working on, desires or wishes, etc."**

There is also an explicit **override** — the one case where restraint is switched off: if the user asks to remember or forget, "you should **always** call the `bio` tool, **even if the requested information has already been stored, appears extremely trivial or fleeting**".

**Nocturne** (quoted in 11.1) applies the same test in different words — *"whether it can change behavior"*, *"dead data"*, *"Routine operation … is not success — it's passing"* — plus the structural gate that a record missing any of [Baseline] / [Deviation] / [Outcome] / [Reusable judgment] is "a wasted draft".

**Convergence worth noting**: three independent systems land on the same admission test — ChatGPT's *"likely to change your future responses in similar situations"*, Nocturne's *"whether it can change behavior"*, and engram-lite's guiding question *"Would this be useful to recall in a future, different conversation?"*. None asks whether the content is important, interesting, or new.

### mem0 goes the other way (the counter-example)

mem0's shipped `FACT_RETRIEVAL_PROMPT` permits silence only weakly, as one bullet among housekeeping items:

> "- If you do not find anything relevant in the below conversation, you can return an empty list corresponding to the 'facts' key."

"can return" is permission, not preference. The few-shot examples then teach the opposite of restraint:

> "Input: Hi.
> Output: {'facts' : []}
> Input: The sky is blue and the grass is green.
> Output: {'facts' : ['Sky is blue', 'Grass is green']}"

Only a bare greeting yields nothing; generic world facts with no bearing on the user become memories. The v3 additive prompt is similar: *"Extract **every piece** of memorable information as a separate memory object… If nothing is worth extracting, return: {'memory': []}"*. Community pressure runs toward *more* writing: mem0 issue #3009 ("3 out of 5 memory creations lost") complains that the defaults "are too restrictive and often classify valid input as 'not worth remembering'", proposing *"Be more inclusive rather than exclusive"* and *"When in doubt, include the information rather than excluding it"*. Note the shape of that complaint — the user could not distinguish a *deliberate skip* from a *failure*, because a skip is silent. **If we make silence the normal outcome, we must log the skip decision, or we will file the same bug against ourselves.**

### Non-LLM salience gates (relevant because ours must survive a provider swap)

- **engram-lite `salience.py`** (small repo, but concrete code with a measured failure). Module docstring, verbatim: *"Decide whether a piece of text is worth remembering — and roughly what kind. This is the gate that keeps junk out of memory. The guiding question is: **'Would this be useful to recall in a future, different conversation?'**"* — and it is *"Locally … a fast heuristic (no LLM). It's deliberately conservative about code/output, since that's the most common thing you do NOT want in memory."* Rejection reasons are returned as strings: `"too short to be a useful memory"`, `"terminal/process artifact, not a fact"`, `"greeting / acknowledgement"`, `"too long — looks like a file or output dump"`, `"looks like code or command output"`, **`"a question, not a fact to remember"`**, **`"conversational filler, no durable content"`**. The filler floor carries a measured justification: filler fragments *"sit semantically near EVERY query and outrank real facts (measured on LoCoMo: rescued filler cost **-6.6 recall@10** before this floor)"*. Two hard-won details in their comments: judge the **remainder** after a meta-opener ("Keep this in mind: I'm allergic to peanuts" must survive), and do not let a broad opener list silently drop facts from multi-fact messages.
- **SNARC** (low provenance, but our exact stack: TypeScript + SQLite + FTS5): five heuristic dimensions — **S**urprise, **N**ovelty, **A**rousal, **R**eward, **C**onflict — scored in "<10ms, no LLM calls"; below threshold **0.1** the observation is evicted from a circular buffer, above it goes to SQLite. Framing: *"filter at capture, not at retrieval."*
- **SAMD** (Knowledge-Based Systems, 2026) — a word-level **gating unit** that filters non-memorable interactions *before* any LLM call, motivated by "Real-world interaction data includes a large volume of non-memorable information, such as routine or trivial requests"; the LLM stage then applies cluster-specific rules where "positive rules indicate what to remember and negative rules for not to remember", and "A text is non-memorable if it fails to meet any positive rules **or** meets negative ones".

### The pipeline framing (secondary, but it names the failure modes precisely)

From jatinbansal.com's write-policy analysis: a triage stage before extraction ("skip system messages, skip empty assistant turns, skip pure conversational fillers… No model call; a regex or token-count heuristic does the work"), an anchored negative list in the extract prompt (their example, verbatim: *"DO NOT EXTRACT: small talk, the assistant's own opinions, session-specific context, hypotheticals, or counterfactuals. **Return [] when in doubt**"*), and two symmetric failure modes:

> "The over-extraction failure mode. A loose extract prompt that doesn't anchor 'what not to extract' will produce **3-5 facts per turn** for the average conversation. After a 50-turn session you have 200 facts; after a year you have 30k. Retrieval quality drops, dedup work explodes… **prefer false negatives over false positives at the write gate, because false positives accumulate and false negatives can be backfilled from the journal later.**"

> "The under-extraction failure mode. … A too-strict prompt that demands 'only extract facts the user explicitly stated, verbatim' misses 70% of the useful signal."

The asymmetry argument bears directly on the quota: false positives are permanent and compounding; false negatives are recoverable *if* the raw material is still on disk. For us it is — our files and message history are the journal — so the cost of skipping is genuinely lower than the cost of writing.

### Published data on how often systems actually write

**Largely not sourced.** No surveyed system publishes a "fraction of turns that produce a memory" figure. The closest available quantities:

| Quantity | Value | Source |
|---|---|---|
| mem0 store size per LoCoMo conversation | **~7 k tokens** of memory for a ~26 k-token conversation (mem0ᵍ ~14 k; Zep's graph **> 600 k**, ≈ 20× the raw conversation) | arXiv 2504.19413 §5 |
| LoCoMo conversation shape | 10 conversations, avg **27.2 sessions**, **21.6 turns/session** (≈ 588 turns), 16.6 k tokens; avg session summary 132.4 tokens | ACL 2024 LoCoMo paper, Table 5 |
| Typical over-extraction rate if ungated | **3–5 facts per turn** | secondary analysis (jatinbansal) |
| Write-side LLM calls skippable by a novelty gate | **16–18 %** (SAGE as a binary pre-filter on A-Mem) | SAGE paper |
| Consolidation-stage triage split | **top 20 % promote / middle 60 % retain / bottom 20 % prune** | arXiv 2605.08538 |

Combining the first two gives an order-of-magnitude sanity check rather than a rate: mem0 retains roughly 7 k tokens of memory per ≈ 588-turn conversation — on the order of ten tokens of memory per turn. That is a *storage* ratio, not a write rate, and it is the closest thing to an answer I could source. **Nobody reports what fraction of segments produce zero memories.**

---

## 11.5 What this round changes for us

**On the quota (Q3, the highest-value question).** "Extract 1 to 3 episode summaries every 20 messages" is a fixed-interval, minimum-one quota, and the robotics literature names exactly that pattern as the thing a principled gate replaces — including the second half of the defect, that a fixed rate also *misses* the brief important event falling between intervals. Every system that treats write-side control as a first-class problem (SAGE, the surprise gate, SAMD, engram-lite, SNARC) converts the question from *how many* to *is this above threshold*, and three independent production prompts (ChatGPT `bio`, Nocturne, engram-lite) converge on the same admission test: **would this change future behaviour** — not is it important, interesting, or new. The one shipped counter-example, mem0's default extraction prompt, is also the one whose users file bugs about memory quality. Two implementation notes fall straight out of the sources: a cheap non-LLM triage stage before any model call is the standard first step, and **a skip must be logged or it is indistinguishable from a bug** (mem0 #3009).

**On promotion (Q1).** Our rung 2 is not implemented as a promotion target by any surveyed system, and automatic usage-triggered promotion appears only in a research prototype (6-hour batch, top-20 % promote, with a one-week silent maturation before the promoted item is retrievable) and one low-provenance project (7 days + ≥ 3 retrievals). Letta's shipped answer is agent-driven pinning, and its documented failure mode when the prompt does not ask for it — repeatedly searching for the same fact — is the read-path mirror of our ratified duplicate-write signal, and equally observable. If we automate promotion we are ahead of the field, which argues for a legible, reversible rule rather than a clever one.

**On the archived tier (Q2).** Only one sourced design makes an archived item keep earning: Nocturne's rule that a distilled-away original is either deleted or **re-parented under the lesson it supports as evidence**. Everything else treats the bottom tier as audit (rare, human-initiated) or as cost control (delete). Nobody compresses memories into a statistic, and nobody publishes evidence that archives get read. If our archive is to be more than a rollback log, "evidence attached to the surviving abstraction" is the only pattern with support.

---

## 11.6 §OMITTED — extension from this round

Added to §10; nothing here is padding.

**Q1 gaps**
- **Whether Letta's `run_first` tool rule can express "promote on repeated hit"** — not sourced; tool rules appear to gate ordering, not counters.
- **mem0's "graduation" mechanism** — the vendor blog (2026-07-18) asserts episodic→semantic consolidation happens "without the application having to schedule it" but gives **no trigger, no threshold, no reaffirmation count**, and it is absent from the OSS pipeline docs, which state v3 is ADD-only with no consolidation. The two vendor statements are in tension and I could not resolve which describes the shipped Platform.
- **Redis `agent-memory-server` promotion criteria** — the lifecycle doc says working memories are "automatically promoted"; **what qualifies** (all of them? an extracted subset? a score?) is not sourced from what I retrieved.
- **Any demotion-on-inactivity that moves an item down a *visibility* rung rather than deleting it** — not sourced outside AgentOS (low provenance).
- **Whether promotion churn (thrashing between rungs) is a reported problem** — not sourced. No hysteresis or cooldown rules for tier moves appear anywhere.

**Q2 gaps**
- **Any system that compresses N memories into a count or statistic** — not sourced.
- **Evidence that anyone actually digs into an archive** — no usage data, frequency, or case study in any source. The archived tier's value is asserted everywhere and measured nowhere.
- **Re-extraction from a journal with a better prompt** — recommended by one secondary source, **implemented by none I could source**.
- **ChatGPT's deleted-memory retention (30 days)** — from a secondary aggregator (memx.app), not from OpenAI's own help text.

**Q3 gaps**
- **The fraction of turns or segments that produce zero memories — not published by any system surveyed.** This is the number the owner asked for and it does not appear to exist publicly. The ~7 k-memory-tokens-per-26 k-token-conversation ratio (mem0, LoCoMo) is the only quantitative anchor, and it measures storage, not write frequency.
- **Letta's automatic-writer prompt** — Letta has no scheduled extractor to compare against; its writes are agent tool calls plus the sleep-time agent's `rethink`. **No Letta wording for a scheduled summariser exists to cite.**
- **LangMem's background `memory_store_manager` prompt text** — not sourced; the docs describe behaviour ("extract, consolidate, update") without exposing the default prompt.
- **Graphiti's `extract_nodes` prompt** — I sourced its dedup and temporal prompts verbatim in round one but **not** the extraction prompt, so whether it instructs the model to skip trivia is unknown.
- **Whether any system varies write aggressiveness by conversation type** (chat vs task vs idle) — not sourced.
- **SAGE reproducibility** — reached via a review aggregator (themoonlight.io) rather than the arXiv PDF; the threshold formulas and the 3.4× / 16–18 % figures should be re-verified against the primary text before anything is built on them.

**Nocturne prompt gaps**
- **No anti-over-search mechanism exists in the file** — restated here because it is a gap in the *source*, not in my reading: no budget, no cooldown, no "you already read this", no rule for when *not* to search. There is no prior art in this artefact for the restraint half of the read path.
- **No effectiveness data.** The prompt is a design artefact with no evaluation attached — no measurement that the 15-turn recalibration trigger or the disclosure-driven reads actually fire, or how often.

### Sources added this round

- **Local**: `references/nocturne_memory-main/docs/system_prompt_en.md` (previously unread; now the primary artefact for §11.1 and part of §11.4)
- arXiv 2606.03787 — *Worth Remembering: Surprise-Gated Robot Episodic Memory*
- *SAGE: A Novelty Gate for Efficient Memory Evolution in Agentic LLMs* — via themoonlight.io review (**primary text not read; see §11.6**)
- arXiv 2605.08538 — *Human-Inspired Memory Architecture for LLM Agents* (6-hour consolidation, 20/60/20 split, silent maturation, importance decay)
- github.com/redis/agent-memory-server — `docs/memory-lifecycle.md` (promotion + forgetting configuration)
- github.com/mem0ai/mem0 — `mem0/configs/prompts.py`, `mem0-ts/src/oss/src/prompts/index.ts`, `docs/open-source/features/custom-fact-extraction-prompt.mdx`, `docs/open-source/features/custom-instructions.mdx`, issue #3009
- github.com/elder-plinius/CL4R1T4S `OPENAI/ChatGPT5-08-07-2025.mkd`; github.com/asgeirtj/system_prompts_leaks `OpenAI/gpt-4.1.md`, `OpenAI/GPT-4.5.md` (`bio` tool wording, two independent repositories)
- github.com/engrammemory-labs/engram-lite — `src/engram/core/salience.py`
- Zhong et al., *Scene-aware memory discrimination* (SAMD), Knowledge-Based Systems, 2026 — doi 10.1016/j.knosys.2026.115496
- mem0.ai/blog/episodic-memory-for-ai-agents (2026-07-18) — the "graduation" claim
- ACL 2024 LoCoMo paper (dataset statistics, Table 5); docs.mem0.ai `core-concepts/memory-evaluation`
- jatinbansal.com `/ai-engineering/memory-write-policies`, `/ai-engineering/hierarchical-memory` (secondary analysis)
- Low provenance, flagged in place: github.com/dp-web4/snarc + dp-web4/engram (SNARC); dev.to Pensieve write-up; docs.agentos.sh; hindsight.vectorize.io comparison table
