import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryFixture, type MemoryFixture } from "../testing/memory-fixture.ts";
import { indexEntry } from "./indexer.ts";
import { legacySearchProjection } from "./legacy-search-projection.ts";
import { rebuildSearchProjection } from "./search-projection-rebuild.ts";
import { createIntlSegmenterTokenizer } from "./search-tokenizer.ts";

const fixtures: MemoryFixture[] = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.cleanup(); });
function fixture() { const value = createMemoryFixture(); fixtures.push(value); return value; }

describe("Legacy search projection source", () => {
  it("does not overwrite a Core edit between file scan and async row consumption", async () => {
    const f = fixture();
    const stored = f.store.write({ layer: "profile", content: "我 喜欢 拉面", importance: 5 });
    const scan = legacySearchProjection(f).scan()[Symbol.asyncIterator]();
    const reading = scan.next();
    queueMicrotask(() => indexEntry(f, f.store.archiveAtPath(stored.filePath)));
    await reading;
    expect(f.db.prepare("SELECT status FROM memory_entries WHERE path=:path").get({ path: stored.filePath })?.status).toBe("archived");
    await scan.return?.();
  });

  it("rechecks an unseen path before orphan cleanup when a Core writer restored the file", async () => {
    const f = fixture();
    f.store.write({ layer: "profile", content: "existing first entry", importance: 5 });
    const restored = f.store.write({ layer: "profile", content: "restored second entry", importance: 5 });
    f.reconcile();
    const bytes = readFileSync(restored.filePath);
    f.store.deleteAtPath(restored.filePath);
    const scan = legacySearchProjection(f).scan()[Symbol.asyncIterator]();
    await scan.next();
    writeFileSync(restored.filePath, bytes);
    indexEntry(f, f.store.readAtPath(restored.filePath));
    while (!(await scan.next()).done) { /* Drain the source's orphan reconciliation. */ }
    expect(f.repo.listHashes().map((row) => row.path)).toContain(restored.filePath);
  });

  it("refuses malformed authoritative files without publishing a partial replacement", async () => {
    const f = fixture();
    f.store.write({ layer: "profile", content: "我 喜欢 拉面", importance: 5 }); f.reconcile();
    const before = f.db.prepare("SELECT * FROM memory_fts").all();
    writeFileSync(join(f.root, "invalid.md"), "invalid frontmatter");
    let published = false;
    await expect(rebuildSearchProjection({ db: f.db, source: legacySearchProjection(f),
      tokenizer: createIntlSegmenterTokenizer({ stoplist: false }), assertCurrent() {},
      publish: () => { published = true; } })).rejects.toThrow();
    expect(published).toBe(false);
    expect(f.db.prepare("SELECT * FROM memory_fts").all()).toEqual(before);
  });
});
