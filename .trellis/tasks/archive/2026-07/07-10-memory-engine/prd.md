# PRD — Memory engine: layer registry + files-as-truth + FTS5 + assembly + tools

**GitHub issue**: #6 (M2 — Memory & extensibility, largest v1 slice). Parent: #1. Blocked by: #5 (DONE).
**Trellis task**: `07-10-memory-engine`
**Definitive design**: `docs/MEMORY-DESIGN.md` (read in full). This prd operationalizes it; on conflict MEMORY-DESIGN wins except where §3 records an explicit leader deviation.

## 1. Goal

The soul substrate, end-to-end: a layer-generic engine (store / indexer / retriever / assembler) driven by a declarative registry; markdown files in the Workspace are the truth, SQLite FTS5 (trigram, CJK-safe) is a rebuildable index; the LLM gets `memory_write` / `memory_search` / `memory_archive` tools — the FIRST tools in our ToolLoopAgent — and every turn's context is assembled deterministically with per-section budgets (pinned promises never truncated).

## 2. Scope

**In**: layer registry (5 v1 layers as DATA) · frontmatter parser/serializer (zero-dep, per research) · store (entry files, atomic, id allocation, path containment) · indexer (migration 002, startup hash-reconciliation, rebuildable) · `Retriever` interface + FTS5-trigram impl (v2 vector seam documented) · assembler (persona placeholder → neutral emotion capsule → pinned → retrieved → ≤1 intention; budgets) · the 3 memory tools wired into the chat loop · chat-agent per-turn assembled `instructions` · tests per §7.

