# Memory Design (v1)

Native TS module in `packages/core/src/memory/`. No external service, no network dependency — memory is the Companion's most intimate data and must survive offline, forever, in a form the user can read. Sources of ideas: OpenClaw (production-proven markdown memory), nocturne (disclosure/priority fields), ATRI (intentions, reason-gated proactivity — vibe-coded reference, ideas only, zero authority), SillyTavern (keyword-triggered injection), generative-agents (deferred scoring). All mechanisms independently authored.

v1 ships a single Character: Shiina Taki (椎名立希). Multi-character-on-screen is out of scope for v1; the layer model below keeps it open.

## Mechanism/policy separation: the layer registry (user requirement: layers must be add/remove/editable)

The engine (store, indexer, retriever, assembler) is **generic over layers** — it only knows "a layer with a policy". The taxonomy itself is data: one registry file of declarative `MemoryLayerDefinition` entries (zod-validated):

```ts
{ id, ownership: "global" | "per-character",
  writePolicy: "explicit-tool" | "machine" | "agent" | "consolidation",
  recallPolicy: "pinned" | "retrieved" | "mood-gated", truncatable: boolean,
  retention: "permanent" | { rollingDays } | "expiring" }
```

Adding/removing/reshaping a layer = editing one registry entry + a directory; the engine never changes (open-closed principle). Because files are the truth and SQLite is a rebuildable index, layer changes require **no DB migration** — just re-index. Guardrail: the registry is a config file edited in code, NOT a runtime plugin system or layer-management UI (over-engineering until proven needed). Critical guarantees are layer policy fields, not hard-coded special cases (e.g. promises = `recallPolicy: pinned, truncatable: false`).

## v1 layer registry

| Layer | Ownership | Writer | Recall | Retention |
| --- | --- | --- | --- | --- |
| `profile` (user facts: identity, preferences, taboos) | global | explicit tools + consolidation | importance >= 9 pinned, rest retrieved | permanent |
| `activity` (objective records from Sampling: apps opened, pages read, screenshot content summaries) | global | machine (sensing pipeline) | retrieved only, never pinned | entries: rolling window (default ~30 days); referenced screenshots: separate shorter window (default ~7 days) + disk-size cap — entry survives its image |

### Activity capture pipeline (decided 2026-07-07)

Sampling is a single opportunistic pass at trigger time — everything lands immediately, no deferred batch jobs: capture screenshot (Shell/xcap) + process snapshot → VLM interpretation (screenshot + process info are dual signals; process alone says "Edge is open", vision says *what* is being watched) → write in one go: compressed image (WebP, ~1600px wide) to app-data `captures/YYYY-MM-DD/`, activity markdown entry with frontmatter `image` (path ref) + `processes` (structured snapshot) + interpretation text, FTS index upsert.

- **Raw screenshots ARE retained by default** (user decision, reversing the discard-by-default proposal): configurable time window, master switch (off = interpretation only, image never touches disk).
- Retention is dual-threshold: max age AND max total disk size, whichever hits first; expiry deletes the image, never the entry.
- Sensitive-process skip list (password managers, banking, private-browsing windows in foreground → skip that sampling round), user-editable; Privacy Pause remains the manual master switch.
- VLM failure degrades gracefully: image + process snapshot still land, interpretation left empty — no re-analysis queue.
- UI: activity log cards (thumbnail click-to-open, capture time, process info, taki's interpretation); phone Node receives cards with summaries, thumbnails fetched on demand.
| `relationship` (promises, rules, milestones) | per-character | explicit tools | **pinned, never truncated** | permanent |
| `episodes` (conversation logs, diary) | per-character | auto + nightly consolidation | retrieved | permanent (archived by consolidation) |
| `intentions` (unsaid thoughts) | per-character | agent | mood-gated, max one per turn | expiring |

Persona is NOT memory: the Character card (persona prompt, Character-Card-v2 vocabulary) is static config; memory supplies the evolving shared history. Soul = card + pinned layers + retrieved history, assembled fresh every turn.

## Substrate: files are the truth, SQLite is a derived index

- Every memory is a markdown entry with YAML frontmatter in the Workspace: human-readable, user-editable, git-able, survives DB corruption.
- `node:sqlite` holds the derived index: one metadata table + FTS5 content index + an events log. **Rebuildable from files at any time** (startup reconciliation by content hash). DB corruption or schema migration can never lose a memory.

```
workspace/memory/
├── global/
│   ├── profile/NNNN-slug.md
│   └── activity/NNNN-slug.md
└── characters/taki/
    ├── relationship/NNNN-slug.md
    ├── episodes/NNNN-slug.md
    └── intentions/NNNN-slug.md
```

One entry per file across every layer (`NNNN-slug.md`), decided in #6: a single storage mechanism (policy in
data, no per-layer special cases) makes entry-level atomicity, `status`, retention-expiry, and reindex uniform.

