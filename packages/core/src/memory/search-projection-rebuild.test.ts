import { setImmediate } from "node:timers/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCanonicalMaintenanceFixture } from "../db/canonical-memory-maintenance-fixtures.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { loadMemoryConfig } from "../config/memory-config.ts";
import { createSearchProjectionPolicyRepo } from "../db/search-projection-policy-repo.ts";
import { createIntlSegmenterTokenizer } from "./search-tokenizer.ts";
import { canonicalSearchProjection } from "./canonical-search-projection.ts";
import { createCanonicalLocalRuntime } from "./canonical-local-runtime.ts";
import { cleanAbandonedSearchProjections, rebuildSearchProjection } from "./search-projection-rebuild.ts";
import { createLiveSearchTokenizer } from "./live-search-tokenizer.ts";

const opened: Database[] = [];
const roots: string[] = [];
afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("taki-search-rebuild-")) throw new Error("unsafe fixture path");
    rmSync(root, { recursive: true, force: true });
  }
});
function fixture() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  opened.push(db);
  return createCanonicalMaintenanceFixture(db);
}

describe("search projection publication", () => {
  it("reconciles concurrent inserts, edits and removals before replacing the live index", async () => {
    const f = fixture();
    f.seed({ memoryId: "old", unit: { text: "我是拉面爱好者" } });
    f.seed({ memoryId: "removed", unit: { text: "hidden later" } });
    const source = canonicalSearchProjection(f.db, f.epochId);
    const scan = source.scan;
    source.scan = async function* () {
      for await (const row of scan()) { yield row; }
      await setImmediate();
      f.seed({ memoryId: "late", unit: { text: "我也喜欢咖啡" } });
      f.db.prepare("UPDATE canonical_memory_units SET text=:text WHERE memory_id='old'").run({ text: "我 喜欢 寿司" });
      f.db.exec("UPDATE canonical_memory_policy SET visibility='hidden' WHERE memory_id='removed'");
    };
    let published = false;
    const result = await rebuildSearchProjection({ db: f.db, source, tokenizer: createIntlSegmenterTokenizer({ stoplist: false }),
      assertCurrent() {}, publish: () => { published = true; } });
    expect(result.indexed).toBe(2);
    expect(published).toBe(true);
    const rows = f.db.prepare("SELECT memory_id,text,search_terms FROM canonical_memory_fts ORDER BY memory_id").all();
    expect(rows).toHaveLength(2);
    expect(rows[1]?.text).toBe("我 喜欢 寿司");
    expect(String(rows[1]?.search_terms).split(" ")).toContain("我");
    expect(f.db.prepare("SELECT name FROM sqlite_temp_master WHERE name LIKE 'taki_reindex_%'").all()).toEqual([]);
  });

  it("preserves old index and tokenizer when authority changes before publication", async () => {
    const f = fixture(); f.seed({ unit: { text: "我是拉面爱好者" } });
    const before = f.db.prepare("SELECT * FROM canonical_memory_fts").all();
    const source = canonicalSearchProjection(f.db, f.epochId);
    const scan = source.scan; let active = true; let published = false;
    source.scan = async function* () { yield* scan(); active = false; };
    await expect(rebuildSearchProjection({ db: f.db, source, tokenizer: createIntlSegmenterTokenizer({ stoplist: false }),
      assertCurrent: () => { if (!active) throw new Error("retired"); }, publish: () => { published = true; } }))
      .rejects.toThrow("retired");
    expect(published).toBe(false);
    expect(f.db.prepare("SELECT * FROM canonical_memory_fts").all()).toEqual(before);
    expect(f.db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'taki_reindex_%'").all()).toEqual([]);
  });

  it("keeps held Run tools on matching search and write tokenizers after publication", async () => {
    const f = fixture();
    const runtime = createCanonicalLocalRuntime({ db: f.db, epochId: f.epochId });
    runtime.writeEntry({ type: "episodes", origin: "observed", characterId: "taki", content: "我 喜欢 拉面", importance: 5 });
    const run = await runtime.captureRun("taki");
    const prompt = run.assemble!("");
    const identity = run.snapshot;
    await runtime.reconfigureSearch!({ ...loadMemoryConfig({}), stoplist: false });
    const result = await run.tools.recall!.execute!({ query: "我", scope: "character", limit: 8, maxTokens: 1024 },
      { toolCallId: "retained", messages: [], context: {} });
    expect(result).toMatchObject({ ok: true, data: { returned: 1 } });
    runtime.writeEntry({ type: "episodes", origin: "observed", characterId: "taki", content: "我 喜欢 咖啡", importance: 5 });
    expect(f.db.prepare("SELECT search_terms FROM canonical_memory_fts").all().every((row) => String(row.search_terms).split(" ").includes("我"))).toBe(true);
    expect(run.snapshot).toBe(identity);
    expect(run.assemble!("")).toBe(prompt);
  });
});

describe("search projection persistence", () => {
  it.each(["policy-write", "commit"])("rolls back index, policy and facade on %s failure", async (failure) => {
    const f = fixture(); f.seed({ unit: { text: "我 喜欢 拉面" } });
    const repo = createSearchProjectionPolicyRepo(f.db);
    const identity = { table: "canonical_memory_fts", epochId: f.epochId } as const;
    repo.write(identity, true);
    const search = createLiveSearchTokenizer(repo.appliedStoplist(identity));
    const before = f.db.prepare("SELECT * FROM canonical_memory_fts").all();
    f.db.exec("CREATE TABLE policy_parent(id INTEGER PRIMARY KEY); CREATE TABLE policy_child(id INTEGER REFERENCES policy_parent(id) DEFERRABLE INITIALLY DEFERRED)");
    await expect(search.reconfigure(false, (candidate, publish) => rebuildSearchProjection({
      db: f.db, source: canonicalSearchProjection(f.db, f.epochId), tokenizer: candidate,
      assertCurrent() {}, publish,
      commitPolicy() {
        repo.write(identity, false);
        if (failure === "policy-write") throw new Error("policy failure");
        f.db.exec("INSERT INTO policy_child VALUES(1)");
      },
    }))).rejects.toThrow();
    expect(repo.appliedStoplist(identity)).toBe(true);
    expect(search.appliedStoplist()).toBe(true);
    expect(search.tokenizer.tokenize("我 喜欢 拉面")).not.toContain("我");
    expect(f.db.prepare("SELECT * FROM canonical_memory_fts").all()).toEqual(before);
    expect(f.db.prepare("SELECT * FROM policy_child").all()).toEqual([]);
    expect(f.db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'taki_reindex_%'").all()).toEqual([]);
  });

  it("reopens the committed index policy even when process-local publication was lost", async () => {
    const root = mkdtempSync(join(tmpdir(), "taki-search-rebuild-")); roots.push(root);
    const path = join(root, "taki.db");
    const db = openDatabase({ path, migrations: MIGRATIONS }); opened.push(db);
    const f = createCanonicalMaintenanceFixture(db); f.seed({ unit: { text: "我 喜欢 拉面" } });
    const identity = { table: "canonical_memory_fts", epochId: f.epochId } as const;
    const repo = createSearchProjectionPolicyRepo(db);
    expect(repo.appliedStoplist(identity)).toBeNull();
    const search = createLiveSearchTokenizer(repo.appliedStoplist(identity));
    await search.reconfigure(false, (candidate) => rebuildSearchProjection({
      db, source: canonicalSearchProjection(db, f.epochId), tokenizer: candidate,
      assertCurrent() {}, commitPolicy: () => repo.write(identity, false), publish() {},
    }));
    // A new process owns the next facade; it must derive its policy from the committed database.
    expect(search.ready()).toBe(false);
    db.close();
    const reopened = openDatabase({ path, migrations: MIGRATIONS }); opened.push(reopened);
    const recovered = createLiveSearchTokenizer(createSearchProjectionPolicyRepo(reopened).appliedStoplist(identity));
    expect(recovered.ready()).toBe(true);
    expect(recovered.tokenizer.tokenize("我 喜欢 拉面")).toContain("我");
    expect(reopened.prepare("SELECT memory_id FROM canonical_memory_fts WHERE canonical_memory_fts MATCH 'search_terms:我'").all()).toHaveLength(1);
    await recovered.reconfigure(false, async () => { throw new Error("matching persisted policy must not rebuild"); });
  });

  it("rebuilds an unknown historical policy and publishes readiness only after its durable write", async () => {
    const f = fixture(); f.seed({ unit: { text: "我 喜欢 拉面" } });
    const repo = createSearchProjectionPolicyRepo(f.db);
    const identity = { table: "canonical_memory_fts", epochId: f.epochId } as const;
    const search = createLiveSearchTokenizer(repo.appliedStoplist(identity));
    const source = canonicalSearchProjection(f.db, f.epochId);
    const scan = source.scan;
    source.scan = async function* () {
      for await (const row of scan()) {
        expect(search.ready()).toBe(false);
        expect(repo.read(identity)).toBeNull();
        yield row;
      }
    };
    await search.reconfigure(true, (candidate, publish) => rebuildSearchProjection({
      db: f.db, source, tokenizer: candidate, assertCurrent() {}, commitPolicy: () => repo.write(identity, true),
      publish: () => { expect(repo.appliedStoplist(identity)).toBe(true); publish(); },
    }));
    expect(search.ready()).toBe(true);
    expect(search.appliedStoplist()).toBe(true);
  });

  it("cleans only narrowly named abandoned virtual candidates after reopen", () => {
    const root = mkdtempSync(join(tmpdir(), "taki-search-rebuild-")); roots.push(root);
    const path = join(root, "taki.db");
    const db = openDatabase({ path, migrations: MIGRATIONS }); opened.push(db);
    const candidate = `taki_reindex_${"a".repeat(32)}`;
    const retired = `taki_reindex_${"b".repeat(32)}_retired`;
    const ordinary = `taki_reindex_${"c".repeat(32)}`;
    db.exec(`CREATE VIRTUAL TABLE ${candidate} USING fts5(content); CREATE VIRTUAL TABLE ${retired} USING fts5(content)`);
    db.exec(`CREATE TABLE ${ordinary}(content TEXT); CREATE VIRTUAL TABLE taki_reindex_owned_elsewhere USING fts5(content)`);
    db.close();
    const reopened = openDatabase({ path, migrations: MIGRATIONS }); opened.push(reopened);
    cleanAbandonedSearchProjections(reopened);
    const names = reopened.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
    expect(names).not.toContain(candidate);
    expect(names).not.toContain(retired);
    expect(names).toContain(ordinary);
    expect(names).toContain("taki_reindex_owned_elsewhere");
    expect(names).toContain("memory_fts");
    expect(names).toContain("canonical_memory_fts");
  });
});
