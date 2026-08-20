import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "./index-list.ts";
import { openDatabase } from "../sqlite.ts";

describe("canonical memory migration", () => {
  it("adds empty canonical tables without touching legacy rows", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    db.exec("INSERT INTO memory_entries (id, path, layer, character_id, importance, created_at, status, content_hash) VALUES ('legacy','legacy.md','episodes','c',4,'2026-08-19T00:00:00.000Z','active','h')");
    expect(db.prepare("SELECT count(*) AS n FROM canonical_memory_authority_epochs").get()?.n).toBe(0);
    expect(db.prepare("SELECT count(*) AS n FROM canonical_memory_banks").get()?.n).toBe(0);
    expect(db.prepare("SELECT id FROM memory_entries").get()?.id).toBe("legacy");
    expect(db.prepare("SELECT version FROM migrations WHERE version=17").get()?.version).toBe(17);
    db.close();
  });
  it("enforces canonical scope and lifecycle constraints", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    expect(() => db.exec("INSERT INTO canonical_memory_authority_epochs VALUES ('e','local','l','active',NULL,'2026-08-19T00:00:00.000Z','2026-08-19T00:00:00.000Z','initial-local')")).toThrow();
    db.exec("INSERT INTO canonical_memory_authority_epochs VALUES ('e','local','l','active',NULL,'2026-08-19T00:00:00.000Z',NULL,'initial-local')");
    expect(() => db.exec("INSERT INTO canonical_memory_banks VALUES ('e','b','global','char','{}','','{}',1,'2026-08-19T00:00:00.000Z','2026-08-19T00:00:00.000Z')")).toThrow();
    db.close();
  });
});
