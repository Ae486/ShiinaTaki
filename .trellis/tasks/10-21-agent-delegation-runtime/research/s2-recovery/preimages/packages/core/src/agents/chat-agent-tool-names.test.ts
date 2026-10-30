import { afterEach, describe, expect, it, vi } from "vitest";
import { APICallError, tool } from "ai";
import { z } from "zod";
import type { TriggerRequest } from "@taki/shared";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { createExtensionRunContext } from "../extensions/extension-run-context.ts";
import type { GovernancePolicyService } from "../governance/governance-policy-service.ts";
import { createMemoryRunReference } from "../memory/memory-capability-snapshot.ts";
import { createRunSnapshotCapture } from "../harness/run-snapshot-capture.ts";
import { createHostCatalogStore } from "../hosts/host-catalog.ts";
import type { McpManager, McpToolSnapshot } from "../mcp/mcp-manager.ts";
import type { TurnInteractive } from "../mcp/mcp-turn-tools.ts";
import type { SkillCatalogManager } from "../skills/skill-catalog-manager.ts";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";
import { createChatAgent } from "./chat-agent.ts";

const RUN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RUN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HOST = "11111111-1111-4111-8111-111111111111";
const ROUTE = "source-server_tool_name";
const fixtures: CompanionFixture[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
});

describe("ChatAgent captured tool names", () => {
  it("persists the admission-captured target after MCP replacement and keeps it readable in later history", async () => {
    const fixture = fresh();
    let generation = 1;
    const firstTool = tool({ description: "First tool", inputSchema: z.strictObject({}), execute: () => {
      generation = 2;
      return { from: "first runtime" };
    } });
    const secondTool = tool({ description: "Second tool", inputSchema: z.strictObject({}), execute: () => ({ from: "second runtime" }) });
    const first = snapshotEntry({ generation: 1, tool: firstTool, current: () => generation });
    const second = snapshotEntry({ generation: 2, tool: secondTool, current: () => generation });
    const snapshot = vi.fn(() => [generation === 1 ? first : second]);
    const capture = snapshotCapture({ snapshot } as unknown as McpManager);
    const admitted = await capture.capture(request("first"), RUN_A);
    const firstExtensionId = Object.keys(admitted.context?.toolDisclosure?.describedTools ?? {})[0];
    expect(firstExtensionId).toBeDefined();
    const model = scriptedModel([
      { kind: "tool", toolCallId: "describe-first", toolName: "extension_describe", input: { extensionId: firstExtensionId } },
      { kind: "tool", toolCallId: "call-first", toolName: ROUTE, input: {} },
      { kind: "text", deltas: ["first done"] },
    ]);
    const fallbackContext = vi.fn(() => ({ tools: {} }));
    const agent = createChatAgent({ model, store: fixture.conversation, memory: fixture.memory, runContext: fallbackContext });

    await drain(agent.stream({ characterId: "taki", message: "first request" }, { runContext: admitted.context }));

    expect(snapshot).toHaveBeenCalledOnce();
    expect(first.isCurrent()).toBe(false);
    expect(Object.isFrozen(admitted.context?.toolDisplayNames)).toBe(true);
    expect(admitted.context?.toolDisplayNames?.[ROUTE]).toBe("source-server · tool.name");
    const routeParts = () => toolParts(fixture).filter((part) => part.toolName === ROUTE);
    expect(routeParts().map((part) => part.displayName)).toEqual(["source-server · tool.name", "source-server · tool.name"]);
    expect(routeParts()[1]).toMatchObject({ output: { type: "json", value: { from: "first runtime" } } });

    const replacement = await capture.capture(request("second"), RUN_B);
    const secondExtensionId = Object.keys(replacement.context?.toolDisclosure?.describedTools ?? {})[0];
    expect(secondExtensionId).toBeDefined();
    const replacementModel = scriptedModel([
      { kind: "tool", toolCallId: "describe-second", toolName: "extension_describe", input: { extensionId: secondExtensionId } },
      { kind: "tool", toolCallId: "call-second", toolName: ROUTE, input: {} },
      { kind: "text", deltas: ["second done"] },
    ]);
    const replacementAgent = createChatAgent({ model: replacementModel, store: fixture.conversation,
      memory: fixture.memory, runContext: fallbackContext });
    await drain(replacementAgent.stream({ characterId: "taki", message: "second request" }, { runContext: replacement.context }));

    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(fallbackContext).not.toHaveBeenCalled();
    expect(routeParts().map((part) => [part.toolCallId, part.toolName, part.displayName])).toEqual([
      ["call-first", ROUTE, "source-server · tool.name"],
      ["call-first", ROUTE, "source-server · tool.name"],
      ["call-second", ROUTE, "source-server · tool_name"],
      ["call-second", ROUTE, "source-server · tool_name"],
    ]);
    // Descriptor results legitimately contain displayName inside their data. Presentation metadata must
    // still stay out of canonical model-message parts and must not replace the captured routing key.
    for (const message of fixture.conversation.history("taki")) {
      if (Array.isArray(message.content)) for (const part of message.content) expect(part).not.toHaveProperty("displayName");
    }
    expect(JSON.stringify(replacementModel.doStreamCalls[0]?.prompt)).not.toContain("source-server · tool.name");
  });

  it("captures a compatibility context once across a clean overflow retry and later injected-table mutations", async () => {
    const fixture = fresh();
    const names = { compat_route: "Original target · operation" };
    const dispose = vi.fn();
    const compatTool = tool({ description: "Compatibility tool", inputSchema: z.strictObject({}), execute: () => {
      names.compat_route = "Changed during execution";
      return { ok: true };
    } });
    const runContext = vi.fn(() => ({ tools: { compat_route: compatTool }, toolDisplayNames: names, dispose }));
    const model = scriptedModel([
      { kind: "tool", toolCallId: "compat-call", toolName: "compat_route", input: {} },
      { kind: "text", deltas: ["done"] },
    ]);
    vi.spyOn(model, "doStream").mockRejectedValueOnce(new APICallError({
      message: "This model's maximum context length is 4096 tokens.",
      url: "https://provider.invalid/v1/chat/completions", requestBodyValues: {}, statusCode: 400, isRetryable: false,
    }));
    const onOverflow = vi.fn(() => { names.compat_route = "Changed before retry"; });
    const agent = createChatAgent({ model, store: fixture.conversation, memory: fixture.memory, runContext, onOverflow });

    await drain(agent.stream({ characterId: "taki", message: "Use the compatibility tool" }));

    expect(onOverflow).toHaveBeenCalledOnce();
    expect(runContext).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    expect(names.compat_route).toBe("Changed during execution");
    expect(toolParts(fixture).map((part) => part.displayName)).toEqual([
      "Original target · operation", "Original target · operation",
    ]);
  });

  it("keeps legacy ToolSet-only integrations unresolved instead of decoding their routing keys", async () => {
    const fixture = fresh();
    const model = scriptedModel([
      { kind: "tool", toolCallId: "legacy-call", toolName: ROUTE, input: {} },
      { kind: "text", deltas: ["done"] },
    ]);
    const agent = createChatAgent({ model, store: fixture.conversation, memory: fixture.memory,
      extraTools: { [ROUTE]: tool({ description: "Legacy tool", inputSchema: z.strictObject({}), execute: () => ({ ok: true }) }) } });

    await drain(agent.stream({ characterId: "taki", message: "Use the legacy tool" }));

    const parts = toolParts(fixture);
    expect(parts).toHaveLength(2);
    for (const part of parts) {
      expect(part.toolName).toBe(ROUTE);
      expect(part).not.toHaveProperty("displayName");
    }
  });
});

