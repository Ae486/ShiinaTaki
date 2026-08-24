import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase } from "./sqlite.ts";
import { createHindsightConnectionRepo } from "./hindsight-connection-repo.ts";

describe("Hindsight connection repo", () => {
  it("roundtrips safe state and rejects stale expected revisions", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    const repo = createHindsightConnectionRepo(db);
    const current = repo.read();
    const saved = repo.save({ ...current, revision: 1, phase: "ready-to-validate", updatedAt: "2026-08-21T00:00:00.000Z" }, 0);
    expect(repo.read()).toEqual(saved);
    expect(() => repo.save({ ...saved, revision: 2 }, 0)).toThrow("HINDSIGHT_STATE_CONFLICT");
    db.close();
  });
});
