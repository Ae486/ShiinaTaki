import { describe, expect, it } from "vitest";
import {
  HindsightBackupInboxFileSchema, HindsightBackupManifestSchema, HindsightBackupNativeProofSchema, HindsightBackupStatusSectionSchema,
  HindsightCredentialCustodySchema, MemoryBackupResultSchema,
} from "./hindsight-backup-schema.ts";
import { HindsightErrorCodeSchema } from "./hindsight-connection-schema.ts";
import { MemoryOperationErrorCodeSchema, MemoryOperationRequestSchema, MemoryOperationSchema } from "./memory-operation-schema.ts";
import { MemoryReplicaErrorCodeSchema } from "./memory-replica-schedule-schema.ts";

const at = "2026-09-26T00:00:00.000Z";
const hex = (character: string) => character.repeat(64);
const BACKUP_ID = "11111111-1111-4111-8111-111111111111";
const LINEAGE = "22222222-2222-4222-8222-222222222222";
const GENERATION = "33333333-3333-4333-8333-333333333333";
const coreCheckpoint = { replicaCursor: 10, applicationNativeCursor: 10, applicationStateCursor: 4, checkpointHash: hex("d") };
const bank = { bankId: "core-g", nativeBankId: "taki-hs-g", scope: "global", characterId: null, bankGeneration: GENERATION, core: coreCheckpoint } as const;
const custody = {
  storeId: "host-1", connectionMarker: hex("a"),
  refs: [{ ref: "memory.hindsight.connection.api-key", present: true, health: "ok", keyVersion: 1, updatedAt: at },
    { ref: "memory.hindsight.model.default.api-key", present: false, health: "ok", keyVersion: null, updatedAt: null }],
} as const;
const proof = {
  providerLineage: LINEAGE, alembicRevision: "a1b2c3", upstreamCommit: "0123abcd", compatibilityBuild: "taki-build",
  banks: [{ bankId: "taki-hs-g", bankGeneration: GENERATION, currentCursor: 12, minimumAvailableCursor: 0, application: { nativeCursor: 12, stateCursor: 5 } }],
  receipts: { count: 3, digest: hex("b"), missingCount: 0, missingSample: [] }, zipSha256: hex("e"), zipBytes: 4096,
} as const;
const manifest = {
  version: 1, backupId: BACKUP_ID, createdAt: at, operationId: "44444444-4444-4444-8444-444444444444", route: "native-endpoint",
  core: { file: "core.sqlite", sha256: hex("1"), bytes: 8192, pages: 2, migrationHead: 50 },
  native: { location: "native-host", file: "/srv/hindsight/backups/b.zip", nativeManifestVersion: "2", schema: "public", proof },
  authority: { epochId: "epoch-h", activationTransactionId: "tx", providerLineageId: LINEAGE, replicaCheckpointDigest: hex("c"),
    configFingerprint: hex("f"), deploymentMode: "existing-instance" },
  banks: [bank, { ...bank, bankId: "core-c", nativeBankId: "taki-hs-c", scope: "character", characterId: "taki" }],
  terminalOperations: { count: 3, digest: hex("b") }, custody, sensitive: true, verifiedAt: null,
} as const;
const valid = (value: unknown) => HindsightBackupManifestSchema.safeParse(value).success;

describe("Hindsight backup manifest", () => {
  it("round-trips a native-host artifact and a Core-held one", () => {
    expect(HindsightBackupManifestSchema.parse(manifest)).toEqual(manifest);
    expect(valid({ ...manifest, native: { ...manifest.native, location: "core-dir", file: "native.zip" }, verifiedAt: at })).toBe(true);
  });

  it("refuses inconsistent Bank identity, checkpoints and artifact shape", () => {
    const withBank = (patch: object) => ({ ...manifest, banks: [{ ...bank, ...patch }] });
    const invalid = [
      withBank({ scope: "character" }),
      withBank({ bankGeneration: null }),
      withBank({ core: { ...coreCheckpoint, replicaCursor: null } }),
      withBank({ core: { ...coreCheckpoint, checkpointHash: null } }),
      { ...manifest, banks: [bank, bank] },
      { ...manifest, banks: [bank, { ...bank, bankId: "other" }] },
      { ...manifest, native: { ...manifest.native, location: "core-dir", file: "../native.zip" } },
      { ...manifest, verifiedAt: "2026-09-25T00:00:00.000Z" },
      { ...manifest, version: 2 },
      { ...manifest, sensitive: false },
      { ...manifest, core: { ...manifest.core, file: "taki.db" } },
      { ...manifest, backupId: "../escape" },
      { ...manifest, extra: true },
    ];
    for (const value of invalid) expect(valid(value)).toBe(false);
    const fresh = { ...bank, bankGeneration: null, core: { replicaCursor: null, applicationNativeCursor: null, applicationStateCursor: null, checkpointHash: null } };
    expect(valid({ ...manifest, banks: [fresh] })).toBe(true);
  });

  it("carries credential presence only, never a value or envelope", () => {
    expect(HindsightCredentialCustodySchema.parse(custody)).toEqual(custody);
    const [present] = custody.refs;
    for (const refs of [[{ ...present, value: "sk-secret" }], [{ ...present, keyVersion: null }], [{ ...present, present: false }], [present, present]]) {
      expect(HindsightCredentialCustodySchema.safeParse({ ...custody, refs }).success).toBe(false);
    }
    expect(HindsightCredentialCustodySchema.safeParse({ ...custody, envelope: "AAAA" }).success).toBe(false);
  });

  it("bounds the native receipt answer to a sampled subset of the checked list", () => {
    expect(HindsightBackupNativeProofSchema.safeParse({ ...proof, receipts: { ...proof.receipts, missingCount: 1, missingSample: ["write:a"] } }).success).toBe(true);
    for (const receipts of [{ ...proof.receipts, missingCount: 1 }, { ...proof.receipts, missingCount: 4 }, { ...proof.receipts, missingSample: ["write:a"] }]) {
      expect(HindsightBackupNativeProofSchema.safeParse({ ...proof, receipts }).success).toBe(false);
    }
    expect(HindsightBackupNativeProofSchema.safeParse({ ...proof, banks: [...proof.banks, ...proof.banks] }).success).toBe(false);
  });
});

