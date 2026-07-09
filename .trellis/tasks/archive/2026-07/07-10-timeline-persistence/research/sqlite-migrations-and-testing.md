# Research: SQLite migrations + testing (node:sqlite, vitest 4)

- **Query**: Simplest correct startup-migration pattern + vitest testing strategy for issue #5
- **Scope**: internal (spec/pattern) + empirical
- **Date**: 2026-07-10

## (a) Startup migration pattern

### Migrations table (simplest correct design)

```sql
CREATE TABLE IF NOT EXISTS migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL          -- ISO-8601 UTC, per schema-convention spec
) STRICT;
```

Apply every migration whose number `> SELECT max(version)`, each wrapped in its own transaction so a mid-migration crash never leaves a half-applied schema.

### SQL-as-TS-constants vs `.sql` files — **spec conflict to surface**

There is a direct tension the main agent must resolve:

- **`.trellis/spec/backend/database-guidelines.md:12` explicitly prescribes**: *"Migrations: numbered SQL files `db/migrations/NNN-description.sql`, applied at startup, tracked in a `migrations` table."* This is the authoritative project constraint today.
- **Task brief leans the other way**: TS string constants avoid an `fs` dependency entirely and survive bundling.

Both are viable with node:sqlite (each migration is just a string handed to `db.exec()`):

| Approach | Pro | Con |
|---|---|---|
| **`.sql` files** (spec) | migrations are first-class, diff-friendly, DBA-readable; matches spec | db layer must `readFileSync` its own migration dir + resolve paths at runtime; bundling must copy the `.sql` files |
| **TS string constants** | zero fs, survives esbuild/tsup bundling, no path resolution | large SQL lives in `.ts`; drifts from the spec wording |

**Reading migration `.sql` is a *sanctioned* fs site**, not an invariant-1 violation: the db wrapper reads **its own** migration assets, exactly mirroring `packages/core/src/devices/paired-device-store.ts` whose header tags it `SANCTIONED node:fs site (core-owned … not agent-reachable; invariant 1)` (`paired-device-store.ts:1-6,46`). So the fs concern is not a blocker for the `.sql` approach — it's an ergonomics/bundling tradeoff only.

**Recommendation (researcher, non-binding)**: follow the spec (`.sql` files) unless the team decides to bundle Core into a single artifact, in which case update `database-guidelines.md:12` first and use TS constants. If the main agent picks TS-constants for simplicity, it MUST run `update-spec` to keep the spec truthful (do not silently diverge). Flagging, not deciding.

### Migration-runner pseudocode (works for either source)

```ts
// migrations: ordered [{ version: number, sql: string }], version ascending.
// Either read from db/migrations/*.sql (spec) or import string constants.
function runMigrations(db: DatabaseSync, migrations: Migration[]): void {
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (
    version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT`);
  const row = db.prepare("SELECT max(version) AS v FROM migrations").get();
  const current = (row?.v as number | null) ?? 0;         // 0 on first boot
  const record = db.prepare("INSERT INTO migrations (version, applied_at) VALUES (?, ?)");
  for (const m of migrations) {
    if (m.version <= current) continue;
    db.exec("BEGIN");
    try {
      db.exec(m.sql);                                       // DDL/DML for this step
      record.run(m.version, new Date().toISOString());
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`migration ${m.version} failed`, { cause: err });
    }
  }
}
```

Notes: synchronous, short transactions (spec rule). Parse the filename number strictly (`NNN`) and assert versions are contiguous/unique before applying if using files. Enable `PRAGMA foreign_keys=ON` (default) — but note some schema-altering migrations need FKs temporarily off; if so, toggle *outside* the per-migration transaction (SQLite ignores `foreign_keys` changes inside a transaction).

## (b) Testing node:sqlite with vitest 4

Confirmed on this machine: `node:sqlite` imports and runs **cleanly under vitest 4.1.10** (no config file in repo; `packages/core` is ESM, `test: "vitest run"`). No ExperimentalWarning, no special setup.

### In-memory per-test isolation (verified isolated)

Each `new DatabaseSync(":memory:")` is an independent DB (empirically B cannot see A's tables). Give every test a fresh instance — no shared state, no cleanup needed.

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";

let db: DatabaseSync;
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  runMigrations(db, MIGRATIONS);        // exercise real schema each test
});

it("appends a turn to the timeline", () => {
  const repo = createTimelineRepo(db);
  repo.append({ role: "user", content: "hi" });
  expect(repo.recent(10)).toHaveLength(1);
});
```

### Temp-file restart survival (AC: simulated restart) — verified on Windows

`.close()` **releases the OS file handle**, so opening a NEW `DatabaseSync` on the same path reads the persisted data — confirmed on this Windows box (`reopenErr: null`, row survived). Use `os.tmpdir()` + `fs.mkdtempSync` + `path.join` for cross-platform paths.

```ts
import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

it("timeline survives an agent restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "taki-db-"));
  const file = join(dir, "taki.db");
  try {
    // --- first boot: migrate + write, then shut down ---
    const first = new DatabaseSync(file);
    runMigrations(first, MIGRATIONS);
    createTimelineRepo(first).append({ role: "user", content: "before restart" });
    first.close();                              // releases the file handle

    // --- second boot: brand-new connection, same file ---
    const second = new DatabaseSync(file);
    runMigrations(second, MIGRATIONS);          // idempotent: no-op, already applied
    const rows = createTimelineRepo(second).recent(10);
    expect(rows.at(-1)?.content).toBe("before restart");
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

Windows notes (all empirically clean here): close→reopen works with no lock error; `rmSync(dir, {recursive:true, force:true})` removes the db file + any `-wal`/`-shm` sidecars after close. If a test opts into WAL, still call `.close()` before deleting so the handles are freed. Prefer `mkdtempSync` over a fixed path so parallel vitest workers never collide.

## Raw empirical evidence (Node 24.18.0, this Windows machine)

```
run() result {"changes":1,"lastInsertRowid":1,"typeofRowid":"number","typeofChanges":"number"}
all() rows [{"id":1,"role":"user","content":"hi",...},{"id":2,"role":"assistant",...}]
type-map (default) {"n":42,"typeofN":"number","s":"txt","blobCtor":"Uint8Array","blobBytes":[1,2,3],"nul":null}
large INTEGER read {"defaultReadErr":"ERR_OUT_OF_RANGE","withReadBigInts":"bigint(9007199254740993)","typeofBig":"bigint"}
isTransaction true
count after rollback (expect 2) 2
:memory: b sees a's table? (expect false=isolated) false
journal_mode after set {"journal_mode":"wal"}
reopened row survived? {"survived":{"content":"persisted-before-restart"},"reopenErr":null}
process warnings captured []     <-- no ExperimentalWarning
PROBE-DONE
```

vitest run: `Test Files 1 passed (1) / Tests 1 passed (1)` on vitest v4.1.10.

## Caveats / Not Found

- The `.sql`-vs-TS-constants decision is a **spec conflict**, deliberately left for the main agent (documented above with the spec citation). Not a researcher call.
- `runMigrations` must be idempotent so the restart test can call it twice; the `version <= current` guard guarantees this.
- Throwaway probe scripts lived under `research/tmp/` and were deleted after capturing the output above.
