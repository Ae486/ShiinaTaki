import { afterEach, describe, expect, it } from "vitest";
import { HindsightCurrentStatusSchema } from "@taki/shared";
import { openDatabase, type Database } from "./sqlite.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { currentStateFixture, currentImportFixture, currentMaintenanceFixture, CURRENT_REPLICA } from "./hindsight-current-fixtures.ts";
import { saveHindsightCurrentImport } from "./hindsight-current-import-repo.ts";
import { saveCurrentVerificationCandidate } from "./hindsight-current-candidate-repo.ts";
import { saveHindsightCurrentVerification } from "./hindsight-current-verification-repo.ts";
import { LOCAL_COVERAGE_NOW as now, LOCAL_COVERAGE_NEXT as next, retainNewLocalSource } from "./hindsight-local-coverage-fixtures.ts";

const databases: Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function fixture() { const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); databases.push(db); return currentStateFixture(db); }

describe("D78 operator progress from durable current evidence", () => {
  it.each([false, true])("reports imported and verified counts for an empty Bank=%s without relabeling B2 counts", (empty) => {
    const f = fixture();
    expect(f.runs.status(f.runId).currentState).toBeUndefined();
    if (empty) {
      f.db.exec(`DELETE FROM canonical_memory_unit_sources; DELETE FROM canonical_memory_policy;
        DELETE FROM canonical_memory_fts; DELETE FROM canonical_memory_revision_snapshots;
        DELETE FROM canonical_memory_units; DELETE FROM canonical_memory_sources;`);
      f.runs.captureCoverage({ lease: f.lease, now: next });
    }
    const prepared = f.prepare();
    expect(f.runs.status(f.runId).currentState).toMatchObject({ state: "available", bankCount: 1, preparedBankCount: 1,
      preparationGapCount: 0, importedBankCount: 0, objectMappingCount: 0, memoryUnitMappingCount: 0,
      verificationBankCount: 0, verifiedBankCount: 0 });
    const native = currentImportFixture(prepared, f.baselineRecords);
    const imported = saveHindsightCurrentImport(f.db, { preparationId: prepared.preparationId, ...native });
    expect(f.runs.status(f.runId)).toMatchObject({ factMappingCount: 0, operationCounts: { mapped: 0 },
      currentState: { importedBankCount: 1, objectMappingCount: empty ? 1 : 3, memoryUnitMappingCount: empty ? 0 : 1,
        verificationBankCount: 0, verifiedBankCount: 0 } });
    const proof = currentMaintenanceFixture(imported, native);
    saveCurrentVerificationCandidate(f.db, { preparationId: prepared.preparationId, request: proof.request, status: proof.candidate });
    expect(f.runs.status(f.runId).currentState).toMatchObject({ verificationBankCount: 1, verifiedBankCount: 0 });
    saveHindsightCurrentVerification(f.db, { lease: f.lease, ...proof, replicaEpochId: CURRENT_REPLICA, now });
    expect(f.runs.status(f.runId).currentState).toMatchObject({ verifiedBankCount: 1,
      objectMappingCount: empty ? 1 : 3, memoryUnitMappingCount: empty ? 0 : 1 });
  });

  it("does not count historical mappings after a different current capture is selected", () => {
    const f = fixture(); const prepared = f.prepare(); const native = currentImportFixture(prepared, f.baselineRecords);
    saveHindsightCurrentImport(f.db, { preparationId: prepared.preparationId, ...native });
    retainNewLocalSource(f.db, f); f.runs.captureCoverage({ lease: f.lease, now: next }); f.prepare();
    expect(f.runs.status(f.runId).currentState).toMatchObject({ state: "available", preparedBankCount: 1,
      importedBankCount: 0, objectMappingCount: 0, memoryUnitMappingCount: 0 });
    expect(f.db.prepare("SELECT count(*) AS n FROM hindsight_current_import_evidence").get()?.n).toBe(1);
  });

  it("reports unavailable with null counts for corrupted evidence", () => {
    const f = fixture(); const prepared = f.prepare(); const native = currentImportFixture(prepared, f.baselineRecords);
    saveHindsightCurrentImport(f.db, { preparationId: prepared.preparationId, ...native });
    f.db.exec("DROP TRIGGER hindsight_current_import_evidence_no_update");
    f.db.prepare("UPDATE hindsight_current_import_evidence SET evidence_json='{}'").run();
    const status = f.runs.status(f.runId).currentState;
    expect(status).toMatchObject({ state: "unavailable", importedBankCount: null, objectMappingCount: null, memoryUnitMappingCount: null,
      verificationBankCount: null, verifiedBankCount: null });
    expect(HindsightCurrentStatusSchema.safeParse({ ...status, objectMappingCount: 0 }).success).toBe(false);
  });
});
