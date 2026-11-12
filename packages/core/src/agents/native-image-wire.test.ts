import { join } from "node:path";
import { utimesSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { tool } from "ai";
import { z } from "zod";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { brokerReturning, catalogsReturning, fakeHost, registryReturning, testGovernance, testApproval } from "../testing/capability-tool-harness.ts";
import { createAttachmentStore } from "../media/attachment-store.ts";
import { createScreenshotStore } from "../capabilities/screenshot-store.ts";
import { createScreenshotTool } from "../capabilities/screenshot-tool.ts";
import { projectAmbientScreenshotRoute, projectScreenshotRoute } from "../capabilities/native-screenshot-result.ts";
import { snapshotHostCapabilityExtensions } from "../extensions/extension-sources.ts";
import { createExtensionRegistry } from "../extensions/extension-registry.ts";
import { createExtensionTools } from "../extensions/extension-tools.ts";
import { createChatAgent } from "./chat-agent.ts";
import { createConversationStore } from "./conversation-store.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { estimateMessagesTokens, IMAGE_TOKENS } from "../memory/token-estimator.ts";
import { nativeImageSource } from "./native-image-projection.ts";
import { streamingMockModel } from "../testing/mock-language-model.ts";
import { nativeToolImages, type NativeToolImages } from "./native-tool-images.ts";
import type { EffectLifecycleService } from "../harness/effect-lifecycle-service.ts";
import type { EffectLifecycle } from "@taki/shared";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import type { TurnUsageReport } from "./turn-usage-report.ts";

const fixtures: CompanionFixture[] = [];
const databases: Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); for (const fixture of fixtures.splice(0)) fixture.cleanup(); });
const BASE64 = Buffer.from("native-wire-image").toString("base64");
const IMAGE = { mediaType: "image/png" as const, dataBase64: BASE64 };
const SCREENSHOT = { ...IMAGE, width: 64, height: 32 };
type WireRequest = { model: string; messages: { role: string; tool_call_id?: string; tool_calls?: { id: string }[];
  content: string | { type: string; text?: string; image_url?: { url: string } }[] }[] };
type Reply = { text: string } | { name: string; id: string; input: unknown };

function provider(replies: Reply[]) {
  const requests: WireRequest[] = [];
  const api = createOpenAICompatible({ name: "native-wire", baseURL: "https://native-fixture.invalid/v1", fetch: async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)) as WireRequest);
    const reply = replies[requests.length - 1] ?? { text: "complete" };
    const delta = "text" in reply ? { content: reply.text } : { tool_calls: [{ index: 0, id: reply.id, type: "function",
      function: { name: reply.name, arguments: JSON.stringify(reply.input) } }] };
    const chunk = { id: "fixture", object: "chat.completion.chunk", created: 0, model: "primary-native",
      choices: [{ index: 0, delta, finish_reason: "text" in reply ? "stop" : "tool_calls" }],
      usage: { prompt_tokens: 2000, completion_tokens: 5, total_tokens: 2005 } };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
  } });
  return { model: api("primary-native"), requests };
}

function fixture(durable = false) {
  const companion = createCompanionFixture(); fixtures.push(companion);
  const db = durable ? openDatabase({ path: join(companion.root, "restart.db"), migrations: MIGRATIONS }) : companion.db;
  if (durable) databases.push(db);
  const attachments = createAttachmentStore({ attachmentsDir: join(companion.root, "attachments"), ttlMs: () => 60_000 });
  const stores = { attachments, store: createScreenshotStore({ screenshotsDir: join(companion.root, "screenshots") }) };
  const conversation = createConversationStore({ repo: createTimelineRepo(db), attachments, window: { budget: () => 20_000 } });
  return { companion, db, attachments, stores, conversation };
}

function effects(): EffectLifecycleService {
  let ordinal = 0;
  return {
    prepare(input) {
      const effect = { ...input, effectId: `effect-${++ordinal}`, schemaVersion: "effect.v1", state: "intent_committed", version: 0 } as unknown as EffectLifecycle;
      input.onCommitIntent?.(effect); return effect;
    },
    settle: () => ({ duplicate: false, stale: false }), get: () => undefined, unfinished: () => [],
  };
}

async function drain(stream: AsyncIterable<string>) { let text = ""; for await (const part of stream) text += part; return text; }
function imageUrls(request: WireRequest | undefined): string[] {
  return (request?.messages ?? []).flatMap((message) => !Array.isArray(message.content) ? []
    : message.content.flatMap((part) => part.type === "image_url" && part.image_url ? [part.image_url.url] : []));
}

