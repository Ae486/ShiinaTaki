import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { InMemoryTransport, memConnect, type CallHandler } from "../testing/mcp-test-transport.ts";
import { createMcpManager, type McpManager } from "./mcp-manager.ts";
import { projectMcpImageResult } from "./mcp-image-result.ts";
import { createAttachmentStore } from "../media/attachment-store.ts";
import { createChatAgent } from "../agents/chat-agent.ts";
import { createConversationStore } from "../agents/conversation-store.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { nativeToolImages } from "../agents/native-tool-images.ts";
import { snapshotMcpExtensions } from "../extensions/extension-sources.ts";
import { createExtensionRegistry } from "../extensions/extension-registry.ts";
import { createExtensionTools } from "../extensions/extension-tools.ts";

const HOST = "11111111-1111-4111-8111-111111111111";
const PNG = Buffer.from("native-mcp-png").toString("base64");
const JPEG = Buffer.from("native-mcp-jpeg").toString("base64");
const SVG = Buffer.from("<svg />").toString("base64");
const fixtures: CompanionFixture[] = []; const managers: McpManager[] = [];
afterEach(async () => { await Promise.all(managers.splice(0).map((manager) => manager.close())); for (const fixture of fixtures.splice(0)) fixture.cleanup(); });

function mixedResult() {
  return { isError: true, structuredContent: { original: "structured-kept" }, content: [
    { type: "text", text: "MCP returned text" },
    { type: "image", mimeType: "image/svg+xml", data: SVG, annotations: { audience: ["assistant"] } },
    { type: "image", mimeType: "image/jpeg", data: JPEG },
    { type: "resource", resource: { uri: "mcp://image", mimeType: "image/png", blob: PNG } },
    { type: "resource_link", uri: "mcp://original", name: "original-resource" },
    { type: "audio", mimeType: "audio/wav", data: "original-audio-data" },
    { type: "custom-native-block", note: "unknown-content-data" },
  ] };
}

async function fixture(result = mixedResult()) {
  const companion = createCompanionFixture(); fixtures.push(companion);
  const attachments = createAttachmentStore({ attachmentsDir: join(companion.root, "attachments") });
  const call = vi.fn<CallHandler>((request) => ({ jsonrpc: "2.0", id: request.id, result }));
  const transport = new InMemoryTransport([{ name: "capture", inputSchema: { type: "object", properties: {} } }], call);
  const manager = createMcpManager({ logger: createCaptureLogger().logger, connect: memConnect(new Map([["images", transport]])),
    projectImageResult: (output) => projectMcpImageResult(output, attachments) }); managers.push(manager);
  expect(await manager.applyDesired({ serverId: "images", ownerHostId: HOST, configRevision: 1,
    config: { command: "fixture" }, selectedTools: [], enabled: true })).toMatchObject({ status: "published" });
  const store = createConversationStore({ repo: createTimelineRepo(companion.db), attachments, window: { budget: () => 20_000 } });
  return { companion, attachments, call, manager, store };
}

type WireRequest = { messages: { role: string; tool_call_id?: string; content: string | null | { type: string; image_url?: { url: string } }[] }[] };
function provider(toolName: string, input: unknown) {
  const requests: WireRequest[] = [];
  const api = createOpenAICompatible({ name: "mcp-native-wire", baseURL: "https://mcp-fixture.invalid/v1", fetch: async (_url, options) => {
    requests.push(JSON.parse(String(options?.body)) as WireRequest);
    const first = requests.length === 1;
    const delta = first ? { tool_calls: [{ index: 0, id: "mcp-native-call", type: "function", function: { name: toolName, arguments: JSON.stringify(input) } }] }
      : { content: "native MCP images received" };
    return new Response(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 0, model: "primary",
      choices: [{ index: 0, delta, finish_reason: first ? "tool_calls" : "stop" }], usage: { prompt_tokens: 5000, completion_tokens: 5, total_tokens: 5005 } })}\n\ndata: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream" } });
  } });
  return { model: api("primary"), requests };
}
function imageUrls(request: WireRequest | undefined) {
  return (request?.messages ?? []).flatMap((message) => Array.isArray(message.content)
    ? message.content.flatMap((part) => part.type === "image_url" && part.image_url ? [part.image_url.url] : []) : []);
}
async function drain(stream: AsyncIterable<string>) { let text = ""; for await (const delta of stream) text += delta; return text; }

