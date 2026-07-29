import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { createMemoryRepo } from "../db/memory-repo.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { rmTempDir } from "../testing/rm-temp.ts";
import { createBlockStore } from "./block-store.ts";
import { reconcile } from "./indexer.ts";
import { createMemoryStore } from "./store.ts";

const dataDirs: string[] = [];
const dbs: Database[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const dir of dataDirs.splice(0)) rmTempDir(dir);
});

describe("Memory Blocks never enter the FTS index (structural, not a filter)", () => {
  it("reconciles a workspace that holds blocks and indexes zero of them", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "taki-ws-"));
    dataDirs.push(dataDir);
    // The real production layout: blocks live BESIDE the entry tree, never under it, so the entry store's recursive
    // walk cannot reach a block and the indexer has nothing to filter out.
    const store = createMemoryStore({ root: join(dataDir, "workspace", "memory") });
    const blocks = createBlockStore({ root: join(dataDir, "workspace", "blocks") });
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    dbs.push(db);
    const repo = createMemoryRepo(db);

    blocks.writeBlock({ id: "user-card", content: "Name: pleia", caller: "user" });
    blocks.writeBlock({ id: "user-model", content: "常在深夜写代码", caller: "background" });
    blocks.writeBlock({ id: "memory-index", characterId: "taki", content: "拉面", caller: "background" });
    store.write({ layer: "episodes", characterId: "taki", content: "今天聊到了豚骨拉面", importance: 4 });

    const stats = reconcile({ repo, store });
    expect(stats).toMatchObject({ total: 1, upserted: 1, invalid: [] });
    expect(repo.listHashes().map((row) => row.path).some((path) => path.includes("blocks"))).toBe(false);

    const now = new Date().toISOString();
    // The episode is searchable; the block that shares its keyword is not (else this would return two rows).
    expect(repo.search({ like: "%拉面%", characterId: "taki", now, limit: 10 })).toHaveLength(1);
    expect(repo.search({ like: "%深夜%", characterId: "taki", now, limit: 10 })).toHaveLength(0);
  });

  it("reports a frontmatter-less markdown file inside the entry tree as invalid instead of indexing it", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "taki-ws-"));
    dataDirs.push(dataDir);
    const memoryRoot = join(dataDir, "workspace", "memory");
    const store = createMemoryStore({ root: memoryRoot });
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    dbs.push(db);
    const repo = createMemoryRepo(db);

    // Second line of defence behind the disk layout: even if block-shaped markdown ever landed under the entry
    // tree, the entry codec has no frontmatter to parse, so it can never become a searchable row.
    const stray = join(memoryRoot, "characters", "taki", "episodes", "user-card.md");
    mkdirSync(dirname(stray), { recursive: true });
    writeFileSync(stray, "Name: pleia\n常在深夜写代码");

    const stats = reconcile({ repo, store });
    expect(stats).toMatchObject({ total: 0, upserted: 0 });
    expect(stats.invalid).toEqual([stray]);
    expect(repo.search({ like: "%深夜%", characterId: "taki", now: new Date().toISOString(), limit: 10 })).toHaveLength(0);
  });
});
