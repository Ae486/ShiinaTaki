import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import { ChatSendResultSchema, JsonRpcSuccessResponseSchema, type MediaAnalysisStart } from "@taki/shared";
import { createChatAgent, type ChatAgent, type TurnContext } from "../agents/chat-agent.ts";
import { createExtensionRegistry } from "../extensions/extension-registry.ts";
import { createExtensionTools } from "../extensions/extension-tools.ts";
import { stableSubjectId } from "../mcp/mcp-tool-identity.ts";
import { preparedPublicationFixture } from "../testing/prepared-publication-fixture.ts";
import { coWatchingInput } from "../testing/co-watching-fixture.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { createCoWatchingCatalog } from "./analysis-catalog.ts";
import { createInitiativeCompletionSource } from "../db/initiative-completion-source.ts";
import { registerPatternPrimarySource, validatePatternActor } from "../initiative/patterns/pattern-source.ts";
import { createManageMediaRecommendationsTool, MEDIA_RECOMMENDATIONS_SKILL } from "./manage-media-recommendations-tool.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";
import { chatSendMethod } from "../server/methods/chat-send.ts";
import { createMethodRegistry } from "../server/method-registry.ts";
import type { RunExecutionContext } from "../harness/run-service.ts";
import { createMediaAnalysisRuntime, type MediaAnalysisRuntime } from "./media-analysis-runtime.ts";

const fixtures: Array<{ cleanup(): Promise<void> }> = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.cleanup(); vi.useRealTimers(); });

async function fixture(options: { existing?: boolean } = {}) {
  vi.useFakeTimers();
  const hooks: { runtime?: MediaAnalysisRuntime } = {};
  const base = await preparedPublicationFixture({ onPrimaryReserved: (key) => hooks.runtime?.yieldToPrimary(key) });
  const { analysis, raw } = coWatchingInput();
  const ownerHostId = randomUUID();
  const flags = Object.assign(base.flags, { native: true });
  const catalog = createCoWatchingCatalog(join(base.workspaceRoot, "media-catalog.json"));
  if (options.existing) catalog.register({ analysisId: analysis.analysisId, title: analysis.title, media: analysis.media,
    serverId: analysis.serverId, native: analysis.native, expectedRevision: 0 });
  const access = { schema_version: "bilinote.media-access.v1", service_instance_id: analysis.native.serviceInstanceId,
    source: { platform: "bilibili", bvid: analysis.media.bvid, cid: analysis.media.cid, page: analysis.media.page,
      canonical_url: `https://www.bilibili.com/video/${analysis.media.bvid}?p=${analysis.media.page}` },
    title: "Existing exact video", duration_seconds: 300,
    access: { kind: "video_range", byte_length: 1024, checked_at: Date.now() } };
  const probe = vi.fn(async () => ({ structuredContent: access }));
  const receipt = () => ({ structuredContent: { identity: raw.structuredContent.identity,
    task_id: raw.structuredContent.identity.job_id, disposition: "running" } });
  const submit = vi.fn(async (input: unknown, _options?: unknown): Promise<unknown> => {
    void _options;
    raw.structuredContent.identity.request_id = (input as { client_request_id: string }).client_request_id;
    return receipt();
  });
  const lookup = vi.fn(async (_input: unknown): Promise<unknown> => { void _input; return receipt(); });
  const status = vi.fn(async (): Promise<unknown> => ({ structuredContent: { identity: raw.structuredContent.identity,
    state: "succeeded", result: { availability: "available", artifact: { sha256: analysis.native.sha256 } } } }));
  const read = vi.fn(async () => raw);
  const capture = base.capture.getMockImplementation()!;
  base.capture.mockImplementation(async (request) => {
    const captured = await capture(request);
    const registry = createExtensionRegistry({ runId: randomUUID(), primaryHostId: ownerHostId, hosts: [], candidates: [{
      identity: { kind: "mcp-tool", ownerHostId, subjectId: stableSubjectId(analysis.serverId, "bilinote_probe_media"),
        subjectRevision: "r1", connectionGeneration: 1, catalogGeneration: 1 },
      displayName: "bilinote_probe_media", summary: "Probe exact media access", callMode: "mcp-tool",
      isCurrent: () => flags.native, call: probe,
    }] });
    return { ...captured, context: { ...captured.context, tools: { ...createExtensionTools(registry),
      native_submit: tool({ inputSchema: z.unknown(), execute: submit }),
      native_lookup: tool({ inputSchema: z.unknown(), execute: lookup }),
      native_status: tool({ inputSchema: z.unknown(), execute: status }),
      native_result: tool({ inputSchema: z.unknown(), execute: read }),
    } } };
  });
  const generate = vi.fn(async (control: string, turn?: TurnContext) => {
    expect(turn?.runContext).toBe(base.runs.context(turn!.runId!));
    expect(turn?.allowedToolNames).toEqual(["read_file", "get_current_time"]);
    turn?.onSettledText?.(control.includes("failed with code") ? "这次视频分析失败，原请求已保留。" : "这是原始分析中的关键结论。");
  });
  const agent: ChatAgent = { async *stream(params, turn) { await generate(params.message, turn); yield "Do not publish this intermediate delta"; } };
  const runtime = createMediaAnalysisRuntime({ ...base, catalog, ownerHostId, agent, logger: createCaptureLogger().logger,
    primarySource: { register: (source) => registerPatternPrimarySource(base.db, source),
      isCurrent: (source) => validatePatternActor(base.db, source.characterId, { kind: "agent", runId: source.runId,
        attemptId: source.attemptId, toolCallId: "recommendation-test" }) === null },
    analysisTools: () => [{ serverId: analysis.serverId, submit: "native_submit", lookup: "native_lookup",
      status: "native_status", result: "native_result", isCurrent: () => flags.native }], targetReady: () => true });
  hooks.runtime = runtime;
  const request: MediaAnalysisStart = { characterId: "taki", requestId: randomUUID(),
    videoUrl: access.source.canonical_url, instruction: "分析这个视频的观点", lifetimeMinutes: 5 };
  const interactive = { connection: { state: { status: "authenticated" as const, role: "operator" as const,
    deviceId: "fixture", capabilities: [] } } };
  const f = { ...base, runtime, catalog, flags, analysis, raw, access, request, interactive, probe, submit, lookup, status, read, generate,
    start: () => runtime.analyze(request, interactive), job: () => runtime.read("taki")!,
    async primary(characterId = request.characterId) {
      const messageId = randomUUID();
      const source = await base.runs.admit({ triggerRequestId: randomUUID(), idempotencyKey: messageId,
        characterId, initiator: "primary", deliveryClass: "class_a", contextMode: "primary",
        provenance: { provider: "chat", triggerRequestId: messageId } });
      base.runs.start(source.run.runId, source.attempt.attemptId);
      const entry = base.store.appendUser(characterId, "Select recommendations");
      if (characterId === request.characterId) request.requestId = entry.id;
      return { runId: source.run.runId, attemptId: source.attempt.attemptId, interactive,
        userTimelineSeq: entry.seq, userTimelineId: entry.id };
    },
    preparation: () => runtime.preparation("taki")!,
    cleanup: async () => { await runtime.close(); base.cleanup(); } };
  fixtures.push(f);
  return f;
}

