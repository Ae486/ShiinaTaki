import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCanonicalMemoryAuthorityRepo } from "./canonical-memory-authority-repo.ts";
import { createMemoryAutoRepo } from "./memory-auto-repo.ts";
import { createMemoryTidyReviewRepo } from "./memory-tidy-review-repo.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase, type Database } from "./sqlite.ts";
import { rmTempDir } from "../testing/rm-temp.ts";

const opened: Database[] = [];
const roots: string[] = [];
afterEach(() => { for (const db of opened.splice(0)) db.close(); for (const root of roots.splice(0)) rmTempDir(root); });
const AT = "2026-11-06T00:00:00.000Z";

describe("Local tidy revision checkpoints", () => {
  it("upgrades and reopens a pre-change database without inventing coverage from its success timestamp", () => {
    const root = mkdtempSync(join(tmpdir(), "taki-tidy-migration-")); roots.push(root);
    const path = join(root, "taki.db");
    const old = openDatabase({ path, migrations: MIGRATIONS.filter((migration) => migration.version < 67) });
    const epoch = createCanonicalMemoryAuthorityRepo(old).initializeLocalAuthority(AT);
    createMemoryAutoRepo(old).setTidy("taki", AT);
    old.close();
    const current = openDatabase({ path, migrations: MIGRATIONS });
    const repo = createMemoryTidyReviewRepo(current, epoch.epochId);
    expect(repo.read("taki").memories).toEqual([]);
    expect(createMemoryAutoRepo(current).get("taki").lastTidyAt).toBe(AT);
    repo.commit("taki", { memories: [{ bankId: "bank", memoryId: "memory", revision: 2 }], blocks: [], at: AT });
    repo.failed("taki", AT);
    current.close();
    const reopened = openDatabase({ path, migrations: MIGRATIONS }); opened.push(reopened);
    expect(createMemoryTidyReviewRepo(reopened, epoch.epochId).read("taki")).toMatchObject({
      memories: [{ revision: 2, reviewedAt: AT }], retry: { pending: true, failures: 1, retryAt: "2026-11-06T00:01:00.000Z" },
    });
  });

  it("commits coverage with progress atomically and never replaces a newer reviewed revision with an older one", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); opened.push(db);
    const epoch = createCanonicalMemoryAuthorityRepo(db).initializeLocalAuthority(AT);
    const repo = createMemoryTidyReviewRepo(db, epoch.epochId);
    const batch = { memories: [{ bankId: "bank", memoryId: "memory", revision: 2 }], blocks: [{ blockId: "user-model", revision: 3 }], at: AT };
    expect(() => repo.commit("taki", { ...batch, onCommitted: () => { throw new Error("progress unavailable"); } })).toThrow();
    expect(repo.read("taki").memories).toEqual([]);
    expect(repo.read("taki").blocks).toEqual([]);
    repo.commit("taki", batch);
    repo.commit("taki", { ...batch, memories: [{ bankId: "bank", memoryId: "memory", revision: 1 }] });
    expect(repo.read("taki").memories[0]?.revision).toBe(2);
  });
});
