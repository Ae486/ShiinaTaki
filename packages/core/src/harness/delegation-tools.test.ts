import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { tool, type ToolExecutionOptions } from "ai";
import { z } from "zod";
import { createExtensionRegistry } from "../extensions/extension-registry.ts";
import { createExtensionTools } from "../extensions/extension-tools.ts";
import { bindExecutableToolSelection } from "../governance/executable-tool-selection.ts";
import { bindCapturedToolExecution } from "../governance/captured-tool-execution.ts";
import { resolveDelegationTools } from "./delegation-tools.ts";
import { subagentFixture } from "../testing/subagent-fixture.ts";
import { streamingMockModel } from "../testing/mock-language-model.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";
import { createRunSnapshotCapture } from "./run-snapshot-capture.ts";
import { createMemoryRunReference } from "../memory/memory-capability-snapshot.ts";
import { attachMemoryEffectMetadata } from "../memory/canonical-tools/memory-effect-tool.ts";

describe("immutable delegated tool membership", () => {
  it("keeps permitted reads executable when actual captured projection removes requested mutations, including a metadata alias", async () => {
    const read = vi.fn(async () => ({ ok: true, result: "Actual permitted recall" }));
    const write = vi.fn(async () => ({ ok: true }));
    const capabilities = { providerId: "local", contractVersion: 1 as const, retain: true, recall: true, reflect: true,
      edit: true, invalidate: true, restore: true, conditionalMutation: true, idempotentWrites: true,
      sparseRetrieval: true, vectorRetrieval: "unavailable" as const, derivedMemoryRead: false };
    const memory = createMemoryRunReference({ providerId: "local", providerLineageId: "fixture-local", authorityEpochId: "fixture-epoch",
      contractVersion: 1, capabilities });
    const mutationNames = ["retain", "update_memory", "invalidate_memory", "restore_memory"];
    const alias = attachMemoryEffectMetadata(tool({ inputSchema: z.object({}), execute: write }), { operation: "retain",
      providerId: memory.providerId, providerLineageId: memory.providerLineageId!, authorityEpochId: memory.authorityEpochId!,
      capabilities, replayPosture: "never" });
    const memoryTools = { recall: tool({ inputSchema: z.object({}), execute: read }),
      ...Object.fromEntries(mutationNames.map((name) => [name, tool({ inputSchema: z.object({}), execute: write })])), alias_write: alias };
    const hostId = randomUUID();
    const snapshot = createRunSnapshotCapture({ provider: "test", modelId: "test",
      governance: { level: () => ({ level: "standard", policyGeneration: 1, registryRevision: 1 }) },
      memory: { captureRun: async () => ({ snapshot: memory, tools: memoryTools }) },
      extensions: { runContext: (_interactive, runId) => ({ tools: {}, instructions: "", toolDisclosure: { skills: {}, describedTools: {}, deferredToolNames: [] },
        snapshot: { runId: runId!, primaryHostId: hostId, hosts: [], entries: [], collisions: [],
          budget: { maxEntries: 10, maxCalls: 10, maxDescriptionChars: 100, maxSearchResults: 10 } } }) } });
    const model = scriptedModel([{ kind: "tool", toolCallId: "read", toolName: "recall", input: {} },
      { kind: "tool", toolCallId: "complete", toolName: "complete_subagent", input: { text: "Read without writes", materials: [] } }]);
    const f = await subagentFixture(model, { snapshot });
    try {
      const names = ["recall", "complete_subagent", ...mutationNames, "alias_write"];
      const accepted = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: names }, {
        characterId: "taki", operationKey: "capture-regression", label: "Read-only", initialContext: { kind: "fresh" }, direction: "Recall, then finish",
        materials: [], completionPolicy: "record_only", lifetimeMinutes: 30, toolSelection: { mode: "allow", names },
      });
      await vi.waitFor(() => expect(f.executions.list({ subagentId: accepted.conversation.subagentId })[0]?.result).toMatchObject({ outcome: "completed" }));
      expect(read).toHaveBeenCalledOnce(); expect(write).not.toHaveBeenCalled();
      expect(model.doStreamCalls[0]?.tools?.map((entry) => entry.name).sort()).toEqual(["complete_subagent", "interact_parent", "read_self_history", "recall"]);
      const execution = f.executions.list({ subagentId: accepted.conversation.subagentId })[0]!;
      expect(f.runRepo.snapshot(execution.runId).memory).toEqual(memory);
      expect(f.inputs.get(accepted.input!.inputId).consumed).not.toBeNull();
      expect(f.errors).toEqual([]);
      expect(() => resolveDelegationTools({ tools: { recall: memoryTools.recall }, parentNames: ["recall", "invented"],
        scope: { kind: "subagent", subagentId: accepted.conversation.subagentId, workInputId: accepted.input!.inputId },
        fixedExcludedNames: mutationNames, selection: { mode: "allow", names: ["recall", "invented"] } })).toThrow("SUBAGENT_TOOL_UNAVAILABLE");
    } finally { await f.close(); }
  });
  it.each(["mcp-tool", "skill", "capability"] as const)("refuses excluded %s through extension_call and preserves included original closure", async (kind) => {
    const native = vi.fn(async () => ({ ok: true, content: "original", extra: { complete: true } }));
    const alias = kind === "mcp-tool" ? "server_read" : kind === "skill" ? "load_skill" : "clipboard_read";
    const hostId = randomUUID();
    const registry = createExtensionRegistry({ runId: randomUUID(), primaryHostId: hostId, hosts: [], candidates: [{
      identity: { kind, ownerHostId: hostId, subjectId: kind === "capability" ? "clipboard-read" : "test", subjectRevision: "1",
        connectionGeneration: 1, catalogGeneration: 1 }, displayName: "Original", summary: "Original operation", isCurrent: () => true,
      callMode: kind === "mcp-tool" ? "mcp-tool" : kind === "skill" ? "skill-load" : "capability",
      modelToolName: kind === "mcp-tool" ? alias : undefined, selectionToolNames: [alias], call: native,
    }] });
    const tools = { ...createExtensionTools(registry), [alias]: tool({ inputSchema: z.object({}), execute: native }) };
    const names = Object.keys(tools); const scope = { kind: "subagent" as const, subagentId: randomUUID(), workInputId: randomUUID() };
    const selected = bindExecutableToolSelection(resolveDelegationTools({ tools, parentNames: names, scope,
      selection: { mode: "inherit", excludeNames: [alias] } }));
    const f = await subagentFixture(streamingMockModel(["unused"]));
    try {
      const bound = bindCapturedToolExecution(selected, { runId: f.parent.run.runId, attemptId: f.parent.attempt.attemptId, effects: f.effects });
      const options = { toolCallId: "indirect", messages: [], context: undefined } satisfies ToolExecutionOptions<unknown>;
      const args = { extensionId: registry.snapshot.entries[0]!.identity.extensionId, input: {} };
      expect(await bound.extension_call!.execute!(args, options)).toMatchObject({ ok: false, code: "EXTENSION_UNAVAILABLE" });
      expect(native).not.toHaveBeenCalled();
      const allowed = bindExecutableToolSelection(resolveDelegationTools({ tools, parentNames: names, scope }));
      expect(await allowed.extension_call!.execute!(args, options)).toMatchObject({ ok: true, output: { content: "original", extra: { complete: true } } });
      expect(native).toHaveBeenCalledOnce();
      expect(resolveDelegationTools({ tools, parentNames: names, scope, selection: { mode: "allow", names: [] } })).toEqual({});
    } finally { await f.close(); }
  });
});