describe("standard MCP native image boundary", () => {
  it.each(["direct", "extension_call"])("sends real SDK MCP image/resource blocks natively through %s while preserving all other result blocks", async (path) => {
    const f = await fixture();
    const snapshot = snapshotMcpExtensions(f.manager);
    const registry = createExtensionRegistry({ runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", primaryHostId: HOST, hosts: [], candidates: snapshot.candidates });
    const extensionId = registry.snapshot.entries[0]!.identity.extensionId;
    const toolName = path === "direct" ? Object.keys(snapshot.directTools)[0]! : "extension_call";
    const tools = path === "direct" ? snapshot.directTools : createExtensionTools(registry);
    const api = provider(toolName, path === "direct" ? {} : { extensionId, input: {} });
    const agent = createChatAgent({ model: api.model, store: f.store, memory: f.companion.memory, attachments: f.attachments, extraTools: tools });
    expect(await drain(agent.stream({ characterId: "taki", message: "inspect native MCP images" }))).toBe("native MCP images received");
    expect(api.requests).toHaveLength(2); expect(f.call).toHaveBeenCalledTimes(1);
    expect(imageUrls(api.requests[1])).toEqual([`data:image/svg+xml;base64,${SVG}`, `data:image/jpeg;base64,${JPEG}`, `data:image/png;base64,${PNG}`]);
    const feedback = JSON.stringify(api.requests[1]?.messages.filter((message) => message.role === "tool"));
    for (const bytes of [SVG, JPEG, PNG]) expect(feedback).not.toContain(bytes);
    for (const kept of ["MCP returned text", "structured-kept", "mcp://original", "original-audio-data", "unknown-content-data", "isError"]) expect(feedback).toContain(kept);
    const rows = createTimelineRepo(f.companion.db).latestAscending("taki", 20);
    for (const bytes of [SVG, JPEG, PNG]) expect(JSON.stringify(rows)).not.toContain(bytes);
    const result = rows.flatMap((row) => row.parts ?? []).find((part) => part.type === "tool-result" && part.toolCallId === "mcp-native-call");
    expect(result?.type === "tool-result" ? result.imageRefs : []).toHaveLength(2);
    await drain(agent.stream({ characterId: "taki", message: "follow up on retained MCP images" }));
    expect(imageUrls(api.requests[2])).toEqual([`data:image/jpeg;base64,${JPEG}`, `data:image/png;base64,${PNG}`]);
    expect(f.call).toHaveBeenCalledTimes(1);
  });

  it("keeps unknown non-image output unchanged and never promotes screenshot-shaped JSON", () => {
    const ordinary = { structuredContent: { screenshot: { mediaType: "image/png", dataBase64: PNG } } };
    expect(projectMcpImageResult(ordinary)).toBe(ordinary);
    const unknown = { content: [{ type: "custom", data: PNG }] };
    expect(projectMcpImageResult(unknown)).toBe(unknown);
    expect(nativeToolImages(ordinary)).toBeUndefined(); expect(nativeToolImages(unknown)).toBeUndefined();
  });

  it("does not repeat a completed remote effect when optional local retention fails", async () => {
    const output = projectMcpImageResult(mixedResult(), { save: () => { throw new Error("storage unavailable"); } });
    expect(nativeToolImages(output)?.images).toHaveLength(3);
    expect(nativeToolImages(output)?.refs).toEqual([]);
    expect(JSON.stringify(output)).not.toContain(JPEG);
    expect(output).toMatchObject({ isError: true, structuredContent: { original: "structured-kept" } });
  });
});
