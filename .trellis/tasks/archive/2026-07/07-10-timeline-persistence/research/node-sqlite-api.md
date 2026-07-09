# Research: node:sqlite API (as shipped in Node 24.18.0)

- **Query**: Exact `node:sqlite` API for the `packages/core/src/db/` wrapper (issue #5 timeline persistence)
- **Scope**: external (Node stdlib) + empirical
- **Date**: 2026-07-10

## Evidence sources

- Installed types: `node_modules/.pnpm/@types+node@24.13.3/node_modules/@types/node/sqlite.d.ts` (cited as `sqlite.d.ts:LINE`). NOTE the installed `@types/node` is **24.13.3**, runtime is **24.18.0** — a few options added after 24.13.3 (e.g. `limits`) are in the docs but not yet in these types. Minor drift, non-blocking.
- Official docs: https://nodejs.org/docs/latest-v24.x/api/sqlite.html (v24.18.0).
- Empirical runtime: `node v24.18.0` on this Windows machine (probe output pasted below).

## Findings

### 1. `DatabaseSync` construction & lifecycle

`new DatabaseSync(path: PathLike, options?: DatabaseSyncOptions)` — `sqlite.d.ts:245`. `path` is `string | Buffer | URL`; use `':memory:'` for in-memory. Opens **synchronously in the constructor** unless `open:false` (then call `db.open()` — `sqlite.d.ts:419`). Close with `db.close()` (`sqlite.d.ts:283`). Class implements `Disposable` + `[Symbol.dispose]()` (`sqlite.d.ts:236,567`) so `using db = new DatabaseSync(...)` auto-closes.

Constructor options (all `sqlite.d.ts:44-129`, defaults confirmed against docs):

| Option | Default | Since | Note |
|---|---|---|---|
| `open` | `true` | 22.5 | construct-time open |
| `readOnly` | `false` | 22.12 | fails if file missing |
| `enableForeignKeyConstraints` | `true` | 22.10 | FKs ON by default |
| `enableDoubleQuotedStringLiterals` | `false` | 22.10 | keep off |
| `allowExtension` | `false` | 22.13 | must be true before `loadExtension()` |
| `timeout` | `0` | 24.0 | busy-timeout ms (alias for `PRAGMA busy_timeout`) |
| `readBigInts` | `false` | 24.4 | read INTEGER as BigInt (see §2 gotcha) |
| `returnArrays` | `false` | 24.4 | rows as arrays not objects |
| `allowBareNamedParameters` | `true` | 24.4 | bind `{key}` without `:`/`$`/`@` prefix |
| `allowUnknownNamedParameters` | `false` | 24.4 | throw on unknown named param |
| `defensive` | `true` | 24.12 | blocks SQL that can corrupt the file |

Runtime state: `db.isOpen` (`:407`), `db.isTransaction` (`:413`), `db.location(dbName?)` (`:318`, returns `null` for `:memory:`).

### 2. Statement API

- `db.exec(sql): void` — runs one or more statements, returns nothing (`sqlite.d.ts:326`). Use for DDL / migration scripts / `BEGIN`/`COMMIT`.
- `db.prepare(sql): StatementSync` (`sqlite.d.ts:427`).

`StatementSync` methods (`sqlite.d.ts:757-887`):

| Method | Returns | Line |
|---|---|---|
| `.run(named?, ...positional)` | `StatementResultingChanges` | 833 |
| `.get(named?, ...positional)` | `Record<string,SQLOutputValue> \| undefined` | 802 |
| `.all(named?, ...positional)` | `Record<string,SQLOutputValue>[]` | 770 |
| `.iterate(named?, ...positional)` | `Iterator<Record<string,SQLOutputValue>>` | 820 |
| `.columns()` | `StatementColumnMetadata[]` | 782 |

**`.run()` return shape** = `StatementResultingChanges { changes: number|bigint; lastInsertRowid: number|bigint }` (`sqlite.d.ts:731-744`). **Empirically both are `number` by default** (bigint only if `readBigInts`/`setReadBigInts(true)`): `{"changes":1,"lastInsertRowid":1,"typeofRowid":"number","typeofChanges":"number"}`.

**Rows are column-keyed objects**, e.g. `{ id: 1, role: "user", content: "hi", created_at: "..." }`.

**Parameter binding**: named parameters are passed as a **single object as the FIRST argument** (`run(namedParameters, ...anonymousParameters)` — `sqlite.d.ts:834-836`); positional `?` bound by trailing args. In SQL the prefix (`:`, `$`, `@`) is required; in JS the object key may omit it because `allowBareNamedParameters` defaults true. Empirically `INSERT ... VALUES (:role, :content, :at)` bound with `{ role, content, at }` works.

**JS↔SQLite type mapping** (`SQLInputValue`/`SQLOutputValue`, `sqlite.d.ts:42-43`): bind/read `null | number | bigint | string | ArrayBufferView`. Empirically: `number→number`, `string→string`, **`BLOB→Uint8Array`**, `NULL→null`, bigint round-trips as bigint.

### 3. Stability — NOT experimental-flagged, NO runtime warning

- Official stability index (v24.18.0 docs): **`Stability: 1.2 - Release candidate`**. Changelog: "SQLite is now a release candidate" (v24.15.0); "no longer behind `--experimental-sqlite` but still experimental" (v22.13/v23.4). The 24.13.3 JSDoc still tags `@experimental` (`sqlite.d.ts:37`).
- **Empirically NO `ExperimentalWarning` is emitted** at import or use in 24.18.0. A clean `node --input-type=module -e "import {DatabaseSync} from 'node:sqlite'; ..."` produced an **empty stderr** (only our own marker printed). `import { DatabaseSync } from "node:sqlite"` needs **no flag**; `node --help` lists only `--no-experimental-sqlite` (to disable). Nothing to suppress.
- Works cleanly **under vitest 4.1.10** (throwaway `*.test.mjs` passed, no warning noise) — see `sqlite-migrations-and-testing.md`.

### 4. Transactions — manual, synchronous only

No wrapper/`transaction()` helper exists. Use `db.exec("BEGIN")` … `db.exec("COMMIT")` / `db.exec("ROLLBACK")`. Empirically `db.isTransaction` flips to `true` after `BEGIN`, and `ROLLBACK` reverts the insert (row count returned to 2). All APIs are **synchronous** (class doc `sqlite.d.ts:232-233`) — never hold a transaction open across an `await` (the "no txn across async gaps" spec rule is a natural fit).

### 5. In-memory DB — isolated per instance

Path string is exactly `':memory:'`. Empirically two `new DatabaseSync(":memory:")` are **fully isolated** — instance B could not see instance A's table (`b sees a's table? false`). Good for per-test isolation (no shared-cache surprise).

### 6. Pragmas for a single-writer durable store

Set via `db.exec("PRAGMA ...")` or read via `db.prepare("PRAGMA journal_mode").get()`. Empirically `PRAGMA journal_mode = WAL` → `{ journal_mode: "wal" }`.
- `journal_mode=WAL`: for a **strict single writer** the default rollback journal already gives durability; WAL's main win is non-blocking concurrent **readers** and often better write throughput. Our DB has one OS-process writer (Agent Core) but *may* prepare-read from the same connection frequently — WAL is a safe, low-cost default. Caveat: WAL creates `-wal`/`-shm` sidecar files next to the DB; back them up together.
- `foreign_keys`: ON by default via `enableForeignKeyConstraints` (or `PRAGMA foreign_keys=ON`).
- `busy_timeout`: prefer the constructor `timeout` option; equivalent to `PRAGMA busy_timeout=<ms>`.

## Minimal compilable TS snippet

```ts
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("C:/Users/me/.takiagent/taki.db"); // opens synchronously
db.exec("PRAGMA journal_mode = WAL");
db.exec(`CREATE TABLE IF NOT EXISTS turn (
  id INTEGER PRIMARY KEY,
  role TEXT NOT NULL,
  content TEXT,
  created_at TEXT NOT NULL
) STRICT`);

const insert = db.prepare(
  "INSERT INTO turn (role, content, created_at) VALUES (:role, :content, :at)",
);
const { lastInsertRowid, changes } = insert.run({
  role: "user",
  content: "hello",
  at: new Date().toISOString(),
}); // lastInsertRowid: number, changes: number

const rows = db.prepare("SELECT * FROM turn ORDER BY id").all();
// rows: Array<{ id: number; role: string; content: string; created_at: string }>
db.close();
```

## Caveats / Not Found

- **`ERR_OUT_OF_RANGE` gotcha**: reading a SQLite `INTEGER` larger than `Number.MAX_SAFE_INTEGER` as a JS number **throws** `RangeError [ERR_OUT_OF_RANGE]` at read time. Observed: default read threw `ERR_OUT_OF_RANGE`; after `stmt.setReadBigInts(true)` it read back `9007199254740993n` (bigint). Relevant only if a column can exceed 2^53 (autoincrement rowids won't for a long time; epoch-ms timestamps are safe). If a bigint id is ever used, opt into BigInt per-statement or via `readBigInts:true`.
- `@types/node@24.13.3` predates the docs' `limits` constructor option — verify against runtime if you need it (we don't for issue #5).
- Empirical probe output retained inline above; throwaway scripts under `research/tmp/` were deleted after capture.
