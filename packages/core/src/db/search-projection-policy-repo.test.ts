import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { T4_HISTORICAL_MIGRATIONS } from "./migrations/historical-t4.ts";
import { openDatabase, type Database } from "./sqlite.ts";
import { createSearchProjectionPolicyRepo, SEARCH_TOKENIZER_VERSION } from "./search-projection-policy-repo.ts";

const roots: string[] = [];
const opened: Database[] = [];
afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("taki-search-policy-")) throw new Error("unsafe fixture path");
    rmSync(root, { recursive: true, force: true });
  }
});
function open(path = ":memory:", through?: number) {
  const migrations = through === undefined ? MIGRATIONS : T4_HISTORICAL_MIGRATIONS.filter((migration) => migration.version <= through);
  const db = openDatabase({ path, migrations });
  opened.push(db);
  return db;
}

describe("search projection policy", () => {
  it("upgrades a real prior database without guessing policy or rewriting existing rows", () => {
    const root = mkdtempSync(join(tmpdir(), "taki-search-policy-")); roots.push(root);
    const path = join(root, "taki.db");
    const previous = open(path, 71);
    previous.exec("INSERT INTO memory_fts(path,disclosure,content,search_terms) VALUES('/memory/a.md','food','我 喜欢 拉面','喜欢 拉面')");
    previous.exec("INSERT INTO config(key,value,updated_at) VALUES('TAKI_MEMORY_STOPLIST','\"off\"','2026-11-10T00:00:00Z')");
    const before = previous.prepare("SELECT * FROM memory_fts").all();
    const receipts = previous.prepare("SELECT * FROM migrations ORDER BY version").all();
    previous.close();
    const upgraded = open(path, 72);
    const policy = createSearchProjectionPolicyRepo(upgraded);
    const identity = { table: "memory_fts", epochId: null } as const;
    expect(upgraded.prepare("SELECT * FROM memory_fts").all()).toEqual(before);
    expect(upgraded.prepare("SELECT * FROM migrations WHERE version<=71 ORDER BY version").all()).toEqual(receipts);
    expect(upgraded.prepare("SELECT value FROM config").get()?.value).toBe('"off"');
    expect(policy.read(identity)).toBeNull();
    policy.write(identity, true);
    upgraded.close();
    const reopened = open(path, 72);
    expect(createSearchProjectionPolicyRepo(reopened).read(identity)).toEqual({ stoplist: true, tokenizerVersion: SEARCH_TOKENIZER_VERSION });
    expect(reopened.prepare("SELECT MAX(version) AS version FROM migrations").get()?.version).toBe(72);
  });

  it("keeps epoch policies distinct and treats a different tokenizer implementation as unknown", () => {
    const db = open();
    const repo = createSearchProjectionPolicyRepo(db);
    const legacy = { table: "memory_fts", epochId: null } as const;
    const first = { table: "canonical_memory_fts", epochId: "epoch-a" } as const;
    const second = { table: "canonical_memory_fts", epochId: "epoch-b" } as const;
    repo.write(legacy, true); repo.write(first, false); repo.write(second, true);
    expect(repo.appliedStoplist(legacy)).toBe(true);
    expect(repo.appliedStoplist(first)).toBe(false);
    expect(repo.appliedStoplist(second)).toBe(true);
    db.exec("UPDATE search_projection_policy SET tokenizer_version='previous-runtime' WHERE authority_epoch_id='epoch-a'");
    expect(repo.read(first)).toEqual({ stoplist: false, tokenizerVersion: "previous-runtime" });
    expect(repo.appliedStoplist(first)).toBeNull();
    expect(repo.appliedStoplist(second)).toBe(true);
  });

  it("rejects identities outside Local/Legacy and rolls policy writes back with their caller", () => {
    const db = open();
    const repo = createSearchProjectionPolicyRepo(db);
    const identity = { table: "memory_fts", epochId: null } as const;
    repo.write(identity, true);
    expect(() => db.transaction(() => { repo.write(identity, false); throw new Error("cancel publication"); })).toThrow("cancel publication");
    expect(repo.appliedStoplist(identity)).toBe(true);
    expect(() => db.exec("INSERT INTO search_projection_policy VALUES('hindsight_replica_sync_fts','','v1',1)")).toThrow();
    expect(() => db.exec("INSERT INTO search_projection_policy VALUES('canonical_memory_fts','','v1',1)")).toThrow();
  });
});
