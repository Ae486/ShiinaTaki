# Research: Nocturne Memory as a candidate memory module for TakiAgent

- **Query**: PRD question 2 — memory model, interfaces, 连(buy/run) vs 造(build) for `references/nocturne_memory-main`
- **Scope**: internal (reference repo study) + stack cross-check
- **Date**: 2026-07-07
- **Reference root**: `H:\TakiAgent\references\nocturne_memory-main`

> **License correction (load-bearing)**: The PRD assumes references are "GPLv3 / study-only". Nocturne Memory is **MIT** (`LICENSE:1`, `README_EN.md:819` "MIT License © 2026 Salem"). Code may be legally copied/adapted. A clean-room TS reimplementation is still recommended to match our code style, but there is no legal barrier to reading/porting.

---

## 1. Memory model

### Schema — a 4-layer graph, not a flat KV store

Defined in `backend/db/models.py`; confirmed against live `demo.db` (`sqlite3` dump: tables `nodes`, `memories`, `edges`, `paths`, `glossary_keywords`, `search_documents` + FTS5 shadow `search_documents_fts`, `memory_access_logs`, `presets`, `schema_migrations`).

| Layer | Table | Key columns | Purpose | Evidence |
|---|---|---|---|---|
| Identity | `nodes` | `uuid` (PK), `created_at`, `last_accessed_at` | Permanent anchor for a concept; UUID survives content edits | `db/models.py:73-92` |
| Content | `memories` | `id`, `node_uuid` FK, `content` TEXT, `deprecated` BOOL, `migrated_to` INT, `created_at` | One **version** of a node; version chain `old.migrated_to → new.id`; only one active (`deprecated=0`) per node enforced by unique partial index `idx_unique_active_memory` | `db/models.py:95-111`; index in demo.db dump |
| Relation | `edges` | `id`, `parent_uuid`, `child_uuid`, `name`, `priority` INT, `disclosure` TEXT; `UNIQUE(parent_uuid,child_uuid)` | Directed parent→child link carrying **priority** and **disclosure** (recall trigger). Sentinel root `ROOT_NODE_UUID` avoids NULL-uniqueness quirk | `db/models.py:114-142`, `:34` |
| Routing | `paths` | PK `(namespace, domain, path)`, `edge_id` FK, `node_uuid` FK | Materialized URI cache `domain://path → edge`. Aliases = multiple paths to same edge/node | `db/models.py:145-168` |

Auxiliary: `glossary_keywords` (`keyword`, `node_uuid`, `namespace`; `db/models.py:171-196`) for keyword→node hyperlinking; `search_documents` + FTS5 virtual table (derived index, `db/models.py:199-224`); `memory_access_logs` (`node_uuid`, `accessed_at`, `context`; `:227-243`) for recency diagnostics; `presets` (boot-URI sets, one active; `:246-271`).

`demo.db` scale: **110 memory rows for 22 nodes / 15 paths / 7 glossary keywords** — i.e. ~5 versions per concept retained (version-chain rollback substrate).

### Retrieval — lexical FTS, NO vectors

- **SQLite path**: FTS5 virtual table `search_documents_fts` (`tokenize='unicode61'`), ranked by `bm25(...)` with per-column weights, tie-broken by `priority ASC, length(path) ASC` (`db/search.py:294-325`). **This is exactly our planned SQLite FTS5 approach — no embeddings anywhere in the codebase.**
- **PostgreSQL path**: `to_tsvector('simple', ...) @@ websearch_to_tsquery` ranked by `ts_rank_cd` (`db/search.py:326-370`).
- **CJK handling**: jieba segmentation at the *application* layer before indexing (`db/search_terms.py:53-76`, `build_document_search_terms:86-107`); glossary words registered as custom jieba words.
- `search_memory` is documented as "lexical full-text search, NOT semantic search" (`mcp_server.py:1071-1074`; `docs/TOOLS.md:102`).
- **No automatic recency/importance scoring in retrieval ranking.** `priority` is a manual integer the AI assigns (0 = highest). Recency/importance appear only in the *diagnostic* health report (stale-node thresholds that double per priority level; crowded/orphan/duplicate detection) — `system_views.py:397-497` — and in `system://random` weighted pick (`mcp_server.py:419-438`). These are curation aids, not recall ranking.

### Write paths — explicit tool calls only

