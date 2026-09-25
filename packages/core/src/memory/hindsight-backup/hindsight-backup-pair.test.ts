import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HindsightBackupManifestSchema, type HindsightBackupNativeProof } from "@taki/shared";
import { backupBank, backupManifest, nativeProof, TERMINAL_IDS } from "./hindsight-backup-fixtures.ts";
import { hindsightBackupOperationDigest, verifyHindsightBackupPair, type HindsightBackupCoreIdentity } from "./hindsight-backup-pair.ts";

const manifest = backupManifest({ sha256: "b".repeat(64), bytes: 8192, pages: 2 });
const core: HindsightBackupCoreIdentity = manifest;
const ids = core.banks.map((bank) => bank.nativeBankId);
type NativeBank = HindsightBackupNativeProof["banks"][number];

function withBank(patch: Partial<NativeBank>, index = 1): HindsightBackupNativeProof {
  const proof = nativeProof(ids);
  return { ...proof, banks: proof.banks.map((bank, at) => (at === index ? { ...bank, ...patch } : bank)) };
}

describe("verifyHindsightBackupPair", () => {
  it("accepts an exact pair and the stored manifest is itself schema-valid", () => {
    expect(HindsightBackupManifestSchema.safeParse(manifest).success).toBe(true);
    expect(verifyHindsightBackupPair(core, manifest.native.proof)).toEqual({ ok: true });
  });

  it("accepts the native superset left by a write landing after the Core copy and before the native snapshot", () => {
    // The inter-capture write advanced every native cursor and added a receipt Core never recorded as terminal.
    const proof = withBank({ currentCursor: 12, application: { nativeCursor: 12, stateCursor: 5 } });
    expect(verifyHindsightBackupPair(core, proof)).toEqual({ ok: true });
  });

  it("refuses each mismatch with its closed reason and the Bank it names", () => {
    const character = core.banks[1]?.bankId ?? null;
    const cases: [HindsightBackupNativeProof, string, string | null][] = [
      [nativeProof(ids, { providerLineage: "55555555-5555-4555-8555-555555555555" }), "lineage", null],
      [nativeProof([ids[0] ?? "", "taki-hs-other"]), "native_bank_id", character],
      [nativeProof([...ids, "taki-hs-extra"]), "bank_set", null],
      [withBank({ bankGeneration: "66666666-6666-4666-8666-666666666666" }), "generation", character],
      [withBank({ currentCursor: 9 }), "replica_cursor", character],
      [withBank({ application: { nativeCursor: 9, stateCursor: 4 } }), "application_native_cursor", character],
      [withBank({ application: null }), "application_native_cursor", character],
      [withBank({ application: { nativeCursor: 10, stateCursor: 3 } }), "application_state_cursor", character],
      [nativeProof(ids, { receipts: { count: 2, digest: hindsightBackupOperationDigest(TERMINAL_IDS.slice(1)), missingCount: 0, missingSample: [] } }),
        "receipt_scope", null],
      [nativeProof(ids, { receipts: { ...nativeProof(ids).receipts, digest: "0".repeat(64) } }), "receipt_scope", null],
      [nativeProof(ids, { receipts: { ...nativeProof(ids).receipts, missingCount: 1, missingSample: ["write:a"] } }), "receipt_missing", null],
    ];
    for (const [proof, reason, bankId] of cases) {
      expect(verifyHindsightBackupPair(core, proof)).toEqual({ ok: false, reason, bankId });
    }
  });

  it("compares cursors and generation only where the Core copy has a checkpoint", () => {
    const fresh = { ...backupBank("taki-hs-c", "taki"), bankGeneration: null,
      core: { replicaCursor: null, applicationNativeCursor: null, applicationStateCursor: null, checkpointHash: null } };
    const identity = { ...core, banks: [core.banks[0] ?? backupBank("taki-hs-g"), fresh] };
    const proof = withBank({ bankGeneration: "77777777-7777-4777-8777-777777777777", currentCursor: 0, application: null });
    expect(verifyHindsightBackupPair(identity, proof)).toEqual({ ok: true });
  });
});

describe("hindsightBackupOperationDigest", () => {
  it("names a list independently of order and duplicates", () => {
    expect(hindsightBackupOperationDigest(["b", "a", "b"])).toBe(hindsightBackupOperationDigest(["a", "b"]));
    expect(hindsightBackupOperationDigest(["a", "b"])).not.toBe(hindsightBackupOperationDigest(["a"]));
    // The exact bytes the native route must reproduce: sorted ids joined by "\n".
    expect(hindsightBackupOperationDigest(["b", "a"])).toBe(createHash("sha256").update("a\nb").digest("hex"));
  });

  it("refuses ids that could not be reproduced byte for byte", () => {
    for (const bad of [[""], ["a b"], ["a\nb"], ["é"]]) expect(() => hindsightBackupOperationDigest(bad)).toThrow("HINDSIGHT_BACKUP_ARTIFACT_INVALID");
  });
});
