import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmTempDir } from "../testing/rm-temp.ts";
import { entryFromFile } from "./entry.ts";
import { createMemoryStore, type MemoryStore } from "./store.ts";

const roots: string[] = [];
function freshStore(): MemoryStore {
  const root = mkdtempSync(join(tmpdir(), "taki-mem-"));
  roots.push(root);
  return createMemoryStore({ root });
}
afterEach(() => {
  for (const root of roots.splice(0)) rmTempDir(root);
});

describe("memory store (T5)", () => {
  it("writes a per-character entry whose file round-trips to the exact content", () => {
    const store = freshStore();
    const stored = store.write({
      layer: "relationship",
      characterId: "taki",
      content: "每周五一起看电影",
      importance: 10,
      disclosure: "约定,电影",
    });

    expect(stored.characterId).toBe("taki");
    expect(stored.filePath).toContain(join("characters", "taki", "relationship"));
    expect(stored.entry.id).toMatch(/^0001-/);

    const onDisk = readFileSync(stored.filePath, "utf8");
    const { entry, body } = entryFromFile(onDisk);
    expect(body).toBe("每周五一起看电影");
    expect(entry.importance).toBe(10);
    expect(entry.status).toBe("active");
    expect(entry.disclosure).toBe("约定,电影");
  });

  it("places a global layer under global/<layer> with no characterId", () => {
    const store = freshStore();
    const stored = store.write({ layer: "profile", content: "喜欢拉面", importance: 9 });
    expect(stored.characterId).toBeNull();
    expect(stored.filePath).toContain(join("global", "profile"));
  });

  it("allocates a root-wide, monotonically increasing NNNN across layers/characters", () => {
    const store = freshStore();
    const a = store.write({ layer: "profile", content: "fact one", importance: 5 });
    const b = store.write({ layer: "relationship", characterId: "taki", content: "promise", importance: 10 });
    const c = store.write({ layer: "episodes", characterId: "yui", content: "log", importance: 3 });
    expect([a.entry.id, b.entry.id, c.entry.id].map((id) => id.slice(0, 4))).toEqual(["0001", "0002", "0003"]);
  });

  it("archiveAtPath rewrites status to archived, preserving the body", () => {
    const store = freshStore();
    const stored = store.write({ layer: "relationship", characterId: "taki", content: "旧约定", importance: 8 });
    const archived = store.archiveAtPath(stored.filePath);
    expect(archived.entry.status).toBe("archived");
    expect(archived.body).toBe("旧约定");
    expect(entryFromFile(readFileSync(stored.filePath, "utf8")).entry.status).toBe("archived");
    expect(archived.contentHash).not.toBe(stored.contentHash);
  });

  it("keeps per-character entries isolated on disk and lists everything for reconciliation", () => {
    const store = freshStore();
    store.write({ layer: "relationship", characterId: "taki", content: "taki promise", importance: 10 });
    store.write({ layer: "relationship", characterId: "yui", content: "yui promise", importance: 10 });

    const all = store.list().entries;
    expect(all).toHaveLength(2);
    const byCharacter = new Map(all.map((s) => [s.characterId, s.body]));
    expect(byCharacter.get("taki")).toBe("taki promise");
    expect(byCharacter.get("yui")).toBe("yui promise");
    for (const s of all) expect(s.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("list() on a never-written root is empty (first boot)", () => {
    expect(freshStore().list()).toEqual({ entries: [], invalid: [] });
  });

  it("list() reports a hand-broken file as invalid instead of throwing (files are user-editable truth)", () => {
    const store = freshStore();
    store.write({ layer: "profile", content: "喜欢拉面", importance: 9 });
    writeFileSync(join(store.root, "README.md"), "not an entry file");

    const { entries, invalid } = store.list();
    expect(entries).toHaveLength(1);
    expect(invalid).toHaveLength(1);
    expect(invalid[0]?.filePath).toContain("README.md");
    expect(invalid[0]?.reason).toMatch(/fence/);
  });
});

describe("memory store origin (T5 Q8)", () => {
  it("defaults a write to origin 'self' and records 'observed' when the caller sensed it", () => {
    const store = freshStore();
    expect(store.write({ layer: "episodes", characterId: "taki", content: "她说很累", importance: 5 }).entry.origin).toBe(
      "self",
    );

    const observed = store.write({
      layer: "episodes",
      characterId: "taki",
      content: "[image] 桌上有一杯咖啡",
      importance: 4,
      origin: "observed",
    });
    expect(observed.entry.origin).toBe("observed");
    expect(readFileSync(observed.filePath, "utf8")).toContain('origin: "observed"');
  });
});

describe("memory store reinforcement (T5-R9)", () => {
  it("raises importance, stamps `updated`, and starts the reinforce count at 1", () => {
    const store = freshStore();
    const stored = store.write({ layer: "episodes", characterId: "taki", content: "他喜欢拉面", importance: 4 });
    expect(stored.entry.updated).toBeUndefined();

    const reinforced = store.reinforceAtPath(stored.filePath, 6);

    expect(reinforced.entry.importance).toBe(6);
    expect(reinforced.entry.reinforceCount).toBe(1);
    expect(reinforced.entry.updated).toBeDefined();
    expect(Date.parse(reinforced.entry.updated as string)).not.toBeNaN();
    // The bump lands on disk, not just in the returned object.
    expect(entryFromFile(readFileSync(stored.filePath, "utf8")).entry.importance).toBe(6);
  });

  it("never DEMOTES importance — a deliberate high-importance entry survives a later automatic write", () => {
    const store = freshStore();
    const stored = store.write({ layer: "profile", characterId: "taki", content: "他叫 pleia", importance: 10 });

    const reinforced = store.reinforceAtPath(stored.filePath, 3);
    expect(reinforced.entry.importance).toBe(10);
  });

  it("increments the count across repeated reinforcements", () => {
    const store = freshStore();
    const stored = store.write({ layer: "episodes", characterId: "taki", content: "他喜欢拉面", importance: 4 });

    store.reinforceAtPath(stored.filePath, 5);
    const third = store.reinforceAtPath(store.reinforceAtPath(stored.filePath, 5).filePath, 5);
    expect(third.entry.reinforceCount).toBe(3);
  });

  it("leaves the body and the rest of the frontmatter untouched", () => {
    const store = freshStore();
    const stored = store.write({
      layer: "episodes",
      characterId: "taki",
      content: "他喜欢拉面",
      importance: 4,
      disclosure: "拉面",
      origin: "observed",
    });

    const reinforced = store.reinforceAtPath(stored.filePath, 6);
    expect(reinforced.body).toBe("他喜欢拉面");
    expect(reinforced.entry.id).toBe(stored.entry.id);
    expect(reinforced.entry.created).toBe(stored.entry.created);
    expect(reinforced.entry.disclosure).toBe("拉面");
    expect(reinforced.entry.origin).toBe("observed");
    expect(reinforced.contentHash).not.toBe(stored.contentHash); // the file changed, so the index must re-read it
  });
});
