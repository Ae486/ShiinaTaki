import { describe, expect, it } from "vitest";
import {
  MemoryDerivedCompletionRequestSchema, PendingMemoryIntentSchema, PendingMemoryNativeReceiptSchema,
  PendingMemoryOverlayEntrySchema, PendingMemoryStateSchema,
} from "./pending-memory-schema.ts";

const at = "2026-09-06T00:00:00.000Z";
const uuid = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";

function intent() {
  return PendingMemoryIntentSchema.parse({ schemaVersion: 1, authorityEpochId: "epoch", providerId: "hindsight",
    providerLineageId: uuid, bankGeneration: other, bank: { bankId: "bank", scope: "global", characterId: null },
    operationId: "source-request", originalAt: at, baseCursor: 7,
    operation: { kind: "retain", zeroResultAllowed: true, request: { bankId: "bank", content: "A durable source.",
      context: null, timestamp: null, tags: [], entities: [], metadata: {}, observationScopes: null, documentId: null,
      strategy: null, updateMode: "replace", provenance: { actor: "user", origin: "explicit-user", characterId: null,
        timelineFromSeq: null, timelineToSeq: null, capturedAt: at, sanitized: true, sourceRef: null },
      policy: { layerId: "profile", importance: 5, visibility: "retrieved", disclosure: null, origin: "self",
        emotionalWeight: null, retention: { kind: "permanent" }, policyVersion: 1 } } } });
}

function queued() {
  return PendingMemoryStateSchema.parse({ intent: intent(), intentHash: "a".repeat(64), remoteOperationId: uuid,
    documentId: "doc", preparedMutation: null, preparedMutationHash: null, phase: "queued", version: 1,
    attempts: 0, lastAttemptAt: null, nextRetryAt: null, dispatchedAt: null, acceptedAt: null, nativeReceipt: null,
    derivedEvidence: null, lease: null, diagnosticCode: null, currentRevision: null, createdAt: at, updatedAt: at, terminalAt: null });
}

function accepted() {
  return { ...queued(), phase: "awaiting_derived", dispatchedAt: at, acceptedAt: at,
    nativeReceipt: { kind: "retain", operationId: uuid, documentId: "doc", memories: [], resultMetadataHash: "b".repeat(64), completedAt: at } };
}

describe("Pending Memory contract", () => {
  it("round-trips separate native, derived, and reflected completion phases", () => {
    const native = PendingMemoryStateSchema.parse(accepted());
    const evidence = { schemaVersion: 1, evidenceId: "proof", authorityEpochId: "epoch", bankId: "bank",
      providerLineageId: uuid, bankGeneration: other, operationId: uuid, nativeReceiptHash: "c".repeat(64), throughCursor: 9, completedAt: at };
    const derived = PendingMemoryStateSchema.parse({ ...native, phase: "awaiting_pull", derivedEvidence: evidence });
    const complete = PendingMemoryStateSchema.parse({ ...derived, phase: "completed", terminalAt: at });
    expect(PendingMemoryStateSchema.parse(JSON.parse(JSON.stringify(complete)))).toEqual(complete);
    expect(complete.intent.originalAt).toBe(at);
  });

  it.each(["awaiting_derived", "awaiting_pull", "completed"])("does not accept %s without its evidence", (phase) => {
    expect(PendingMemoryStateSchema.safeParse({ ...queued(), phase, terminalAt: phase === "completed" ? at : null }).success).toBe(false);
  });

  it.each(["failed", "superseded", "cancelled", "outcome_unknown"])("cannot relabel native success as %s", (phase) => {
    expect(PendingMemoryStateSchema.safeParse({ ...accepted(), phase, terminalAt: at }).success).toBe(false);
  });

  it("rejects wrong Bank binding, missing expected revision, and contradictory retry state", () => {
    const value = intent();
    expect(PendingMemoryIntentSchema.safeParse({ ...value, bank: { bankId: "other", scope: "global", characterId: null } }).success).toBe(false);
    expect(PendingMemoryIntentSchema.safeParse({ ...value, operation: { kind: "mutation", request: { kind: "restore", bankId: "bank", memoryId: uuid } } }).success).toBe(false);
    expect(PendingMemoryStateSchema.safeParse({ ...queued(), phase: "cancelled", terminalAt: at, nextRetryAt: at }).success).toBe(false);
  });

  it("requires explicit permission for zero-result native retain and rejects duplicate fact IDs", () => {
    const state = accepted();
    const original = state.intent.operation;
    expect(PendingMemoryStateSchema.safeParse({ ...state, intent: { ...state.intent,
      operation: { ...original, zeroResultAllowed: false } } }).success).toBe(false);
    expect(PendingMemoryNativeReceiptSchema.safeParse({ ...state.nativeReceipt,
      memories: [{ memoryId: uuid, revision: 1 }, { memoryId: uuid, revision: 2 }] }).success).toBe(false);
  });

  it("binds receipt and derived evidence to the same operation, generation, and original cursor", () => {
    const state = PendingMemoryStateSchema.parse(accepted());
    const evidence = { schemaVersion: 1, evidenceId: "proof", authorityEpochId: "epoch", bankId: "bank",
      providerLineageId: uuid, bankGeneration: uuid, operationId: uuid, nativeReceiptHash: "c".repeat(64), throughCursor: 9, completedAt: at };
    expect(PendingMemoryStateSchema.safeParse({ ...state, phase: "awaiting_pull", derivedEvidence: evidence }).success).toBe(false);
    expect(MemoryDerivedCompletionRequestSchema.safeParse({ ...evidence, evidenceId: undefined, throughCursor: undefined,
      completedAt: undefined, afterCursor: 7, operationId: other, receipt: state.nativeReceipt }).success).toBe(false);
  });

  it("keeps overlay entries explicitly unconfirmed without fabricating a canonical fact revision", () => {
    const entry = { confirmed: false, authorityEpochId: "epoch", bankId: "bank", operationId: "request", originalAt: at,
      phase: "queued", operation: intent().operation };
    expect(PendingMemoryOverlayEntrySchema.parse(entry)).not.toHaveProperty("record");
    expect(PendingMemoryOverlayEntrySchema.safeParse({ ...entry, confirmed: true }).success).toBe(false);
    expect(PendingMemoryOverlayEntrySchema.safeParse({ ...entry, phase: "superseded" }).success).toBe(false);
  });

  it("only admits closed, bounded diagnostics", () => {
    expect(PendingMemoryStateSchema.safeParse({ ...queued(), diagnosticCode: "provider secret and raw response" }).success).toBe(false);
    expect(PendingMemoryStateSchema.safeParse({ ...queued(), diagnosticCode: "HINDSIGHT_DERIVED_FENCE_UNAVAILABLE" }).success).toBe(true);
  });

  it("requires the frozen conditional payload after mutation dispatch", () => {
    const base = queued();
    const request = { kind: "restore", bankId: "bank", memoryId: uuid, expectedRevision: 2 };
    const submitted = { ...base, intent: { ...base.intent, operation: { kind: "mutation", request } },
      documentId: null, phase: "submitted", dispatchedAt: at };
    expect(PendingMemoryStateSchema.safeParse(submitted).success).toBe(false);
    expect(PendingMemoryStateSchema.safeParse({ ...submitted, preparedMutation: request, preparedMutationHash: "d".repeat(64) }).success).toBe(true);
  });
});