describe("Hindsight backup inbox file", () => {
  it("accepts only plain .zip names inside the inbox", () => {
    for (const name of ["hindsight-2026-09-26.zip", "a.zip", "Backup_1.2.zip"]) expect(HindsightBackupInboxFileSchema.safeParse(name).success).toBe(true);
    for (const name of ["../a.zip", "a/b.zip", "a\\b.zip", ".hidden.zip", "C:a.zip", "a.sqlite", "nul.zip", "COM1.zip", `${"a".repeat(125)}.zip`]) {
      expect(HindsightBackupInboxFileSchema.safeParse(name).success).toBe(false);
    }
  });
});

describe("Hindsight backup status section", () => {
  const lastVerified = { backupId: BACKUP_ID, createdAt: at, verifiedAt: at, nativeCursors: [{ bankId: "core-g", currentCursor: 12 }] };
  const interval = { bankId: "core-g", fromNativeCursor: 12, toReplicaCursor: 20, pendingCount: 1 };
  it("reports age and intervals only against a verified backup and keeps unknown as null", () => {
    const section = { lastVerified, ageSeconds: 3600, missingInterval: [interval] };
    expect(HindsightBackupStatusSectionSchema.parse(section)).toEqual(section);
    expect(HindsightBackupStatusSectionSchema.safeParse({ lastVerified: null, ageSeconds: null,
      missingInterval: [{ ...interval, fromNativeCursor: null, pendingCount: null }] }).success).toBe(true);
    for (const invalid of [{ ...section, ageSeconds: null }, { lastVerified: null, ageSeconds: null, missingInterval: [interval] },
      { ...section, missingInterval: [interval, interval] }, { ...section, ageSeconds: -1 }]) {
      expect(HindsightBackupStatusSectionSchema.safeParse(invalid).success).toBe(false);
    }
  });
});

describe("backup operation arms", () => {
  const base = {
    operationId: "55555555-5555-4555-8555-555555555555", kind: "backup.capture", state: "running", reason: null, authorityEpochId: "epoch-h",
    request: { kind: "backup.capture", expectedEpochId: "epoch-h" }, producer: { kind: "backup", backupId: BACKUP_ID, phase: "capturing-core" },
    result: null, errorCode: null, createdAt: at, updatedAt: at, terminalAt: null,
  } as const;
  it("binds the three backup kinds to the backup producer/result arms and closed codes", () => {
    expect(MemoryOperationSchema.safeParse(base).success).toBe(true);
    const result = { kind: "backup", backupId: BACKUP_ID, verifiedAt: at, mismatch: null } as const;
    expect(MemoryOperationSchema.safeParse({ ...base, state: "completed", terminalAt: at, result }).success).toBe(true);
    expect(MemoryOperationSchema.safeParse({ ...base, state: "completed", terminalAt: at, result: { ...result, backupId: "66666666-6666-4666-8666-666666666666" } }).success).toBe(false);
    expect(MemoryOperationSchema.safeParse({ ...base, producer: { kind: "bank", origin: "operator", characterId: "taki", nativeBankId: "b",
      templateRevision: "r", admittedEpochId: "epoch-h", configFingerprint: hex("f"), phase: "reserved" } }).success).toBe(false);
    const mismatch = { ...result, verifiedAt: null, mismatch: { reason: "receipt_missing", bankId: null } };
    expect(MemoryOperationSchema.safeParse({ ...base, state: "failed", terminalAt: at, reason: "producer_failed",
      errorCode: "HINDSIGHT_BACKUP_PAIR_MISMATCH", result: mismatch }).success).toBe(true);
    expect(MemoryBackupResultSchema.safeParse({ ...mismatch, verifiedAt: at }).success).toBe(false);
    expect(MemoryOperationRequestSchema.safeParse({ kind: "backup.admit", expectedEpochId: "epoch-h", fileName: "b.zip" }).success).toBe(true);
    expect(MemoryOperationRequestSchema.safeParse({ kind: "backup.admit", expectedEpochId: "epoch-h", fileName: "../b.zip" }).success).toBe(false);
    expect(MemoryOperationRequestSchema.safeParse({ kind: "backup.verify", backupId: BACKUP_ID }).success).toBe(true);
    expect(MemoryOperationRequestSchema.safeParse({ kind: "backup.verify", backupId: "latest" }).success).toBe(false);
    expect(MemoryOperationErrorCodeSchema.safeParse("HINDSIGHT_BACKUP_QUIESCENCE_TIMEOUT").success).toBe(true);
  });

  it("adds the rollback refusal to the Hindsight code set every replica and operation arm inherits", () => {
    for (const schema of [HindsightErrorCodeSchema, MemoryReplicaErrorCodeSchema, MemoryOperationErrorCodeSchema]) {
      expect(schema.safeParse("HINDSIGHT_PROVIDER_ROLLBACK_DETECTED").success).toBe(true);
    }
  });
});
