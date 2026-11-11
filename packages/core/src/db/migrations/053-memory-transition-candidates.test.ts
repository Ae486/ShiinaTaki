import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../sqlite.ts";
import { MIGRATIONS } from "./index-list.ts";
import { createTransitionReentryFixture } from "../../testing/memory-transition-reentry-fixtures.ts";
import { captureTransitionLocal } from "../memory-transition-local-capture.ts";
import { rmTempDir } from "../../testing/rm-temp.ts";

const roots: string[] = []; const databases: Database[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const root of roots.splice(0)) {
    const absolute = resolve(root);
    if (dirname(absolute) !== resolve(tmpdir()) || !basename(absolute).startsWith("taki-w3-")) throw new Error("unsafe fixture path");
    rmTempDir(absolute);
  }
});
function fixturePath(kind: "lineage" | "writer") {
  const root = mkdtempSync(join(tmpdir(), `taki-w3-${kind}-`)); roots.push(root); return join(root, "database.sqlite");
}
function openFixture(options: Parameters<typeof openDatabase>[0]) {
  const db = openDatabase(options); databases.push(db); return db;
}

describe("W3 additive 053 and writer reservation", () => {
  it("upgrades a real 052 file without rewriting receipts and reopens without migration", () => {
    const path = fixturePath("lineage");
    let db = openFixture({ path, migrations: MIGRATIONS.filter((migration) => migration.version <= 52) });
    const before = db.prepare("SELECT * FROM migrations ORDER BY version").all(); db.close();
    const applied: number[][] = [];
    db = openFixture({ path, migrations: MIGRATIONS, onMigrated: (versions) => applied.push(versions) });
    expect(applied).toEqual([MIGRATIONS.filter(({ version }) => version > 52).map(({ version }) => version)]);
    expect(db.prepare("SELECT * FROM migrations WHERE version<=52 ORDER BY version").all()).toEqual(before);
    expect(db.prepare("PRAGMA quick_check").get()?.quick_check).toBe("ok"); db.close();
    db = openFixture({ path, migrations: MIGRATIONS, onMigrated: (versions) => applied.push(versions) });
    expect(applied).toEqual([MIGRATIONS.filter(({ version }) => version > 52).map(({ version }) => version), []]); db.close();
  });
  it("holds a real writer reservation across complete discovery and rolls capture back on failure", () => {
    const path = fixturePath("writer");
    const db = openFixture({ path, migrations: MIGRATIONS }); const fixture = createTransitionReentryFixture(db);
    const second = openFixture({ path, migrations: MIGRATIONS }); second.exec("PRAGMA busy_timeout=1");
    try {
      const assertConfiguration = () => {
        expect(() => second.prepare("UPDATE canonical_memory_banks SET mission='raced' WHERE authority_epoch_id=:epoch")
          .run({ epoch: fixture.candidate.targetEpochId })).toThrow();
      };
      db.exec("CREATE TRIGGER fail_w3_capture BEFORE INSERT ON memory_transition_captures BEGIN SELECT RAISE(ABORT,'capture refused'); END");
      expect(() => captureTransitionLocal(db, { ...fixture.input, assertConfiguration })).toThrow("capture refused");
      expect(db.prepare("SELECT count(*) AS n FROM memory_transition_captures").get()?.n).toBe(0);
      db.exec("DROP TRIGGER fail_w3_capture");
      expect(captureTransitionLocal(db, { ...fixture.input, assertConfiguration }).state.banks).toHaveLength(3);
    } finally { second.close(); db.close(); }
  });
});