Frontmatter (all layers): `id`, `layer`, `importance: 1-10`, `disclosure` (free-text "when to recall" hint, keyword-matched), `created`, `status: active|archived`, optional `emotional_weight`, optional `expires`.

## Blocks: the always-visible tier (T5)

Storage shape follows the tier, and the two answers are different (T5-R20). **Entry rows** (everything above) are the
*searchable* tier: one thing per file, frontmatter, FTS-indexed, scored, deduped, decayed. **Memory Blocks** are the
*always-visible* tier: whole documents that are deterministically pushed into every turn's context, edited by rewriting
rather than by accumulating. Rows are right where retrieval and per-item policy apply; blocks are right where the
content must be integrated and compressed instead of appended.

Blocks are **pure markdown — zero frontmatter**. Every policy (who may write it, whether it is global or per-character,
its prompt framing, its token budget) is a row in the block registry (`memory/block-registry.ts`), so a block file
holds nothing but the content a human would want to read.

```
workspace/
├── memory/                            # searchable tier (entry files above) — FTS-indexed
└── blocks/                            # always-visible tier — NEVER indexed
    ├── global/
    │   ├── user-card.md
    │   └── user-model.md
    └── characters/taki/
        └── memory-index.md
```

The two trees are siblings, never nested: the entry store's recursive walk cannot reach a block, so "blocks are never
indexed" is structural rather than a filter someone could forget.

| Block | Scope | Writer | What it holds |
| --- | --- | --- | --- |
| `user-card` | global | **the user** (hand-edited; no agent path may write it) | identity facts the user states about themselves — name, form of address, timezone, hard preferences. On conflict this wins over anything she remembers (T5-R7) |
| `user-model` | global | background (tidy pass) | her own consolidated understanding of the user: patterns and well-supported inferences, not stated facts (M-D4) |
| `memory-index` | per-character | background (tidy pass) | a compact index of what her memory holds, phrased as recall triggers — pointers, never bulk content (T5-R14) |

Injection: blocks render in registry order — the table above IS that order (hard facts, then her reading of the
user, then the index as navigation) — right after the persona/emotion sections and before the pinned rows, each
under its registry `header` and carrying its budget number (`[budget: N/M tokens]`) so the background writer that
maintains it can see how close it is to the ceiling. Over-budget content is trimmed **in the prompt only** — the file
on disk stays whole, and the visible cut is the signal to consolidate.

The user card is not seeded: create `workspace/blocks/global/user-card.md` by hand and it takes effect on the next
turn (blocks are read fresh, never cached). Symmetrically, **deleting a block file removes that feature completely**
(D28) — a missing block renders nothing at all, no header and no error.

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

`Retriever` is an interface. v1 = FTS5 (plus agentic compensation: `memory_search` is LLM-invoked, so the model reformulates queries itself — partial coverage of the paraphrase gap). v2 adds embedding recall behind the same interface — the one thing lexical search cannot do is paraphrase association ("那家我们去过的拉面店" → stored "吃了豚骨拉面"), which is the "she suddenly remembers" magic; therefore v2 is committed, not optional. v2 shape, following the industry-wide pattern (every serious implementation is hybrid, none is vector-only, all degrade gracefully):

- Hybrid **weighted union** (not intersection), OpenClaw-style ~0.7 vector / 0.3 bm25
- Embeddings via the user's OpenAI-compatible `/v1/embeddings` (no new privacy surface — memories already flow to the same provider as chat context); vectors stored in `sqlite-vec`
- Degradation chain baked in: embedding call fails → FTS5 still works → pinned block and files always present

Deferred beyond v2, not designed-in: recency×importance×relevance scoring (generative-agents), forgetting curves (MemoryBank), graph edges (Zep). Optional later: external MCP memory service (e.g. nocturne on VPS) as a cross-device *archive* behind the local store — never the primary.

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