describe("installed compatible SDK native wire", () => {
  it("sends user image pixels to primary with no separate vision configuration or description request", async () => {
    const f = fixture(); const api = provider([{ text: "seen" }]);
    const agent = createChatAgent({ model: api.model, store: f.conversation, memory: f.companion.memory, attachments: f.attachments });
    expect(await drain(agent.stream({ characterId: "taki", message: "look", attachments: [IMAGE] }))).toBe("seen");
    expect(api.requests).toHaveLength(1);
    expect(api.requests[0]?.model).toBe("primary-native");
    expect(imageUrls(api.requests[0])).toEqual([`data:image/png;base64,${BASE64}`]);
    expect(api.requests[0]?.messages.filter((message) => typeof message.content === "string").map((message) => message.content).join("\n")).not.toContain(BASE64);
  });

  it.each(["screenshot", "extension_call"])("projects %s once per next-step request beside its exact result, with one capture and no base64 JSON", async (kind) => {
    const f = fixture(true); const { logger } = createCaptureLogger();
    const capture = vi.fn(async () => ({ ok: true as const, output: SCREENSHOT }));
    const captured = createExtensionRegistry({ runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", primaryHostId: "00000000-0000-4000-8000-000000000001", hosts: [],
      candidates: snapshotHostCapabilityExtensions(catalogsReturning("screenshot"), capture,
        { projectScreenshot: (result) => projectScreenshotRoute(f.stores, result) }) });
    const extensionId = captured.snapshot.entries[0]!.identity.extensionId;
    const screenshot = createScreenshotTool({ registry: registryReturning(fakeHost("screenshot")), catalogs: catalogsReturning("screenshot"),
      broker: { ...brokerReturning({ ok: true, output: SCREENSHOT }), request: capture } as ReturnType<typeof brokerReturning>,
      logger, governance: testGovernance(), approval: testApproval(), ...f.stores });
    const directCapture = vi.spyOn(f.stores.store, "save");
    const api = provider([{ name: kind, id: "capture-call", input: kind === "screenshot" ? {} : { extensionId, input: {} } },
      { name: "probe", id: "probe-call", input: {} }, { text: "screen inspected" }]);
    const extraTools = { ...(kind === "screenshot" ? screenshot : createExtensionTools(captured)),
      probe: tool({ inputSchema: z.object({}), execute: () => ({ ok: true }) }) };
    const agent = createChatAgent({ model: api.model, store: f.conversation, memory: f.companion.memory, attachments: f.attachments, extraTools });
    expect(await drain(agent.stream({ characterId: "taki", message: "inspect screen" }))).toBe("screen inspected");
    expect(api.requests).toHaveLength(3);
    expect(directCapture).toHaveBeenCalledTimes(1);
    for (const request of api.requests.slice(1)) {
      expect(imageUrls(request)).toEqual([`data:image/png;base64,${BASE64}`]);
      expect(request.messages.filter((message) => message.role === "tool" && message.tool_call_id === "capture-call")).toHaveLength(1);
      expect(JSON.stringify(request.messages.filter((message) => message.role === "tool"))).not.toContain(BASE64);
    }
    const rows = createTimelineRepo(f.db).latestAscending("taki", 20);
    const result = rows.flatMap((row) => row.parts ?? []).find((part) => part.type === "tool-result" && part.toolCallId === "capture-call");
    expect(result?.type === "tool-result" ? result.imageRefs : []).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(BASE64);
    const replay = f.conversation.project("taki");
    expect(estimateMessagesTokens(replay.messages)).toBe(replay.measurement.historyTokens);
    expect(replay.messages.some((message) => nativeImageSource(message)?.kind === "tool")).toBe(true);
    f.db.close();
    const restartedDb = openDatabase({ path: join(f.companion.root, "restart.db"), migrations: MIGRATIONS }); databases.push(restartedDb);
    const restartedStore = createConversationStore({ repo: createTimelineRepo(restartedDb), attachments: f.attachments, window: { budget: () => 20_000 } });
    const restartedAgent = createChatAgent({ model: api.model, store: restartedStore, memory: f.companion.memory, attachments: f.attachments, extraTools });
    await drain(restartedAgent.stream({ characterId: "taki", message: "same capture after restart?" }));
    expect(imageUrls(api.requests[3])).toHaveLength(1);
    f.attachments.clear();
    await drain(restartedAgent.stream({ characterId: "taki", message: "after removal?" }));
    expect(imageUrls(api.requests[4])).toEqual([]);
    expect(JSON.stringify(api.requests[4])).toContain("NOT_FOUND");
    expect(directCapture).toHaveBeenCalledTimes(1);
  });

  it("does not promote screenshot-shaped JSON from an arbitrary tool into trusted pixels", async () => {
    const f = fixture(); const api = provider([{ name: "untrusted", id: "json", input: {} }, { text: "metadata only" }]);
    const agent = createChatAgent({ model: api.model, store: f.conversation, memory: f.companion.memory,
      extraTools: { untrusted: tool({ inputSchema: z.object({}), execute: () => SCREENSHOT }) } });
    await drain(agent.stream({ characterId: "taki", message: "read metadata" }));
    expect(imageUrls(api.requests[1])).toEqual([]);
  });

  it("replays retained user pixels on follow-up and rebuilt stores, then reports expiry without another save", async () => {
    const f = fixture(true); const api = provider([{ text: "seen" }, { text: "follow-up" }, { text: "restart" }, { text: "expired" }]);
    const save = vi.spyOn(f.attachments, "save");
    const deps = { model: api.model, memory: f.companion.memory, attachments: f.attachments };
    await drain(createChatAgent({ ...deps, store: f.conversation }).stream({ characterId: "taki", message: "look", attachments: [IMAGE] }));
    await drain(createChatAgent({ ...deps, store: f.conversation }).stream({ characterId: "taki", message: "same image?" }));
    f.db.close();
    const reopenedDb = openDatabase({ path: join(f.companion.root, "restart.db"), migrations: MIGRATIONS }); databases.push(reopenedDb);
    const reopenedAttachments = createAttachmentStore({ attachmentsDir: join(f.companion.root, "attachments"), ttlMs: () => 60_000 });
    const reopened = createConversationStore({ repo: createTimelineRepo(reopenedDb), attachments: reopenedAttachments, window: { budget: () => 20_000 } });
    await drain(createChatAgent({ ...deps, attachments: reopenedAttachments, store: reopened }).stream({ characterId: "taki", message: "after recreation?" }));
    expect(imageUrls(api.requests[1])).toHaveLength(1);
    expect(imageUrls(api.requests[2])).toHaveLength(1);
    const saved = save.mock.results[0]!.value;
    const expired = new Date(Date.now() - 61_000);
    utimesSync(join(f.companion.root, saved.ref), expired, expired);
    await drain(createChatAgent({ ...deps, attachments: reopenedAttachments, store: reopened }).stream({ characterId: "taki", message: "after expiry?" }));
    expect(imageUrls(api.requests[3])).toEqual([]);
    expect(JSON.stringify(api.requests[3])).toContain("EXPIRED");
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("delivers model-invoked ambient screenshot natively, then withdraws stale pixels at the next Effect dispatch and releases them", async () => {
    const f = fixture(); let current = true; let evidence: NativeToolImages | undefined;
    const capture = vi.fn(async () => ({ ok: true, output: SCREENSHOT }));
    const captured = createExtensionRegistry({ runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", primaryHostId: "00000000-0000-4000-8000-000000000001", hosts: [],
      candidates: snapshotHostCapabilityExtensions(catalogsReturning("screenshot-ambient"), capture, {
        projectAmbientScreenshot(result) {
          const output = projectAmbientScreenshotRoute(result, () => current); evidence = nativeToolImages(output); return output;
        },
      }) });
    const extensionId = captured.snapshot.entries[0]!.identity.extensionId;
    const api = provider([{ name: "extension_call", id: "ambient-call", input: { extensionId, input: {} } },
      { name: "probe", id: "probe-call", input: {} }, { text: "continued without stale frame" }]);
    const measured = vi.fn();
    const agent = createChatAgent({ model: api.model, store: f.conversation, memory: f.companion.memory,
      effectLifecycle: effects(), onRequestMeasured: measured,
      extraTools: { ...createExtensionTools(captured), probe: tool({ inputSchema: z.object({}), execute: () => ({ ok: true }) }) } });
    await drain(agent.stream({ characterId: "taki", message: "inspect ambient capture" }, {
      runId: "run", attemptId: "attempt", onCommitModelIntent(effect) { if (effect.effectId === "effect-3") current = false; },
    }));
    expect(imageUrls(api.requests[1])).toHaveLength(1);
    expect(imageUrls(api.requests[2])).toEqual([]);
    expect(JSON.stringify(api.requests[2])).toContain("OBSERVATION_RETIRED");
    expect(JSON.stringify(api.requests.flatMap((request) => request.messages.filter((message) => message.role === "tool")))).not.toContain(BASE64);
    expect(f.attachments.usage().count).toBe(0);
    expect(JSON.stringify(createTimelineRepo(f.companion.db).latestAscending("taki", 20))).not.toContain(BASE64);
    expect(evidence?.images).toHaveLength(0);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(measured.mock.calls.at(-1)?.[1].requestMessageTokens).toBeLessThan(IMAGE_TOKENS);
  });

  it("removes foreground observation invalidated at model intent and measures the actual dispatch while preserving provider totals", async () => {
    const f = fixture(); const api = provider([{ text: "valid foreground answer" }]);
    let current = true; const release = vi.fn(); const reports: TurnUsageReport[] = [];
    const agent = createChatAgent({ model: api.model, store: f.conversation, memory: f.companion.memory,
      effectLifecycle: effects(), useProviderUsage: true, onUsage: (report) => { reports.push(report); },
      acquireNativeImageContext: () => ({ images: [IMAGE], context: "Optional current screen", isCurrent: () => current, release }) });
    expect(await drain(agent.stream({ characterId: "taki", message: "continue my valid request" }, {
      runId: "run", attemptId: "attempt", onCommitModelIntent() { current = false; },
    }))).toBe("valid foreground answer");
    expect(api.requests).toHaveLength(1);
    expect(imageUrls(api.requests[0])).toEqual([]);
    expect(JSON.stringify(api.requests[0])).not.toContain("Optional current screen");
    await vi.waitFor(() => expect(reports).toHaveLength(1));
    expect(reports[0]?.measurement.requestMessageTokens).toBeLessThan(IMAGE_TOKENS);
    expect(reports[0]?.measurement.projectedInputTokens).toBe(2000);
    expect(reports[0]?.inputTokens).toBe(2000);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("replays legacy declared SDK image blocks natively with byte-free feedback and unchanged durable historical rows", async () => {
    const f = fixture(); const repo = createTimelineRepo(f.db);
    repo.append({ characterId: "taki", role: "assistant", content: "[tool-call: old MCP capture]",
      parts: [{ type: "tool-call", toolCallId: "historical-capture", toolName: "old_mcp_capture" }] });
    const output = { type: "content", value: [
      { type: "text", text: "Historical diagnostic status" },
      { type: "file", mediaType: "image/png", data: { type: "data", data: BASE64 } },
      { type: "image-data", mediaType: "image/png", data: BASE64 },
      { type: "file", mediaType: "application/pdf", data: { type: "data", data: "non-image-document" } },
    ] };
    repo.append({ characterId: "taki", role: "tool", content: "[tool-result: old MCP capture]",
      parts: [{ type: "tool-result", toolCallId: "historical-capture", toolName: "old_mcp_capture", output }] });
    const original = JSON.stringify(repo.latestAscending("taki", 20));
    const api = provider([{ text: "historical native pixels" }]);
    await drain(createChatAgent({ model: api.model, store: f.conversation, memory: f.companion.memory, attachments: f.attachments })
      .stream({ characterId: "taki", message: "refer to the old capture" }));
    expect(imageUrls(api.requests[0])).toEqual([`data:image/png;base64,${BASE64}`, `data:image/png;base64,${BASE64}`]);
    const feedback = JSON.stringify(api.requests[0]?.messages.filter((message) => message.role === "tool"));
    expect(feedback).not.toContain(BASE64); expect(feedback).toContain("Historical diagnostic status");
    expect(feedback).toContain("non-image-document");
    expect(JSON.stringify(repo.latestAscending("taki", 20).slice(0, 2))).toBe(original);
    const replay = f.conversation.project("taki");
    expect(replay.measurement.historyTokens).toBe(estimateMessagesTokens(replay.messages));
    expect(replay.measurement.historyTokens).toBeGreaterThan(2 * IMAGE_TOKENS);
  });

  it("prices native retained images before history selection and complete-request pressure", async () => {
    const f = fixture(); const saved = f.attachments.save(BASE64, "image/png");
    const repo = createTimelineRepo(f.companion.db);
    const store = createConversationStore({ repo, attachments: f.attachments, window: { budget: () => 2_000 } });
    store.appendUser("taki", "old image", [{ mediaType: "image/png", ref: saved.ref }]);
    store.appendAssistant("taki", "seen");
    const model = streamingMockModel(["follow-up"]); const measured = vi.fn();
    await drain(createChatAgent({ model, store, memory: f.companion.memory, attachments: f.attachments, onRequestMeasured: measured })
      .stream({ characterId: "taki", message: "question" }));
    expect(measured.mock.calls.some(([, measurement]) => measurement.historyTokens >= IMAGE_TOKENS
      && measurement.requestMessageTokens >= IMAGE_TOKENS)).toBe(true);
    const short = createConversationStore({ repo, attachments: f.attachments, window: { budget: () => 100 } }).project("taki");
    expect(JSON.stringify(short.messages)).not.toContain('"type":"file"');
    expect(estimateMessagesTokens(short.messages)).toBe(short.measurement.historyTokens);
  });
});