it("analyzes without playback, releases the foreground lane while native work waits and publishes exactly once", async () => {
  const f = await fixture();
  const foreground = f.queue.reservePrimary("taki"); const release = await foreground.acquire();
  const accepted = await f.start();
  expect(accepted).toMatchObject({ accepted: true, job: { status: "accepted" } });
  expect(f.probe).not.toHaveBeenCalled();
  release(); f.runtime.released();
  await vi.waitFor(() => expect(f.submit).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(f.queue.isBusy("taki")).toBe(false));
  const runId = f.job().runId!; const attempt = f.runs.status(runId).run.activeAttemptId;
  expect(f.runs.status(runId).run.state).toBe("waiting");
  expect(f.generate).not.toHaveBeenCalled();
  const primary = f.queue.reservePrimary("taki"); const releasePrimary = await primary.acquire();
  await vi.advanceTimersByTimeAsync(3_000);
  expect(f.status).not.toHaveBeenCalled();
  releasePrimary(); f.runtime.released();
  await vi.waitFor(() => expect(f.job().status).toBe("completed"));
  expect(f.runs.status(runId).run.activeAttemptId).toBe(attempt);
  expect(f.runs.status(runId).run.state).toBe("completed");
  expect(f.generate).toHaveBeenCalledTimes(1); expect(f.send).toHaveBeenCalledTimes(1);
  expect(f.store.history("taki").map((entry) => entry.content)).toEqual(["这是原始分析中的关键结论。"]);
  f.runtime.released(); await vi.advanceTimersByTimeAsync(30_000);
  expect(await f.start()).toMatchObject({ accepted: true, job: { status: "completed", runId } });
  expect(f.submit).toHaveBeenCalledTimes(1); expect(f.generate).toHaveBeenCalledTimes(1); expect(f.send).toHaveBeenCalledTimes(1);
});

