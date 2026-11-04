import { createServer } from "node:http";
import { once } from "node:events";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tool, type ToolSet } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import { CHAT_METHODS, ChatDeltaSchema, ChatErrorSchema, ChatSendResultSchema, ConnectResultSchema,
  JsonRpcSuccessResponseSchema, type TriggerRequest } from "@taki/shared";
import { createChatAgent } from "../../agents/chat-agent.ts";
import { createChatActivityProjection } from "../../agents/chat-activity-projection.ts";
import { createTurnQueue } from "../../agents/turn-queue.ts";
import { createTurnRegistry } from "../../agents/turn-registry.ts";
import { createRunRepo } from "../../db/run-repo.ts";
import { createRunEventRepo } from "../../db/run-event-repo.ts";
import { createEffectRepo } from "../../db/effect-repo.ts";
import { createRunService } from "../../harness/run-service.ts";
import { createEffectLifecycleService } from "../../harness/effect-lifecycle-service.ts";
import { wrapGovernedTool } from "../../governance/governed-tool.ts";
import type { GovernancePolicyService } from "../../governance/governance-policy-service.ts";
import { createDeviceRegistry } from "../../devices/device-registry.ts";
import { createPairedDeviceStore } from "../../devices/paired-device-store.ts";
import { createCompanionFixture } from "../../testing/companion-fixture.ts";
import { createCaptureLogger } from "../../testing/capture-logger.ts";
import { abortRejectingModel, slowStreamingModel } from "../../testing/mock-language-model.ts";
import { notification, openClient, sendConnect, type TestClient } from "../../testing/ws-test-client.ts";
import { createConnectionRegistry } from "../connection-registry.ts";
import { createMethodRegistry } from "../method-registry.ts";
import { createTimelineSubscriptions } from "../timeline-subscriptions.ts";
import { startWsServer } from "../ws-server.ts";
import { connectMethod } from "./connect.ts";
import { chatSendMethod } from "./chat-send.ts";
import { chatCancelMethod } from "./chat-cancel.ts";

type Scenario = "prefill" | "partial" | "success" | "error" | "tool-partial" | "graceful" | "rejecting";
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

function sse(delta: unknown, finishReason: string | null = null): string {
  return `data: ${JSON.stringify({ id: "transport-fixture", object: "chat.completion.chunk", created: 0,
    model: "fixture", choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...(finishReason ? { usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 } } : {}),
  })}\n\n`;
}

async function httpProvider(scenario: Scenario) {
  let requests = 0;
  let markReady!: () => void;
  const ready = new Promise<void>(resolve => { markReady = resolve; });
  const server = createServer((request, response) => {
    requests++;
    request.resume();
    request.on("end", () => {
      if (scenario === "error") {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "Fixture refusal" } }));
      } else {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.flushHeaders();
        if (scenario === "success") response.end(sse({ content: "complete" }, "stop") + "data: [DONE]\n\n");
        else if (scenario === "tool-partial" && requests === 1) {
          response.end(sse({ tool_calls: [{ index: 0, id: "one-call", type: "function",
            function: { name: "probe", arguments: "{}" } }] }, "tool_calls") + "data: [DONE]\n\n");
        } else if (scenario !== "prefill") response.write(sse({ content: "partial" }));
      }
      markReady();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture HTTP listener missing");
  const provider = createOpenAICompatible({ name: "local-transport", baseURL: `http://127.0.0.1:${address.port}/v1` });
  return { model: provider("fixture"), ready, requests: () => requests };
}

function snapshot(request: TriggerRequest) {
  return { schemaVersion: "transport-test.v1", characterId: request.characterId, initiator: request.initiator,
    provenance: request.provenance, deliveryClass: request.deliveryClass, contextMode: request.contextMode,
    modelProvider: "fixture", modelId: "fixture", primaryHostId: "core", hosts: [], extensions: [],
    extensionSnapshotDigest: "a".repeat(64), governance: { policyGeneration: 1, registryRevision: 1, approvalGeneration: 1 },
    memory: { providerId: "legacy-markdown", contractVersion: 1 as const, capabilityDigest: "b".repeat(64), capabilities: {
      providerId: "legacy-markdown", contractVersion: 1 as const, retain: true, recall: true, reflect: false,
      edit: false, invalidate: true, restore: false, conditionalMutation: false, idempotentWrites: false,
      sparseRetrieval: true, vectorRetrieval: "unavailable" as const, derivedMemoryRead: false,
    } }, contextDecision: { sourceCategories: ["character"], tokenAccounting: "unknown" as const },
    replayDecision: { status: "not_captured" as const }, budget: {},
    implementation: { runtimeVersion: "test", schemaVersion: "transport-test.v1" }, sourceRefs: [] };
}

