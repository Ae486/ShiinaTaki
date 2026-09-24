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

  it("keeps the reviewed deployment mode only with the fingerprint it was reviewed under", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    const repo = createHindsightConnectionRepo(db);
    const [first, second] = ["a".repeat(64), "b".repeat(64)];
    let current = repo.read();
    const save = (patch: object, mode?: "existing-instance" | "managed-helper") => {
      current = repo.save({ ...current, ...patch, revision: current.revision + 1 }, current.revision, mode);
      return repo.reviewed();
    };
    expect(repo.reviewed()).toEqual({ configFingerprint: null, deploymentMode: null });
    expect(save({ configFingerprint: first }, "managed-helper")).toEqual({ configFingerprint: first, deploymentMode: "managed-helper" });
    expect(save({ phase: "failed" })).toEqual({ configFingerprint: first, deploymentMode: "managed-helper" });
    expect(save({ configFingerprint: second })).toEqual({ configFingerprint: second, deploymentMode: null });
    expect(() => repo.save({ ...current, revision: current.revision + 1 }, current.revision - 1, "existing-instance")).toThrow("HINDSIGHT_STATE_CONFLICT");
    expect(repo.reviewed().deploymentMode).toBeNull();
    db.close();
  });
});
