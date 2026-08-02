# Batch 3 design — Retrieval migration

Pre-development design for PRD §Batch 3. Binding inputs: prd.md §Batch 3 + notes.md rulings
(segmenter Option 1 + D53 upgrade path, owner hard constraint 2026-07-28 "retrieval is a
long-term optimization module — NOTHING hardcoded, keep it maintainable"; Q2 gate removal;
Q2/Q8 hit shape + fence; 其四 search events; R13 config). Research bank
`research/ra-retrieval-stack.md` is LAW for this batch. Written 2026-07-29 by the leader;
owner-confirmed before dispatch.

## 1. The verdict being implemented (ra §A.0/§F Option 1 — owner-ratified)

Keep SQLite FTS5; the work is a TOKENIZER MIGRATION, not an engine swap. `trigram` → `unicode61`
+ an app-segmented `search_terms` column (Nocturne's shipped pattern). Measured on the faithful
A/B (ra §A.1): rank@1 17/25 → 24/25, in-top3 25/25, index SMALLER than trigram. Every case the
old design misses is a natural-language question — exactly the T5-R12 one-shot-search shape.

Owner-accepted regressions (do NOT re-litigate, do NOT silently mitigate beyond what is listed):
ASCII infix matching is lost ("scode" no longer finds VSCode; whole-token + case-fold still
works); CJK substring-of-token misses (查"面"不中"拉面"); proper nouns fragment with no glossary
hook. Escalation is D53 (bigram-union 1b / jieba 1c), TRIGGERED by observed misses, not built now.

## 2. Module map

| File | Change |
| --- | --- |
| `memory/search-tokenizer.ts` (NEW) | `SearchTokenizer` interface + `createIntlSegmenterTokenizer()` v1 impl + stoplist filter. THE swappable seam (D53) |
| `db/migrations/008-memory-fts-unicode61.ts` (NEW) | DROP + CREATE `memory_fts` with `(path UNINDEXED, disclosure, content, search_terms, tokenize='unicode61')`; blank `content_hash` → boot reconcile refills from files (mechanism proven by 006) |
| `db/migrations/009-memory-events-count.ts` (NEW) | `ALTER TABLE memory_events ADD COLUMN count INTEGER` (nullable; skip/reinforce leave it NULL; search records hit count) |
| `memory/fts5-query.ts` | Rewrite: trigram decomposition → tokenizer-driven (segment → stoplist → dedupe → quoted tokens OR'd); LIKE fallback KEPT for degenerate input (zero usable tokens); same `FtsQuery` result type |
| `memory/fts5-retriever.ts` | DELETE the `disclosureMatches` post-filter (Q2); takes the tokenizer via deps; layer post-filter + cap unchanged |
| `memory/retriever.ts` | `RankedEntry` gains `origin: string` (disclosure already present) |
| `db/memory-repo.ts` | `MemoryUpsert` gains `searchTerms`; fts insert gains the column; `SEARCH_MATCH_SQL` bm25 becomes 4-column with CONFIG-fed weights (repo factory takes them) |
| `memory/indexer.ts` | computes `search_terms = dedupe(tokenize(disclosure + " " + content))` via injected tokenizer |
| `config/memory-config.ts` | + `bm25Weights` (env `TAKI_MEMORY_BM25_WEIGHTS`, CSV "disclosure,content,searchTerms", zod 3 positive numbers, fail-closed defaults) + `stoplist` (env `TAKI_MEMORY_STOPLIST` on/off, default ON) |
| `memory/memory-tools.ts` | `toHit` adds `disclosure` + `origin`; observed hit content wrapped via `fenceUntrusted` (source="memory"); search execute records a `search` event; both tool factories accept an optional turn-seq getter |
| `memory/memory-engine.ts` | threads tokenizer + weights + seq getter; `createTools(characterId, seq?)` / `createBackgroundTools(characterId, seq?)` |
| `main.ts` | wires the seq getter (`() => timelineRepo.latestSeq(id)`) at the tool-creation call sites; loads the new config fields |
| `db/memory-events-repo.ts` | kind enum + `count` field on record/row |

`disclosure-gate.ts` SURVIVES untouched — `pickIntention` (assembler) is its only remaining
consumer (Q2 ruling scoped the removal to the retriever).

## 3. The tokenizer seam (owner hard constraint: nothing hardcoded)

```ts
interface SearchTokenizer { tokenize(text: string): string[] }   // segmented, deduped, stoplist-applied
createIntlSegmenterTokenizer(opts: { stoplist: boolean }): SearchTokenizer
```

- v1 = `Intl.Segmenter("zh", { granularity: "word" })`, word-like segments only. Node 24 full-ICU
  CjkBreakEngine (dictionary + Viterbi) — ra §B.2 verified mixed CJK+ASCII tokens (VSCode,
  TakiAgent) come out intact.
- ONE tokenize path shared by index side and query side (consistency is what makes matches land —
  ra §B.2). Stoplist (~30 function words, const DATA array finalized at implement from ra's probe
  class: 的/了/是/什么/…) applied inside the tokenizer; config toggle.
- D53 upgrade = a new `SearchTokenizer` impl file + one wiring change; NOTHING else may know which
  tokenizer runs. Weights/pipeline equally swappable: weights are config; the Retriever seam keeps
  returning ranked candidates so v2 hybrid (sqlite-vec — ra §C verified loadable into node:sqlite,
  pointer ONLY) is an addition, not a rewrite.

## 4. Weights (the direction is ruled; the values are derived, not guessed)

`bm25(memory_fts, 0.0, w_disclosure, w_content, w_search_terms)` — ascending, best-first (SQLite
bm25 is negative-better). Ruled DIRECTION (Nocturne A3 + ra §A.1): disclosure and search_terms
ABOVE content — under unicode61 the raw `content` column is nearly dead for CJK (one giant token),
so its old 2.0 top-weight must NOT be carried over. Values: implement derives them against the
A/B fixture (§6) and records the choice in a why-comment citing the fixture; they ship as
fail-closed config defaults.

## 5. Search events (其四) + seq threading

`memory_search` execute records `{kind:"search", characterId, turnSeq: seq?.(), count: hits}` —
ids/counts only, never query text or content (logging-guidelines). Seq getter is an OPTIONAL
closure threaded main → engine → tool factories; `chat-agent.ts` is FROZEN, so the wiring lives
entirely in `main.ts` call sites (both the chat toolset and the flush background set get
`() => timelineRepo.latestSeq(characterId)`). Implement must READ the actual chat wiring in
main.ts before choosing the exact hook point (source-grounding: explore, don't assume).

## 6. TDD table

| Test | Asserts |
| --- | --- |
| 2-char CJK (ra req b) | `拉面` / `电影` hit via MATCH (no LIKE fallback involved) |
| NL question class (ra req c) | `我对什么过敏` finds the 香菜过敏 row — the exact ra §A.1 miss class, ≥3 cases from the report |
| Mixed CJK+ASCII | `VSCode` query hits; `vscode` (case-fold) hits |
| Disclosure boost | a row whose `disclosure` matches the query vocabulary outranks a content-only match |
| Gate removal regression (Q2) | an entry WITH a disclosure is retrievable by a content-only query (the old AND gate made this fail) |
| Reindex equivalence | incremental indexEntry results == blank-hash + reconcile results (same corpus, same queries) |
| Weights from config | env CSV override changes ranking; default fail-closed |
| Stoplist toggle | ON shrinks the result set for a function-word query with rank@1 unchanged (ra §B.2); OFF restores |
| LIKE fallback | degenerate input (pure stopwords / symbols) still returns the substring match |
| Hit shape (Q2/Q8) | `toHit` carries `disclosure` + `origin`; observed hit content arrives fenced, self unfenced |
| Search event | one event per memory_search with hit count + threaded seq; skip/reinforce rows keep NULL count |
| A/B fixture regression net | the compact corpus (~20 rows / ~15 queries drawn verbatim from ra §A.1/§B.2 examples) — must-pass classes locked green |

## 7. Constraints and frozen zones (batch 3)

- Frozen: `chat-agent.ts` (D1 — seq threading must not touch it), `assembler.ts` entirely (the
  Retriever interface change is additive — `RankedEntry.origin` — and the assembler's retrieved
  section keeps compiling untouched; if it does not, STOP and report), blocks family
  (block-registry/store, batch 2), batch-1 write side (episodic/flush/dedupe/auto-layer-policy/
  write-convention), `disclosure-gate.ts` internals.
- Zero new deps (the whole point of Option 1); OS-neutral; size caps; headers; index.md; comments
  why-only; every new number = config or const DATA with zod (R13); no memory content in logs or
  events.
- Migration order 008 → 009 registered in index-list; both get tests (006-style: mechanism, not
  just DDL).

## 8. Deliberately deferred (recorded, not silent)

- D53 escalations (1b bigram-union / 1c jieba glossary) — trigger: observed proper-noun/substring
  misses in practice. v2 hybrid vector (#30, sqlite-vec) — the seam stays open, nothing built.
- `CANDIDATE_CAP = 50` over-fetch stays as-is (pre-existing, not a new number).
- Retrieved-section death + `RECALL_WINDOW` removal — batch 5 (R6).
- ASCII infix loss NOT mitigated with `token*` prefix magic in v1 — keep the query builder
  minimal; revisit only on observed misses (same D53 trigger family).