async function boot(scenario: Scenario) {
  const companion = createCompanionFixture();
  cleanup.push(async () => { companion.cleanup(); });
  const http = await httpProvider(scenario);
  const fake = scenario === "graceful" ? slowStreamingModel(["partial", "unread"], 30)
    : scenario === "rejecting" ? abortRejectingModel(["partial", "unread"], 30) : undefined;
  const model = fake ?? http.model;
  const events = createRunEventRepo(companion.db);
  const effects = createEffectLifecycleService(createEffectRepo(companion.db, events), undefined, { eventRepo: events });
  const runs = createRunService({ repo: createRunRepo(companion.db), provider: "fixture", modelId: "fixture",
    snapshot: { async capture(request) { return { snapshot: snapshot(request) }; } } });
  const maintenance = vi.fn(async () => undefined);
  const usage = vi.fn();
  const witness = vi.fn();
  const execute = vi.fn(async () => ({ ok: true, value: "effect complete" }));
  const governed = wrapGovernedTool(tool({ inputSchema: z.object({}), execute }), {
    service: { authorize: () => ({ allowed: true, evaluation: {} }) } as unknown as GovernancePolicyService,
    binding: { identity: { capabilityId: "fixture.probe", ownerHostId: "core" }, cellKey: "probe" },
  });
  const capturedTools: ToolSet = scenario === "tool-partial" ? { probe: governed } : {};
  const agent = createChatAgent({ model, store: companion.conversation, memory: companion.memory,
    effectLifecycle: effects, autoMemory: { onTurnCompleted: maintenance }, onUsage: usage, onPrimaryCommitted: witness,
    attachments: { save: () => ({ ref: `attachments/${"a".repeat(64)}.png`, bytes: 3 }) },
    runContext: () => ({ tools: capturedTools }),
  });
  const { logger } = createCaptureLogger();
  const connections = createConnectionRegistry();
  const registry = createMethodRegistry();
  registry.register(connectMethod({ deviceRegistry: createDeviceRegistry({ store: createPairedDeviceStore(join(companion.root, "devices.json")) }),
    connectionRegistry: connections, trustLoopbackOperator: true, onPairingCode: () => undefined, onAutoTrust: () => undefined }));
  const activity = createChatActivityProjection();
  const controls = { queue: createTurnQueue(), turns: createTurnRegistry(), live: { activity, subscriptions: createTimelineSubscriptions() } };
  registry.register(chatSendMethod(agent, logger, controls, runs));
  registry.register(chatCancelMethod(controls.turns, runs));
  const server = await startWsServer({ host: "127.0.0.1", port: 0, registry, connectionRegistry: connections, logger });
  cleanup.push(async () => { await controls.turns.drain(); await server.close(); activity.dispose(); });
  const client = await openClient(`ws://127.0.0.1:${server.port}`);
  cleanup.push(async () => { client.close(); await client.waitClosed(); });
  sendConnect(client, { deviceId: "550e8400-e29b-41d4-a716-446655440000", deviceName: "transport fixture", role: "operator" });
  const connected = ConnectResultSchema.parse(JsonRpcSuccessResponseSchema.parse((await client.take(1))[0]).result);
  expect(connected.status).toBe("ok");
  return { companion, http, client, runs, activity, events, maintenance, usage, witness, execute,
    requests: () => fake?.doStreamCalls.length ?? http.requests() };
}

async function settle(client: TestClient, input: { runId: string; cancelOnDelta: boolean; cancelSent: boolean }) {
  let cancelSent = input.cancelSent;
  let cancelAcknowledged = !cancelSent;
  let terminal = false;
  const notes: Array<{ method: string; params: unknown }> = [];
  while (!terminal || !cancelAcknowledged) {
    const frame = (await client.take(1))[0];
    const response = JsonRpcSuccessResponseSchema.safeParse(frame);
    if (response.success) {
      expect(response.data.id).toBe("cancel");
      expect(response.data.result).toEqual({ cancelled: true });
      cancelAcknowledged = true;
      continue;
    }
    const note = notification(frame); notes.push(note);
    if (note.method === CHAT_METHODS.delta && input.cancelOnDelta && !cancelSent) {
      expect(ChatDeltaSchema.parse(note.params).delta).toBe("partial");
      client.send({ jsonrpc: "2.0", id: "cancel", method: CHAT_METHODS.cancel, params: { characterId: "taki", runId: input.runId } });
      cancelSent = true; cancelAcknowledged = false;
    }
    terminal ||= note.method === CHAT_METHODS.complete || note.method === CHAT_METHODS.error;
  }
  return notes;
}