**Out**: auto episodic writes + pre-compaction flush (#7) · activity capture pipeline (M5 #19/#20 — the `activity` layer exists in the registry but nothing writes it yet) · nightly consolidation (v1.5 #27, `status` field ships now) · vector retrieval (v2 #30 — interface seam only) · emotion model (D2: capsule is a static neutral placeholder) · persona card (M4 #16: persona section is a static placeholder string) · Rust/UI surfaces.

## 3. Leader ruling — uniform entry-per-file storage (deviation from the MEMORY-DESIGN tree sketch)

MEMORY-DESIGN's layout sketch mixes three styles (profile `NNNN-slug.md`, activity/episodes daily files, `relationship.md` single file). This slice stores **every layer as entry-per-file** `NNNN-slug.md` under its layer directory:

```
<dataDir>/workspace/memory/
├── global/{profile,activity}/NNNN-slug.md
└── characters/<characterId>/{relationship,episodes,intentions}/NNNN-slug.md
```

Rationale: one storage mechanism (the design's own mantra — policy in data, no special cases); entry-level atomicity, `status`, retention-expiry and reindex all become uniform; activity's future per-capture cards and retention deletes are entry-shaped anyway. The human-readable goal is intact (files, kebab slugs, YAML frontmatter). **The implement agent also updates the tree sketch in `docs/MEMORY-DESIGN.md`** (one surgical edit, note "one entry per file across all layers, decided in #6").

## 4. Registry (data, not code)

`memory/layer-registry.ts`: `MemoryLayerDefinitionSchema` (zod) + `V1_MEMORY_LAYERS` array. Fields per MEMORY-DESIGN:

```ts
{ id, ownership: "global" | "per-character",
  writePolicy: "explicit-tool" | "machine" | "agent" | "consolidation",
  recallPolicy: "pinned" | "retrieved" | "mood-gated",
  pinnedImportanceThreshold?: number,   // retrieved layers may pin high-importance entries (profile: 9)
  truncatable: boolean,                 // relationship: false — the never-truncate guarantee
  retention: "permanent" | { rollingDays: number } | "expiring" }
```

v1 data: `profile`(global, explicit-tool, retrieved+threshold 9, truncatable, permanent) · `activity`(global, machine, retrieved, truncatable, {rollingDays:30}) · `relationship`(per-character, explicit-tool, pinned, **truncatable:false**, permanent) · `episodes`(per-character, agent, retrieved, truncatable, permanent) · `intentions`(per-character, agent, mood-gated, truncatable, expiring). The engine reads ONLY these fields — adding a layer = adding a row (AC 1). `memory_write` accepts exactly the layers whose `writePolicy` is `explicit-tool` or `agent` (registry-derived enum, not hardcoded).

## 5. Frontmatter & files

Fields (MEMORY-DESIGN): `id`, `layer`, `importance: 1-10`, `disclosure?`, `created` (ISO UTC), `status: active|archived`, `emotional_weight?`, `expires?` (ISO, intentions). Parser/serializer per `research/frontmatter-and-budget.md` (strict flat subset, zod-validated, round-trip-proven; writes only from our serializer). Slug + id allocation + path containment per the same research (id/layer/characterId can NEVER traverse out of the memory root — validated, tested). Atomic writes temp+rename. `memory/store.ts` is the new sanctioned fs site — it IS the Workspace, the one directory the agent may touch (invariant 1); check greps that no other new module imports fs.

## 6. Index, retrieval, assembly (key flows)

- **Migration 002** (TS constant): `memory_entries` metadata table (path UNIQUE, id, layer, character_id NULL for global, importance, status, created_at, expires_at, content_hash) + FTS5 **trigram** virtual table (content + disclosure columns) per `research/fts5-trigram-cjk.md` (plain table, rebuilt by indexer; CREATE VIRTUAL TABLE transactionality per research).
- **Write path**: file first (truth), then index upsert; crash between is healed by **startup reconciliation** (walk files, compare sha256 content hashes, insert/update/delete index rows). AC 2's flagship: delete the DB → boot reindex → **identical retrieval results** (tested).
- **Retriever seam** (AC 6): `memory/retriever.ts` = interface + types ONLY (`retrieve({text, characterId, layers?, limit}) → RankedEntry[]` + doc comment naming the v2 hybrid-vector plan, #30); `memory/fts5-retriever.ts` = the impl. Call sites depend on the interface. Ranking: bm25 → importance → recency; filter `status=active`, unexpired, characterId scope (global + own character only — AC 10), disclosure keyword gate (entry with non-empty `disclosure` requires a case-insensitive substring hit of any disclosure token in the query text; empty disclosure always passes).
- **Assembler** (`memory/assembler.ts`): deterministic sections, per-section budgets via the research estimator: 1) persona placeholder (static string, replaced by #16) · 2) neutral emotion capsule placeholder (D2) · 3) **pinned block (~800)**: all active `relationship` + `profile` entries ≥ threshold; overflow drops oldest entries of **truncatable layers only** — `relationship` is never dropped even if it alone exceeds budget (AC 4, tested) · 4) **retrieved block (~600)**: retriever over current message + last 4 turns, framed "things that come to mind" · 5) ≤1 intention when the mood gate passes — v1 heuristic: newest active, unexpired intention whose `disclosure` matches the current message; else none (AC 9, deterministic, tested).
- **chat-agent**: per turn — append user → `instructions = assembler.assemble(...)` → agent stream with tools (per-turn instructions/agent-per-call decision per `research/ai-sdk-v7-tools.md`) → pump untouched (ignoring tool parts verified safe by research; text deltas remain the persisted truth).
- **Tools** (`memory/memory-tools.ts`, thin, characterId-bound per stream call): `memory_write({type, content, importance, disclosure?})` (description tells the model: promises/"remember this" → `relationship`, importance 10) · `memory_search({query, layer?})` · `memory_archive({id})`. Errors return `{ok:false, code, message}` readable results — never throw (loop behavior per research). Tool params zod schemas colocated (NOT in @taki/shared — tools are core-internal surface to the model, not cross-process protocol).

## 7. TDD plan (red-green-refactor; `:memory:` db; tmp-dir workspaces; zero network)

| Cycle | Tests |
| --- | --- |
| A registry | T1 zod: 5 layers parse; bad ownership/retention rejected; writable-layer enum derived from data |
| B files | T2 frontmatter adversarial round-trips (colons/quotes/CJK/emoji; multiline rejected); T3 slug/id allocation + collisions; T4 path containment (traversal via id/layer/characterId rejected) |
| C store | T5 write→exact file content; archive rewrites status; per-character isolation on disk |
| D indexer | T6 fresh index from files; hash-change reconcile; **T7 rebuild-equivalence (delete db → reindex → identical retrieval,AC 2/11)**; expired intentions excluded |
| E retriever | T8 CJK trigram (finds 拉面 in 吃了豚骨拉面; 2-char behavior per research), bm25→importance→recency order, disclosure gate, layer filter, characterId isolation (AC 5/10) |
| F assembler | T9 deterministic order + budgets; **T10 pinned-never-truncated under pressure (relationship survives, oldest truncatable dropped first — AC 4/11)**; T11 intention gate 0-or-1 |
| G tools+loop | T12 tool execute paths incl. `{ok:false}` on non-writable layer; **T13 mock two-step tool loop: model calls memory_write("promise", imp 10) then answers — file+index written, stream stays clean text (pump unaffected), next turn's assembled instructions contain the promise (captured by mock)** |
| H restart | T14 write via tools → new engine instances over same workspace+db → identical retrieval + pinned block present |

## 8. Constraints

All prior §constraints carry (headers/index.md — `memory/` gets one; size caps: split assembler/indexer helpers before 300 lines; closed error union for any WS-visible codes; pino never logs memory content — ids/layers/lengths only; OS-neutral paths). Research files are LAW for FTS5/tools/frontmatter APIs. `db/` stays the sole node:sqlite importer (indexer receives the wrapper). No new npm deps unless research proved necessity. Registry data drives ALL behavior branches (check hunts for hardcoded layer names outside the registry + tool description).

## 9. Verification

```bash
pnpm -r typecheck && pnpm lint && pnpm -r test
# leader live smoke: fresh TAKI_DATA_DIR → chat "记住我们的约定：每周五一起看电影" → tool writes relationship entry (file visible, importance 10)
#   → restart core → new chat "我们有什么约定?" → answer reflects the promise (pinned block); memory_search via chat exercises retrieval; CJK query works
```

AC mapping: AC1←T1 · AC2←T6/T7+smoke · AC3←T2/T5 · AC4←T10 · AC5←T8+smoke · AC6←interface review+doc · AC7←T12/T13+smoke · AC8←T9 · AC9←T11+capsule review · AC10←T4/T5/T8 · AC11←T7/T10/T9/T8.