- All mutation is via MCP tools (`create_memory`/`update_memory`/`delete_memory`/`add_alias`/`manage_triggers`). **There is no background summarizer / auto-extraction pipeline** — this is an explicit design stance ("First-Person Sovereign Memory… No background summarization system", `README_EN.md:394`; the whole "Why Vector RAG Fails / Proxy Memory" section `:370-394`).
- `update_memory` has **no full-replace mode** — only patch (`old_string`/`new_string`, must match uniquely, with literal-`\n` and Unicode-normalization fallbacks) or append (`mcp_server.py:566-779`; `docs/TOOLS.md:42-63`). Prevents accidental overwrite.
- Every write captures before/after rows into a namespace-scoped `ChangesetStore` for the dashboard's review/rollback queue (`mcp_server.py:307-323`, `_record_rows`).
- `delete_memory` severs a *path*, not content (content stays `deprecated`) — `mcp_server.py:782-832`; `docs/TOOLS.md:67-72`.

### Namespacing / multi-agent

- `namespace` is part of the PK of `paths`, `search_documents`, and `glossary_keywords` — full data isolation per agent persona in one DB (`db/models.py:155,204,189`).
- Resolved via contextvar; source = env `NAMESPACE` (stdio) or `X-Namespace` header / `?namespace=` query (HTTP/SSE, header wins) — `namespace_middleware.py:96-181`, `README_EN.md:563-604`.
- **Namespace is NOT a security boundary** — there is a single global auth token; any authenticated client can pass any namespace. Isolation ≠ access control.

---

## 2. Interfaces

### MCP tools (exactly 7) — `mcp_server.py`, FastMCP-based

| Tool | Signature | Evidence |
|---|---|---|
| `read_memory` | `(uri: str)` — plus virtual `system://boot`, `system://index/<domain>`, `system://recent[/N]`, `system://glossary`, `system://diagnostic/<domain>`, `system://random/<domain>` | `mcp_server.py:342-445` |
| `create_memory` | `(parent_uri, content, priority:int≥0, disclosure, title?)` | `:448-563` |
| `update_memory` | `(uri, old_string?, new_string?, append?, priority?, disclosure?)` — patch xor append | `:566-779` |
| `delete_memory` | `(uri)` — cuts one path | `:782-832` |
| `add_alias` | `(new_uri, target_uri, priority:int, disclosure)` — new entry point, same node; children mirrored | `:835-941` |
| `manage_triggers` | `(uri, add?:List[str], remove?:List[str])` — glossary keyword binding | `:944-1064` |
| `search_memory` | `(query, domain?, limit=10)` — FTS | `:1067-1120` |

Mutating tools are suppressed in public read-only deployments via `@write_tool()` gated on `PUBLIC_READONLY_MCP` (`mcp_server.py:325-333`; the public demo exposes only read/search, `README_EN.md:238`).

### Transports

- **stdio**: `python backend/mcp_server.py` → `mcp.run()` (`mcp_server.py:1128-1129`). `mcp_wrapper.py` is a CRLF→LF stdio shim for a Windows/Antigravity bug (`mcp_wrapper.py:1-71`, `README_EN.md:314-327`).
- **SSE** `GET /sse` + **Streamable HTTP** `/mcp**` in one uvicorn process via `run_sse.py` (`run_sse.py:38-61`); also embeds REST API + dashboard.
- Our `@ai-sdk/mcp` client supports **stdio + HTTP** (TECH-STACK.md:13) → compatible with nocturne's stdio and `/mcp` streamable-HTTP endpoints out of the box.

### REST API surface (FastAPI, for the dashboard — not for agents)

Large admin surface under `/api` (`backend/api/*.py`): `browse` (namespaces, domains CRUD, node get/put/post/alias/rename/delete, glossary, search), `maintenance` (orphans, access-log stats), `presets` (boot-URI set CRUD + activate), `review` (change groups, diff, rollback, deprecated purge), `settings` (config, boot-uris per namespace, DB status/test/create). ~45 endpoints total (grep of `@router.*` across `api/`). This exists to serve the React dashboard; an MCP-consuming agent never needs it.

### Auth model

- **Single global Bearer token** in `config.json` `api_token`, constant-time compared (`auth.py:46-76`). Applied as ASGI middleware with path exclusions (`:79-116`).
- `enforce_network_auth` **refuses to bind to a non-localhost host without a token ≥32 chars** (`auth.py:136-192`). Localhost bind warns but allows tokenless.
- No user accounts, no per-namespace auth, no OAuth. Coarse "one shared secret guards the whole server."

