# PRD — Continuous conversation timeline persistence (no sessions)

**GitHub issue**: #5 (`Ae486/ShiinaTaki`, milestone M1 — final slice). Parent: #1. Blocked by: #3 (DONE).
**Trellis task**: `07-10-timeline-persistence`

## 1. Goal

Durable conversation persistence per ADR 0005: ONE continuous append-only timeline per character in SQLite, surviving restarts, browsable backward by date, no session concept anywhere. Establishes the `db/` layer (sole `node:sqlite` importer), numbered migrations applied at startup, and the write→WS-event pattern every future externally-relevant write follows (database-guidelines).

**Architectural boundary (leader ruling)**: the timeline is the verbatim chat log with SQLite as its source of truth. It is NOT a Memory Layer — MEMORY-DESIGN's `episodes` (markdown-as-truth + FTS index, distilled) arrives in M2 as a different representation. Nothing in this slice touches `memory/`.

## 2. Scope

**In**: `db/` wrapper + migration runner + `timeline` table · timeline repo (typed SQL) · `ConversationStore` re-backed by SQLite (chat from #3 persists every turn and replays history after restart) · WS methods `timeline.history` (cursor paging) + `timeline.subscribe` (+ `timeline.appended` push) · CLI prints the last 5 timeline entries after connect (the AC-2 demo vehicle) · tests incl. simulated restart + migration tracking.

**Out**: memory layers / FTS5 / consolidation (M2 #6/#7) · context compaction & token budgeting (replay window is a plain constant this slice) · timeline entries for tool calls (no tools yet; schema grows by migration later) · edit/delete (append-only by design) · unsubscribe method (auto-cleanup on disconnect is enough for v1; add when a client needs it) · Rust/serde mirror (Shell connects in M3).

## 3. Design decisions (settled — implement as written)

1. **Rows are plain displayable text, never serialized `ModelMessage` blobs.** Schema stays decoupled from AI SDK version churn; rows are human-readable; the model replay is reconstructed as `{role, content: text}` (lossless for text-only chat; multi-part fidelity is revisited when tools land).
2. **`ConversationStore` interface evolves** (both call sites are ours): `appendUser(characterId, text)` · `appendAssistant(characterId, text)` · `history(characterId): ModelMessage[]`. `chat-agent` accumulates streamed deltas into the assistant text (drops its `result.responseMessages` usage — deltas ARE the truth for text-only chat) and calls the store around the stream. The in-memory implementation is DELETED — the SQLite-backed store with a `:memory:` db serves tests.
3. **Ordering/cursor = `seq` (INTEGER PRIMARY KEY AUTOINCREMENT)**, not timestamps (same-ms collisions). `created_at` (ISO-8601 UTC, guidelines) serves date browsing/display. Paging: newest-first, `before` = seq cursor.
4. **Replay window**: model receives the latest `REPLAY_WINDOW = 200` messages (ascending). A constant, not config — compaction is a later, dedicated concern (ADR 0005 keeps it invisible either way).
5. **Migrations are numbered TS modules exporting SQL string constants** (`db/migrations/001-timeline.ts` → `{ version: 1, sql }`), aggregated in an ordered list; runner applies `version > max(applied)` each inside a transaction, tracked in `migrations(version INTEGER PRIMARY KEY, applied_at TEXT)`. Zero `fs` in the db layer. (Research file may refine runner details — its verdict on constants-vs-files is binding if it contradicts this.)
6. **Write→event colocation**: the store emits the appended entry to an injected `onAppend(entry)` sink after commit; the server-side subscription registry fans it out as `timeline.appended` notifications to subscribed connections. Two UIs subscribed to one character see the same stream — ADR 0005's bubble+window sharing, for free.

## 4. Schema (migration 001)

```sql
CREATE TABLE timeline_messages (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  id           TEXT NOT NULL UNIQUE,          -- uuid, the protocol-visible message id
  character_id TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content      TEXT NOT NULL,
  created_at   TEXT NOT NULL                  -- ISO-8601 UTC
);
CREATE INDEX idx_timeline_character_seq ON timeline_messages (character_id, seq DESC);
```

DB file: `<dataDir>/taki.db` (`dataDir` = existing `TAKI_DATA_DIR` config, default `~/.takiagent` — beside `devices.json`, outside the Workspace). Pragmas at open: WAL + foreign_keys (per research). `node:sqlite` is Node-24 built-in; if it emits an ExperimentalWarning at boot, accept and document it — never suppress warnings globally.

## 5. Protocol additions (`@taki/shared`, `timeline-schema.ts` + index re-exports)

- `TIMELINE_METHODS = { history: "timeline.history", subscribe: "timeline.subscribe", appended: "timeline.appended" }`
- `TimelineEntrySchema { seq: int, id: uuid, characterId, role: "user"|"assistant", content, createdAt }`
- `TimelineHistoryParamsSchema { characterId, before?: int, limit?: int (default 50, max 200) }` → `TimelineHistoryResultSchema { entries: TimelineEntry[] (newest-first), nextBefore: int | null }`
- `TimelineSubscribeParamsSchema { characterId }` → result `{ status: "ok" }`; push = `TimelineAppendedSchema` (= entry)
- Both methods `roles: ["operator"]`.

## 6. File map

```
packages/shared/src/timeline-schema.ts (+test)
packages/core/src/db/sqlite.ts (+test)            # DatabaseSync wrapper: open/pragmas/migrate/close — the ONLY node:sqlite import
packages/core/src/db/migration-runner.ts (+test)  # ordered TS-constant migrations, tracked, transactional
packages/core/src/db/migrations/001-timeline.ts   # {version, sql}
packages/core/src/db/migrations/index-list.ts     # ordered array (explicit, no fs/glob)
packages/core/src/db/timeline-repo.ts (+test)     # append / pageBefore / latestAscending — typed rows, zod at boundary
packages/core/src/agents/conversation-store.ts    # REWRITE: interface v2 + SQLite-backed factory (repo + onAppend injected)
packages/core/src/agents/chat-agent.ts            # EDIT: store injected via deps; delta accumulation
packages/core/src/server/timeline-subscriptions.ts (+test)  # characterId -> subscribed connections; disconnect cleanup
packages/core/src/server/methods/timeline-history.ts
packages/core/src/server/methods/timeline-subscribe.ts
packages/core/src/main.ts                         # EDIT: open db → migrate → wire repo/store/subscriptions; close db on shutdown
apps/cli/src/main.ts (or chat-client)             # EDIT: after auth, fetch+print last 5 entries ("history replay" demo)
```

Headers + index.md on everything touched, per quality-guidelines. `db/migrations/` gets its own index.md.

## 7. TDD plan (red-green-refactor; `:memory:` for isolation, temp-file for restart)

| Cycle | Tests |
| --- | --- |
| **A shared** | T1 timeline schema tables: entry round-trip, limit bounds (0/negative/201 rejected), role enum, cursor optionality |
| **B db** | T2 sqlite wrapper: opens `:memory:`, applies migrations once, REOPEN same temp file → migrations NOT reapplied (tracked), bad-SQL migration → transaction rolled back + readable fatal error. T3 timeline-repo: append returns entry with seq/createdAt; pageBefore ordering (newest-first), cursor walk, limit clamp; latestAscending window (insert 250 → returns last 200 ascending); per-character isolation; **restart survival**: write → close → NEW DatabaseSync on same temp path → rows intact (Windows file-lock verified per research) |
| **C store** | T4 conversation-store v2: appendUser/appendAssistant → history() returns ModelMessage[] ascending; onAppend fired per append with the committed entry |
| **D server** | T5 timeline.history over real WS (paired operator): pages backward across two pages; node-role → FORBIDDEN. T6 subscribe → chat.send (mock model) → subscriber receives timeline.appended for user AND assistant entries, non-subscriber receives none, disconnect removes subscription |
| **E restart integration** | T7 **the AC-2 test**: temp dataDir → boot server → chat turn → close server+db → boot AGAIN on same dataDir → connect → timeline.history returns prior turns in order → new chat turn's model call includes replayed history (mock model captures messages) |
| **F CLI** | T8 chat-client/main: scripted server → last-5 printed after auth (module-level, PassThrough) |

## 8. Constraints

#3/#4 §constraints carry over (invariants, caps, headers, closed error union, pino no-content logging — log seq/characterId/lengths, never message content). Additions: `db/` is the sole `node:sqlite` importer (check greps); no `fs` in db layer (TS-constant migrations); transactions synchronous and short (no await inside BEGIN..COMMIT); `lastInsertRowid` bigint handling per research (coerce safely, test it); all timeline methods operator-gated; NO new npm deps.

## 9. Verification

```bash
pnpm -r typecheck && pnpm lint && pnpm -r test
# manual (leader): fresh TAKI_DATA_DIR → core:dev → cli chat (2 turns) → Ctrl-C core → core:dev again
#   → cli reconnect: last-5 history printed, new turn references earlier fact (real DeepSeek)
#   → taki.db exists in dataDir; devices.json untouched; second boot logs migrations already applied
```

AC mapping: AC1←T2/T3+schema · AC2←T7+manual · AC3←T2+grep · AC4←path review+manual · AC5←T5/T6 · AC6←T2/T7.
