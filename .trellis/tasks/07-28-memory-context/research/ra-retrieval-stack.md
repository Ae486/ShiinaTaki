# Research: retrieval stack — import a library, or keep SQLite FTS5?

- **Query**: "Is there a framework/library we can import to own the retrieval function, instead of building it ourselves?" + pin the CJK segmentation choice with evidence.
- **Scope**: mixed (local references → empirical probes → web)
- **Date**: 2026-07-28
- **Agent**: retrieval-research

## Requirement being served

T5-R12 grants the agent exactly **ONE** deliberate `memory_search` call, no retry. That single search must hit for:

- (a) exact CJK keywords;
- (b) 2-char common Chinese words (`拉面` / `电影`) — today's FTS5 **trigram** MATCH returns empty by design and we degrade to a linear `LIKE`;
- (c) vocabulary-mismatch cases bridged by an indexed natural-language trigger field (`disclosure`, phrased in the question's vocabulary).

Chinese-first corpus, thousands of entries, single-user desktop. Constraints: provider-agnostic (no mandatory embedding), OS-neutral core (Windows + Ubuntu), single process / single DB writer, KISS, permissive license.

---

## 0. Verdict table

| Candidate | Ranking | CJK story | Persistence | License / maint. | Verdict |
|---|---|---|---|---|---|
| **SQLite FTS5 `trigram`** (today) | bm25, per-column weights | substring ≥ 3 chars; **2-char CJK = empty by design** | in our DB | bundled in Node 24 | **Keep the engine, change the tokenizer** — see §A.0 |
| **SQLite FTS5 `unicode61` + segmented aux column** (Nocturne pattern) | bm25, per-column weights | **works incl. 2-char**, via app-layer segmentation | in our DB | bundled | **RECOMMENDED** (§A.0, §B) |
| Orama `@orama/orama` 3.1.18 | BM25 | `@orama/tokenizers/mandarin` (**"experimental"**) | **in-memory index**, `persist`/`restore` to disk | Apache-2.0, very active (2026-07-27) | **Reject** — duplicates our index in RAM + second persistence artefact; parity not decisive advantage |
| FlexSearch 0.8.212 | contextual/resolution scoring, **not BM25** | built-in `Charset.CJK` encoder | in-memory; persistent adapters incl. its own SQLite schema | Apache-2.0, active (2025-09) | **Reject** — non-BM25 ranking, and its SQLite adapter means a second schema in our DB |
| MiniSearch 7.2.0 | BM25 | **no built-in CJK**; `tokenize`/`processTerm` seam — community wires `Intl.Segmenter` or `jieba-wasm` | **in-memory only** (JSON serialise) | MIT, zero deps, active (2025-09) | **Reject** — would duplicate the whole corpus in RAM; the seam it offers is exactly what we'd write ourselves |
| lunr 2.3.9 / elasticlunr 0.9.5 | TF-IDF-ish (not BM25) | none | in-memory | MIT, **stale** (2023 / 2022) | **Reject** |
| wink-bm25-text-search 3.1.2 | BM25 | none; depends on `wink-eng-lite-web-model` (**English model**) | in-memory | MIT, **stale** (2022) | **Reject** — English-centric by construction |
| LlamaIndex.TS `KeywordTableIndex` | keyword-count sort (not BM25) | n/a | doc/index store | MIT | **Auto-reject** — **LLM call per node at index time** (§D) |
| LlamaIndex.TS `Bm25Retriever` | BM25 | inherits tokenizer of impl | needs a `docStore` | MIT | Reject — framework weight for a component we already have |
| LangChain.js `BM25Retriever` | Okapi BM25 (`okapibm25`) | **none** — `preprocessFunc` = `text.toLowerCase().split(/\s+/)` | **none** — re-scores a `Document[]` array per query | MIT | **Auto-reject** — a Chinese sentence becomes ONE token (§D) |
| `sqlite-vec` 0.1.9 | — (vector) | — | our DB, via extension | MIT OR Apache-2.0, pre-v1 | **v2-ready, do not adopt now** (§C) |
| Vectra 0.15.0 | — (vector, plain files) | — | JSON files | MIT but dep tree pulls `openai`, `@grpc/grpc-js`, `cheerio`, `turndown` | Reject as a dependency; the *pattern* is the v2 fallback (§C) |

**Segmenter verdict (§B): `Intl.Segmenter` with `zh` + `granularity:'word'`, zero install.** Node 24.18.0 on this machine ships **full ICU 78.3** (`icu_small=false`), and ICU's Chinese word break is `CjkBreakEngine` — a dictionary with per-word costs + **Viterbi decoding** ([ICU docs](https://unicode-org.github.io/icu/userguide/boundaryanalysis/), [CjkBreakEngine ref](https://fossies.org/dox/icu-release-78.3/classicu_1_1CjkBreakEngine.html)) — i.e. the same algorithmic family as jieba, not a naive rule split. This closes the gap flagged in `t5-memory-systems-survey.md` §10.3 ("`Intl.Segmenter`'s Chinese segmentation quality is unsourced and must be checked before A4 is planned").

---

## A. Importable JS/TS full-text libraries vs staying on SQLite FTS5

### A.0 The decisive finding is NOT which library — it is our tokenizer

Nocturne's `search_terms` pattern that we planned to port does **not** work on a trigram table. Two facts, both verified locally on `node v24.18.0` / SQLite 3.53.1:

1. **Nocturne's FTS5 table is `unicode61`, not trigram.** `references/nocturne_memory-main/backend/db/migrations/009_v1.3.0_add_search_fts.py:86-96` and `010_v2.0.0_add_namespace.py:148-158` both declare `tokenize = 'unicode61'` over `(namespace, domain, path, node_uuid, uri, content, disclosure, search_terms)`. Our table is `memory_fts(path UNINDEXED, disclosure, content, tokenize='trigram')` (`packages/core/src/db/migrations/002-memory.ts:25`).
2. **A 2-char MATCH token yields zero trigrams, so a segmented aux column changes nothing under `trigram`.** Probe: identical rows loaded into a trigram table and a `unicode61` + `search_terms` table; queries segmented with `Intl.Segmenter`:

```
query      | A trigram(raw)                 | B unicode61+seg
拉面        | NO-QUERY (all tokens <3 chars) | 1
电影        | NO-QUERY (all tokens <3 chars) | 2
豚骨拉面     | NO-QUERY (all tokens <3 chars) | 1
用户叫什么名字 | NO-QUERY (all tokens <3 chars) | 4,2,5
VSCode     | 3                              | 3
```

So requirement (b) is a **migration** (`tokenize='trigram'` → `'unicode61'` + a `search_terms` column), not a config tweak. Cost is low because the index is fully rebuildable from the markdown files.

### A.1 Head-to-head: today's retriever vs the aux-column designs

Faithful A/B — column A replicates `packages/core/src/memory/fts5-query.ts` **verbatim** (whitespace split → all overlapping trigrams → OR, with `LIKE` fallback when no token reaches 3 chars) and `memory-repo.ts:82`'s `bm25(memory_fts, 0.0, 1.0, 2.0)`. Corpus: 30 realistic Chinese memory entries (`disclosure` + `content`), 25 queries, top-3, "rank@1" = expected row is first.

|  | rank@1 | in-top3 | index bytes (30 rows) |
|---|---|---|---|
| **trigram (today)** | **17/25** | 17/25 | 7595 |
| **unicode61 + `Intl.Segmenter` terms** | **24/25** | **25/25** | **6198** |
| unicode61 + deterministic bigram terms | 23/25 | 25/25 | 8301 |
| unicode61 + union (segmenter ∪ bigram) | 23/25 | 25/25 | 9970 |

Every case today's trigram design misses is a natural-language question — exactly the T5-R12 shape:

```
我对什么过敏      trigram ✗ [-]     segmenter ✓ [5,4,3]
我在做什么项目     trigram ✗ [-]     segmenter ✓ [28,11,4]
我不吃什么        trigram ✗ [-]     segmenter ✓ [27,4,3]
我在读什么书      trigram ✗ [-]     segmenter ✓ [12,4,3]
我讨厌什么        trigram ✗ [-]     segmenter ✓ [19,27,4]
我玩什么游戏      trigram ✗ [-]     segmenter ✓ [21,11,4]
```

Cause: the query's trigram windows (`我对什`, `对什么`, `什么过`, `么过敏`) do not align with any 3-char window of `用户对香菜过敏` / `当用户问起过敏源或饮食禁忌时`. Segmentation produces `过敏` as a token on both sides and the match lands.

The aux column is also **smaller** than the trigram index (6198 vs 7595 bytes) — a trigram index is ~3× text; segmented terms are ~1.41× text.

**Not a free win — two regressions to accept:**

- **ASCII infix matching is lost.** Under `trigram`, `"scode"` matched `今天用VSCode写了TypeScript代码`. Under `unicode61` it does not; only whole tokens (and `token*` prefixes) match. Verified:
  ```
  "godzilla"  u=[1] t=[1]      "godzil"  u=[]  t=[1]      "godzil"* u=[1] t=[1]
  "vscode"    u=[]  t=[2]      "scode"   u=[]  t=[2]      "typescript" u=[] t=[2]
  ```
- **Under `unicode61` the raw `content` column is nearly dead for CJK-mixed text.** `unicode61` treats CJK ideographs as letters, so `今天用VSCode写了TypeScript代码` indexes as **one token** — which is why `"vscode"` above returns empty on the raw column. All recall must come from the space-separated `search_terms` column. That is precisely why Nocturne carries `search_terms` alongside `content` rather than instead of it, and it means the bm25 weight on `content` earns little for Chinese rows.
- **CJK suffix/infix within a token also fails**: `"面"` does not match the token `拉面`; `"拉"*` does. Bigram terms fix this class; the segmenter alone does not.

### A.2 Why none of the JS libraries beats this

Every candidate is an **in-memory inverted index** that would sit *beside* the SQLite index we already maintain, doubling both the index and the write path — a direct anti-sprawl violation with no decisive advantage:

- **Orama 3.1.18** (Apache-2.0, `time.modified` 2026-07-27, most actively maintained of the set): BM25 full-text plus vector/hybrid in one API ([docs](https://docs.orama.com/docs/orama-js/supported-languages/using-chinese-with-orama)). Chinese needs `@orama/tokenizers/mandarin`, self-labelled **"Chinese (Mandarin, experimental)"** in the package README, with Korean still "work in progress". The tokenizers package was migrated from a Rust/WASM build to plain TypeScript in [PR #899](https://github.com/oramasearch/orama/pull/899), and [issue #883](https://github.com/oramasearch/orama/issues/883) documents shipped-broken export paths and an un-awaited async `tokenize()` that crashed `insert`. Attractive on paper for the v2 hybrid story; not attractive enough to relocate our index out of the DB. Verdict: reject.
- **FlexSearch 0.8.212** (Apache-2.0): has a real built-in `Charset.CJK` encoder — `index.add(0, "一个单词"); index.search("单词")` is the documented example ([encoder.md](https://github.com/nextapps-de/flexsearch/blob/master/doc/encoder.md)). But its ranking is a resolution/context scoring model, **not BM25**, and its persistence story for Node is a set of DB adapters (`flexsearch/db/sqlite`, postgres, redis, mongo, clickhouse) that would install *its own* schema in our database — colliding with the single-writer/one-schema invariant. Verdict: reject.
- **MiniSearch 7.2.0** (MIT, zero runtime deps, 826 KB unpacked): clean BM25 with `tokenize` / `processTerm` seams at both index and query time ([docs](https://lucaong.github.io/minisearch/)). No built-in CJK — [issue #201](https://github.com/lucaong/minisearch/issues/201) is the canonical thread where users wire in `Intl.Segmenter`, `jieba-wasm`, or hand-rolled bigrams. That is exactly the code we would write against FTS5 anyway, minus the "hold the whole corpus in RAM and serialise a second artefact" cost. Verdict: reject — but the thread is a valuable source and is cited again in §B.
- **lunr 2.3.9 / elasticlunr 0.9.5**: last publishes 2023-07 / 2022-06, no CJK, not BM25. Reject.
- **wink-bm25-text-search 3.1.2**: MIT, real BM25, but last published 2022-11 and its dependency list is `wink-nlp` + `wink-eng-lite-web-model` — an **English** model. Reject.

---

## B. CJK segmenters for the aux-column pattern

### B.1 Comparison

| Option | Algorithm | Custom words | Install footprint | Win + Ubuntu | License | Maintenance |
|---|---|---|---|---|---|---|
| **`Intl.Segmenter('zh',{granularity:'word'})`** | ICU `CjkBreakEngine`: dictionary with per-word costs + **Viterbi decoding** | **No API** — cannot add glossary words | **zero** (built into Node) | trivially neutral; **needs full-ICU Node** | n/a | tracks Node/ICU (78.3 / CLDR 48 here) |
| `@node-rs/jieba` 2.0.1 | jieba-rs (Rust) | yes (jieba dict API) | native `.node`, ~2.9 MB win-x64 / 3.8 MB linux-x64; **prebuilt, no node-gyp** | yes — optionalDeps cover `win32-x64-msvc`, `win32-arm64-msvc`, `linux-x64-gnu`, `linux-x64-musl`, `linux-arm64-gnu/musl`, +wasm32-wasi | MIT | latest 2.0.1, `time.modified` 2025-05-04 |
| `jieba-wasm` 2.4.0 | jieba-rs via WASM, exposes `cut_for_search` | yes | **16.1 MB unpacked**; no native compile | yes (WASM is arch-neutral) | MIT | 2025-09-17 |
| `nodejieba` 3.5.8 | cppjieba | yes | `@mapbox/node-pre-gyp` + `node-addon-api` — **compiles if no prebuilt matches** | risk on either OS | MIT | 2026-03-23 |
| `segmentit` 2.0.3 | dictionary + heuristics, pure JS | yes (`loadDict`) | **15.0 MB unpacked**, dep `preval.macro` | yes | MIT | **stale — 2022-05, last version 2019-12** |

Auto-reject under our constraints: `nodejieba` (native compile path). `segmentit` is effectively unmaintained and the largest install for the weakest algorithm.

### B.2 Empirical probe — `Intl.Segmenter` on realistic strings

Environment: `node v24.18.0`, `process.versions.icu = 78.3`, `unicode = 17.0`, `cldr = 48.0`, `process.config.variables.icu_small = false` (**full ICU**), `Intl.Segmenter.supportedLocalesOf(['zh','zh-Hans','ja','ko'])` → all four.

Content sentences:

```
吃了豚骨拉面，汤头很浓          -> ["吃了","豚","骨","拉面","汤头","很","浓"]
答应周五一起看电影              -> ["答应","周五","一起","看","电影"]
今天用VSCode写了TypeScript代码 -> ["今天","用","VSCode","写","了","TypeScript","代码"]
用户的名字是pleia              -> ["用户","的","名字","是","pleia"]
用户喜欢在深夜写代码，不喜欢被打断  -> ["用户","喜欢","在","深夜","写","代码","不","喜欢","被打","断"]
用户正在开发一个叫TakiAgent的桌面宠物项目
                             -> ["用户","正在","开发","一个","叫","TakiAgent","的","桌面","宠物","项目"]
记住：用户对香菜过敏             -> ["记住","用户","对","香菜","过敏"]
拉面店在秋叶原车站附近           -> ["拉面","店","在","秋","叶","原","车站","附近"]
```

Queries:

```
拉面              -> ["拉面"]
电影              -> ["电影"]
还记得上次说的电影吗  -> ["还","记得","上次","说的","电影","吗"]
用户叫什么名字      -> ["用户","叫","什么","名字"]
我用什么编辑器      -> ["我","用","什么","编辑","器"]
豚骨拉面           -> ["豚","骨","拉面"]
我对什么过敏        -> ["我","对","什么","过敏"]
桌面宠物项目        -> ["桌面","宠物","项目"]
```

Judgement for **search recall** (the criterion that matters, not linguistic correctness):

- **Mixed CJK+ASCII is handled correctly** — `VSCode`, `TypeScript`, `TakiAgent`, `pleia` come out as intact single tokens. This is the case that breaks a naive char-splitter.
- **Query and content segment consistently** for the common path: `电影`, `拉面`, `过敏`, `名字`, `项目`, `宠物` are produced identically on both sides, which is what makes the aux-column match land.
- **Locale is irrelevant**: `zh`, `zh-Hans` and `ja` produced byte-identical output on all three test sentences — the CJK dictionary is unified (matches ICU's documented "unified dictionary" for Chinese and Japanese).
- **Known weaknesses, honestly:**
  - **Proper nouns fragment.** `哥斯拉` → `["哥","斯","拉"]`; `秋叶原` → `["秋","叶","原"]`; `豚骨` → `["豚","骨"]`. Retrieval still works here because the query fragments the same way, but IDF is diluted (single chars are common) so ranking is weaker for names. **`Intl.Segmenter` has no custom-word API** — this is the one capability Nocturne uses (`jieba.add_word` for glossary keywords, `search_terms.py:43-50`) that we cannot reproduce.
  - **Query-as-substring-of-token misses.** Reported by a MiniSearch user in [issue #201](https://github.com/lucaong/minisearch/issues/201): "`懵逼了` in a document is broken down `['懵','逼了']`, while a search term `懵逼` is broken down `['懵','逼']`. This damages searchability." Reproduced verbatim here, plus `预置` → `["预","置"]` standalone but `["预","置"]` inside `这个功能预置了三种模式`. I also hit it in the corpus probe: query `科幻` missed a row whose content segmented to `科幻片` as one token. Deterministic **bigrams do not have this failure mode** (probe 4: bigram 14/15 vs segmenter 13/15 on that case set).
  - **Function words are indexed** (`的`, `了`, `是`, `什么`). A ~30-entry stoplist raised precision markedly (result-set size for `我对什么过敏` went 4 → 1) with **no change in rank@1** (13/15 both ways) — bm25 IDF was already handling it. Cheap, optional.
- **Throughput**: 6000 segmentations of `disclosure + content` pairs in **92 ms** (~65 k/s). Indexing cost is a non-issue at our scale.

**Bigrams as an alternative or supplement.** A dependency-free `[c₁c₂, c₂c₃, …]` expansion over CJK runs scored 23/25 rank@1 and 25/25 in-top3 — statistically level with the segmenter — is fully deterministic (query and content can never disagree), and additionally recovers CJK infix/suffix matching that `unicode61` otherwise loses. Cost: aux text 2.25× raw vs 1.41× for the segmenter, index 8301 vs 6198 bytes. The union of both scored no better than either alone at this corpus size (23/25) for 1.6× the index.

---

## C. v2 vector readiness (verification only — do **not** adopt now)

- **`sqlite-vec` loads into `node:sqlite`. Confirmed by both sides.** The official sqlite-vec JS guide states `load()` "is compatible with `node:sqlite`" and shows the exact recipe for **Node ≥ 23.5.0** ([alexgarcia.xyz/sqlite-vec/js.html](https://alexgarcia.xyz/sqlite-vec/js.html), [site/using/js.md](https://github.com/asg017/sqlite-vec/blob/main/site/using/js.md)):
  ```js
  const db = new DatabaseSync(":memory:", { allowExtension: true });
  sqliteVec.load(db);
  ```
  Node's own docs confirm `database.loadExtension(path[, entryPoint])` "is required to enable the `allowExtension` option when constructing the `DatabaseSync` instance", plus `database.enableLoadExtension(allow)` ([nodejs.org/api/sqlite.html](https://nodejs.org/api/sqlite.html)). Verified present on this machine: `new DatabaseSync(':memory:', {allowExtension:true})` → `typeof db.loadExtension === 'function'`, `typeof db.enableLoadExtension === 'function'`.
- **Distribution**: `sqlite-vec@0.1.9`, license `MIT OR Apache`, `time.modified` 2026-05-18. optionalDependencies ship prebuilts for `sqlite-vec-windows-x64`, `sqlite-vec-linux-x64`, `sqlite-vec-linux-arm64`, `sqlite-vec-darwin-x64/arm64` — **both our target OSes covered, no compile step**. Written in pure C, no dependencies.
- **Risk**: the repo banner says "**`sqlite-vec` is a pre-v1, so expect breaking changes!**". Fine for a v2 decision, not something to build a v1 contract on.
- **Fallback if the extension path ever closes** (plain-file vectors, Vectra-style): store embeddings as a `Float32Array` blob column (or a sidecar file) and brute-force cosine in TS. At thousands of entries × 768–1536 dims this is a few million multiply-adds per query — single-digit milliseconds, no extension, no index structure. **Do not take Vectra itself as a dependency**: `vectra@0.15.0` is MIT but its runtime deps are `openai`, `@grpc/grpc-js`, `@grpc/proto-loader`, `cheerio`, `turndown`, `gpt-tokenizer`, `dotenv` — a provider-coupled tree that violates the provider-agnostic rule outright. Take the *pattern*, not the package.
- **Implication for the T5 Retriever seam**: keep the `Retriever` interface returning ranked candidates with scores, so a second scorer can be unioned in later. Nothing in the `unicode61` + aux-column design blocks adding a `vec0` virtual table in the same database later — it is additive, in the same file, under the same single writer.

---

## D. RAG-orchestration frameworks — honesty check

**LlamaIndex.TS.** `KeywordTableIndex` is not a lexical index in the BM25 sense: `buildIndexFromNodes` calls `KeywordTableIndex.extractKeywords(node.getContent(...))` for **every node**, and that method is `await llm.complete({prompt: defaultKeywordExtractPrompt...})` — an **LLM call per node at index time**, plus another per query in `KeywordTableLLMRetriever.getKeywords` ([source](https://github.com/run-llama/LlamaIndexTS/blob/09ba5aa/packages/llamaindex/src/indices/keyword/index.ts)). Retrieval then sorts by how many query keywords hit each node (`chunkIndicesCount`) — a count, not a ranking function. A separate `@llamaindex/bm25-retriever` (`Bm25Retriever`) does real BM25 but is documented against a `docStore` obtained from `VectorStoreIndex.fromDocuments(...)`. Auto-reject: the keyword path takes a mandatory model dependency on the **write** path, which is exactly the "provider-agnostic" line, and the BM25 path means adopting the framework to get a component we already own.

**LangChain.js.** `BM25Retriever` from `@langchain/community` is a thin wrapper over the `okapibm25` implementation. Its tokenizer, verbatim from the shipped build (`@langchain/community@1.1.19/dist/retrievers/bm25.cjs`):

```js
preprocessFunc(text) { return text.toLowerCase().split(/\s+/); }
```

Whitespace split — **a Chinese sentence becomes exactly one token**, so recall for our corpus is approximately zero, and `preprocessFunc` is a private method, not a constructor option. It also holds `docs: Document[]` in memory and re-scores the entire array on every `invoke` — no index, no persistence, no incremental update. The docs themselves position it as a **reranking postprocessor** "after retrieving an initial set of documents from another source" ([docs.langchain.com](https://docs.langchain.com/oss/javascript/integrations/retrievers/bm25)), not as a primary retriever. Auto-reject.

Both frameworks would also import a large dependency tree to sit under a single tool call in a desktop pet. Rejected on KISS as expected — but now sourced, not asserted.

---

## E. OMITTED / not sourced

- **`@orama/tokenizers/mandarin` internal algorithm.** Post-[PR #899](https://github.com/oramasearch/orama/pull/899) it is TypeScript (was Rust/WASM), `mandarin.js` is ~1.9 KB built and the whole package is 34.7 KB unpacked — too small to embed a Chinese dictionary, which suggests a rule/char-based split rather than dictionary segmentation. **I did not read the source and did not run it.** Treat "experimental" as the only load-bearing claim.
- **FlexSearch `Charset.CJK` internals.** Documented to work (`index.add(0,"一个单词")` / `index.search("单词")`) but I did not verify the algorithm or its ranking behaviour on Chinese.
- **Relative retrieval quality of `Intl.Segmenter` vs real jieba `cut_for_search`.** I could not benchmark jieba locally without installing a package (zero-install rule). The comparison in §B is `Intl.Segmenter` vs trigram vs bigram only. Two independent MiniSearch users assert jieba/`jieba-wasm` is better than `Intl.Segmenter` for search; that is **community opinion, not a measurement I reproduced**.
- **Probe corpus is 30 entries.** Precision at "thousands of entries" is extrapolated from bm25's IDF behaviour, not measured. The rank@1 gap (17/25 → 24/25) is large enough to survive noise; the absolute numbers are not a benchmark.
- **Alignment scan in probe 4 (§B) was tautological** (it only tested tokens that already exist in the content segmentation) and reported 0 misalignments. Disregard that number; the `科幻` / `懵逼` cases are the real evidence and they are cited above.
- **`@node-rs/jieba` release cadence.** `latest` is 2.0.1 with `time.modified` 2025-05-04; the parent `napi-rs/node-rs` monorepo is active, but whether the jieba package specifically is still receiving attention was **not determined**.
- **Migration cost of `trigram` → `unicode61`** was not measured on the real corpus (no reindex timing). The design claim "index is fully rebuildable" comes from the task brief, not from my own run.

---

## F. Options for the owner

### Option 1 — Migrate the tokenizer, add `Intl.Segmenter` terms *(recommended)*

`memory_fts` becomes `fts5(path UNINDEXED, disclosure, content, search_terms, tokenize='unicode61')`; the indexer writes `search_terms = dedupe(segment(disclosure + ' ' + content))`; `buildFtsQuery` segments the query and ORs quoted tokens; bm25 weights become 4-column.

- **Buys**: 2-char CJK (requirement b) natively, no `LIKE` fallback path at all; rank@1 17/25 → 24/25 on natural-language questions (requirement c); a *smaller* index than today.
- **Costs**: one migration + full reindex; **zero new dependencies**; loses ASCII infix matching (`"scode"` no longer finds `VSCode` — mitigable with `token*` prefix queries); the raw `content` column stops earning its bm25 weight for Chinese rows, so the weighting decision in `memory-repo.ts:82` must be re-derived against `search_terms`, not carried over.
- **Residual risk**: proper nouns fragment and there is no glossary hook (§B.2). If `哥斯拉`/`秋叶原`-class recall proves weak in practice, escalate to Option 1b.

### Option 1b — Same, but `search_terms = segmenter tokens ∪ bigrams`

- **Buys**: removes the substring-of-token failure class (`科幻` / `懵逼`), restores CJK infix matching, fully deterministic floor if ICU ever shifts.
- **Costs**: aux column ~3.6× raw text, index ~1.6× Option 1 (9970 vs 6198 bytes at 30 rows — still trivial at our scale). No measured rank@1 gain at this corpus size, so this is insurance, not an upgrade.

### Option 1c — Same as 1, but swap `Intl.Segmenter` for `@node-rs/jieba`

- **Buys**: `cut_for_search` granularity (jieba emits sub-words *and* the full word, which is strictly better for recall than a single segmentation) and `add_word` for a glossary — the one Nocturne capability `Intl.Segmenter` cannot match.
- **Costs**: a prebuilt native `.node` dependency (~3 MB/platform) in `packages/core`, which is OS-neutral in practice (full Win + Linux gnu/musl matrix) but is a **binary artefact in the OS-neutral package** — a rule-adjacent call the owner should make explicitly, not me. `jieba-wasm` (16 MB, no native binary) is the alternative if binaries are the objection.
- **Recommendation**: not now. Ship Option 1, and treat glossary/proper-noun recall as the trigger to revisit.

### Option 2 — Import a library (Orama / FlexSearch / MiniSearch)

- **Cost**: a second index in RAM plus a second persistence artefact, alongside the SQLite index we keep anyway for metadata joins and scoping; write path forks; the CJK seam still has to be written by hand in every case except FlexSearch. **No decisive advantage** over Option 1 — this is the "replacing a working embedded FTS5 engine requires a decisive advantage, not parity" test, and none of them passes it.
- The only one worth revisiting is **Orama**, and only if v2 hybrid search is later judged easier inside Orama than as `sqlite-vec` beside FTS5 — which §C suggests it is not.

### Option 3 — Do nothing to the tokenizer, harden around it

Keep `trigram`, keep the `LIKE` fallback. Requirement (b) stays served by a linear scan (correct but unranked — `SEARCH_LIKE_SQL` at `memory-repo.ts:85-88` orders by `importance, created_at` only, with **no relevance term at all**), and requirement (c) stays at 17/25. Given T5-R12's one-shot budget, this is the option that most directly contradicts the requirement.

### Independent of the above

The `disclosure` gate at `packages/core/src/memory/fts5-retriever.ts:32` / `disclosure-gate.ts` is an **AND post-filter** requiring a disclosure token to be a literal substring of the query — as the kickoff notes record, a Chinese NL trigger is one token that must appear verbatim, so writing a trigger currently makes an entry *harder* to retrieve. Nothing in this report changes that: requirement (c) needs the gate to become a ranking boost regardless of which retrieval option is chosen. Nocturne has no such gate — it indexes `disclosure` as an FTS column, weights it in bm25 (`bm25(fts, 0.0, 0.0, 2.5, 0.0, 2.0, 1.0, 1.0, 0.75)`, `db/search.py:311`), and returns it with every hit.

---

## Sources

**Local**
- `packages/core/src/db/migrations/002-memory.ts:25` — current FTS5 DDL (`tokenize='trigram'`)
- `packages/core/src/db/memory-repo.ts:78-88` — `SEARCH_MATCH_SQL` bm25 weights, `SEARCH_LIKE_SQL` fallback
- `packages/core/src/memory/fts5-query.ts` — trigram-OR query builder + LIKE fallback
- `packages/core/src/memory/fts5-retriever.ts:32` — disclosure AND post-filter
- `references/nocturne_memory-main/backend/db/migrations/009_v1.3.0_add_search_fts.py:86-96`, `010_v2.0.0_add_namespace.py:148-158` — `tokenize = 'unicode61'`
- `references/nocturne_memory-main/backend/db/search_terms.py` — `SearchTokenizer`, `cut_for_search`, `register_custom_words`, `build_document_search_terms`
- `references/nocturne_memory-main/backend/db/search.py:47-54, 283-320` — `_to_sqlite_match_query` (AND semantics), bm25 column weights, candidate over-fetch
- `.trellis/tasks/archive/2026-07/07-10-memory-engine/research/fts5-trigram-cjk.md` — prior trigram/CJK probe
- `.trellis/workspace/pleia/t5-memory-systems-survey.md` §0.1 A2–A4, §4/F, §10.3 — Nocturne retrieval pattern and the `Intl.Segmenter` gap this report closes

**Empirical** — `node v24.18.0`, SQLite 3.53.1, this machine. Six throwaway probes under `research/tmp/`, deleted after use: ICU/`Intl.Segmenter` capability; segmentation output on 15 realistic strings; trigram-vs-`unicode61` 2-char MATCH; faithful A/B against production `buildFtsQuery`; stopword and rank-stability on a 30-row corpus; segmenter-vs-bigram-vs-union head-to-head; `unicode61`-vs-`trigram` prefix/infix behaviour.

**External**
- ICU: [Boundary Analysis](https://unicode-org.github.io/icu/userguide/boundaryanalysis/), [Break Rules](https://unicode-org.github.io/icu/userguide/boundaryanalysis/break-rules.html), [`CjkBreakEngine` 78.3](https://fossies.org/dox/icu-release-78.3/classicu_1_1CjkBreakEngine.html), [UAX #29](http://www.unicode.org/reports/tr29/)
- Node.js: [`node:sqlite`](https://nodejs.org/api/sqlite.html) (`loadExtension`, `allowExtension`, `enableLoadExtension`)
- sqlite-vec: [JS guide](https://alexgarcia.xyz/sqlite-vec/js.html), [repo](https://github.com/asg017/sqlite-vec), [site/using/js.md](https://github.com/asg017/sqlite-vec/blob/main/site/using/js.md)
- Orama: [Chinese docs](https://docs.orama.com/docs/orama-js/supported-languages/using-chinese-with-orama), [`@orama/tokenizers`](https://registry.npmjs.org/@orama/tokenizers), [PR #899](https://github.com/oramasearch/orama/pull/899), [issue #883](https://github.com/oramasearch/orama/issues/883)
- FlexSearch: [repo](https://github.com/nextapps-de/flexsearch), [encoder.md](https://github.com/nextapps-de/flexsearch/blob/master/doc/encoder.md), [persistent.md](https://github.com/nextapps-de/flexsearch/blob/defb38b0/doc/persistent.md)
- MiniSearch: [docs](https://lucaong.github.io/minisearch/), [issue #201 — CJK](https://github.com/lucaong/minisearch/issues/201)
- LlamaIndex.TS: [`keyword/index.ts`](https://github.com/run-llama/LlamaIndexTS/blob/09ba5aa/packages/llamaindex/src/indices/keyword/index.ts), [`Bm25Retriever`](https://developers.llamaindex.ai/typescript/framework-api-reference/classes/bm25retriever/)
- LangChain.js: [BM25 integration](https://docs.langchain.com/oss/javascript/integrations/retrievers/bm25), [`bm25.cjs` @1.1.19](https://app.unpkg.com/@langchain/community@1.1.19/files/dist/retrievers/bm25.cjs), [PR #6719](https://github.com/langchain-ai/langchainjs/pull/6719)
- Segmenters: [`@node-rs/jieba`](https://github.com/napi-rs/node-rs/tree/main/packages/jieba), [`segmentit`](https://github.com/linonetwo/segmentit/)
- npm registry metadata (`npm view`, 2026-07-28) for versions, licenses, `time.modified`, optionalDependencies, unpacked sizes
