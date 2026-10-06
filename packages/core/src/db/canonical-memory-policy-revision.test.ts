import { describe, expect, it } from "vitest";
import { createCanonicalMaintenanceFixture } from "./canonical-memory-maintenance-fixtures.ts";
import { openDatabase } from "./sqlite.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";

describe("Local semantic policy revisions", () => {
  it("advances actual edits, keeps no-ops stable and preserves the historical result across retry", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    try {
      const f = createCanonicalMaintenanceFixture(db); f.seed();
      const input = { epochId: f.epochId, bankId: "global", characterId: null, memoryId: "memory", expectedRevision: 1,
        requestId: "policy", now: "2026-01-02T00:00:00.000Z", patch: { importance: 6 } };
      const changed = f.maintenance.policyEdit(input);
      expect(changed.record.policy.policyVersion).toBe(3);
      expect(f.maintenance.policyEdit(input)).toEqual(changed);
      const noOp = f.maintenance.policyEdit({ ...input, requestId: "same", expectedRevision: 2 });
      expect(noOp.outcome).toBe("unchanged"); expect(noOp.record).toEqual(changed.record);
      const sameImportance = f.maintenance.reinforce({ ...input, requestId: "reinforce", expectedRevision: 2,
        mode: "duplicate-write", importance: 5 });
      expect(sameImportance.record.policy.policyVersion).toBe(3);
      expect(sameImportance.record.unit.proofCount).toBe(changed.record.unit.proofCount + 1);
      const higher = f.maintenance.reinforce({ ...input, requestId: "higher", expectedRevision: 3,
        mode: "duplicate-write", importance: 8 });
      expect(higher.record.policy.policyVersion).toBe(4);
    } finally { db.close(); }
  });
  it("text-only edits retain policy version and layer edits advance it atomically", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    try {
      const f = createCanonicalMaintenanceFixture(db); f.seed();
      const input = { epochId: f.epochId, bankId: "global", memoryId: "memory", expectedRevision: 1,
        requestId: "text", requestHash: "a".repeat(64), now: "2026-01-02T00:00:00.000Z", searchTerms: "edit", patch: { text: "edited fact" } };
      expect(f.records.edit(input).record.policy.policyVersion).toBe(2);
      const policy = { layerId: "activity", visibility: "retrieved" as const, retention: { kind: "rolling-window" as const, days: 7 } };
      db.exec("CREATE TRIGGER policy_rollback BEFORE INSERT ON canonical_memory_operation_receipts WHEN NEW.request_id='layer' BEGIN SELECT RAISE(ABORT,'owned rollback'); END");
      const change = { ...input, requestId: "layer", requestHash: "b".repeat(64), expectedRevision: 2, policy };
      expect(() => f.records.edit(change)).toThrow("owned rollback");
      expect(f.records.record(f.epochId, "global", "memory")?.policy.policyVersion).toBe(2);
      db.exec("DROP TRIGGER policy_rollback");
      expect(f.records.edit(change).record.policy.policyVersion).toBe(3);
    } finally { db.close(); }
  });
});
