# Database Guidelines

## Engine and access

- SQLite via **`node:sqlite`** (Node 24 built-in), wrapped in `packages/core/src/db/`. The wrapper is the only module importing `node:sqlite` — keeps a `better-sqlite3` swap trivial if stability disappoints.
- **Single writer**: only the Agent Core opens the database. Shell, Pet UI, and future mobile nodes query/subscribe over the WS API (ADR 0004). Never open the DB file from Rust or the UI.
- DB file lives in the app data root (`%USERPROFILE%\.takiagent\`, beside the Workspace, not inside it), never in the repo or install dir.

## Schema conventions

- Tables and columns: `snake_case`. Timestamps: `*_at`, ISO-8601 UTC strings.
- Migrations: numbered TS modules `db/migrations/NNN-description.ts`, each exporting `{ version, sql }` (plain SQL string constants — keeps the db layer fs-free and bundle-safe), aggregated in one explicit ordered list (no fs/glob discovery), applied at startup each inside a transaction, tracked in a `migrations` table. No ORM — hand-written SQL in repository modules (`db/timeline-repo.ts`, `db/memory-repo.ts`), one repo per aggregate.
- Memory search: SQLite **FTS5** virtual table indexing Workspace markdown files; markdown is the source of truth, the index is rebuildable.

## Patterns

- Repos expose typed functions; zod-parse rows at boundaries where shape matters.
- Every externally-relevant write emits a WS event after commit (this is how desktop→phone real-time works). Write + event emission live together in the repo/service layer.
- No transactions across async gaps; keep them synchronous and short.