describe("approved cancellation policy over real HTTP and WebSocket transports", () => {
  it.each([
    { scenario: "prefill", image: false }, { scenario: "partial", image: false },
    { scenario: "partial", image: true }, { scenario: "tool-partial", image: false },
    { scenario: "graceful", image: false }, { scenario: "rejecting", image: false },
    { scenario: "success", image: false }, { scenario: "success", image: true }, { scenario: "error", image: false },
  ] as const)("$scenario, image=$image: terminal notification, primary witness and one Effect settlement", async ({ scenario, image }) => {
    const f = await boot(scenario);
    const cancelled = scenario !== "success" && scenario !== "error";
    f.client.send({ jsonrpc: "2.0", id: "send", method: CHAT_METHODS.send, params: {
      characterId: "taki", message: "Fixture only", ...(image ? { attachments: [{ mediaType: "image/png", dataBase64: "YWJj" }] } : {}),
    } });
    const ack = ChatSendResultSchema.parse(JsonRpcSuccessResponseSchema.parse((await f.client.take(1))[0]).result);
    if (scenario === "prefill") {
      await f.http.ready;
      f.client.send({ jsonrpc: "2.0", id: "cancel", method: CHAT_METHODS.cancel, params: { characterId: "taki", runId: ack.runId } });
    }
    const notes = await settle(f.client, { runId: ack.runId, cancelSent: scenario === "prefill", cancelOnDelta: cancelled });
    const terminal = notes.filter(note => note.method === CHAT_METHODS.complete || note.method === CHAT_METHODS.error);
    expect(terminal).toHaveLength(1);
    expect(terminal[0]?.method).toBe(scenario === "prefill" || scenario === "error" ? CHAT_METHODS.error : CHAT_METHODS.complete);
    if (scenario === "prefill") expect(ChatErrorSchema.parse(terminal[0]?.params).retracted).toBe(true);
    const outcome = cancelled ? "cancelled" : scenario === "error" ? "failed" : "completed";
    expect(f.runs.status(ack.runId)).toMatchObject({ run: { state: outcome }, receipt: { outcome }, attempts: [{ state: outcome }] });
    expect(f.activity.read("taki")).toMatchObject({ status: "terminal", outcome });
    expect(f.maintenance).toHaveBeenCalledTimes(scenario === "success" ? 1 : 0);
    if (cancelled || scenario === "error") expect(f.usage).not.toHaveBeenCalled();
    const history = f.companion.conversation.history("taki");
    if (scenario === "prefill") {
      expect(history).toEqual([]); expect(f.witness).not.toHaveBeenCalled();
    } else {
      expect(f.witness).toHaveBeenCalledOnce();
      expect(f.witness.mock.calls[0]?.[0].entries.map((entry: { role: string }) => entry.role)).toEqual(history.map(row => row.role));
      expect(history[0]?.role).toBe("user");
      if (scenario === "error") expect(history).toEqual([{ role: "user", content: "Fixture only" }]);
      else expect(history.at(-1)).toEqual({ role: "assistant", content: scenario === "success" ? "complete" : "partial" });
    }
    expect(f.requests()).toBe(scenario === "tool-partial" ? 2 : 1);
    const modelEffects = f.companion.db.prepare("SELECT state,outcome FROM run_effects WHERE run_id=@runId AND kind='model' ORDER BY rowid").all({ runId: ack.runId });
    expect(modelEffects).toEqual(scenario === "tool-partial"
      ? [{ state: "terminal", outcome: "completed" }, { state: "terminal", outcome: "outcome_unknown" }]
      : [{ state: "terminal", outcome: cancelled ? "outcome_unknown" : scenario === "error" ? "failed" : "completed" }]);
    expect(f.events.list(ack.runId).filter(event => event.payload.kind === "model.response.settled")).toHaveLength(f.requests());
    const toolEffects = f.companion.db.prepare("SELECT state,outcome FROM run_effects WHERE run_id=@runId AND kind='tool'").all({ runId: ack.runId });
    expect(toolEffects).toEqual(scenario === "tool-partial" ? [{ state: "terminal", outcome: "completed" }] : []);
    expect(f.execute).toHaveBeenCalledTimes(scenario === "tool-partial" ? 1 : 0);
    if (scenario === "tool-partial") expect(history.filter(row => row.role === "tool")).toHaveLength(1);
  });
});
