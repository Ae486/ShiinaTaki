# Research: FTS5 + trigram tokenizer + CJK retrieval (node:sqlite, Node 24.18.0)

- **Query**: Is FTS5+trigram viable for the memory index per `docs/MEMORY-DESIGN.md` (CJK substring retrieval, bm25 ranking, rebuildable index)?
- **Scope**: external (SQLite bundled in Node) + empirical
- **Date**: 2026-07-10
- **Evidence**: empirical probe on `node v24.18.0` / this machine (output pasted trimmed; throwaway script under `research/tmp/`, deleted). Official docs: https://www.sqlite.org/fts5.html#the_trigram_tokenizer. Baseline `node:sqlite` facts (API, transactions, pragmas) already verified in `.trellis/tasks/archive/2026-07/07-10-timeline-persistence/research/node-sqlite-api.md` — not re-verified here.

## Verdict

FTS5 **is compiled in** (SQLite **3.53.1**, `ENABLE_FTS5`), trigram tokenizer **works**, CJK substring matching **works for queries of >= 3 unicode chars**. 2-char CJK queries return **empty (no error)** — use a `LIKE` fallback. Plain (non-external-content) FTS5 table + delete-all/reinsert rebuild has **no gotchas**. `CREATE VIRTUAL TABLE` inside a transaction **works and rolls back cleanly** — fine for our TS-constant migration runner.

## 1. FTS5 availability

```
sqlite_version()                          -> 3.53.1
sqlite_compileoption_used('ENABLE_FTS5')  -> 1
PRAGMA compile_options (FTS-related)      -> ENABLE_FTS3, ENABLE_FTS3_PARENTHESIS, ENABLE_FTS5
CREATE VIRTUAL TABLE t USING fts5(content) -> OK
```

3.53.1 >> 3.34 (trigram introduced) and >= 3.45 (indexed LIKE/GLOB on trigram tables, `remove_diacritics` option). No ICU compiled in (irrelevant — trigram needs nothing extra).

## 2. Trigram tokenizer

All accepted empirically:

```sql
CREATE VIRTUAL TABLE t USING fts5(title, body, tokenize='trigram');            -- OK
CREATE VIRTUAL TABLE t USING fts5(c, tokenize="trigram case_sensitive 1");     -- OK
CREATE VIRTUAL TABLE t USING fts5(c, tokenize="trigram remove_diacritics 1");  -- OK
```

Semantics (docs, confirmed by probe): a MATCH token matches **any character substring** of a row, not whole tokens. Default `case_sensitive 0` = case-insensitive (`GODZILLA` matched `Godzilla` empirically). Constraints from docs: `remove_diacritics 1` requires `case_sensitive 0` (both 1 is an error) and disables indexed LIKE/GLOB; `case_sensitive 1` indexes only GLOB, not LIKE. **Recommendation: plain `tokenize='trigram'` (both defaults)** — keeps case-folding AND indexed LIKE.

## 3. CJK empirical proof (probe output)

Data: `(1, "拉面日记", "吃了豚骨拉面")`, `(2, "约定", "答应周五一起看电影")`, `(3, "mixed", "今天用VSCode写了TypeScript代码")`, `(4, "english only", "Watched the new Godzilla movie trailer")`, `(5, "two-char body", "拉面")`.

| Query (`WHERE t MATCH ?`) | Result |
|---|---|
| `豚骨拉` (3-char CJK) | rowid 1 |
| `豚骨拉面` (4-char) | rowid 1 |
| `拉面` (2-char CJK) | **[] — empty, no error** |
| `电影` (2-char CJK) | **[]** |
| `看电影` (3-char) | rowid 2 |
| `godzilla` / `GODZILLA` | rowid 4 (case-folded) |
| `VSCode` | rowid 3 |
| `VS` (2-char ASCII) | [] |
| `用VS` (3 chars crossing CJK/ASCII) | rowid 3 — trigrams cross script boundaries |
| `豚骨拉 OR 看电影` | rowids 1, 2 (OR works) |
| `豚骨 电影` (space = implicit AND of two sub-3 tokens) | [] |
| `拉面?` (raw punctuation, unquoted) | **fts5 syntax error** |
| `"拉面?"` (double-quoted) | [] (safe, treated as literal substring) |

**The 2-char limitation** (docs: "Substrings consisting of fewer than 3 unicode characters do not match any rows"): it is *unicode chars*, not bytes (豚骨拉 = 9 UTF-8 bytes, matched). Two consequences:

1. **Query side**: a 2-char query (`拉面`, `电影` — extremely common Chinese words) finds nothing via MATCH. **Workaround (recommended)**: when every token in the sanitized query is < 3 chars, fall back to `WHERE body LIKE '%拉面%'` on the same FTS5 table — verified: `LIKE '%拉面%'` returned rowids 1 AND 5. On this build (>= 3.45, defaults) LIKE on a trigram table is index-assisted when the pattern has a >= 3-char run; a 2-char pattern degrades to a linear scan but stays **correct** — fine at our scale (thousands of entries). Mixed case: run MATCH with the >= 3-char tokens and optionally OR-in LIKE for short ones; v1 can keep it simpler (MATCH if any token >= 3 chars, else LIKE).
2. **Content side (subtle)**: a row whose entire indexed text is < 3 chars produces **zero trigrams** — rowid 5 (`拉面`) was invisible to every MATCH. Memory entries are sentences, so this is theoretical; the LIKE fallback also covers it.