it("reuses the same catalog result as Co-Watching, including moments with unknown ends", async () => {
  const f = await fixture({ existing: true });
  for (const moment of f.raw.structuredContent.result.analysis.moments) moment.end_seconds = null;
  await f.start();
  await vi.waitFor(() => expect(f.job().status).toBe("completed"));
  expect(f.probe).toHaveBeenCalledTimes(1); expect(f.read).toHaveBeenCalledTimes(1);
  expect(f.submit).not.toHaveBeenCalled(); expect(f.lookup).not.toHaveBeenCalled(); expect(f.status).not.toHaveBeenCalled();
  expect(f.job().analysisId).toBe(f.analysis.analysisId); expect(f.generate).toHaveBeenCalledTimes(1);
});

it("reconciles a lost native submission response under the original persisted UUID", async () => {
  const f = await fixture(); const original = f.submit.getMockImplementation()!;
  f.submit.mockImplementationOnce(async (input) => {
    await original(input);
    return { isError: true, structuredContent: { ok: false, error: { code: "submission_outcome_unknown" } } };
  });
  await f.start(); await vi.waitFor(() => expect(f.submit).toHaveBeenCalledTimes(1));
  const requestId = (f.submit.mock.calls[0]![0] as { client_request_id: string }).client_request_id;
  expect(f.catalog.request(f.job().analysisId!)?.requestId).toBe(requestId);
  await vi.advanceTimersByTimeAsync(3_000);
  await vi.waitFor(() => expect(f.lookup).toHaveBeenCalledTimes(1));
  expect(f.lookup.mock.calls[0]![0]).toEqual({ client_request_id: requestId });
  await vi.advanceTimersByTimeAsync(3_000);
  await vi.waitFor(() => expect(f.job().status).toBe("completed"));
  expect(f.submit).toHaveBeenCalledTimes(1);
});

it("reports a retained unknown old request without creating a replacement key or detailed job", async () => {
  const f = await fixture();
  const original = f.catalog.reserve({ media: f.analysis.media, serverId: f.analysis.serverId }).request;
  f.lookup.mockRejectedValue(new Error("request_not_found"));
  await f.start(); await vi.waitFor(() => expect(f.lookup).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(60_000);
  await vi.waitFor(() => expect(f.job()).toMatchObject({ status: "failed", reason: "analysis_unknown" }));
  expect(f.submit).not.toHaveBeenCalled(); expect(f.generate).toHaveBeenCalledTimes(1); expect(f.send).toHaveBeenCalledTimes(1);
  expect(f.lookup.mock.calls.every(([input]) => (input as { client_request_id: string }).client_request_id === original.requestId)).toBe(true);
  expect(f.catalog.request(original.analysisId)).toEqual(original);
  expect(f.runs.status(f.job().runId!).run.state).toBe("outcome_unknown");
});

it("returns a native failed outcome through the ordinary Agent and normal delivery without reanalysis", async () => {
  const f = await fixture();
  f.status.mockImplementation(async () => ({ structuredContent: { identity: f.raw.structuredContent.identity,
    state: "failed", result: { availability: "unavailable", artifact: null } } }));
  await f.start(); await vi.waitFor(() => expect(f.submit).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(3_000);
  await vi.waitFor(() => expect(f.job()).toMatchObject({ status: "failed", reason: "analysis_failed" }));
  expect(f.generate.mock.calls[0]![0]).toContain("failed with code analysis_failed");
  expect(f.store.history("taki").at(-1)?.content).toContain("失败");
  expect(f.submit).toHaveBeenCalledTimes(1); expect(f.catalog.list()).toEqual([]);
});

it("fails an inaccessible URL before reservation and still returns a bounded terminal answer", async () => {
  const f = await fixture();
  f.probe.mockRejectedValue(new Error("native video access refused"));
  await f.start(); await vi.waitFor(() => expect(f.job()).toMatchObject({ status: "failed", reason: "probe_failed" }));
  expect(f.submit).not.toHaveBeenCalled(); expect(f.job().analysisId).toBeNull();
  expect(f.generate).toHaveBeenCalledTimes(1); expect(f.send).toHaveBeenCalledTimes(1);
});

it("cancels waiting analysis without aborting an unrelated foreground turn, including repeated close/cancel", async () => {
  const f = await fixture(); await f.start(); await vi.waitFor(() => expect(f.submit).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(f.queue.isBusy("taki")).toBe(false));
  const primary = f.queue.reservePrimary("taki"); const release = await primary.acquire();
  const controller = f.turns.begin("taki", undefined, "foreground");
  expect(f.runtime.cancel("taki", f.request.requestId)).toMatchObject({ accepted: true, job: { status: "cancelled" } });
  expect(controller.signal.aborted).toBe(false);
  f.turns.end("taki", controller); release(); f.runtime.released();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(f.status).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled();
  await f.runtime.close();
  expect(f.runtime.cancel("taki", f.request.requestId)).toMatchObject({ accepted: true, job: { status: "cancelled" } });
  expect(f.runs.status(f.job().runId!).run.state).toBe("cancelled");
});

it("yields an in-flight native submission to foreground and resumes by lookup instead of replay", async () => {
  const f = await fixture();
  f.submit.mockImplementation((input, options) => {
    f.raw.structuredContent.identity.request_id = (input as { client_request_id: string }).client_request_id;
    const signal = (options as { abortSignal: AbortSignal }).abortSignal;
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("OUTCOME_UNKNOWN")), { once: true }));
  });
  await f.start(); await vi.waitFor(() => expect(f.submit).toHaveBeenCalledTimes(1));
  const primary = f.queue.reservePrimary("taki"); const release = await primary.acquire();
  expect(f.runs.status(f.job().runId!).run.state).toBe("waiting");
  expect(f.generate).not.toHaveBeenCalled(); release(); f.runtime.released();
  await vi.waitFor(() => expect(f.lookup).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(3_000);
  await vi.waitFor(() => expect(f.job().status).toBe("completed"));
  expect(f.submit).toHaveBeenCalledTimes(1);
});

