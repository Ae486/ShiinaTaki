import { afterEach, describe, expect, it } from "vitest";
import type { ConfigValue } from "@taki/shared";
import { createConfigRepo, type ConfigRepo } from "./config-repo.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase, type Database } from "./sqlite.ts";

const dbs: Database[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function open(): { db: Database; repo: ConfigRepo } {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  dbs.push(db);
  return { db, repo: createConfigRepo(db) };
}

function writeRaw(db: Database, key: string, value: string): void {
  db.prepare("INSERT INTO config (key, value, updated_at) VALUES (:key, :value, 't')").run({ key, value });
}

describe("createConfigRepo", () => {
  it("round-trips each JSON primitive", () => {
    const { repo } = open();
    repo.upsert("TAKI_MAX_STEPS", 12);
    repo.upsert("TAKI_WS_HOST", "127.0.0.1");
    repo.upsert("TAKI_AMBIENT_SCREENSHOT", true);

    expect(repo.get("TAKI_MAX_STEPS")).toBe(12);
    expect(repo.get("TAKI_WS_HOST")).toBe("127.0.0.1");
    expect(repo.get("TAKI_AMBIENT_SCREENSHOT")).toBe(true);
  });

  it("get returns null for a knob the operator never set (the store is sparse)", () => {
    const { repo } = open();
    expect(repo.get("TAKI_MAX_STEPS")).toBeNull();
    expect(repo.all().size).toBe(0);
  });

  it("upsert overwrites in place", () => {
    const { repo } = open();
    repo.upsert("TAKI_MAX_STEPS", 12);
    repo.upsert("TAKI_MAX_STEPS", 20);

    expect(repo.get("TAKI_MAX_STEPS")).toBe(20);
    expect(repo.all().size).toBe(1);
  });

  it("delete drops the row so the knob falls back to env/default", () => {
    const { repo } = open();
    repo.upsert("TAKI_MAX_STEPS", 12);
    repo.delete("TAKI_MAX_STEPS");

    expect(repo.get("TAKI_MAX_STEPS")).toBeNull();
    expect(repo.delete("TAKI_MAX_STEPS")).toBeUndefined(); // deleting an absent row is a no-op, not an error
  });

  it("all returns every stored knob as a keyed map", () => {
    const { repo } = open();
    repo.upsert("TAKI_MAX_STEPS", 12);
    repo.upsert("TAKI_LOG_LEVEL", "debug");

    expect(repo.all()).toEqual(
      new Map<string, ConfigValue>([
        ["TAKI_MAX_STEPS", 12],
        ["TAKI_LOG_LEVEL", "debug"],
      ]),
    );
  });

  it("a non-JSON row THROWS at the boundary, on get and on all", () => {
    const { db, repo } = open();
    writeRaw(db, "TAKI_MAX_STEPS", "not json");

    expect(() => repo.get("TAKI_MAX_STEPS")).toThrow(/not valid JSON/);
    expect(() => repo.all()).toThrow(/not valid JSON/);
  });

  it("a JSON row that is not a primitive THROWS (composites are never valid knob values)", () => {
    const { db, repo } = open();
    writeRaw(db, "TAKI_MAX_STEPS", '{"a":1}');

    expect(() => repo.get("TAKI_MAX_STEPS")).toThrow(/not a JSON primitive/);
  });
});
