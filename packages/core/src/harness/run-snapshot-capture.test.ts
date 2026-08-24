import { describe, expect, it } from "vitest";
import type { ExtensionRunContext } from "../extensions/extension-run-context.ts";
import { createRunSnapshotCapture } from "./run-snapshot-capture.ts";

const hostId = "550e8400-e29b-41d4-a716-446655440000";
const extensionId = "skill.test";
const memoryCapabilities = { providerId: "local", contractVersion: 1 as const, retain: true, recall: true,
  reflect: false, edit: true, invalidate: true, restore: true, conditionalMutation: true,
  idempotentWrites: true, sparseRetrieval: true, vectorRetrieval: "unavailable" as const, derivedMemoryRead: false };

describe("createRunSnapshotCapture", () => {
  it("persists only reduced authority references while returning the exact executable context", async () => {
    const memoryTools = { captured_memory_tool: {} as never };
    const context: ExtensionRunContext = { tools: {}, instructions: "secret prompt instructions", snapshot: {
      runId: "550e8400-e29b-41d4-a716-446655440001", primaryHostId: hostId,
      hosts: [{ hostId, available: true, connectionGeneration: 2, catalogGeneration: 3, extensionCount: 1 }],
      entries: [{ identity: { extensionId, kind: "skill", ownerHostId: hostId, subjectId: "skill.pkg",
        subjectRevision: "rev", connectionGeneration: 2, catalogGeneration: 3 }, displayName: "Secret display",
        summary: "Secret description", callMode: "skill-load", modelKey: "skill_test", available: true }],
      collisions: [], budget: { maxEntries: 64, maxDescriptionChars: 512, maxSearchResults: 16, maxCalls: 8 },
    } };
    const capture = createRunSnapshotCapture({
      extensions: { runContext: () => context },
      governance: { level: () => ({ level: "standard", policyGeneration: 4, registryRevision: 2 }) },
      approval: { approvalGeneration: () => 7 },
      memory: { snapshot: () => ({ providerId: "local", authorityEpochId: "epoch-1", contractVersion: 1,
        capabilities: memoryCapabilities }),
        createTools: () => memoryTools },
      provider: "openai-compatible",
      modelId: "model",
    });
    const result = await capture.capture({ triggerRequestId: "trigger", idempotencyKey: "idem",
      characterId: "taki", initiator: "primary", provenance: { provider: "chat" },
      deliveryClass: "class_a", contextMode: "primary" }, context.snapshot.runId);
    expect(result.context).toMatchObject({ tools: context.tools, instructions: context.instructions });
    expect(result.context?.memoryTools).toBe(memoryTools);
    expect(result.snapshot).toMatchObject({ primaryHostId: hostId,
      hosts: [{ hostId, connectionGeneration: 2, catalogGeneration: 3 }],
      extensions: [{ extensionId, subjectRevision: "rev" }],
      governance: { policyGeneration: 4, registryRevision: 2, approvalGeneration: 7 },
      memory: { providerId: "local", authorityEpochId: "epoch-1", capabilities: memoryCapabilities } });
    expect(result.snapshot.memory.capabilityDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.snapshot.contextDecision).toEqual({ sourceCategories: ["character", "memory", "extensions"], tokenAccounting: "unknown" });
    expect(result.snapshot.replayDecision).toEqual({ status: "not_captured" });
    expect(result.snapshot.implementation).toEqual({ runtimeVersion: "slice1", schemaVersion: "slice1.v1" });
    const persisted = JSON.stringify(result.snapshot);
    expect(persisted).not.toContain("secret prompt instructions");
    expect(persisted).not.toContain("Secret display");
    expect(persisted).not.toContain("Secret description");
  });
});