it("treats uncertain delivery as committed and never emits the same analysis answer again", async () => {
  const f = await fixture({ existing: true }); f.flags.transport = "unknown";
  await f.start(); await vi.waitFor(() => expect(f.job().status).toBe("completed"));
  f.runtime.released(); await vi.advanceTimersByTimeAsync(30_000);
  expect(f.generate).toHaveBeenCalledTimes(1); expect(f.send).toHaveBeenCalledTimes(1);
  expect(f.db.prepare("SELECT state FROM run_deliveries").all()).toEqual([{ state: "unknown" }]);
});

it("rejects unsupported short links before admission and canonicalizes exact native-supported video parts", async () => {
  const f = await fixture(); const before = f.capture.mock.calls.length;
  expect(await f.runtime.analyze({ ...f.request, videoUrl: "https://b23.tv/opaque" }, f.interactive))
    .toEqual({ accepted: false, reason: "invalid_request" });
  expect(f.capture).toHaveBeenCalledTimes(before); expect(f.probe).not.toHaveBeenCalled();
  const release = await f.queue.reservePrimary("taki").acquire();
  expect(await f.runtime.analyze({ ...f.request, videoUrl: `https://bilibili.com/video/${f.analysis.media.bvid}/?p=1&share_source=test` }, f.interactive))
    .toMatchObject({ accepted: true, job: { videoUrl: f.request.videoUrl } });
  release(); f.runtime.cancel("taki", f.request.requestId);
});

it("keeps one final Agent generation when foreground reserves the lane before result publication", async () => {
  const f = await fixture({ existing: true });
  let finish: () => void = () => undefined;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  f.generate.mockImplementationOnce(async (_control, turn) => {
    turn?.signal?.addEventListener("abort", finish, { once: true });
    await pending;
    expect(turn?.signal?.aborted).toBe(false);
    turn?.onSettledText?.("已完成这次分析回答。");
  });
  await f.start(); await vi.waitFor(() => expect(f.generate).toHaveBeenCalledTimes(1));
  const primary = f.queue.reservePrimary("taki"); const acquisition = primary.acquire();
  expect(f.job().status).toBe("summarizing");
  finish(); const release = await acquisition;
  expect(f.send).not.toHaveBeenCalled();
  expect(f.job().status).toBe("delivering");
  release(); f.runtime.released();
  await vi.waitFor(() => expect(f.job().status).toBe("completed"));
  expect(f.generate).toHaveBeenCalledTimes(1); expect(f.send).toHaveBeenCalledTimes(1);
});

it("does not consume or regenerate an old result on a replacement native service instance", async () => {
  const f = await fixture({ existing: true }); f.access.service_instance_id = randomUUID();
  await f.start(); await vi.waitFor(() => expect(f.job()).toMatchObject({ status: "failed", reason: "analysis_mismatch" }));
  expect(f.read).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled(); expect(f.lookup).not.toHaveBeenCalled();
  expect(f.generate).toHaveBeenCalledTimes(1);
});

