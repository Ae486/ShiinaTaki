import { describe, expect, it } from "vitest";
import { RunSnapshotSchema, RunStatusResultSchema, TriggerRequestSchema } from "./harness-schema.ts";

const at = "2026-08-23T00:00:00.000Z";
const memoryCapabilities = { providerId: "legacy-markdown", contractVersion: 1, retain: true, recall: true,
  reflect: false, edit: false, invalidate: true, restore: false, conditionalMutation: false,
  idempotentWrites: false, sparseRetrieval: true, vectorRetrieval: "unavailable", derivedMemoryRead: false } as const;
const request = {
  triggerRequestId: "trigger-1", idempotencyKey: "idem-1", characterId: "taki", initiator: "primary",
  provenance: { provider: "chat", triggerRequestId: "trigger-1" }, deliveryClass: "class_a", contextMode: "primary",
} as const;

describe("Harness Shared schemas", () => {
  it("accepts a bounded provider-neutral Trigger Request and rejects undeclared secret/prompt fields", () => {
    expect(TriggerRequestSchema.parse(request)).toEqual(request);
    expect(TriggerRequestSchema.safeParse({ ...request, apiKey: "secret" }).success).toBe(false);
    expect(TriggerRequestSchema.safeParse({ ...request, prompt: "raw prompt" }).success).toBe(false);
  });

  it("keeps immutable snapshots redaction-safe and strict", () => {
    const snapshot = { snapshotId: "s1", runId: "r1", capturedAt: at, schemaVersion: "slice1.v1", characterId: "taki", initiator: "primary", provenance: request.provenance, deliveryClass: "class_a", contextMode: "primary", modelProvider: "openai-compatible", modelId: "model", primaryHostId: "core-host", hosts: [], extensions: [], extensionSnapshotDigest: "b".repeat(64), governance: { policyGeneration: 1, registryRevision: 1, approvalGeneration: 1 }, memory: { providerId: "legacy-markdown", contractVersion: 1, capabilities: memoryCapabilities, capabilityDigest: "c".repeat(64) }, contextDecision: { sourceCategories: ["memory"], tokenAccounting: "unknown" }, replayDecision: { status: "not_captured" }, budget: {}, implementation: { runtimeVersion: "slice1", schemaVersion: "slice1.v1" }, sourceRefs: [], manifestDigest: "a".repeat(64) } as const;
    expect(RunSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    for (const forbidden of [{ dataBase64: "AAAA" }, { toolInput: { command: "secret" } }, { credential: "token" }, { sensorText: "screen" }]) {
      expect(RunSnapshotSchema.safeParse({ ...snapshot, ...forbidden }).success).toBe(false);
    }
  });

  it("distinguishes waiting and every terminal outcome in status", () => {
    const base = { runId: "r1", characterId: "taki", triggerRequestId: "t1", idempotencyKey: "i1", initiator: "primary", provenance: request.provenance, deliveryClass: "class_a", stateVersion: 1, operationPhase: "terminal", snapshot: { snapshotId: "s1", manifestDigest: "a".repeat(64), schemaVersion: "slice1.v1" }, queuedAt: at };
    for (const state of ["waiting", "completed", "failed", "cancelled", "skipped", "deadline_exceeded", "outcome_unknown"] as const) {
      const operationPhase = state === "waiting" ? "waiting" : "terminal";
      expect(RunStatusResultSchema.safeParse({ run: { ...base, state, operationPhase }, attempts: [] }).success).toBe(true);
    }
  });
});