function snapshotEntry(input: { generation: number; tool: McpToolSnapshot["tool"]; current: () => number }): McpToolSnapshot {
  return {
    toolKey: ROUTE, tool: input.tool, serverId: "source-server", ownerHostId: HOST,
    configRevision: input.generation, generation: input.generation, isCurrent: () => input.current() === input.generation,
    ref: { serverName: "source-server", toolName: input.generation === 1 ? "tool.name" : "tool_name",
      subjectId: `mcp.subject.${input.generation}`, subjectRevision: `cfg.${input.generation}` },
  };
}

function snapshotCapture(mcp: McpManager) {
  const governance = { authorize: () => ({ allowed: true }),
    level: () => ({ level: "standard", policyGeneration: 1, registryRevision: 1 }) } as unknown as GovernancePolicyService;
  return createRunSnapshotCapture({
    extensions: { runContext: (interactive?: TurnInteractive, runId = RUN_A) => createExtensionRunContext({
      runId, coreHostId: HOST, catalogs: createHostCatalogStore(), mcp, interactive,
      skills: {
        catalog: { currentGeneration: () => 1, list: () => [] } as unknown as SkillCatalogManager,
        loader: { renderList: () => "", describe: () => undefined,
          load: () => ({ ok: true, content: "", contentRevision: "test", files: [] }) },
        governance,
      },
      route: async () => ({ ok: true }),
    }) },
    governance,
    memory: { captureRun: async () => ({ tools: {}, snapshot: createMemoryRunReference({ providerId: "local", contractVersion: 1,
      capabilities: { providerId: "local", contractVersion: 1, retain: true, recall: true, reflect: false, edit: true,
        invalidate: true, restore: true, conditionalMutation: true, idempotentWrites: true, sparseRetrieval: true,
        vectorRetrieval: "unavailable", derivedMemoryRead: false } }) }) },
    provider: "test", modelId: "test",
  });
}

function request(id: string): TriggerRequest {
  return { triggerRequestId: id, idempotencyKey: id, characterId: "taki", initiator: "primary",
    provenance: { provider: "chat" }, deliveryClass: "class_a", contextMode: "primary" };
}

function toolParts(fixture: CompanionFixture) {
  return createTimelineRepo(fixture.db).latestAscending("taki", 20).flatMap((entry) => entry.parts ?? [])
    .filter((part) => part.type === "tool-call" || part.type === "tool-result");
}

function fresh(): CompanionFixture {
  const fixture = createCompanionFixture();
  fixtures.push(fixture);
  return fixture;
}

async function drain(stream: AsyncIterable<string>): Promise<void> {
  for await (const delta of stream) void delta;
}