it("retains selected native analysis after the primary conversation ends without any summary or Timeline publication", async () => {
  const f = await fixture({ existing: true }); const authority = await f.primary();
  const release = await f.queue.reservePrimary("taki").acquire();
  const accepted = await f.runtime.prepare({ characterId: "taki", requestId: f.request.requestId,
    videoUrls: [f.request.videoUrl], lifetimeMinutes: 5 }, authority);
  expect(accepted).toMatchObject({ accepted: true, batch: { status: "preparing" } });
  const job = f.preparation().jobs[0]!;
  expect(f.runs.context(job.runId!)?.acceptedWork?.publication).toBeUndefined();
  expect(f.runs.status(job.runId!).run.provenance.parentRunId).toBe(authority.runId);
  expect(f.runs.status(job.runId!).run.deliveryClass).toBe("internal");
  f.runs.settle(authority.runId, authority.attemptId, "completed");
  release(); f.runtime.released();
  await vi.waitFor(() => expect(f.preparation().status).toBe("completed"));
  expect(f.preparation().jobs[0]?.analysisId).toBe(f.analysis.analysisId);
  expect(f.runs.status(job.runId!).run.state).toBe("completed");
  expect(f.runtime.read("taki")).toBeNull(); expect(f.generate).not.toHaveBeenCalled();
  expect(f.send).not.toHaveBeenCalled(); expect(f.store.history("taki").filter((entry) => entry.role === "assistant")).toEqual([]);
  expect(f.db.prepare("SELECT COUNT(*) AS count FROM run_deliveries").get()).toEqual({ count: 0 });
  expect(createInitiativeCompletionSource(f.db).read("taki")).toEqual([]);
  expect(f.catalog.get(f.analysis.analysisId)).toBeDefined();
});

it("bounds a selected batch before admission and refuses fabricated or stale primary sources", async () => {
  const f = await fixture(); const authority = await f.primary();
  const request = { characterId: "taki", requestId: f.request.requestId, videoUrls: [f.request.videoUrl], lifetimeMinutes: 5 };
  const captures = f.capture.mock.calls.length;
  for (const videoUrls of [[], Array.from({ length: 4 }, () => f.request.videoUrl), [f.request.videoUrl, f.request.videoUrl + "&share=1"]]) {
    expect(await f.runtime.prepare({ ...request, videoUrls }, authority)).toEqual({ accepted: false, reason: "invalid_request" });
  }
  for (const candidate of [{ ...authority, runId: randomUUID() }, { ...authority, attemptId: randomUUID() },
    { ...authority, runId: f.root.run.runId, attemptId: f.root.attempt.attemptId }]) {
    expect(await f.runtime.prepare(request, candidate)).toEqual({ accepted: false, reason: "source_unavailable" });
  }
  expect(await f.runtime.prepare({ ...request, requestId: randomUUID() }, authority)).toEqual({ accepted: false, reason: "source_unavailable" });
  f.runs.settle(authority.runId, authority.attemptId, "completed");
  expect(await f.runtime.prepare(request, authority)).toEqual({ accepted: false, reason: "source_unavailable" });
  expect(f.capture).toHaveBeenCalledTimes(captures); expect(f.probe).not.toHaveBeenCalled();
});

it("prepares three exact parts sequentially and never reuses the other part's result", async () => {
  const f = await fixture({ existing: true }); const authority = await f.primary();
  const originalRaw = structuredClone(f.raw); const completed: number[] = [];
  f.probe.mockImplementation(async () => {
    const part = completed.length + 1;
    f.raw.structuredContent.identity = { ...originalRaw.structuredContent.identity, job_id: randomUUID() };
    f.raw.structuredContent.result.source.resolved = { ...f.analysis.media, page: part, cid: `${Number(f.analysis.media.cid) + part - 1}` };
    if (part === 1) f.raw.structuredContent.identity = { ...originalRaw.structuredContent.identity };
    f.raw.structuredContent.result.identity = f.raw.structuredContent.identity;
    return { structuredContent: { ...f.access, source: { ...f.access.source, page: part,
      cid: f.raw.structuredContent.result.source.resolved.cid, canonical_url: `https://www.bilibili.com/video/${f.analysis.media.bvid}?p=${part}` } } };
  });
  f.read.mockImplementation(async () => { completed.push(f.raw.structuredContent.result.source.resolved.page); return f.raw; });
  await f.runtime.prepare({ characterId: "taki", requestId: f.request.requestId, lifetimeMinutes: 5,
    videoUrls: [1, 2, 3].map((part) => `https://www.bilibili.com/video/${f.analysis.media.bvid}?p=${part}`) }, authority);
  await vi.waitFor(() => expect(f.submit).toHaveBeenCalledTimes(1));
  expect(completed).toEqual([1]); expect(f.probe).toHaveBeenCalledTimes(2);
  expect(f.preparation().jobs[2]?.status).toBe("accepted");
  await vi.advanceTimersByTimeAsync(3_000);
  await vi.waitFor(() => expect(f.submit).toHaveBeenCalledTimes(2));
  expect(completed).toEqual([1, 2]);
  await vi.advanceTimersByTimeAsync(3_000);
  await vi.waitFor(() => expect(f.preparation().status).toBe("completed"));
  expect(completed).toEqual([1, 2, 3]); expect(f.catalog.list()).toHaveLength(3);
  expect(new Set(f.preparation().jobs.map((job) => job.analysisId)).size).toBe(3);
  expect(f.generate).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
});