---

## 3. 连 path — run it as an external MCP server (zero custom code)

**Feasible technically, poor fit operationally.**

- **Compatibility**: yes — `@ai-sdk/mcp` (stdio + HTTP) speaks to nocturne's stdio / `/mcp` with zero custom code. Namespace via env or header. MIT-licensed.
- **Local (Windows) cost**:
  - A **second full runtime**: Python 3.10+ with FastAPI + uvicorn + SQLAlchemy 2 + aiosqlite + **jieba** (jieba loads a multi-MB dictionary on first segmentation → slow first call, extra RAM) + pyahocorasick + Pillow + pypinyin (`backend/requirements.txt`). Realistic RSS ~80–200 MB for the uvicorn+SQLAlchemy+jieba process.
  - **Node.js required** and an **auto `npm install && npm run build`** of a React frontend on first run (`mcp_server.py:63-134`).
  - On stdio start it **spins up an embedded web server AND auto-opens a browser tab** to the dashboard (`mcp_server.py:158-201`, `auto_open_browser`). Intrusive for an embedded desktop-companion product.
  - Known **Windows CRLF stdio bug** needs the `mcp_wrapper.py` workaround for some clients (`README_EN.md:314`).
- **VPS cost**: Docker Compose stack = PostgreSQL + backend + SSE + Nginx (`README_EN.md:634-739`). Adds network latency to every recall, requires Bearer token + `host=0.0.0.0`, and a maintained service. The user has a VPS, so hosting is possible — but it's a standalone service to operate.
- **Architectural conflict (decisive)**: TECH-STACK.md:64 mandates the **single-owner data pattern** — "the Agent Core is the only reader/writer of the database… no shared database file." Nocturne owns *its own* SQLite/Postgres + REST API + dashboard. Adopting 连 means a **second database and a second server** that the Agent Core does not own, directly violating our single-writer principle and duplicating the storage/WS-push architecture we already committed to (`node:sqlite` + FTS5, TECH-STACK.md:16-17).
- **Maintenance / activity risk**: reference is a source snapshot (no upstream git history present in the vendored copy; the only git repo here is TakiAgent itself). It carries 14 sequential DB migrations (`backend/db/migrations/001…014`) spanning v1.0→v2.5.3, i.e. an actively-churning schema — a moving target to pin against. Depending on it means tracking someone else's schema migrations for our product's memory core.

**Verdict on 连**: works, but drags a Python+Node runtime, an embedded web dashboard, browser auto-open, and a second owned datastore into a single-TS-process companion app. Wrong center of gravity.

---

## 4. 造 path — native TS in `packages/core/src/memory/`

**To replicate ~80% of the value we need very little that we aren't already building.** Our planned substrate (Markdown in Workspace + `node:sqlite` FTS5, OpenClaw-style — TECH-STACK.md:16-17) is the **same category** as nocturne's engine (lexical FTS5, no vectors). Nocturne *validates* our plan; it does not out-class it.

What a native port would add on top of plain markdown+FTS5, ranked by value/cost:

| Idea | Value | Cost | Note |
|---|---|---|---|
| **`disclosure` / trigger-condition field** ("when to recall this") | High | Trivial (one text column + prompt convention) | The single most transferable idea. Turns passive storage into conditional recall. |
| **Explicit-write, first-person model** (no auto-summarizer) | High | Free (a stance) | Matches an agent that curates its own memory; avoids "proxy memory". |
| **`priority` as manual relative ranking** (with soft caps) | Medium | Trivial | Cheap recall tie-breaker; already in nocturne's bm25 sort. |
| **Diagnostic/health view** (stale/crowded/orphan/duplicate) | Medium | Low | Great for long-lived memory hygiene; pure SQL over our index. |
| **Glossary auto-hyperlink** (Aho-Corasick keyword→node) | Medium | Medium | `pyahocorasick` → a JS Aho-Corasick lib; nice "self-weaving web" but optional. |
| **URI routing `domain://path`** | Medium | ~Free | Our markdown **file paths already ARE this** addressing scheme. |
| **Version chain** (`deprecated`+`migrated_to`, rollback) | Medium | Free-ish | Markdown-in-Workspace under **git** gives versioning/rollback for free. |
| **Node/Edge/Alias graph** (multi-parent, cycle detection) | Low–Med | High | The expensive part. Defer unless multi-parent aliasing proves necessary. |
| **Namespace isolation** | Low (v1) | Low | Only needed for multiple personas in one store. |