**Query sanitization is mandatory**: raw user text with `?`/`(`/`"` etc. is FTS5 query syntax and *throws*. Rule: split on whitespace, wrap each token in double quotes with internal `"` doubled (`token.replaceAll('"', '""')`), join with ` OR ` (or AND per retriever policy). Quoted tokens are treated as literal substrings (verified).

## 4. bm25() ranking + tiebreakers

Verified on the two-column table:

```sql
-- per-column weights: title x10, body x1 (weight order = column declaration order)
SELECT rowid, bm25(t, 10.0, 1.0) AS w FROM t WHERE t MATCH '豚骨拉' ORDER BY w;
-- -> title-hit row (-1.217) before body-hit row (-0.796)
```

- bm25 returns **negative** values, better = more negative, so `ORDER BY` **ascending** gives best-first. The implicit `rank` column equals `bm25()` with default weights (`ORDER BY rank` verified).
- Own tiebreakers compose naturally: `ORDER BY bm25(t, ...), importance DESC, created DESC` — verified with `ORDER BY bm25(t), rowid DESC` (two equal-score rows ordered by the tiebreaker). MEMORY-DESIGN's "rank bm25, then importance, then recency" is a single ORDER BY away; importance/created can live as UNINDEXED columns or be joined from the metadata table by id.

## 5. Rebuildable-index pattern: plain FTS5 table (recommended)

Files are the truth; the index must satisfy "delete DB -> reindex from files -> identical retrieval".

- **Plain FTS5 table** (content stored in the FTS table, inserted by the indexer): simplest; `DELETE FROM t` then reinsert verified working (post-reinsert MATCH correct). `INSERT INTO t(t) VALUES('optimize')` (merges the index after churn) and `INSERT INTO t(t) VALUES('integrity-check')` both ran clean afterwards. `optimize` is a nicety after full reindex/large deletes, not required for correctness.
- External-content (`content='src'`) also works here (creation verified) but adds the sync-triggers/`'rebuild'` machinery for zero benefit — our source of truth is markdown files, not another SQLite table. Contentless saves space but can't return stored text and complicates delete. **Recommendation: plain.** Duplication (text in file + FTS table) is the explicit design (derived index).
- Per-entry update = `DELETE FROM t WHERE rowid = ?` (or `WHERE id = ?` if id is a column) + reinsert; startup reconciliation by content hash decides which entries to re-upsert.

## 6. Virtual table creation inside the migration runner

Our runner wraps each migration's `db.exec(sql)` in BEGIN/COMMIT (`packages/core/src/db/migration-runner.ts:31-41`). Verified:

- `BEGIN; CREATE VIRTUAL TABLE ... USING fts5(..., tokenize='trigram'); INSERT ...; COMMIT;` — works, queryable after commit.
- Same inside ROLLBACK — the virtual table (and its shadow tables) is **gone** after rollback, `sqlite_master` clean.

No special-casing needed: an FTS5 migration is just another `{version, sql}` constant. Note FTS5 creates shadow tables (`t_data`, `t_idx`, `t_content`, ...) — harmless, but any "list tables" tooling should filter `name LIKE 't_%'` or use `sqlite_master.type`.

## Suggested DDL sketch (for the indexer migration)

```sql
CREATE TABLE memory_meta (
  id TEXT PRIMARY KEY, layer TEXT NOT NULL, character_id TEXT,
  importance INTEGER NOT NULL, status TEXT NOT NULL, created TEXT NOT NULL,
  disclosure TEXT, file_path TEXT NOT NULL, content_hash TEXT NOT NULL
) STRICT;
CREATE VIRTUAL TABLE memory_fts USING fts5(id UNINDEXED, disclosure, content, tokenize='trigram');
-- retrieval: SELECT m.* FROM memory_fts f JOIN memory_meta m ON m.id = f.id
--   WHERE memory_fts MATCH :q AND m.status = 'active'
--   ORDER BY bm25(memory_fts, 2.0, 1.0), m.importance DESC, m.created DESC
```

(Weights/columns are the implementer's call; the mechanics above are what is verified.)

## Caveats / Not Found

- `STRICT` does not apply to virtual tables (FTS5 columns are typeless) — only the meta table can be STRICT.
- bm25 scores of a title-only hit vs body-only hit came out equal under default weights in one probe case — do not rely on column-length normalization for fine ordering; the importance/recency tiebreakers do the real work at our corpus size.
- LIKE on non-ASCII is byte-wise exact (no CJK case concept) — irrelevant for CJK, but means the LIKE fallback is case-SENSITIVE for ASCII, unlike MATCH. Acceptable for the 2-char fallback path; note it in the retriever contract if ASCII 2-char queries matter (they rarely do — `VS` etc.).
- Did not benchmark index size/speed at scale (thousands of entries assumed fine; trigram indexes are ~3x text size — measure only if it ever hurts).
