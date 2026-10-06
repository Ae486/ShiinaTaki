import { describe, expect, it } from "vitest";
import { openDatabase } from "../../db/sqlite.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { createTransitionReentryFixture } from "../../testing/memory-transition-reentry-fixtures.ts";
import { createCanonicalMemoryRepo } from "../../db/canonical-memory-repo.ts";
import { createCanonicalMemoryMaintenanceRepo } from "../../db/canonical-memory-maintenance-repo.ts";
import { captureTransitionLocal, discoverTransitionLocal } from "../../db/memory-transition-local-capture.ts";
import { prepareTransitionDelta } from "../../db/memory-transition-delta-repo.ts";
import { insertCanonicalUnitAndPolicy } from "../../db/canonical-memory-maintenance-records.ts";
import { createIntlSegmenterTokenizer } from "../search-tokenizer.ts";

function setup() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  const fixture = createTransitionReentryFixture(db, { historical: true });
  const record = fixture.candidate.state.records.find((row) => row.unit.factType === "observation")!;
  const identity = { epochId: fixture.candidate.targetEpochId, bankId: record.unit.bankId, memoryId: record.unit.memoryId,
    expectedRevision: record.unit.revision, now: "2026-10-01T00:00:01.000Z" };
  const repo = createCanonicalMemoryRepo(db);
  const maintenance = createCanonicalMemoryMaintenanceRepo(db, createIntlSegmenterTokenizer({ stoplist: true }));
  return { db, fixture, record, identity, repo, maintenance };
}
describe("W3 explicit historical reference preservation", () => {
  it("installs no fake source unit and roundtrips the exact historical edge through ordinary read/capture/edit", () => {
    const test = setup();
    try {
      expect(test.repo.record(test.identity.epochId, "global", "logical-unit")).toBeUndefined();
      expect(test.repo.record(test.identity.epochId, "global", test.identity.memoryId)).toEqual(test.record);
      expect(discoverTransitionLocal(test.db, test.identity.epochId).state.historicalReferences).toEqual(test.fixture.candidate.state.historicalReferences);
      test.repo.edit({ ...test.identity, requestId: "edit-historical-dependent", requestHash: "b".repeat(64),
        patch: { text: "Changed with inherited tombstoned support" }, searchTerms: "changed" });
      const capture = captureTransitionLocal(test.db, test.fixture.input);
      const target = test.fixture.targets.find((row) => row.target.bank_id === "native-global")!;
      const prepared = prepareTransitionDelta(test.db, { ...test.fixture.input, captureId: capture.captureId, localBankId: "global", ...target });
      expect(prepared.request.native.some((row) => row.source.source_id === "logical-unit")).toBe(false);
      expect(prepared.request.rows.memory_units[0]?.source_memory_ids).toEqual(["native-logical-unit"]);
      expect(capture.state.historicalReferences).toEqual(test.fixture.candidate.state.historicalReferences);
    } finally { test.db.close(); }
  });
  it("deletes an expired dependent and its historical edge atomically while retaining the reserved historical identity", () => {
    const test = setup();
    try {
      const changed = test.maintenance.policyEdit({ ...test.identity, characterId: null, requestId: "rolling-dependent",
        patch: { layerId: "activity", retention: { kind: "rolling-window", days: 1 } } });
      test.maintenance.hardDeleteRolling({ ...test.identity, expectedRevision: changed.record.unit.revision, characterId: null,
        requestId: "delete-dependent", now: "2026-11-01T00:00:00.000Z" });
      expect(test.repo.record(test.identity.epochId, "global", test.identity.memoryId)).toBeUndefined();
      expect(discoverTransitionLocal(test.db, test.identity.epochId).state.historicalReferences).toEqual([]);
      expect(test.db.prepare("SELECT count(*) AS n FROM canonical_memory_historical_identities WHERE authority_epoch_id=:epoch")
        .get({ epoch: test.identity.epochId })?.n).toBe(1);
      const unit = { ...test.record.unit, memoryId: "logical-unit", sourceMemoryIds: [] };
      expect(() => insertCanonicalUnitAndPolicy(test.db, { unit,
        policy: { ...test.record.policy, memoryId: unit.memoryId }, searchTerms: "" })).toThrow("MEMORY_REQUEST_ID_CONFLICT");
      expect(test.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { test.db.close(); }
  });
  it("still refuses deletion of a current supporting fact even when the dependent is invalidated", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    try {
      const fixture = createTransitionReentryFixture(db);
      const maintenance = createCanonicalMemoryMaintenanceRepo(db, createIntlSegmenterTokenizer({ stoplist: true }));
      const identity = { epochId: fixture.candidate.targetEpochId, bankId: "global", memoryId: "logical-unit", characterId: null,
        expectedRevision: 1, now: "2026-10-01T00:00:01.000Z" };
      const changed = maintenance.policyEdit({ ...identity, requestId: "rolling-support",
        patch: { layerId: "activity", retention: { kind: "rolling-window", days: 1 } } });
      expect(() => maintenance.hardDeleteRolling({ ...identity, expectedRevision: changed.record.unit.revision,
        requestId: "delete-support", now: "2026-11-01T00:00:00.000Z" })).toThrow("memory still supports another fact");
      expect(maintenance.record(identity)).toBeDefined();
    } finally { db.close(); }
  });
});
