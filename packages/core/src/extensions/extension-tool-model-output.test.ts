import { afterEach, describe, expect, it, vi } from "vitest";
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { stepCountIs, streamText, tool, type Tool, type ToolSet } from "ai";
import { z } from "zod";
import { InMemoryTransport } from "../testing/mcp-test-transport.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";
import { createExtensionRegistry, type ExtensionCandidate } from "./extension-registry.ts";
import { createExtensionTools } from "./extension-tools.ts";
import { snapshotMcpExtensions } from "./extension-sources.ts";
import { createToolDisclosureSnapshot } from "./tool-disclosure-snapshot.ts";
import { createToolDisclosure } from "../agents/tool-disclosure.ts";
import type { McpManager } from "../mcp/mcp-manager.ts";
import { wrapGovernedTool } from "../governance/governed-tool.ts";
import type { GovernancePolicyService } from "../governance/governance-policy-service.ts";

const CORE = "11111111-1111-4111-8111-111111111111";
const REMOTE = "22222222-2222-4222-8222-222222222222";
const RUN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const clients: MCPClient[] = [];
afterEach(async () => { await Promise.all(clients.splice(0).map((client) => client.close())); });
function candidate(overrides: Partial<ExtensionCandidate> = {}): ExtensionCandidate {
  return { identity: { kind: "mcp-tool", ownerHostId: CORE, subjectId: "mcp.fixture.echo", subjectRevision: "raw-revision",
    connectionGeneration: 7, catalogGeneration: 9 }, displayName: "Echo", summary: "Useful purpose", callMode: "mcp-tool",
    modelToolName: "fixture_echo", call: () => ({ useful: "content" }), isCurrent: () => true, ...overrides };
}
function registry(candidates = [candidate()]) {
  return createExtensionRegistry({ runId: RUN, primaryHostId: CORE, hosts: [], candidates });
}
async function mcpTools(result: Record<string, unknown>, outputSchema?: Record<string, unknown>) {
  const call = vi.fn((message) => ({ jsonrpc: "2.0", id: message.id, result }));
  const client = await createMCPClient({ transport: new InMemoryTransport([{ name: "echo", description: "Echo content",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    ...(outputSchema ? { outputSchema } : {}) }], call) });
  clients.push(client);
  const rawTool = (await client.tools(outputSchema ? { schemas: { echo: {
    inputSchema: z.strictObject({ text: z.string() }), outputSchema: z.strictObject({ vendorId: z.string(), cursor: z.string() }),
  } } } : {})).echo!;
  const tool = wrapGovernedTool(rawTool as Tool, { service: { authorize: () => ({ allowed: true }) } as unknown as GovernancePolicyService,
    binding: { identity: { capabilityId: "mcp.tool.call", ownerHostId: CORE, subject: { subjectId: "mcp.fixture.echo", revision: "raw-revision" } }, cellKey: "mcp-tool-call" } });
  const snapshot = snapshotMcpExtensions({ snapshot: () => [{ tool, toolKey: "fixture_echo", serverId: "fixture", ownerHostId: CORE,
    generation: 7, configRevision: 1, isCurrent: () => true,
    ref: { subjectId: "mcp.fixture.echo", subjectRevision: "raw-revision", toolName: "echo", serverName: "Fixture" } }] } as unknown as McpManager);
  const reg = registry([...snapshot.candidates]);
  return { reg, call, tool, tools: { ...snapshot.directTools, ...createExtensionTools(reg) } };
}

