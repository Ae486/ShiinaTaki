/**
 * INPUT: synthetic native/playback ports and optional actual-model/Skill/file composition
 * OUTPUT: real accepted Run, queue and shared Delivery owners with an isolated proposal workspace
 * POS: core/testing — synthetic browser/native ports; default model directly writes fixture artifacts
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { vi } from "vitest";
import { z } from "zod";
import { tool, type LanguageModel } from "ai";
import type { BrowserPlaybackView, CoWatchingAnalysis, CoWatchingStart } from "@taki/shared";
import { createChatAgent } from "../agents/chat-agent.ts";
import { createCoWatchingCatalog } from "../co-watching/analysis-catalog.ts";
import { createCoWatchingRuntime } from "../co-watching/runtime.ts";
import type { CoWatchingNative } from "../co-watching/native-result.ts";
import { createCaptureLogger } from "./capture-logger.ts";
import { preparedPublicationFixture } from "./prepared-publication-fixture.ts";
import { createSubagentRepo } from "../db/subagent-repo.ts";
import { createSubagentInputRepo } from "../db/subagent-input-repo.ts";
import { createRunMessageRepo } from "../db/run-message-repo.ts";
import { createSubagentService } from "../harness/subagent-service.ts";
import { streamingMockModel } from "./mock-language-model.ts";
import { coWatchingToolFixture } from "./co-watching-tool-fixture.ts";
import { DEFAULT_CONTEXT_TOKENS, DEFAULT_HISTORY_RATIO } from "../config/context-config.ts";
import { createUtilitySlot } from "../memory/utility-slot.ts";

export function coWatchingInput() {
  const analysis: CoWatchingAnalysis = { analysisId: randomUUID(), revision: 1, title: "Fixture video",
    media: { kind: "bilibili", bvid: "BV1UEaq6qEZt", cid: "42265479965", page: 1 }, serverId: "native-fixture",
    native: { serviceInstanceId: randomUUID(), requestId: randomUUID(), jobId: randomUUID(), sha256: "a".repeat(64) } };
  const identity = { service_instance_id: analysis.native.serviceInstanceId, request_id: analysis.native.requestId, job_id: analysis.native.jobId };
  const result = { schema_version: "bilinote.media-result.v1", identity, source: { binding: "exact", resolved: analysis.media },
    duration: { seconds: 300, platform_seconds: 300 }, analysis: { format: "media_v1", markdown: "Grounded test analysis",
      moments: [{ moment_id: "first", at_seconds: 10, end_seconds: 20, content: "First fact" },
        { moment_id: "second", at_seconds: 30, end_seconds: 40, content: "Second fact" }] as CoWatchingNative["analysis"]["moments"] } };
  const raw = { structuredContent: { ok: true, complete: true, identity, sha256: analysis.native.sha256, result } };
  return { analysis, raw };
}

export async function coWatchingFixture(options: { fresh?: boolean;
  preparation?: { model: LanguageModel; modelId: string; provider?: string;
    contextTokens?: number; historyRatio?: number; requestEnvelopeReserve?: number; useProviderUsage?: boolean };
} = {}) {
  const hooks: { yieldToPrimary?: (key: string) => void } = {};
  const base = await preparedPublicationFixture({ linkedSubagents: true, onPrimaryReserved: (key) => hooks.yieldToPrimary?.(key),
    ...(options.preparation ? { modelId: options.preparation.modelId, provider: options.preparation.provider,
      expiresAt: new Date(Date.now() + 600_000).toISOString() } : {}) });
  const actualTools = options.preparation ? coWatchingToolFixture(base) : undefined;
  const contextTokens = options.preparation?.contextTokens ?? DEFAULT_CONTEXT_TOKENS;
  const historyRatio = options.preparation?.historyRatio ?? DEFAULT_HISTORY_RATIO;
  const historyTokens = Math.floor(contextTokens * historyRatio);
  const contextPolicy = { contextTokens, historyRatio, historyTokens,
    requestEnvelopeReserve: options.preparation?.requestEnvelopeReserve ?? contextTokens - historyTokens,
    useProviderUsage: options.preparation?.useProviderUsage ?? false, utilityRoute: "main_model_fallback" };
  const utility = options.preparation
    ? createUtilitySlot({ mainModel: options.preparation.model, logger: createCaptureLogger().logger }) : undefined;
  const { analysis, raw } = coWatchingInput();
  const flags = { source: true, native: true, skill: true };
  const playback: BrowserPlaybackView = { sourceRef: randomUUID(), hostId: randomUUID(), connectionGeneration: 1, catalogGeneration: 1,
    attachmentId: randomUUID(), attachmentGeneration: 1, sequence: 1, receivedAt: new Date().toISOString(),
    freshUntil: new Date(Date.now() + (options.preparation ? 600_000 : 60_000)).toISOString(), source: { tabId: 1, frameId: 0, documentId: randomUUID(), playerId: randomUUID(), media: { ...analysis.media } },
    sample: { state: "paused", positionSeconds: 0, durationSeconds: 300, playbackRate: 1, visible: true, pictureInPicture: false } };
  const catalog = createCoWatchingCatalog(join(base.workspaceRoot, "catalog.json"));
  if (!options.fresh) catalog.register({ analysisId: analysis.analysisId, title: analysis.title, media: analysis.media,
    serverId: analysis.serverId, native: analysis.native, expectedRevision: 0 });
  const readNative = vi.fn(async () => raw);
  const receipt = () => ({ structuredContent: { task_id: raw.structuredContent.identity.job_id,
    identity: raw.structuredContent.identity, disposition: "running" } });
  const submitNative = vi.fn(async (input: unknown): Promise<unknown> => {
    raw.structuredContent.identity.request_id = (input as { client_request_id: string }).client_request_id;
    return receipt();
  });
  const lookupNative = vi.fn(async (input: unknown) => { void input; return receipt(); });
  const statusNative = vi.fn(async () => ({ structuredContent: { identity: raw.structuredContent.identity,
    state: "succeeded", result: { availability: "available", artifact: { sha256: analysis.native.sha256 } } } }));
  const capture = base.capture.getMockImplementation()!;
  base.capture.mockImplementation(async (request) => {
    const captured = await capture(request);
    return { ...captured, snapshot: { ...captured.snapshot, hosts: [{ hostId: playback.hostId,
      available: true, connectionGeneration: 1, catalogGeneration: 1 }] }, context: { ...captured.context,
      tools: { native_result: tool({ inputSchema: z.object({}).passthrough(), execute: readNative }),
        native_submit: tool({ inputSchema: z.object({}).passthrough(), execute: submitNative }),
        native_lookup: tool({ inputSchema: z.object({}).passthrough(), execute: lookupNative }),
        native_status: tool({ inputSchema: z.object({}).passthrough(), execute: statusNative }) } } };
  });
  const plans: Array<{ candidateRef: string; momentId: string; text: string }> = [
    { candidateRef: "one", momentId: "first", text: "First response" }, { candidateRef: "two", momentId: "second", text: "Second response" }];
  const generate = vi.fn(async (control: string, _signal?: AbortSignal) => {
    void _signal;
    const match = /to (co-watching\/[^\s]+\.json) with revision ([0-9a-f-]+)/.exec(control)!;
    await writeFile(join(base.workspaceRoot, match[1]!), JSON.stringify({ revision: match[2], candidates: plans }), "utf8");
  });
  const model = streamingMockModel(["private"]);
  const stream = model.doStream.bind(model);
  model.doStream = async (options) => {
    const control = options.prompt.flatMap((message) => typeof message.content === "string" ? [message.content]
      : message.content.flatMap((part) => part.type === "text" ? [part.text] : [])).join("\n");
    await generate(control, options.abortSignal);
    return stream(options);
  };
  const realAgent = createChatAgent({ model: options.preparation?.model ?? model,
    store: base.store, memory: base.memory, effectLifecycle: base.effects, maxSteps: options.preparation ? 6 : undefined,
    ...(options.preparation ? { contextWindowTokens: () => contextTokens,
      requestEnvelopeReserve: () => contextPolicy.requestEnvelopeReserve, useProviderUsage: contextPolicy.useProviderUsage } : {}),
    ...(actualTools ? { coreTools: actualTools.coreTools, extraTools: actualTools.extraTools,
      coreToolGovernance: actualTools.coreToolGovernance, instructionsExtra: actualTools.instructionsExtra } : {}) });
  const agent: typeof realAgent = { async *stream(params, turn) {
    try { yield* realAgent.stream(params, turn); }
    catch (error) { errors.push(options.preparation ? "CO_WATCHING_ACCEPTANCE_AGENT_FAILED" : String(error)); throw error; }
  } };
  const onChanged = vi.fn<(characterId: string) => void>();
  const children = createSubagentRepo(base.db); const inputs = createSubagentInputRepo(base.db); const messages = createRunMessageRepo(base.db);
  const errors: string[] = [];
  const subagents = createSubagentService({ ...base, agent, children, inputs, messages, executions: base.executions!,
    ...(utility ? { utility } : {}), historyBudget: () => options.preparation ? historyTokens : 8000,
    changed: (characterId) => onChanged(characterId), reportError: (code) => { errors.push(code); } });
  const createRuntime = () => createCoWatchingRuntime({ ...base, catalog, agent, subagents, workspaceRoot: base.workspaceRoot,
    logger: createCaptureLogger().logger, targetReady: () => true, onChanged,
    resultTool: () => ({ toolKey: "native_result", isCurrent: () => flags.native }),
    analysisTools: () => [{ serverId: analysis.serverId, submit: "native_submit", lookup: "native_lookup",
      status: "native_status", result: "native_result", isCurrent: () => flags.native }],
    skills: actualTools?.skills ?? { renderList: () => "", load: () => ({ ok: true, content: "fixture", contentRevision: "r1", files: [] }),
      describe: () => flags.skill ? { name: "taki-co-watching", contentRevision: "r1" } : undefined },
    sources: { report: () => ({ accepted: false, reason: "disabled" }), close() {}, refresh() {}, retireConnection() {},
      read: () => ({ enabled: flags.source, sources: flags.source ? [structuredClone(playback)] : [] }),
      resolve: () => flags.source ? structuredClone(playback) : undefined },
  });
  let runtime = createRuntime();
  hooks.yieldToPrimary = runtime.yieldToPrimary;
  const input: CoWatchingStart = { characterId: "taki", requestId: randomUUID(), sourceRef: playback.sourceRef, analysisId: analysis.analysisId, lifetimeMinutes: 5 };
  const interactive = { connection: { state: { status: "authenticated" as const, deviceId: "fixture", role: "operator" as const, capabilities: [] } } };
  return { ...base, subagents, children, inputs, messages, errors, contextPolicy, skillRevision: actualTools?.skillRevision,
    get runtime() { return runtime; }, catalog, analysis, raw, flags, playback, readNative, submitNative, lookupNative, statusNative, generate, plans, onChanged, input, interactive,
    restart: async () => { await runtime.close(); runtime = createRuntime(); hooks.yieldToPrimary = runtime.yieldToPrimary; },
    start: () => runtime.start(input, interactive), session: () => runtime.read("taki").session!,
    cleanup: async () => { await runtime.close(); await subagents.close(); await utility?.stop(); base.cleanup(); } };
}