it("reconciles uncertain selected submission under the original UUID without duplicate native work or failure speech", async () => {
  const f = await fixture(); const authority = await f.primary(); const original = f.submit.getMockImplementation()!;
  f.submit.mockImplementationOnce(async (input) => { await original(input); throw new Error("OUTCOME_UNKNOWN"); });
  await f.runtime.prepare({ characterId: "taki", requestId: f.request.requestId, videoUrls: [f.request.videoUrl], lifetimeMinutes: 5 }, authority);
  await vi.waitFor(() => expect(f.submit).toHaveBeenCalledTimes(1));
  const requestId = (f.submit.mock.calls[0]![0] as { client_request_id: string }).client_request_id;
  await vi.advanceTimersByTimeAsync(3_000);
  await vi.waitFor(() => expect(f.lookup).toHaveBeenCalledTimes(1));
  expect(f.lookup.mock.calls[0]![0]).toEqual({ client_request_id: requestId });
  await vi.advanceTimersByTimeAsync(3_000);
  await vi.waitFor(() => expect(f.preparation().status).toBe("completed"));
  expect(f.submit).toHaveBeenCalledTimes(1); expect(f.generate).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
});

it("cancels exact selected work and shutdown without cancelling unrelated primary work or deleting native references", async () => {
  const f = await fixture(); const authority = await f.primary();
  await f.runtime.prepare({ characterId: "taki", requestId: f.request.requestId, videoUrls: [f.request.videoUrl], lifetimeMinutes: 5 }, authority);
  await vi.waitFor(() => expect(f.submit).toHaveBeenCalledTimes(1));
  const batch = f.preparation(); const job = batch.jobs[0]!;
  expect(f.runtime.cancelPreparation("taki", { batchId: randomUUID() })).toEqual({ accepted: false, reason: "not_found" });
  const foreground = f.turns.begin("taki", undefined, authority.runId);
  expect(f.runtime.cancelPreparation("taki", { batchId: batch.batchId, jobRequestId: job.requestId }))
    .toMatchObject({ accepted: true, batch: { status: "cancelled" } });
  expect(foreground.signal.aborted).toBe(false); expect(f.catalog.request(job.analysisId!)).toBeDefined();
  f.turns.end("taki", foreground);
  await f.runtime.close(); await f.runtime.close(); await vi.advanceTimersByTimeAsync(30_000);
  expect(f.runs.status(job.runId!).run.state).toBe("cancelled");
  expect(f.status).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
});

it("settles selected failures without creating an Agent result or replacing unknown retained requests", async () => {
  const f = await fixture(); const authority = await f.primary();
  const original = f.catalog.reserve({ media: f.analysis.media, serverId: f.analysis.serverId }).request;
  f.lookup.mockRejectedValue(new Error("request_not_found"));
  await f.runtime.prepare({ characterId: "taki", requestId: f.request.requestId, videoUrls: [f.request.videoUrl], lifetimeMinutes: 5 }, authority);
  await vi.waitFor(() => expect(f.lookup).toHaveBeenCalledTimes(1)); await vi.advanceTimersByTimeAsync(60_000);
  await vi.waitFor(() => expect(f.preparation()).toMatchObject({ status: "failed", jobs: [{ reason: "analysis_unknown" }] }));
  expect(f.catalog.request(original.analysisId)).toEqual(original); expect(f.submit).not.toHaveBeenCalled();
  expect(f.runs.status(f.preparation().jobs[0]!.runId!).run.state).toBe("outcome_unknown");
  expect(f.generate).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  expect(f.store.history("taki").filter((entry) => entry.role === "assistant")).toEqual([]);
});

