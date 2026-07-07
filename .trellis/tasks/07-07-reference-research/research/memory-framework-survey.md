# Research: Agent Memory Framework Survey (companion + persona-roleplay)

- **Query**: PRD question 4 — survey the wider agent-memory field for a companion/roleplay agent; re-evaluate nocturne-on-VPS honestly; define "soul" composition; recommend a path compatible with ADR 0001/0004.
- **Scope**: external (web, 2025-2026 state) + internal architecture cross-check.
- **Date**: 2026-07-07
- **Builds on**: `research/nocturne-memory-analysis.md` (Nocturne = 4-layer graph, FTS5 bm25, 7 MCP tools, stdio/SSE/HTTP, MIT). This file does NOT redo Nocturne internals; it places Nocturne in the field and re-weighs the VPS proposal.

> **Product frame (load-bearing).** TakiAgent is a **Companion + persona-roleplay** desktop pet. Memory must serve two things simultaneously: **(a) longevity** — recall events from weeks/months ago, remember promises, agreed rules, relationship milestones; **(b) roleplay quality** — memory + system prompt jointly form the agent's "soul"; the persona must stay *stable* while accumulating *shared history*. This is a different optimization target than a coding agent (Letta) or an enterprise knowledge graph (Zep). The evaluation below is weighted for it.

> **Architecture constraints we must respect** (from `docs/TECH-STACK.md`, ADR 0001, ADR 0004):
> - Single-TS-process Agent Core (Node 24), footprint budget 150-250MB total with rendering (ADR 0001).
> - Planned memory substrate already decided: **Markdown-in-Workspace + `node:sqlite` FTS5, OpenClaw-style** (TECH-STACK.md:17). Vector search explicitly deferred.
> - **Single-owner data pattern** (TECH-STACK.md:64-65): the Agent Core is the only reader/writer of the DB; clients query over the WS API.
> - MCP client is `@ai-sdk/mcp`, **stdio + HTTP transports** (TECH-STACK.md:13,16). Verified below.

---

## 1. Framework candidates

### 1.1 mem0 (+ OpenMemory MCP)

- **Memory model**: LLM-extracted salient facts from message pairs; v3 algorithm is **single-pass, ADD-only** (memories accumulate, nothing overwritten), plus optional graph memory (`mem0^g`, entities+relations in Neo4j) and temporal reasoning. Three layers: conversation (your app), session (`run_id`), user (`user_id`, weeks-to-forever). Scoping across user/agent/app/session. https://arxiv.org/html/2504.19413v1 , https://github.com/mem0ai/mem0/blob/HEAD/skills/mem0/references/architecture.md , https://deepwiki.com/mem0ai/mem0/1.1-system-architecture
- **Retrieval**: multi-signal — semantic (vector) + BM25 keyword + entity-graph boost, scored in parallel and fused; optional rerank. **Requires an embedder + vector store (Qdrant/Chroma/etc.) + an LLM** for extraction. Default LLM `gpt-5-mini`, default embed `text-embedding-3-small`. https://github.com/mem0ai/mem0
- **Promises/relationship state**: not first-class; would live as extracted facts. Graph edges (`User -LIKES- X`) approximate relationship state.
- **TS-native?**: **TypeScript SDK exists** (client + OSS `Memory` class is Python-first; the heavy pipeline is Python). Managed cloud + self-hosted (`docker compose up`) + library. https://github.com/mem0ai/mem0
- **MCP**: **Yes, two paths.** (a) `mem0-mcp-server` (uvx/Docker, HTTP endpoint, 9 tools: add/search/get/update/delete/delete_all/get_memory/list_entities/delete_entities) — talks to mem0 cloud/self-host. https://github.com/mem0ai/mem0/blob/69a832dc/docs/platform/features/mcp-integration.mdx (b) **OpenMemory MCP** — local-first, runs entirely on your machine, exposes `add_memories`/`search_memory`/`list_memories`/`delete_all_memories`, dashboard at :3000. **Note: DeepWiki now marks OpenMemory "Deprecated".** https://mem0.ai/blog/introducing-openmemory-mcp , https://deepwiki.com/mem0ai/mem0/15-openmemory-(deprecated)
- **Footprint**: heavy for our target — Python pipeline + vector DB + embedder + extraction LLM calls on every `add`. OpenMemory local mode bundles API server + vector DB + MCP + UI.
- **Windows**: via Docker; not a lean native path.
- **Maintenance**: very active, ~40k+ stars, arXiv paper, frequent algorithm updates (April 2026 new algorithm). https://github.com/mem0ai/mem0
- **License**: **Apache-2.0** (permissive). https://github.com/mem0ai/mem0/blob/main/LICENSE

### 1.2 Letta (formerly MemGPT)

