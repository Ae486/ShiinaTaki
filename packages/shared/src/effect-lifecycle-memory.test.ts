import { describe, expect, it } from "vitest";
import { EffectLifecycleSchema } from "./effect-lifecycle-schema.ts";

const base = {
  schemaVersion: "effect.v1" as const,
  effectId: "effect",
  runId: "run",
  attemptId: "attempt",
  kind: "memory" as const,
  state: "intent_committed" as const,
  version: 0,
  sourceRef: {
    type: "memory" as const,
    requestId: "request",
    authorityEpoch: "epoch",
    providerId: "local",
    providerLineageId: "lineage",
    capabilityDigest: "a".repeat(64),
    operation: "recall" as const,
  },
  executorRef: {
    type: "memory" as const,
    authorityEpoch: "epoch",
    providerId: "local",
    providerLineageId: "lineage",
    capabilityDigest: "a".repeat(64),
  },
  inputDigest: "b".repeat(64),
  replayPosture: "safe" as const,
};

describe("Memory Effect references", () => {
  it("accepts bounded provider/epoch/capability identity", () => {
    expect(EffectLifecycleSchema.parse(base).sourceRef).toMatchObject({ operation: "recall", providerId: "local" });
  });

  it("rejects raw query/content and unknown memory evidence keys", () => {
    expect(EffectLifecycleSchema.safeParse({ ...base, sourceRef: { ...base.sourceRef, query: "private memory" } }).success).toBe(false);
    expect(EffectLifecycleSchema.safeParse({ ...base, sourceRef: { ...base.sourceRef, capabilityDigest: "not-a-digest" } }).success).toBe(false);
  });
});
