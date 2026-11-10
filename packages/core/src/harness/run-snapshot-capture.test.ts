import { describe, expect, it, vi } from "vitest";
import { createMemoryRunReference } from "../memory/memory-capability-snapshot.ts";
import type { TriggerRequest } from "@taki/shared";
import type { ExtensionRunContext } from "../extensions/extension-run-context.ts";
import { createRunSnapshotCapture } from "./run-snapshot-capture.ts";
import type { AgentRuntimeBinding } from "../agents/agent-runtime-binding.ts";
import { generatingModel } from "../testing/mock-language-model.ts";

const hostId = "550e8400-e29b-41d4-a716-446655440000";
const extensionId = "skill.test";
const memoryCapabilities = { providerId: "local", contractVersion: 1 as const, retain: true, recall: true,
  reflect: false, edit: true, invalidate: true, restore: true, conditionalMutation: true,
  idempotentWrites: true, sparseRetrieval: true, vectorRetrieval: "unavailable" as const, derivedMemoryRead: false };

describe("createRunSnapshotCapture", () => {
  it("captures Main before awaiting Memory and refuses unavailable Main before any Memory work", async () => {
    const binding = (modelId: string): AgentRuntimeBinding => ({ modelId, model: generatingModel(modelId), provider: "test",
      revision: 1, maxSteps: 2, historyBudget: () => 1000, contextWindowTokens: () => 2000,
      requestWindowSnapshot: () => ({ declaredRealTokens: 2000, effectiveRealTokens: 2000, estimatorWindowUnits: 2000, factor: 1 }),
      requestEnvelopeReserve: () => 1000, onUsage: () => {}, onOverflow: () => {}, requestReduction: () => undefined });
    let current: AgentRuntimeBinding | undefined = binding("a"); const old = current;
    let release!: () => void; const blocked = new Promise<void>((done) => { release = done; });
    const memory = { captureRun: vi.fn(async () => { await blocked; return { snapshot: createMemoryRunReference({
      providerId: "local", authorityEpochId: "epoch", contractVersion: 1, capabilities: memoryCapabilities }), tools: {} }; }) };
    const capture = createRunSnapshotCapture({ runtime: () => current, memory,
      extensions: { runContext: () => ({ tools: {}, toolDisclosure: { deferredToolNames: [], describedTools: {}, skills: {} }, instructions: "",
        snapshot: { runId: "run", hosts: [], entries: [], primaryHostId: hostId, collisions: [],
          budget: { maxEntries: 1, maxDescriptionChars: 1, maxSearchResults: 1, maxCalls: 1 } } }) },
      governance: { level: () => ({ level: "standard", policyGeneration: 1, registryRevision: 1 }) },
      provider: "legacy", modelId: "legacy" });
    const request: TriggerRequest = { triggerRequestId: "trigger", idempotencyKey: "idem", characterId: "taki",
      initiator: "primary", provenance: { provider: "chat" }, deliveryClass: "class_a", contextMode: "primary" };
    const pending = capture.capture(request, "run"); current = binding("b"); release();
    const result = await pending;
    expect(result.context?.runtime).toBe(old); expect(result.snapshot.modelId).toBe("a");
    current = undefined;
    await expect(capture.capture(request, "next")).rejects.toThrow();
    expect(memory.captureRun).toHaveBeenCalledTimes(1);
  });
  it("persists only reduced authority references while returning the exact executable context", async () => {
    const memoryTools = { captured_memory_tool: {} as never };
    const names = { direct_mcp: "Actual server · operation" };
    const context: ExtensionRunContext = { tools: {}, toolDisclosure: { deferredToolNames: [], describedTools: {}, skills: {} }, toolDisplayNames: names, instructions: "secret prompt instructions", snapshot: {
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
      memory: { captureRun: async () => ({ snapshot: createMemoryRunReference({ providerId: "local", providerLineageId: "lineage-1", authorityEpochId: "epoch-1", contractVersion: 1,
        capabilities: memoryCapabilities }), tools: memoryTools }) },
      provider: "openai-compatible",
      modelId: "model",
    });
    const request: TriggerRequest = { triggerRequestId: "trigger", idempotencyKey: "idem",
      characterId: "taki", initiator: "primary", provenance: { provider: "chat" },
      deliveryClass: "class_a", contextMode: "primary" };
    const result = await capture.capture(request, context.snapshot.runId);
    expect(result.context).toMatchObject({ tools: context.tools, instructions: context.instructions });
    expect(result.context?.memoryTools).toEqual(memoryTools);
    expect(result.context?.toolDisplayNames).toEqual(names);
    expect(result.context?.toolDisclosure).toBe(context.toolDisclosure);
    expect(Object.isFrozen(result.context?.toolDisplayNames)).toBe(true);
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
    expect(persisted).not.toContain("Actual server");

    names.direct_mcp = "Changed display only";
    expect(result.context?.toolDisplayNames?.direct_mcp).toBe("Actual server · operation");
    const renamed = await capture.capture(request, context.snapshot.runId);
    expect(renamed.context?.toolDisplayNames?.direct_mcp).toBe("Changed display only");
    expect(JSON.stringify(renamed.snapshot)).toBe(persisted);
  });

  it("captures memory once and keeps its exact immutable snapshot plus process-local ports", async () => {
    const caps = { ...memoryCapabilities };
    const snapshot = createMemoryRunReference({ providerId: "local", providerLineageId: "lineage", authorityEpochId: "epoch",
      contractVersion: 1, capabilities: caps });
    const automaticRecall = vi.fn(async () => "PRIVATE_RECALLED_CONTENT");
    const assemble = vi.fn(() => "PRIVATE_STABLE_MEMORY");
    const memoryTools = { recall: { description: "original", execute: vi.fn() } as never };
    const captureRun = vi.fn(async () => ({ snapshot, tools: memoryTools, automaticRecall, assemble, prompt: "PRIVATE_PROCEDURE" }));
    const capture = createRunSnapshotCapture({ memory: { captureRun },
      extensions: { runContext: () => ({ tools: {}, toolDisclosure: { deferredToolNames: [], describedTools: {}, skills: {} }, instructions: "", snapshot: { runId: "run", hosts: [], entries: [],
        primaryHostId: hostId, collisions: [], budget: { maxEntries: 1, maxDescriptionChars: 1, maxSearchResults: 1, maxCalls: 1 } } }) },
      governance: { level: () => ({ level: "standard", policyGeneration: 1, registryRevision: 1 }) },
      provider: "test", modelId: "test" });
    const result = await capture.capture({ triggerRequestId: "trigger", idempotencyKey: "idempotency", characterId: "taki",
      initiator: "primary", provenance: { provider: "chat" }, deliveryClass: "class_a", contextMode: "primary" }, "run");
    expect(captureRun).toHaveBeenCalledExactlyOnceWith("taki");
    expect(result.snapshot.memory).toBe(snapshot);
    expect(result.context?.memorySnapshot).toBe(snapshot);
    expect(result.context?.automaticMemoryRecall).toBe(automaticRecall);
    expect(result.context?.assembleMemory).toBe(assemble);
    expect(result.context?.memoryPrompt).toBe("PRIVATE_PROCEDURE");
    caps.recall = false;
    memoryTools.recall = { description: "replacement" } as never;
    expect(result.context?.memoryTools?.recall?.description).toBe("original");
    expect(snapshot.capabilities.recall).toBe(true);
    expect(Object.isFrozen(result.context?.memoryTools?.recall)).toBe(true);
    expect(Object.isFrozen(snapshot.capabilities)).toBe(true);
    expect(JSON.stringify(result.snapshot)).not.toContain("PRIVATE_");
    expect(automaticRecall).not.toHaveBeenCalled();
    expect(assemble).not.toHaveBeenCalled();
  });
});