it("reuses silent preparation for a later explicit analysis and publishes that explicit answer exactly once", async () => {
  const f = await fixture({ existing: true }); const authority = await f.primary();
  await f.runtime.prepare({ characterId: "taki", requestId: f.request.requestId, videoUrls: [f.request.videoUrl], lifetimeMinutes: 5 }, authority);
  await vi.waitFor(() => expect(f.preparation().status).toBe("completed"));
  expect(f.runtime.cancelPreparation("taki", { batchId: f.preparation().batchId })).toMatchObject({ accepted: true, batch: { status: "completed" } });
  expect(f.generate).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  await f.start(); await vi.waitFor(() => expect(f.job().status).toBe("completed"));
  expect(f.job().analysisId).toBe(f.preparation().jobs[0]?.analysisId);
  expect(f.submit).not.toHaveBeenCalled(); expect(f.generate).toHaveBeenCalledTimes(1); expect(f.send).toHaveBeenCalledTimes(1);
});

it("refuses denied native access before reserving a recommendation analysis and produces no failure speech", async () => {
  const f = await fixture(); const authority = await f.primary();
  f.probe.mockRejectedValue(new Error("APPROVAL_REQUIRED"));
  await f.runtime.prepare({ characterId: "taki", requestId: f.request.requestId, videoUrls: [f.request.videoUrl], lifetimeMinutes: 5 }, authority);
  await vi.waitFor(() => expect(f.preparation()).toMatchObject({ status: "failed", jobs: [{ reason: "probe_failed", analysisId: null }] }));
  expect(f.submit).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
});

it("keeps batch retries idempotent and refuses conflicting selections or a second live batch", async () => {
  const f = await fixture(); const authority = await f.primary();
  const release = await f.queue.reservePrimary("taki").acquire();
  const request = { characterId: "taki", requestId: f.request.requestId, videoUrls: [f.request.videoUrl], lifetimeMinutes: 5 };
  const first = await f.runtime.prepare(request, authority); const count = f.capture.mock.calls.length;
  expect(await f.runtime.prepare(request, authority)).toEqual(first);
  expect(f.capture).toHaveBeenCalledTimes(count);
  expect(await f.runtime.prepare({ ...request, lifetimeMinutes: 10 }, authority)).toEqual({ accepted: false, reason: "request_conflict" });
  const next = await f.primary();
  expect(await f.runtime.prepare({ ...request, requestId: next.userTimelineId }, next)).toEqual({ accepted: false, reason: "already_active" });
  f.runtime.cancelPreparation("taki", { batchId: f.preparation().batchId }); release();
  expect(f.submit).not.toHaveBeenCalled();
});

it.each(["cancel", "shutdown"])("settles late recommendation admission after %s without starting native work", async (mode) => {
  const f = await fixture(); const authority = await f.primary(); const capture = f.capture.getMockImplementation()!;
  let resume: () => void = () => undefined;
  const pending = new Promise<void>((resolve) => { resume = resolve; });
  f.capture.mockImplementationOnce(async (request) => { const captured = await capture(request); await pending; return captured; });
  const preparation = f.runtime.prepare({ characterId: "taki", requestId: f.request.requestId, videoUrls: [f.request.videoUrl], lifetimeMinutes: 5 }, authority);
  await vi.waitFor(() => expect(f.preparation().jobs).toHaveLength(1));
  const closing = mode === "shutdown" ? f.runtime.close() : undefined;
  if (mode === "cancel") f.runtime.cancelPreparation("taki", { batchId: f.preparation().batchId });
  resume(); expect(await preparation).toMatchObject({ accepted: false }); await closing;
  expect(f.preparation().status).toBe("cancelled");
  const runId = f.preparation().jobs[0]?.runId;
  if (runId) expect(f.runs.status(runId).run.state).toBe("cancelled");
  expect(f.submit).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
});

it("enforces the shared 64-job global bound without starting any extra native work", async () => {
  const f = await fixture(); const releases: Array<() => void> = [];
  try {
    for (let index = 0; index < 22; index += 1) {
      const characterId = `character-${index}`;
      releases.push(await f.queue.reservePrimary(characterId).acquire());
      const authority = await f.primary(characterId);
      expect(await f.runtime.prepare({ characterId, requestId: authority.userTimelineId, lifetimeMinutes: 5,
        videoUrls: [1, 2, 3].map((page) => `https://www.bilibili.com/video/${f.analysis.media.bvid}?p=${page}`) }, authority))
        .toMatchObject(index < 21 ? { accepted: true } : { accepted: false, reason: "not_ready" });
    }
    expect(f.probe).not.toHaveBeenCalled();
  } finally { await f.runtime.close(); for (const release of releases) release(); }
});

