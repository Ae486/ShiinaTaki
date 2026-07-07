# Memory Design (v1)

Native TS module in `packages/core/src/memory/`. No external service, no network dependency — memory is the Companion's most intimate data and must survive offline, forever, in a form the user can read. Sources of ideas: OpenClaw (production-proven markdown memory), nocturne (disclosure/priority fields), ATRI (intentions, reason-gated proactivity — vibe-coded reference, ideas only, zero authority), SillyTavern (keyword-triggered injection), generative-agents (deferred scoring). All mechanisms independently authored.

## Substrate: files are the truth, SQLite is a derived index

- Every memory is a markdown entry with YAML frontmatter in the Workspace (`memory/` subtree): human-readable, user-editable, git-able, survives DB corruption.
- `node:sqlite` holds the derived index: one metadata table + FTS5 content index + an events log. **Rebuildable from files at any time** (startup reconciliation by content hash). DB corruption or schema migration can never lose a memory.

```
workspace/memory/
├── soul/relationship.md      # pinned block: promises, rules, milestones (one entry per item)
├── facts/NNNN-slug.md        # stable facts (preferences, taboos, identity)
├── episodes/2026-07-07.md    # daily episodic log (append-only entries)
└── intentions/NNNN-slug.md   # unsaid thoughts (mood-gated, expiring)
```

Frontmatter (all types): `id`, `type: fact|promise|rule|episode|intention`, `importance: 1-10`, `disclosure` (free-text "when to recall" hint, keyword-matched), `created`, `status: active|archived`, optional `emotional_weight`, optional `expires` (intentions).

## Memory taxonomy

| Type | What | Recall path |
| --- | --- | --- |
| `promise` / `rule` | Agreements with the user; behavioral rules | **Pinned — always in context, never retrieval-gated.** "You promised" must not depend on search luck |
| `fact` | Stable user/world facts | importance >= 9 pinned; rest retrieved |
| `episode` | What happened, per day | Retrieved (FTS5 + disclosure match) |
| `intention` | Things the Companion "wants to say someday" | Mood/context-gated surfacing; expire if never said; feed Proactive Utterance reasons |

Persona is NOT memory: the Character card (persona prompt, Character-Card-v2 vocabulary) is static config; memory supplies the evolving shared history. Soul = card + pinned block + retrieved history, assembled fresh every turn.

## Context assembly (deterministic order, per-section token budgets)

1. Character persona prompt (static)
2. Emotion capsule (from companion state module — adjacent, not memory)
3. Pinned block: all `promise`/`rule` + facts with importance >= 9 (budget ~800 tokens; overflow = oldest-milestone truncation, promises never truncated)
4. Retrieved block, framed as associations ("things that come to mind"), max ~600 tokens: FTS5 bm25 over current message + last N turns → filter by `disclosure` keyword match and `status: active` → rank bm25, then importance, then recency
5. At most one `intention` when the emotion gate passes (never listed as a checklist)

## Write paths

1. **Explicit tools** (LLM-invoked): `memory_write(type, content, importance, disclosure?)`, `memory_search(query)`, `memory_archive(id)`. "记住这个约定" → `promise` write, importance 10.
2. **Auto episodic**: end-of-session (or every N turns) summarizer appends 1-3 entries to today's episode file.
3. **Pre-compaction flush** (OpenClaw pattern): before context compaction, a silent turn saves anything important that exists only in the conversation window.
4. **Nightly consolidation** (croner, v1.5): distill the day's episodes → diary entry + promote/merge/archive suggestions. Ships after the core loop is stable; the schema carries `status` from day one so consolidation is additive.

All writes go through the memory store API (file write + index upsert + event log line) — never raw file appends from tools.

## CJK retrieval note (technical, load-bearing)

FTS5's default unicode61 tokenizer does not segment Chinese. v1 uses the FTS5 **trigram** tokenizer (substring matching, CJK-safe, zero deps). If quality disappoints, alternatives are a JS segmenter (`Intl.Segmenter`) feeding a custom-tokenized index — decided by usage, not upfront.

## Upgrade path (interfaces over engines)

`Retriever` is an interface. v1 = FTS5. v2 candidates behind the same interface: embedding recall via the user's OpenAI-compatible `/v1/embeddings` (paraphrase association — the only thing FTS5 genuinely cannot do), `sqlite-vec` as store. Deferred, not designed-in: recency×importance×relevance scoring, forgetting curves, graph edges. Optional later: external MCP memory service (e.g. nocturne on VPS) as a cross-device *archive* behind the local store — never the primary.

## Module layout

```
packages/core/src/memory/
├── store.ts          # markdown+frontmatter IO, atomic writes, id allocation
├── indexer.ts        # SQLite sync: metadata, FTS5, startup reconciliation
├── retriever.ts      # Retriever interface + FTS5 implementation
├── assembler.ts      # context assembly with budgets (section 'Context assembly')
├── consolidation.ts  # nightly pipeline (v1.5)
└── memory-tools.ts   # AI SDK tool definitions (thin, delegate to store/retriever)
```

## Ship schedule

| Phase | Scope |
| --- | --- |
| v1 | Store + index + FTS5 retriever + assembler + explicit tools + auto episodic + pre-compaction flush |
| v1.5 | Nightly consolidation + diary as Pet UI panel + intention surfacing gate |
| v2 | Embedding retriever behind `Retriever`, emotion-memory coupling refinements, optional MCP archive |
