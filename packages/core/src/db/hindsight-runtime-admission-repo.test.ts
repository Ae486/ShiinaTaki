import { afterEach, describe, expect, it } from "vitest";
import { applicationTestCompatibility, applicationTestReplica } from "../testing/hindsight-application-runtime-fixtures.ts";
import { APPLICATION_TEST_AT } from "../testing/hindsight-application-fixtures.ts";
import { createHindsightRuntimeAdmissionRepo } from "./hindsight-runtime-admission-repo.ts";

const fixtures: ReturnType<typeof applicationTestReplica>[] = [];
afterEach(() => { for (const value of fixtures.splice(0)) value.db.close(); });
function fixture() { const value = applicationTestReplica(); fixtures.push(value); return { ...value, admission: createHindsightRuntimeAdmissionRepo(value.db) }; }
const identity = { authorityEpochId: "epoch", configFingerprint: "a".repeat(64) };
function evidence() { return { ...identity, admittedAt: APPLICATION_TEST_AT, manifest: applicationTestCompatibility() }; }

describe("persisted Hindsight runtime capability evidence", () => {
  it("has no inferred admission and reuses evidence only for its actual connection identity", () => {
    const f = fixture(); expect(f.admission.read(identity)).toBeUndefined();
    const saved = f.admission.save(evidence()); expect(createHindsightRuntimeAdmissionRepo(f.db).read(identity)).toEqual(saved);
    expect(f.admission.read({ ...identity, configFingerprint: "b".repeat(64) })).toBeUndefined();
    expect(f.admission.read({ ...identity, authorityEpochId: "different-epoch" })).toBeUndefined();
  });

  it.each(["hash", "lineage"] as const)("rejects changed stored %s instead of treating corrupted evidence as absence", (field) => {
    const f = fixture(); f.admission.save(evidence());
    if (field === "hash") f.db.prepare("UPDATE hindsight_application_runtime_admission SET evidence_hash=:hash").run({ hash: "0".repeat(64) });
    else f.db.prepare("UPDATE hindsight_application_runtime_admission SET provider_lineage=:lineage").run({ lineage: "44444444-4444-4444-8444-444444444444" });
    expect(() => f.admission.read(identity)).toThrow("HINDSIGHT_APPLICATION_ADMISSION_INVALID");
  });

  it("refuses previously valid capability evidence after the active lineage changes", () => {
    const f = fixture(); f.admission.save(evidence());
    f.db.prepare("UPDATE canonical_memory_authority_epochs SET provider_lineage_id=:lineage WHERE epoch_id='epoch'")
      .run({ lineage: "44444444-4444-4444-8444-444444444444" });
    expect(() => f.admission.read(identity)).toThrow("MEMORY_AUTHORITY_MISMATCH");
    expect(() => f.admission.save(evidence())).toThrow("MEMORY_AUTHORITY_MISMATCH");
  });
});