- **Memory model**: the strongest *conceptual* fit for "soul." **Memory blocks** = structured, always-in-context sections of the prompt (label + description + value + char limit), agent-editable via tools (`memory_insert`/`memory_replace`/`memory_rethink`). Canonical blocks are **`persona`** (agent identity) and **`human`** (user model) — exactly the companion split. Read-only blocks pin unchangeable facts. Three tiers: **core** (in-context blocks), **archival** (out-of-context vector search, explicit `archival_memory_search`), **conversation history** (`conversation_search`). https://docs.letta.com/guides/core-concepts/memory/memory-blocks/index.md , https://raw.githubusercontent.com/letta-ai/skills/main/letta/agent-development/SKILL.md
- **MemFS** (Letta Agent): git-backed memory filesystem projecting blocks to markdown with YAML frontmatter; `system/` files always loaded, others lazy-loaded by description; `dream`/`doctor` subagents defragment memory via git worktrees. This is **very close to the OpenClaw pattern** and validates markdown-as-substrate. https://docs.letta.com/letta-code/memory/
- **Promises/relationship state**: naturally expressible as a custom block (e.g. `relationship`, `promises`, `agreed_rules`) — "add `emotional_state` and watch agents start using it." https://docs.letta.com/guides/core-concepts/memory/memory-blocks/index.md
- **Retrieval**: core memory needs no retrieval (always visible); archival is vector search over Postgres/pgvector.
- **TS-native?**: **No.** Python server; TS/Node client SDK against the server. It is a **server you run**, not a library you embed. Self-host = Docker + Postgres.
- **MCP**: Letta can act as an MCP *client* and there are Letta MCP servers, but its primary integration is its own REST/agent API, not "drop-in memory MCP."
- **Footprint**: self-host ≈ **Python server ~500MB + bundled Postgres ~300MB + pgvector working set** (VPS guide figures). Far over our budget for local embedding. https://www.ramnode.com/guides/letta , https://docs.letta.com/guides/docker/
- **Windows**: Docker.
- **Maintenance**: very active, large community, ~17k+ stars, Apache-2.0. https://github.com/letta-ai/letta
- **License**: Apache-2.0.
- **Takeaway**: **Do not adopt as a service** (it's a whole agent runtime, overlapping our Agent Core — architectural collision). **Do steal the memory-block abstraction** for soul composition (see §4).

### 1.3 Zep + Graphiti

- **Memory model**: **temporal knowledge graph.** Graphiti (OSS core) extracts episodes → semantic entities → communities; **bi-temporal** edges (t_valid, t_invalid, t_created, t_expired). New facts invalidate old ones by temporal logic rather than deletion — *preserved as history, removed from current state.* This is the best-in-class answer to "a promise/rule that was true then changed." https://www.getzep.com/platform/graphiti/ , https://arxiv.org/abs/2501.13956
- **Retrieval**: hybrid **vector + BM25 + graph traversal** in one ranked call, RRF + MMR + cross-encoder rerank; ~sub-second, ~200ms claim; SOTA on LongMemEval (71.2% vs 60.2% full-context, latency 28.9s→2.58s). https://memorypapers.org/papers/zep-a-temporal-knowledge-graph-architecture-for-agent-memory , https://pypi.org/project/graphiti-core/0.11.2/
- **Promises/relationship state**: excellent — custom Pydantic entity/edge types, explicit temporal validity.
- **TS-native?**: Graphiti is **Python** (schema.org metadata lists Python+TypeScript, but the engine + MCP server are Python). **Requires Neo4j / FalkorDB / Neptune** graph DB. https://www.getzep.com/platform/graphiti/
- **MCP**: **Yes**, built-in MCP server (`mcp_server` dir) — episode/entity/relationship/search tools, Docker+Neo4j deploy. https://pypi.org/project/graphiti-core/0.11.2/ , https://neo4j.com/blog/developer/graphiti-knowledge-graph-memory/
- **Footprint**: **heaviest** — graph DB (Neo4j) + Python + LLM extraction per episode + embeddings. Wildly over budget for a desktop pet.
- **Windows**: Docker only realistically.
- **Maintenance**: very active, well-funded (Zep), strong research. Graphiti permissive license (Apache-2.0-family). https://github.com/getzep/graphiti
- **Takeaway**: technically the most powerful, **operationally the wrong weight class** for a single-process pet. Its *bi-temporal invalidation* idea is worth learning for "rules that change over time."

### 1.4 LangMem (LangChain / LangGraph)

- **Memory model**: SDK, not a service. Two modes: **hot-path** tools (`create_manage_memory_tool`, `create_search_memory_tool`) the agent calls during a turn, and a **background memory manager** that extracts/consolidates. Explicit doc taxonomy: **semantic / episodic / procedural**. Also does **prompt optimization** (self-improving system prompt) — relevant to "soul." https://langchain-ai.github.io/langmem/ , https://github.com/langchain-ai/langmem , https://docs.langchain.com/oss/python/langchain/long-term-memory
- **Retrieval**: vector search over a LangGraph `BaseStore` (InMemory / **AsyncPostgresStore**), JSON docs by namespace/key.
- **TS-native?**: **Python-first** (LangMem SDK is Python). LangGraph has a JS port but LangMem itself is Python. Couples you to the LangGraph store abstraction.
- **MCP**: not a native memory MCP server; it's an in-process SDK.
- **Footprint**: light-ish as a library, but pulls the LangChain/LangGraph dependency tree and needs an embedder + store.
- **License**: MIT. Maintenance: active (LangChain org).
- **Takeaway**: its **semantic/episodic/procedural** framing and **hot-path vs background** split are useful mental models; the code isn't a fit (Python + LangGraph coupling).

### 1.5 memobase

- **Memory model**: **user-profile-based**, purpose-built for **virtual companions**. Background "**Dream Phase**" distills noisy session logs into durable profile facts organized by **topic/subtopic** (`get_user_profile` returns consolidated real-time profile). Passive HTTP-hook capture ("learns without remembering to remember"). Hybrid graph retrieval (vector + KG). Explicit memory types in its recommended system prompt: **semantic | episodic(dated) | procedural | decision**. https://github.com/memodb-io/memobase , https://memobase.ai/ , https://docs.memobase.io/api-reference/profiles/profile
- **Promises/relationship state**: the profile model is the closest turnkey fit to "stable evolving picture of the user + relationship." Companion-oriented by design.
- **TS-native?**: **JavaScript SDK exists** (`@memobase/memobase`) against a server. Server is Python. Local mode `mb start` = **100% private SQLite**. https://docs.memobase.io/api-reference/profiles/profile , https://memobase.ai/
- **MCP**: **MCP-native** (`https://mcp.memobase.ai`, OAuth; also local); tools `search_memory`/`store_memory`/`reconstruct_context`, plus `knowledge_graph_query`/`explore_relationships`; ships hooks (`mb inject claude-code`). https://memobase.ai/
- **Footprint**: server-based; local SQLite mode is the leanest of the "profile" systems but still a separate Python service.
- **License**: **Apache-2.0**. https://github.com/memodb-io/memobase
- **Takeaway**: **the most companion-shaped external candidate.** Its *user-profile + Dream-Phase distillation* is a strong pattern to learn (maps onto OpenClaw's daily-log → MEMORY.md curation). As a service it's still a second Python process/owner.

### 1.6 cognee

- **Memory model**: **ECL pipeline** (Extract → Cognify → Load) turns raw data into a knowledge graph + vector store; **Memify** post-processing pipeline enriches/optimizes/forgets ("delete unused data," "optimize for relevancy"). https://www.cognee.ai/ , https://medium.com/@cognee/cognee-knowledge-graph-optimization-memify-post-processing-pipeline-ce049417d9c3 , https://www.lancedb.com/blog/case-study-cognee
- **Retrieval**: graph + vector (LanceDB in the case study).
- **TS-native?**: Python. Graph+vector backends.
- **Footprint**: heavy (graph + vector + pipeline).
- **License**: permissive (Apache-2.0-family); active. https://github.com/topoteretes/cognee
- **Takeaway**: enterprise-ETL flavored; **overkill** for a single-user companion. Skip.

### 1.7 Nocturne (baseline exemplar — see prior file)

- 4-layer graph (nodes/memories/edges/paths), **FTS5 bm25 lexical, NO vectors**, 7 MCP tools, stdio/SSE/**Streamable HTTP**, MIT. Explicit-write "first-person sovereign memory," no background summarizer, `disclosure` (when-to-recall) trigger field, `priority` manual ranking, version chain + rollback, namespace isolation, single global Bearer token (not a per-namespace security boundary). Full detail in `research/nocturne-memory-analysis.md`. Re-weighed for VPS in §3.

### Pattern-level references (not products to install — designs to port)

| Pattern | Core idea | What it teaches us | Source |
|---|---|---|---|
| **OpenClaw memory** | Plain **Markdown** as source of truth: `SOUL.md` (identity) / `AGENTS.md` (rules) / `USER.md` (user model) / `MEMORY.md` (curated long-term) + `memory/YYYY-MM-DD.md` daily logs; **SQLite hybrid vector+BM25 index** rebuilt from files (`~/.openclaw/memory/{agentId}.sqlite`); **hybrid = weighted UNION not intersection** (default 0.7 vector / 0.3 keyword; `bm25RankToScore = 1/(1+rank)`); **pre-compaction flush** (silent turn saves durable memories ~4000-token buffer before compaction, `memoryFlushCompactionCount` prevents double-flush); **graceful degradation** (embeddings fail → keyword still works → files still exist). | This is **our chosen substrate** (TECH-STACK.md:17). Confirms: files canonical, SQLite is a rebuildable index, hybrid union beats intersection, and the flush pattern is the write-policy answer for longevity. | https://docs.openclaw.ai/concepts/memory , https://www.mmntm.net/articles/openclaw-memory-architecture , https://www.clawagora.com/en/blog/openclaw-memory-guide , https://ai-coding.wiselychen.com/en/openclaw-architecture-deep-dive-context-memory-token-crusher/ |
| **Generative Agents (Stanford)** | **Memory stream** of natural-language observations; retrieval = **recency(0.5) + relevance(3.0) + importance(2.0)**, normalized [0,1]; **importance (poignancy)** LLM-scored per event; **reflection** fires when summed importance crosses a threshold, synthesizes higher-level insights back into the stream. | The **recency+importance+relevance** scoring is the recall-ranking recipe Nocturne lacks. **Importance-triggered reflection** = how to distill daily logs → MEMORY.md automatically. Store NL descriptions, not raw JSON. | https://arxiv.org/pdf/2304.03442 , https://agentpatterns.ai/agent-design/generative-agents-memory-stream/ |
| **MemoryBank** | **Ebbinghaus forgetting curve**: retention R=e^(−t/S); strength S starts 1, +1 and t→0 each time a memory is recalled → recalled memories persist, unrecalled ones decay. Explicitly targets **AI companion** (SiliconFriend). Builds **user portraits**. | A principled **forgetting/reinforcement** model for a *long-lived* companion so memory doesn't grow unbounded and "what we keep revisiting" strengthens. Complements importance scoring. | https://arxiv.org/abs/2305.10250 , https://ojs.aaai.org/index.php/AAAI/article/view/29946 |
| **Hermes three-layer memory** | (Referenced in PRD; general three-tier pattern = working / short-term / long-term.) Could not locate a canonical Hermes source distinct from the widely-shared three-tier taxonomy. Treat as the standard **working → episodic → semantic** tiering, which Letta/mem0/memobase all instantiate. | Confirms the near-universal **3-tier** shape; nothing unique to port beyond what Letta already gives us. | (see Letta/mem0 tiers above; specific "Hermes" repo not verified — Caveat §6) |

### Roleplay-specific references (persona + memory composition)

| Reference | Mechanism | What it teaches | Source |
|---|---|---|---|
| **SillyTavern World Info / Lorebook** | **Keyword-triggered context injection.** Entries = `keys` (triggers, plaintext or regex) + `content` (the only text injected) + `insertion_order` + `token_budget` + `constant`(🔵 always) / `keyword`(🟢) / `vectorized`(🔗) modes + `selective`/`secondary_keys` (AND/NOT logic) + `probability` + **recursive scanning** (entry content can trigger other entries) + timed effects (delay/sticky/cooldown). Budget-bounded; constant beats normal, higher order beats lower, direct key hits beat recursion. | This is a **battle-tested, LLM-free conditional-recall engine** — and it maps almost 1:1 onto **Nocturne's `disclosure`/trigger + `priority`** and onto **FTS5 keyword matching**. It's the roleplay-industry proof that *keyword-gated injection within a token budget* is enough for rich persona memory — **no vectors required**. Directly validates our FTS5 plan and tells us the *field set* a memory entry should carry. | https://github.com/SillyTavern/SillyTavern-Docs/blob/main/Usage/worldinfo.md , https://docs.sillytavern.app/usage/core-concepts/worldinfo/ , https://sillycard.xyz/blog/sillytavern-world-lorebook-logic |
| **Character Card v2 (chara_card_v2 / Chub)** | Standard character schema: `name, description, personality, scenario, first_mes, mes_example, creator_notes, system_prompt, post_history_instructions, alternate_greetings[], character_book?, tags[], creator, character_version, extensions{}`. **`character_book`** = an embedded lorebook (scan_depth, token_budget, recursive_scanning, entries[]) that travels *with* the character and takes precedence over the global world book. | Defines exactly **what a persona profile should contain** beyond a prompt: greetings, example dialogue, scenario, post-history instructions (jailbreak-resistant persona reinforcement injected AFTER history), and a **bundled per-character lorebook**. Our `Character` should adopt this field vocabulary. | https://github.com/malfoyslastname/character-card-spec-v2 , https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md , https://docs.chub.ai/docs/the-basics/character-creation |

---

## 2. The MCP-memory-service pattern & @ai-sdk/mcp compatibility

**Which candidates ship a production MCP memory server:**

| Candidate | MCP server | Transports | Tools (memory-relevant) |
|---|---|---|---|
| **Nocturne** | Yes (FastMCP) | **stdio + SSE + Streamable HTTP** | 7 (read/create/update/delete/add_alias/manage_triggers/search) |
| **mem0** | Yes (`mem0-mcp-server`, uvx/Docker) | stdio + **HTTP** | 9 (add/search/get/update/delete/delete_all/get_memory/list_entities/delete_entities) |
| **OpenMemory** (mem0, local) | Yes | HTTP (local) | 4 (add_memories/search_memory/list_memories/delete_all_memories) — **marked deprecated** |
| **memobase** | Yes (MCP-native) | **HTTP** (OAuth) + local | search_memory/store_memory/reconstruct_context + KG query |
| **Zep/Graphiti** | Yes | HTTP (Docker+Neo4j) | episode/entity/search/group tools |
| **Letta** | Partial (agent API primary) | — | memory via agent, not a clean memory-MCP |
| **LangMem/cognee** | No native memory MCP | — | in-process SDK |

**@ai-sdk/mcp compatibility (verified):** the AI SDK MCP client (`experimental_createMCPClient` / `@ai-sdk/mcp`) supports a **custom transport** and a `MCPTransportConfig` with `type: 'sse' | 'http'` (Streamable HTTP) plus the bundled **stdio** transport (`Experimental_StdioMCPTransport`). The docs explicitly **recommend Streamable HTTP for production**; SSE is being deprecated upstream. It converts MCP tools → AI SDK tools; it is a **tool-consumption client only** — no session management / resumable streams / server notifications. https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools , https://ai-sdk.dev/docs/reference/ai-sdk-core/create-mcp-client , https://github.com/vercel/ai/pull/5972

**Conclusion:** every serious candidate (Nocturne, mem0, memobase, Graphiti) exposes **stdio and/or Streamable HTTP**, all of which our client consumes with **zero custom code**. MCP compatibility is therefore **NOT a differentiator** — it's table stakes. The decision hinges on footprint, ownership, privacy, offline behavior, and fit, not on protocol.

---

## 3. Nocturne-on-VPS re-evaluation (honest, no bias toward the prior verdict)

The prior file concluded "works, but wrong center of gravity" for a *bundled-local* deployment. The user's **new** proposal is materially different: **Nocturne on the user's VPS** (Docker + Postgres, Bearer token), consumed purely as **Streamable HTTP MCP** from the local agent — i.e. the ugly parts (Python runtime, embedded dashboard, browser auto-open, jieba RAM, npm build) run **on the server, not on the pet**. That removes the strongest local-footprint objections. It deserves a fresh, fair weighing.

**Honest arguments FOR nocturne-on-VPS:**

1. **Footprint objection largely evaporates.** The Python/uvicorn/jieba/Node-build costs move to the VPS. The local agent only holds an HTTP MCP client (negligible). ADR 0001's 150-250MB budget is protected. This was the *single biggest* count against 连 — and VPS neutralizes it.
2. **Single-owner is a scope question, not an automatic violation.** TECH-STACK.md:64 says "the Agent Core is the only reader/writer of **the database**." An external MCP memory service is arguably **its own bounded context** — the Agent Core doesn't read Nocturne's Postgres directly; it calls tools over MCP. By that reading, Nocturne is just another *tool/capability provider* (like an LLM API or a TTS endpoint), not a co-owner of *our* DB. The single-owner principle is about **avoiding two writers to one store with no conflict resolution** — a remote MCP service the agent calls sequentially doesn't create that hazard. **This is a legitimate boundary, not a clear violation.** (Counter-point in the "AGAINST" list.)
3. **MIT license + real MCP transports** → integration is genuinely near-zero-code and legally clean.
4. **Backup/durability** on a VPS with Postgres is arguably *easier* than a local SQLite file the user might lose with their laptop.
5. **Cross-device future** (ADR 0004's phone-as-node): a VPS-hosted memory is reachable from multiple devices/relays without building sync — it sidesteps the "phone needs the desktop online" problem for *memory specifically*.

**Honest arguments AGAINST nocturne-on-VPS (weighed for a companion):**

1. **Privacy of intimate companion memories is the decisive concern.** This product's memories are **relationship milestones, promises, emotional context** — the most sensitive data class the app holds, and CONTEXT.md's whole posture is privacy-first (Sensitivity Tiers, Privacy Pause, screenshots off by default, secrets in Credential Manager). Nocturne's auth is a **single global Bearer token; namespace is NOT a security boundary** (prior file §2). Putting "our shared history" on a remote host guarded by one shared secret is a **posture regression** versus a local SQLite file that never leaves the machine. For a coding-assistant this is fine; for a companion it cuts against the core promise.
2. **Recall latency on every conversational turn.** A companion that greets and reacts wants **low-latency, always-available** recall. VPS round-trips add network latency + tail-latency variance to potentially *every* turn (and to Heartbeat-driven proactive utterances). Local FTS5 is sub-millisecond; a remote MCP call is tens-to-hundreds of ms plus jitter. For a real-time pet this is felt.
3. **Offline / degraded behavior is a hard failure, not graceful.** When the VPS is unreachable (user offline, VPS down, network flaky) the companion **loses its memory mid-relationship** — the worst possible failure mode for "remembers what we did." OpenClaw's design principle is explicit **graceful degradation** (files always exist even if index fails). A remote-only memory has **no local fallback**. This alone is close to disqualifying for the *primary* store.
4. **Ops burden on a non-technical end user.** The VPS approach assumes *this developer's* VPS. A shippable product can't require every user to run Docker+Postgres+Nginx+Bearer-token on a server. So nocturne-VPS is at best a **power-user/self-host option**, never the default — meaning we'd still build a local path anyway.
5. **Schema-churn coupling.** Prior file: 14 sequential migrations v1.0→v2.5.3. Depending on someone else's actively-churning memory schema for our product's existential feature is a maintenance liability regardless of where it runs.
6. **Still a second datastore we don't fully own.** Even accepting the "bounded context" argument, the *state of record for the relationship* now lives in a store whose schema, migrations, and availability we don't control — for the one feature the PRD calls "existential."

**Compare the three deployment shapes of the *same* engine:**

| Dimension | Nocturne local (bundled) | Nocturne VPS (MCP) | Native TS module (our plan) |
|---|---|---|---|
| Local footprint | Bad (Python+Node+jieba+dashboard) | **Good** (client only) | **Best** (in-process) |
| Recall latency | Good (localhost) | **Poor** (network + jitter) | **Best** (in-proc FTS5) |
| Offline behavior | OK (local) | **Fails hard** | **Best** (files always present) |
| Privacy of intimate data | OK (local) | **Weak** (remote, 1 shared token) | **Best** (never leaves machine) |
| Single-owner fit | Violates (2nd local DB) | Debatable (bounded context) | **Clean** (Agent Core owns it) |
| Ops burden (end user) | Medium | **High** (user needs a VPS) | **None** |
| Backup/migration | Local file | **Easier** (server Postgres) | Local file (+ git for markdown) |
| Cross-device (phone) | No | **Yes** (reachable) | Via our WS single-owner push |
| Engine capability | = our plan (FTS5) | = our plan (FTS5) | = (FTS5, we add scoring) |

**Verdict (unbiased):** the VPS framing **is a real improvement over the bundled-local option** and its single-owner objection is **weaker than the prior file implied** (bounded-context is a defensible reading). **But** for a *companion whose memories are its most intimate data and whose availability must be constant*, the combination of **remote-only availability (offline = amnesia), per-turn latency, and weak auth on intimate data** makes nocturne-VPS **unfit as the primary/default memory store**. It remains a **legitimate optional power-user backend** and a **plausible cross-device *long-term archive*** behind a native local cache. It does not displace a native local module for v1.

---

## 4. Soul composition: memory + system prompt → stable persona

**The consensus pattern across OpenClaw, Letta, and Character-Card-v2:** separate **stable identity** (rarely changes, always in context) from **accumulating history** (grows, retrieved/curated). The persona stays stable because identity is pinned; the relationship deepens because history accumulates around it.

**Layering (synthesized):**

1. **Identity layer — always in context, (near-)immutable.**
   - OpenClaw `SOUL.md` (personality, tone, ethical boundaries, kept <2KB). https://www.clawagora.com/en/blog/openclaw-memory-guide
   - Letta read-only `persona` block. https://docs.letta.com/guides/core-concepts/memory/memory-blocks/index.md
   - Character-Card `description` + `personality` + `system_prompt` + **`post_history_instructions`** (reinforcement injected *after* chat history so the persona resists drift over long sessions). https://github.com/malfoyslastname/character-card-spec-v2
2. **User/relationship layer — always in context, mutable, agent-curated.**
   - Letta `human` block; OpenClaw `USER.md`; memobase user profile.
   - **This is where promises, agreed rules, relationship state, milestones live** — small, curated, always visible so the companion never "forgets who it's talking to."
3. **Episodic layer — out of context, retrieved on demand.**
   - Daily logs (`memory/YYYY-MM-DD.md`) → FTS5/keyword-triggered injection (SillyTavern lorebook mechanics) → periodic distillation into layer 2.
4. **Conditional-knowledge layer — the lorebook/character_book.**
   - Keyword-gated world/backstory facts injected within a token budget (SillyTavern World Info + Character-Card `character_book`). Perfect for a roleplay companion's world/canon.

**Write policy (what gets remembered automatically vs on explicit "remember this"):**
- **Automatic**: importance-scored events (Generative Agents poignancy) written to daily logs; **pre-compaction flush** (OpenClaw) guarantees durable capture before context loss; background distillation (memobase Dream Phase / OpenClaw daily→MEMORY.md) promotes recurring/important items into the always-in-context user layer.
- **Explicit "remember this / you promised"**: a first-person sovereign write (Nocturne stance) into the **relationship/promises** block with high priority — these must be *durable and always visible*, never left to lossy retrieval. Letta's `/remember` is the same idea.
- **Forgetting**: MemoryBank Ebbinghaus decay — unrecalled episodic items fade; recalled ones strengthen — keeps the store bounded and human-like without deleting promises (which live in the pinned layer, exempt from decay).

**What our `Character` profile should contain (beyond persona prompt + voice):** adopting Character-Card-v2 vocabulary + OpenClaw/Letta layering, a `Character` should carry:
- `persona_prompt` (identity/personality/tone) — the stable SOUL.
- `voice_profile` (already planned).
- `first_mes` / `alternate_greetings[]` — opening lines (roleplay warmth).
- `scenario` — the framing/relationship context.
- `mes_example` — example dialogue that anchors *voice/style* (huge for stable roleplay).
- `post_history_instructions` — persona reinforcement injected after history (anti-drift over long relationships).
- `character_book` (embedded lorebook) — keyword-triggered canon/world facts, travels with the Character, precedence over any global book.
- **decoupled, per-user runtime state** (NOT part of the shipped Character): the `relationship`/`promises`/`agreed_rules` block + episodic memory — these belong to the *user's instance* of the companion, not the distributable Character, so the same Character can be shared while each user's shared history stays private and local.

---

## 5. Recommendation

### Comparison table (weighted for companion + roleplay + ADR 0001/0004)

Legend: ●●● strong / ●● ok / ● weak.

| Candidate | Memory-model fit (longevity, promises, relationship) | Roleplay fit | Integration cost | Footprint (ADR 0001) | Privacy | Offline | Maintenance | License |
|---|---|---|---|---|---|---|---|---|
| **Native TS module** (markdown + `node:sqlite` FTS5 + ported ideas) | ●●● (we design exactly for promises/relationship layers + scoring + forgetting) | ●●● (lorebook + character-card patterns native) | ●● (we build it — but small; §4 of prior file) | ●●● (in-process) | ●●● (never leaves machine) | ●●● (files always present) | ●●● (we own it) | n/a |
| **Nocturne — local bundled** | ●● (FTS5 + disclosure trigger; no scoring) | ●● | ● (Python+Node+dashboard+browser) | ● (2nd runtime) | ●● (local) | ●● | ●● (schema churn) | MIT |
| **Nocturne — VPS (MCP)** | ●● (same engine) | ●● | ●●● (zero code) | ●●● (client only) | ● (remote, 1 shared token, intimate data) | ● (VPS down = amnesia) | ●● (schema churn) | MIT |
| **mem0 / OpenMemory MCP** | ●● (extracted facts, ADD-only, graph opt) | ● (not persona-shaped) | ●● (MCP zero-code, but needs LLM+vector) | ● (Python+vectorDB+embed) | ● (cloud default; local mode heavy; OpenMemory deprecated) | ● | ●●● | Apache-2.0 |
| **Letta (MemGPT)** | ●●● (memory blocks = persona/human) | ●●● (block model) | ● (whole agent runtime — collides w/ our Core) | ● (Py server + Postgres ~800MB) | ●● (self-host) | ● | ●●● | Apache-2.0 |
| **Zep/Graphiti** | ●●● (bi-temporal graph, promises-as-edges) | ●● | ● (Neo4j + Python) | ● (graph DB, heaviest) | ●● (self-host) | ● | ●●● | Apache-2.0-fam |
| **memobase** | ●●● (user-profile, companion-built, Dream Phase) | ●●● (companion-shaped) | ●● (MCP-native, JS SDK; server is Py) | ●● (local SQLite mode; still a service) | ●● (local mode) / ● (cloud) | ● (service) | ●● | Apache-2.0 |
| **LangMem / cognee** | ●● / ●● | ● / ● | ● (Python + LangGraph / graph+vector) | ● | ●● | ● | ●● | MIT / Apache |

### Reasoned recommendation

**Ship a native TypeScript memory module in `packages/core/src/memory/` (as already decided in TECH-STACK.md:17), and treat every surveyed system as an *idea source*, not a dependency.** The survey does **not** overturn the prior verdict — it *reinforces* it and sharpens what to build:

1. **No candidate closes an engine gap that justifies its weight.** The two systems with genuinely superior *engines* (Zep bi-temporal graph, mem0 multi-signal+graph) both demand a graph/vector DB + Python + per-turn LLM extraction — categorically over ADR 0001's budget and against the single-process design. The companion-shaped ones (memobase, Letta) are **still separate services** that duplicate ownership.
2. **The winning patterns are all portable and cheap** onto our markdown+FTS5 substrate:
   - **OpenClaw** layering (SOUL/USER/MEMORY/daily) + **hybrid union** + **pre-compaction flush** + **graceful degradation** → this *is* our substrate; implement it faithfully.
   - **Generative Agents** recency+importance+relevance scoring + importance-triggered reflection → the recall-ranking + auto-distillation Nocturne lacks.
   - **MemoryBank** Ebbinghaus decay/reinforcement → bounded, human-like forgetting (promises exempt, they live pinned).
   - **SillyTavern lorebook + Character-Card-v2** → keyword-gated injection, token budgets, and the exact **Character field vocabulary** (§4).
   - **Nocturne** `disclosure` (when-to-recall) trigger + `priority` + first-person sovereign write (already recommended in prior file).
   - **Letta** memory-block abstraction (persona/human/relationship blocks) → the "soul" composition model (§4).
3. **On the user's nocturne-VPS proposal (§3): decline as the *primary* store, keep as an *optional* backend.** It's a defensible bounded context and fixes the footprint objection, but **offline=amnesia + per-turn latency + weak auth on the most intimate data** disqualify it as the default for a *companion*. It cannot be the only path anyway (end users don't have a VPS), so we build the native local module regardless.

**Hybrid allowance (compatible with ADR 0004):** the architecture *permits* a future **native local (short-term/authoritative) + optional remote MCP long-term archive** split — precisely because our MCP client speaks Streamable HTTP with zero code, and because the single-owner principle applies to *our* DB, not to an external tool the agent calls. A user who *wants* nocturne-VPS (or mem0/memobase MCP) as a **secondary long-term/cross-device archive behind the local cache** can be supported later via config, not code. This keeps the local companion always-available and private while leaving the door open.

### v1 vs defer

**v1 ships (native, small):**
- Markdown-in-Workspace canonical store + `node:sqlite` **FTS5** index (rebuildable), OpenClaw-faithful.
- **Layered soul**: pinned identity (persona prompt) + pinned **relationship/promises/agreed-rules** block + episodic daily logs. Promises/rules are *always in context*, never retrieval-gated.
- **Character profile** extended to Character-Card-v2 vocabulary (first_mes, alternate_greetings, scenario, mes_example, post_history_instructions, embedded `character_book`).
- **Write policy**: automatic importance-tagged daily-log writes + **pre-compaction flush**; explicit "remember this / you promised" → high-priority pinned write.
- **Recall**: FTS5 keyword + lorebook-style keyword-triggered injection within a token budget; `disclosure`/trigger + `priority` fields on entries.
- Graceful degradation (files authoritative; index optional).

**Defer (add only if flat files + FTS5 prove insufficient):**
- **Hybrid vector** scoring on top of FTS5 (OpenClaw 0.7/0.3 union) — deferred per TECH-STACK.md; add an embedder later behind the same interface.
- **Recency+importance+relevance** composite ranking + **importance-triggered reflection** (auto daily→MEMORY.md distillation) — high value, add second.
- **Ebbinghaus decay/reinforcement** for bounded episodic memory.
- **Graph/edges/aliases** (Nocturne layer / Zep bi-temporal) — expensive, add only if the flat model can't express evolving relationship facts.
- **Optional external MCP long-term archive** (nocturne-VPS / mem0 / memobase) as a *secondary* store behind the local cache, config-gated, for power users / cross-device.

---

## 6. Caveats / Not found

- **"Hermes three-layer memory"** — could not verify a canonical, distinct "Hermes" project/source in web search; it appears to be an instance of the common working/short-term/long-term (or working/episodic/semantic) tiering that Letta, mem0, and memobase already exemplify. Treated as the standard 3-tier taxonomy; **no unique mechanism confirmed.** Flag for the caller if a specific "Hermes" repo was intended.
- **OpenMemory MCP** is described as **deprecated** in mem0's current DeepWiki index; mem0's live MCP path is now `mem0-mcp-server` (cloud/self-host). Verify current status before relying on OpenMemory. https://deepwiki.com/mem0ai/mem0/15-openmemory-(deprecated)
- **Star counts / exact footprints** are approximate (from GitHub landing text and third-party guides, e.g. Letta VPS ~500MB server + ~300MB Postgres); treat as order-of-magnitude, not benchmarked on our machine.
- **Nocturne schema churn / activity** — as noted in the prior file, the vendored copy has no git history; 14 migrations v1.0→v2.5.3 is the churn signal. Live repo `github.com/Dataojitori/nocturne_memory`.
- **@ai-sdk/mcp** is still marked **experimental** (`experimental_createMCPClient`) and is a **tool-consumption client only** (no MCP session management / resumable streams / server notifications). Fine for consuming any memory MCP server's tools; not a full MCP host. https://ai-sdk.dev/docs/reference/ai-sdk-core/create-mcp-client
- mem0/Zep/Graphiti all **require an LLM + embeddings at write time** (extraction) — a per-turn cost (latency + token spend) that a lexical FTS5 store avoids; relevant to a chatty always-on companion.
