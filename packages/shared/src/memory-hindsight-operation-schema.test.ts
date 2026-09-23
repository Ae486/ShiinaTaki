import { describe, expect, it } from "vitest";
import {
  MemoryHindsightActivateRequestSchema, MemoryHindsightActivationErrorCodeSchema, MemoryHindsightProducerRefSchema, MemoryHindsightResultSchema,
} from "./memory-hindsight-operation-schema.ts";

const bank = { nativeBankId: "native-global", scope: "global", replicaEpochId: "44444444-4444-4444-8444-444444444444",
  verificationId: "33333333-3333-4333-8333-333333333333", preparationId: null };
const producer = { kind: "hindsight", runId: "run", hindsightEpochId: "epoch-h", transactionId: "tx", configFingerprint: "a".repeat(64),
  manifestId: null, progress: { phase: "reserved", bankCount: 1, preparedBankCount: 0, importedBankCount: 0, verifiedBankCount: 0, carriedWitnessCount: 0 }, banks: [bank] };
const blocking = { scope: "character", characterId: "taki", localBankId: "bank-taki", code: "HINDSIGHT_TEMPLATE_NOT_VERIFIED" };

describe("hindsight activation operation contracts", () => {
  it("accepts every source mode strictly and refuses client-supplied identity", () => {
    for (const source of [{ mode: "new", setupRevision: 1, expectedEpochId: "epoch-l" }, { mode: "resume", runId: "run" }, { mode: "recover", epochId: "epoch-h" }]) {
      expect(MemoryHindsightActivateRequestSchema.safeParse({ kind: "hindsight.activate", source }).success).toBe(true);
    }
    expect(MemoryHindsightActivateRequestSchema.safeParse({ kind: "hindsight.activate", source: { mode: "new", setupRevision: 1, expectedEpochId: "e", hindsightEpochId: "x" } }).success).toBe(false);
    expect(MemoryHindsightActivateRequestSchema.safeParse({ kind: "hindsight.activate", source: { mode: "resume" } }).success).toBe(false);
    expect(MemoryHindsightActivateRequestSchema.safeParse({ kind: "hindsight.activate", source: { mode: "new", setupRevision: -1, expectedEpochId: "e" } }).success).toBe(false);
  });

  it("keeps the producer reference strict with Core-minted uuid Bank identities", () => {
    expect(MemoryHindsightProducerRefSchema.safeParse(producer).success).toBe(true);
    expect(MemoryHindsightProducerRefSchema.safeParse({ ...producer, banks: [{ ...bank, replicaEpochId: "not-a-uuid" }] }).success).toBe(false);
    expect(MemoryHindsightProducerRefSchema.safeParse({ ...producer, progress: { ...producer.progress, phase: "flying" } }).success).toBe(false);
    expect(MemoryHindsightProducerRefSchema.safeParse({ ...producer, extra: true }).success).toBe(false);
    expect(MemoryHindsightProducerRefSchema.safeParse({ ...producer, configFingerprint: "short" }).success).toBe(false);
  });

  it("ties outcome to epoch, runtime availability and blocking prerequisites", () => {
    const activated = { kind: "hindsight", runId: "run", outcome: "activated", epochId: "epoch-h", runtimeAvailable: true, blocking: [] };
    expect(MemoryHindsightResultSchema.safeParse(activated).success).toBe(true);
    expect(MemoryHindsightResultSchema.safeParse({ ...activated, runtimeAvailable: false }).success).toBe(false);
    expect(MemoryHindsightResultSchema.safeParse({ ...activated, epochId: null }).success).toBe(false);
    expect(MemoryHindsightResultSchema.safeParse({ ...activated, outcome: "binding_unavailable", runtimeAvailable: false }).success).toBe(true);
    expect(MemoryHindsightResultSchema.safeParse({ ...activated, outcome: "binding_unavailable" }).success).toBe(false);
    const blocked = { ...activated, outcome: "prerequisite_blocked", epochId: null, runtimeAvailable: false, blocking: [blocking] };
    expect(MemoryHindsightResultSchema.safeParse(blocked).success).toBe(true);
    expect(MemoryHindsightResultSchema.safeParse({ ...blocked, blocking: [] }).success).toBe(false);
    expect(MemoryHindsightResultSchema.safeParse({ ...blocked, epochId: "epoch-h" }).success).toBe(false);
    expect(MemoryHindsightResultSchema.safeParse({ ...activated, blocking: [blocking] }).success).toBe(false);
  });

  it("closes the activation error codes over the Hindsight connection codes plus the cutover/drain codes", () => {
    for (const code of ["HINDSIGHT_UNREACHABLE", "HINDSIGHT_CUTOVER_LEASE_LOST", "MEMORY_INGESTION_INCOMPLETE", "HINDSIGHT_ACTIVATION_INTERNAL_ERROR"]) {
      expect(MemoryHindsightActivationErrorCodeSchema.safeParse(code).success).toBe(true);
    }
    expect(MemoryHindsightActivationErrorCodeSchema.safeParse("LEASE_LOST").success).toBe(false);
    expect(MemoryHindsightActivationErrorCodeSchema.safeParse("MIGRATION_INTERNAL_ERROR").success).toBe(false);
  });
});