**Comparison with our current plan (markdown + FTS5, OpenClaw-style)**: nocturne's model is **richer, not fundamentally better**. Its retrieval engine is identical in kind (SQLite FTS5 + manual priority). Its genuine deltas over plain markdown are (a) the **disclosure trigger** field, (b) the **graph/alias** layer, and (c) **glossary auto-linking**. Of these, (a) is cheap and worth stealing immediately; (b) and (c) are optional enrichments. Meanwhile two of nocturne's headline features — URI addressing and version rollback — we get essentially for free from markdown-files-in-Workspace + git, without the graph tables.

---

## 5. Recommendation — **Hybrid: 造 native, adopt schema ideas (lean toward 造)**

**Build memory natively in `packages/core/src/memory/` on our existing `node:sqlite` + FTS5 substrate, and port nocturne's best *ideas* — not its process.**

Reasoning:

1. **Fit** — 连 imports a Python+Node runtime, an embedded web dashboard, a browser auto-open, and a **second owned datastore/server** into a single-TS-process desktop companion, violating the single-writer data principle we already committed to (TECH-STACK.md:64). That is architecturally backwards for our product.
2. **No engine gap to close** — nocturne is lexical FTS5, exactly our plan. There is no vector/semantic capability we'd be missing by not adopting it; it confirms our OpenClaw-style choice rather than superseding it.
3. **Cheap high-value wins are portable and small** — add a `disclosure` (when-to-recall) field, a manual `priority`, the explicit-write sovereign stance, and a diagnostic health view. These are days of work, integrate with our WS single-owner model, and capture most of nocturne's differentiated value.
4. **Defer the expensive parts** — graph edges/aliases/cycle-detection and glossary Aho-Corasick are optional; markdown+git already covers version rollback and URI-style addressing. Add the graph only if flat files + FTS5 + triggers prove insufficient.
5. **License is permissive (MIT)** — we *may* read its code directly; recommend clean-room TS to match house style, but it's a legal reference we can lean on for tricky bits (e.g. the patch-normalization fallbacks in `update_memory`, or the bm25 column weighting).

**Do not** run nocturne as our production memory backend. **Do** treat `db/models.py` + `db/search.py` + `docs/TOOLS.md` as the design blueprint for our own `memory/` module.

---

## Appendix: the `desktop_pet/` directory — what it is

**Not part of the memory server, and not a client SDK.** It is the author's personal **autonomous-agency heartbeat harness** that happens to ship in the same repo. It:

- Runs a timer loop that drives an *external* CLI agent (OpenCode / Antigravity — `desktop_pet/opencode_heartbeat.py`, `antigravity_heartbeat.py`) each "heartbeat".
- Gives the agent **"eyes"** (a screenshot via `mss`, attached or path-hinted) and a **"mouth"** (`[speak]…[/speak]` tags extracted from the reply → `speak.py` → `edge-tts`/`pyttsx3` desktop bubble + TTS) — `heartbeat_engine.py:75-205`, `:132-152`.
- Injects an elaborate Chinese self-motivation prompt ("The Agency Loop" + anti-parasite heuristics) and an email-check/reply section (`heartbeat_engine.py:210-341`).
- Consumes Nocturne memory only indirectly — as one MCP tool available to that external agent.

Deps are separate (`desktop_pet/requirements.txt`: `edge-tts, pyttsx3, mss, websockets, python-dotenv`). It is hardcoded to the author's paths/accounts and is **not reusable code**. Its *value to us*: it independently validates our own planned **heartbeat scheduler (HEARTBEAT.md) + Pet TTS + screenshot-as-perception** loop (TECH-STACK.md scheduler/TTS rows) — a conceptual cross-check, nothing to import.

## Caveats / Not found

- No upstream git history in the vendored copy, so project-activity/commit-cadence can't be measured locally; the 14-step migration chain (`db/migrations/001…014`, v1.0→v2.5.3) is the best available signal of an actively-evolving schema. The GitHub repo is `github.com/Dataojitori/nocturne_memory` (README) if live activity needs verifying.
- RAM figures are estimates from the dependency set (uvicorn+SQLAlchemy+jieba), not measured on this machine.
- `demo.db` is bundled sample data (110 memory versions / 22 nodes); Docker/Postgres deployments start empty (`README_EN.md:669`).