describe("extension model boundary", () => {
  it("keeps exact selectors and overflow truth while describe uses raw identity to disclose only the next-step captured tool", async () => {
    const reg = registry(); const tools: ToolSet = { ...createExtensionTools(reg), fixture_echo: tool({ inputSchema: z.strictObject({}), execute: () => ({ useful: "content" }) }) };
    const descriptor = reg.snapshot.entries[0]!; const id = descriptor.identity.extensionId;
    const disclosure = createToolDisclosure({ tools, snapshot: createToolDisclosureSnapshot(reg, { fixture_echo: tools.fixture_echo! }, CORE), bundles: [] });
    const model = scriptedModel([{ kind: "tool", toolCallId: "discover", toolName: "extension_discover", input: {} },
      { kind: "tool", toolCallId: "describe", toolName: "extension_describe", input: { extensionId: id } }, { kind: "text", deltas: ["Done"] }]);
    const raw: unknown[] = []; const errors: unknown[] = [];
    await streamText({ model, tools, prompt: "Discover integration", stopWhen: stepCountIs(3),
      prepareStep: ({ steps }) => ({ activeTools: disclosure.activeTools(steps) }),
      onError: ({ error }) => { errors.push(error); },
      onStepEnd: (step) => { raw.push(...step.toolResults.map((item) => item.output)); } }).consumeStream();
    expect(errors).toEqual([]);
    expect(raw[0]).toMatchObject({ runId: RUN, entries: [{ identity: descriptor.identity }] });
    expect(raw[1]).toMatchObject({ entry: { identity: descriptor.identity }, toolName: "fixture_echo" });
    const projected = JSON.stringify(model.doStreamCalls[1]?.prompt);
    expect(projected).toContain(id); expect(projected).toContain("Useful purpose"); expect(projected).toContain("available");
    for (const key of ["connectionGeneration", "catalogGeneration", "modelKey", "raw-revision", RUN]) expect(projected).not.toContain(key);
    expect(model.doStreamCalls[1]?.tools?.map((entry) => entry.name)).not.toContain("fixture_echo");
    expect(model.doStreamCalls[2]?.tools?.map((entry) => entry.name)).toContain("fixture_echo");
    expect(reg.renderContext()).toContain("has no cursor");
    const many = Array.from({ length: 129 }, (_, index) => candidate({ identity: { ...candidate().identity, subjectId: `mcp.${index}` }, modelToolName: `mcp_${index}` }));
    const overflow = registry(many); const output = overflow.discover({ limit: 128 });
    const view = await createExtensionTools(overflow).extension_discover!.toModelOutput!({ input: {}, output, toolCallId: "call" });
    expect(view).toMatchObject({ type: "json", value: { truncated: true } });
    const excluded = many.find((item) => !overflow.snapshot.entries.some((entry) => entry.identity.subjectId === item.identity.subjectId))!;
    expect(overflow.snapshot.entries.some((entry) => entry.identity.subjectId === excluded.identity.subjectId)).toBe(false);
  });

  it("preserves Host disambiguation and unknown third-party content including functional IDs", async () => {
    const remote = candidate({ identity: { ...candidate().identity, ownerHostId: REMOTE, subjectId: "remote.subject" }, modelToolName: "remote_echo",
      call: () => ({ vendorId: "keep-id", cursor: "next-page", structuredContent: { owner: "vendor", content: "unique" }, content: [{ type: "custom", payload: "keep" }] }) });
    const reg = registry([candidate(), remote]); const tools = createExtensionTools(reg);
    const discovery = reg.discover({});
    const discovered = await tools.extension_discover!.toModelOutput!({ input: {}, output: discovery, toolCallId: "call" });
    expect(discovered).toMatchObject({ value: { entries: expect.arrayContaining([expect.objectContaining({ ownerHostId: REMOTE })]) } });
    const entry = reg.snapshot.entries.find((item) => item.identity.ownerHostId === REMOTE)!;
    const input = { extensionId: entry.identity.extensionId, input: {} };
    const raw = await tools.extension_call!.execute!(input, { toolCallId: "call", messages: [], context: {} });
    const projected = await tools.extension_call!.toModelOutput!({ input, output: raw, toolCallId: "call" });
    expect(raw).toMatchObject({ owner: entry.identity });
    expect(projected).toEqual({ type: "json", value: { ok: true, output: remote.call!({}, { toolCallId: "call", messages: [], context: {} }) } });
  });

  it("indirect calls preserve complete MCP error, structured and media data in the next request", async () => {
    const contents = [{ type: "text", text: "actual-content" }, { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
      { type: "resource_link", uri: "https://example.test/source", name: "Source", description: "Evidence" },
      { type: "resource", resource: { uri: "memory://source", text: "resource-text", mimeType: "text/plain" } }];
    const structuredContent = { vendorHandle: "keep-raw", cursor: "functional-next-page" };
    const f = await mcpTools({ isError: true, content: contents, structuredContent });
    const entry = f.reg.snapshot.entries[0]!; const input = { extensionId: entry.identity.extensionId, input: { text: "one" } };
    const model = scriptedModel([{ kind: "tool", toolCallId: "call", toolName: "extension_call", input }, { kind: "text", deltas: ["Read"] }]);
    const raw: unknown[] = [];
    await streamText({ model, tools: f.tools, prompt: "Read extension", stopWhen: stepCountIs(2),
      onStepEnd: (step) => { raw.push(...step.toolResults.map((item) => item.output)); } }).consumeStream();
    expect(raw[0]).toMatchObject({ ok: true, owner: entry.identity, output: { isError: true, content: contents, structuredContent } });
    const projected = await f.tools.extension_call!.toModelOutput!({ input, output: raw[0], toolCallId: "call" });
    expect(projected).toEqual({ type: "json", value: { ok: true, output: (raw[0] as { output: unknown }).output } });
    const request = JSON.stringify(model.doStreamCalls[1]?.prompt);
    expect(request).toContain("actual-content"); expect(request).toContain("aGVsbG8="); expect(request).toContain("resource-text");
    expect(request).toContain("example.test/source"); expect(request).not.toContain("catalogGeneration");
    expect(request).toContain("isError"); expect(request).toContain("vendorHandle"); expect(request).toContain("keep-raw");
    expect(request).toContain("functional-next-page");
    const direct = await f.tool.toModelOutput!({ input: input.input, output: (raw[0] as { output: unknown }).output, toolCallId: "direct" });
    expect(direct.type).toBe("content");
    expect(f.call).toHaveBeenCalledOnce();
  });

  it("retains SDK output-schema validation and the unknown schema's complete structured result", async () => {
    const f = await mcpTools({ structuredContent: { vendorId: "functional", cursor: "opaque-next" },
      content: [{ type: "text", text: "compatibility" }] }, { type: "object", properties: {
      vendorId: { type: "string" }, cursor: { type: "string" } }, required: ["vendorId", "cursor"], additionalProperties: false });
    const entry = f.reg.snapshot.entries[0]!; const input = { extensionId: entry.identity.extensionId, input: { text: "one" } };
    const raw = await f.tools.extension_call!.execute!(input, { toolCallId: "call", messages: [], context: {} });
    expect(raw).toMatchObject({ output: { vendorId: "functional", cursor: "opaque-next" } });
    expect(await f.tools.extension_call!.toModelOutput!({ input, output: raw, toolCallId: "call" }))
      .toEqual({ type: "json", value: { ok: true, output: { vendorId: "functional", cursor: "opaque-next" } } });
    const invalid = await mcpTools({ structuredContent: { vendorId: 7, cursor: "opaque-next" } }, { type: "object" });
    const invalidInput = { extensionId: invalid.reg.snapshot.entries[0]!.identity.extensionId, input: { text: "one" } };
    const invalidResult = await invalid.tools.extension_call!.execute!(invalidInput, { toolCallId: "invalid", messages: [], context: {} });
    expect(invalidResult).toMatchObject({ ok: false, code: "EXTENSION_CALL_FAILED" });
    expect(await invalid.tools.extension_call!.toModelOutput!({ input: invalidInput, output: invalidResult, toolCallId: "invalid" }))
      .toMatchObject({ value: { ok: false, code: "EXTENSION_CALL_FAILED" } });
  });

  it("captures the model projector with the original closure and refuses projector selection for another owner", async () => {
    const projector = vi.fn(({ output }: { output: unknown }) => ({ type: "json" as const,
      value: { captured: z.strictObject({ useful: z.string() }).parse(output) } }));
    const source = candidate({ identity: { ...candidate().identity, kind: "skill" }, callMode: "skill-load", toModelOutput: projector });
    const reg = registry([source]);
    const tools = createExtensionTools(reg); const entry = reg.snapshot.entries[0]!;
    const input = { extensionId: entry.identity.extensionId, input: {} };
    Object.assign(source, { call: () => ({ replacement: true }), toModelOutput: () => ({ type: "json", value: "replacement" }) });
    const output = await tools.extension_call!.execute!(input, { toolCallId: "call", messages: [], context: {} });
    expect(output).toMatchObject({ ok: true, output: { useful: "content" } });
    expect(await tools.extension_call!.toModelOutput!({ input, output, toolCallId: "call" }))
      .toEqual({ type: "json", value: { captured: { useful: "content" } } });
    const mismatched = { ok: true, owner: { ...entry.identity, ownerHostId: REMOTE }, output: { opaqueId: "do-not-drop" } };
    expect(await tools.extension_call!.toModelOutput!({ input, output: mismatched, toolCallId: "call" }))
      .toEqual({ type: "json", value: { ok: true, output: { opaqueId: "do-not-drop" } } });
    expect(projector).toHaveBeenCalledOnce();
    const ignoredMcp = candidate({ toModelOutput: projector, call: () => ({ isError: true, structuredContent: { cursor: "keep-mcp-cursor" } }) });
    const mcpRegistry = registry([ignoredMcp]); const mcpInput = { extensionId: mcpRegistry.snapshot.entries[0]!.identity.extensionId, input: {} };
    const mcpOutput = await mcpRegistry.call(mcpInput, { toolCallId: "mcp", messages: [], context: {} });
    expect(await mcpRegistry.modelCallOutput({ input: mcpInput, output: mcpOutput, toolCallId: "mcp" }))
      .toEqual({ type: "json", value: { ok: true, output: { isError: true, structuredContent: { cursor: "keep-mcp-cursor" } } } });
    expect(projector).toHaveBeenCalledOnce();
  });

  it.each(["cancelled", "outcome_unknown"] as const)("keeps %s failure state without exposing owner plumbing", async (state) => {
    const reg = registry([candidate({ call: () => ({ ok: false, code: "CANCELLED", state }) })]);
    const tools = createExtensionTools(reg); const input = { extensionId: reg.snapshot.entries[0]!.identity.extensionId, input: {} };
    const raw = await tools.extension_call!.execute!(input, { toolCallId: "call", messages: [], context: {} });
    expect(raw).toMatchObject({ owner: reg.snapshot.entries[0]!.identity, state });
    expect(await tools.extension_call!.toModelOutput!({ input, output: raw, toolCallId: "call" }))
      .toMatchObject({ value: { ok: false, code: "EXTENSION_CALL_FAILED", state } });
  });
});