it("prepares through actual chat.send and ChatAgent with separate transport, trigger and committed Timeline identities", async () => {
  const f = await fixture({ existing: true }); const capture = f.capture.getMockImplementation()!;
  const loaded = { ok: true, content: "Prepare selected videos only", contentRevision: "r1", files: [] };
  f.capture.mockImplementation(async (request) => {
    const captured = await capture(request);
    if (request.provenance.provider !== "chat") return captured;
    const context: RunExecutionContext = captured.context;
    return { ...captured, context: { ...captured.context,
      toolDisclosure: { deferredToolNames: [], describedTools: {},
        skills: { [MEDIA_RECOMMENDATIONS_SKILL]: { extensionId: "ext:recommendations", contentRevision: "r1" } } },
      tools: { ...context.tools, extension_call: tool({ inputSchema: z.object({ extensionId: z.string(), input: z.unknown() }),
        execute: () => ({ ok: true, owner: { extensionId: "ext:recommendations" }, output: loaded }) }) } } };
  });
  const model = scriptedModel([
    { kind: "tool", toolCallId: "load", toolName: "load_skill", input: { name: MEDIA_RECOMMENDATIONS_SKILL } },
    { kind: "tool", toolCallId: "prepare", toolName: "manage_media_recommendations", input: {
      action: "prepare_recommendations", videoUrls: [f.request.videoUrl], lifetimeMinutes: 5, batchId: null, jobRequestId: null } },
    { kind: "text", deltas: ["已登记精选视频的预分析请求。"] },
  ]);
  const agent = createChatAgent({ model, store: f.store, memory: f.memory,
    extraTools: { load_skill: tool({ inputSchema: z.object({ name: z.string() }), execute: () => loaded }) },
    skillTools: (input) => input.userEntry ? [{ skillName: MEDIA_RECOMMENDATIONS_SKILL,
      tools: createManageMediaRecommendationsTool({ ...input, userEntry: input.userEntry, runtime: f.runtime }) }] : [],
  });
  const registry = createMethodRegistry(); const notify = vi.fn();
  registry.register(chatSendMethod(agent, createCaptureLogger().logger, f, f.runs));
  const response = await registry.dispatch({ jsonrpc: "2.0", id: "recommendations", method: "chat.send",
    params: { characterId: "taki", message: "为我准备这几个推荐视频" } },
  { connection: f.interactive.connection, notify, close() {}, onClose() {} });
  const ack = ChatSendResultSchema.parse(JsonRpcSuccessResponseSchema.parse(response).result);
  await vi.waitFor(() => expect(f.runs.status(ack.runId).run.state).toBe("completed"));
  const entries = f.timeline.latestAscending("taki", 20); const userEntry = entries.find((entry) => entry.role === "user")!;
  expect(new Set([ack.messageId, f.runs.status(ack.runId).run.triggerRequestId, userEntry.id]).size).toBe(3);
  expect(f.preparation()).toMatchObject({ batchId: userEntry.id, status: "preparing" });
  expect(f.db.prepare("SELECT timeline_id FROM interaction_pattern_primary_sources WHERE run_id=:runId").get({ runId: ack.runId }))
    .toEqual({ timeline_id: userEntry.id });
  expect(model.doStreamCalls[0]?.tools?.map((entry) => entry.name)).not.toContain("manage_media_recommendations");
  expect(model.doStreamCalls[1]?.tools?.map((entry) => entry.name)).toContain("manage_media_recommendations");
  f.runtime.released(); await vi.waitFor(() => expect(f.preparation().status).toBe("completed"));
  expect(f.timeline.latestAscending("taki", 20)).toEqual(entries);
  expect(f.generate).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
});

it.each([true, false])("shares pending and refused admission outcomes for same-key preparation retries (success=%s)", async (success) => {
  const f = await fixture({ existing: true }); const authority = await f.primary(); const capture = f.capture.getMockImplementation()!;
  let resume: () => void = () => undefined;
  const pending = new Promise<void>((resolve) => { resume = resolve; });
  f.capture.mockImplementationOnce(async (request) => {
    const captured = await capture(request); await pending;
    if (!success) throw new Error("SNAPSHOT_UNAVAILABLE");
    return captured;
  });
  const request = { characterId: "taki", requestId: f.request.requestId, videoUrls: [f.request.videoUrl], lifetimeMinutes: 5 };
  const release = await f.queue.reservePrimary("taki").acquire();
  const first = f.runtime.prepare(request, authority); let returned = false;
  const second = f.runtime.prepare(request, authority).then((result) => { returned = true; return result; });
  await Promise.resolve(); expect(returned).toBe(false); resume();
  expect(await second).toEqual(await first);
  expect(await first).toMatchObject({ accepted: success });
  expect(await f.runtime.prepare(request, authority)).toEqual(await first);
  if (success) f.runtime.cancelPreparation("taki", { batchId: request.requestId });
  release();
});
