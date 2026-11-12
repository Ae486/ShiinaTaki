import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { ToolLoopAgent, isStepCount } from "ai";
import type { CoWatchingAnalysis, MediaAnalysisJob, MediaRecommendationBatch, TimelineEntry } from "@taki/shared";
import { mediaToolModelOutput } from "./media-tool-model-output.ts";
import { createManageMediaRecommendationsTool } from "./manage-media-recommendations-tool.ts";
import type { MediaAnalysisRuntime } from "./media-analysis-runtime.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";

const videoUrl = "https://www.bilibili.com/video/BV1UEaq6qEZt?p=1";
const expiresAt = "2026-11-01T12:00:00.000Z";
function job(overrides: Partial<MediaAnalysisJob> = {}): MediaAnalysisJob {
  return { requestId: randomUUID(), characterId: "taki", videoUrl, status: "accepted", runId: randomUUID(),
    analysisId: null, title: null, reason: null, expiresAt, ...overrides };
}
function project(action: string, output: unknown) {
  return mediaToolModelOutput({ toolCallId: "view", input: { action }, output });
}

it("retains entire verified pages, media and exact continuation while omitting only verification metadata", async () => {
  const analysis: CoWatchingAnalysis = { analysisId: randomUUID(), revision: 9, title: "Original video",
    media: { kind: "bilibili", bvid: "BV1UEaq6qEZt", cid: "42265479965", page: 1 }, serverId: "native-fixture",
    native: { serviceInstanceId: randomUUID(), requestId: randomUUID(), jobId: randomUUID(), sha256: "a".repeat(64) } };
  const content = "<untrusted-observation>" + "Full original text😀".repeat(700) + "</untrusted-observation>";
  const output = { ok: true, status: "analysis_read", analysis, view: "complete", content,
    offset: 16384, totalChars: 40000, nextOffset: 32768, truncated: true };
  expect(await project("read_analysis", output)).toEqual({ type: "json", value: { ...output,
    analysis: { analysisId: analysis.analysisId, title: analysis.title, media: analysis.media } } });
  expect(output.analysis.native.sha256).toBe("a".repeat(64));
  expect(output.content).toBe(content);
  const inventory = { ok: true, status: "analyses_listed", scope: "core_registered_analyses",
    analyses: [{ analysisId: analysis.analysisId, title: analysis.title, media: analysis.media }] };
  expect(await project("list_analyses", inventory)).toEqual({ type: "json", value: inventory });
});

it.each(["analysis_accepted", "analysis_status", "analysis_cancelled"])("preserves independent analysis selectors and unknown/cancel state (%s)", async (status) => {
  const original = job({ status: status === "analysis_cancelled" ? "cancelled" : "failed",
    reason: status === "analysis_cancelled" ? "cancelled" : "analysis_unknown", analysisId: randomUUID() });
  const output = { ok: true, status, job: original, message: "Original request remains retained", lifetimeMinutes: 30 };
  const action = status === "analysis_accepted" ? "analyze_url" : status === "analysis_status" ? "analysis_status" : "analysis_cancel";
  expect(await project(action, output)).toEqual({ type: "json", value: { ...output, job: {
    requestId: original.requestId, videoUrl, title: original.title, status: original.status,
    analysisId: original.analysisId, reason: original.reason, expiresAt } } });
  expect(original.runId).not.toBeNull();
});

it("preserves full failure/absence and unfamiliar shapes instead of disguising them as successful empty results", async () => {
  for (const output of [
    { ok: false, reason: "reference_changed", message: "Refresh the catalog", sourceRef: "exact-source" },
    { ok: false, reason: "cancelled", message: "No content returned" },
    { ok: true, status: "analysis_status", job: null },
    { ok: true, status: "preparation_status", batch: null },
    { ok: true, status: "analysis_status", job: { requestId: "new-contract", customEvidence: "Keep this" } },
  ]) expect(await project("analysis_status", output)).toEqual({ type: "json", value: output });
});

it("projects actual SDK requests while raw receipts retain mixed completed/unknown/cancelled batch outcomes", async () => {
  const batch: MediaRecommendationBatch = { batchId: randomUUID(), characterId: "taki", status: "cancelled", jobs: [
    job({ status: "completed", analysisId: randomUUID(), title: "Completed analysis" }),
    job({ status: "failed", reason: "analysis_unknown" }), job({ status: "cancelled", reason: "cancelled" }),
  ] };
  const runtime = { preparation: vi.fn(() => batch) } as unknown as MediaAnalysisRuntime;
  const userEntry: TimelineEntry = { id: randomUUID(), seq: 1, characterId: "taki", role: "user",
    content: "Check the selected videos", createdAt: "2026-11-01T00:00:00.000Z" };
  const tools = createManageMediaRecommendationsTool({ runtime, userEntry, characterId: "taki", turn: {
    connection: { state: { status: "authenticated", role: "operator", deviceId: "operator", capabilities: [] } },
    runId: randomUUID(), attemptId: randomUUID(),
  } });
  const input = { action: "preparation_status", videoUrls: null, lifetimeMinutes: null, batchId: batch.batchId, jobRequestId: null };
  const model = scriptedModel([{ kind: "tool", toolCallId: "status", toolName: "manage_media_recommendations", input },
    { kind: "text", deltas: ["One completed, one unknown and one cancelled"] }]);
  const raw: unknown[] = [];
  const agent = new ToolLoopAgent({ model, tools, stopWhen: isStepCount(2), onStepEnd(step) {
    raw.push(...step.toolResults.map((result) => result.output));
  } });
  await (await agent.stream({ prompt: userEntry.content })).consumeStream();
  expect(raw).toEqual([{ ok: true, status: "preparation_status", batch }]);
  const part = model.doStreamCalls[1]!.prompt.flatMap((message) => message.role === "tool" ? message.content : [])
    .find((part) => part.type === "tool-result");
  expect(part?.output).toEqual(await project("preparation_status", raw[0]));
  const serialized = JSON.stringify(part?.output);
  expect(serialized).not.toContain("characterId");
  for (const item of batch.jobs) {
    expect(serialized).toContain(item.requestId);
    expect(serialized).not.toContain(item.runId!);
  }
  expect(serialized).toContain(batch.jobs[0]!.analysisId!);
  expect(serialized).toContain("analysis_unknown");
  expect(serialized).toContain("cancelled");
});
