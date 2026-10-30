/**
 * INPUT: exact committed primary user entry, current Character and captured current playback choices
 * OUTPUT: registered analysis reads, explicit URL analysis and Co-Watching controls through existing owners
 * POS: core/co-watching — Skill-disclosed governed primary tool; background runs never receive this control surface
 */
import { tool, type ToolExecutionOptions, type ToolSet } from "ai";
import { z } from "zod";
import { CoWatchingAnalysisReadParamsSchema, CoWatchingAnalysisReadResultSchema, CoWatchingAnalysisViewSchema } from "@taki/shared";
import type { TimelineEntry } from "@taki/shared";
import type { TurnContext } from "../agents/chat-agent.ts";
import type { CoWatchingRuntime } from "./runtime.ts";
import { selectInvitationSource } from "./invitation-source.ts";
import type { CoWatchingAnalysisReader } from "./read-analysis.ts";
import type { MediaAnalysisRuntime } from "./media-analysis-runtime.ts";

const CoWatchingControlInputSchema = z.strictObject({
  action: z.enum(["list_analyses", "read_analysis", "analyze_url", "analysis_status", "analysis_cancel", "start", "reanalyze", "revise", "stop"]).describe("analyze_url accepts an explicit URL analysis; analysis_status/cancel control only that analysis. read_analysis reads an existing result. start/reanalyze/revise/stop control Co-Watching."),
  instruction: z.string().trim().min(1).max(4_000).nullable().describe("The requested question/focus for analyze_url, or future expression changes for revise; null uses the original user message for analyze_url and is required for other actions."),
  videoUrl: z.url().max(4_096).nullable().optional().describe("Direct https://www.bilibili.com/video/BV... URL, with optional ?p=N, for analyze_url; short/mobile links are unsupported. Null/omitted for other actions. Core resolves the exact CID without playback."),
  sourceRef: z.uuid().nullable().optional().describe("Exact supplied playback source; null selects the sole current source for start or reanalyze."),
  lifetimeMinutes: z.int().min(5).max(720).nullable().optional().describe("Maximum accepted duration for start, reanalyze or analyze_url. Pass the user-requested minutes; null/omitted means 120, not a duration mentioned elsewhere."),
  analysisId: z.uuid().nullable().optional().describe("Exact ID returned by list_analyses; required only for read_analysis."),
  view: CoWatchingAnalysisViewSchema.nullable().optional().describe("For read_analysis: analysis (default) reads original prose/moments; complete reads the full original JSON including supporting evidence."),
  offset: z.int().nonnegative().nullable().optional().describe("For read_analysis: start at 0; use returned nextOffset only when more of the same view is needed."),
});

const TOOL_DESCRIPTION = "List available analyses, or start, adjust or stop this Character's Co-Watching when the user asks. " +
  "Use analyze_url when the user supplies a Bilibili URL and asks for analysis or a summary without watching together. It verifies media access and queues existing native analysis through one accepted Run; playback is unnecessary. " +
  "The result returns later through ordinary conversation; an accepted response is not analysis completion. Reuse of completed results or original native requests never silently starts a replacement job. " +
  "Use analysis_status to inspect that separate request and analysis_cancel to stop Taki's analysis follow-up; cancellation does not claim the upstream job stopped. Co-Watching stop is separate. " +
  "Use list_analyses to read analysis result references registered in this Core. Listing does not verify upstream completion/availability, list every job, read video contents or start/retry analysis. " +
  "Use read_analysis with an exact listed analysisId to read verified existing content in ordinary conversation without watching. It returns a bounded page; complete view exposes original supporting data, and nextOffset continues that same view. A read failure never authorizes reanalysis. " +
  "Use start for 'watch this video with me': a null sourceRef selects the only visible source, or the sole observed source while the user is in chat; otherwise use an exact provided sourceRef. " +
  "Start reuses a completed analysis or reconciles the retained native request, including a failed request; it queues initial analysis only when no request exists. " +
  "Core owns those request IDs: do not ask the user for them or search files/execute commands to recover them. Start never replaces a failed request. " +
  "For start, reanalyze and analyze_url, pass the user's requested duration in lifetimeMinutes; null defaults to 120 minutes only when unspecified. " +
  "Use reanalyze only when the user explicitly requests restarting this same video's confirmed failed analysis; it incurs new analysis work. " +
  "Use action revise with the requested future expression changes; instruction must be null for stop. " +
  "Revision acknowledgement means future publication has been withheld and preparation is queued, not finished. " +
  "An active task cannot silently change videos. Starting does not confirm analysis is ready. Never replay an already committed response.";

export function createManageCoWatchingTool(input: {
  runtime: CoWatchingRuntime; characterId: string; userEntry: TimelineEntry; turn?: TurnContext;
  readAnalysis?: CoWatchingAnalysisReader; analysisRuntime?: MediaAnalysisRuntime;
}): ToolSet {
  if (input.userEntry.role !== "user" || !input.turn?.connection || !input.turn.runId || !input.turn.attemptId) return {};
  const connection = input.turn.connection;
  const view = input.runtime.read(input.characterId); const session = view.session;
  const sources = view.sources;
  return { manage_co_watching: tool({
    description: TOOL_DESCRIPTION,
    inputSchema: CoWatchingControlInputSchema,
    async execute({ action, instruction, videoUrl, sourceRef, lifetimeMinutes, analysisId, view, offset }, options) {
      if (input.turn?.signal?.aborted) return { ok: false, reason: "turn_cancelled" };
      if (action === "revise" && !instruction) return { ok: false, reason: "instruction_required" };
      if (action !== "revise" && action !== "analyze_url" && instruction !== null) return { ok: false, reason: "unexpected_instruction" };
      if (action !== "analyze_url" && videoUrl != null) return { ok: false, reason: "invalid_request", message: "Use videoUrl only with analyze_url." };
      if (action !== "read_analysis" && [analysisId, view, offset].some((value) => value != null)) return CoWatchingAnalysisReadResultSchema.parse({
        ok: false, reason: "invalid_selection", message: "Use analysisId, view and offset only with read_analysis; otherwise leave them null." });
      try {
        if (["analyze_url", "analysis_status", "analysis_cancel"].includes(action)) return await analysisAction({
          runtime: input.analysisRuntime, characterId: input.characterId, userEntry: input.userEntry, turn: input.turn,
        }, { action, instruction, videoUrl, lifetimeMinutes });
        if (action === "read_analysis") return await readAnalysisAction(input, { analysisId, view, offset }, options);
        if (action === "list_analyses") return { ok: true, status: "analyses_listed", scope: "core_registered_analyses",
          analyses: input.runtime.read(input.characterId).analyses };
        if (action === "start" || action === "reanalyze") {
          const durationMinutes = lifetimeMinutes ?? 120;
          const current = input.runtime.read(input.characterId).sources;
          const source = selectInvitationSource({ captured: sources, current, sourceRef });
          if (!source) return { ok: false, reason: "source_unavailable_or_ambiguous",
            sources: current.map((entry) => ({ sourceRef: entry.sourceRef, media: entry.source.media })),
            message: "播放来源尚未稳定或已变化；请确认当前视频。连接信息可继续复用。" };
          const result = input.runtime.invite({ characterId: input.characterId, requestId: input.userEntry.id,
            sourceRef: source.sourceRef, lifetimeMinutes: durationMinutes, reanalyze: action === "reanalyze" }, { connection });
          return result.accepted ? { ok: true, status: "watching_queued", sessionId: result.session.sessionId,
            expiresAt: result.session.expiresAt, lifetimeMinutes: durationMinutes,
            message: `已接受本次共看，最长 ${durationMinutes} 分钟；将复用已有分析或准备新分析，就绪后随播放回应。` }
            : { ok: false, reason: result.reason };
        }
        if (!session || ["stopped", "failed"].includes(session.status)) return { ok: false, reason: "not_found" };
        const result = action === "stop" ? input.runtime.stop(input.characterId, session.sessionId)
          : input.runtime.revise({ characterId: input.characterId, sessionId: session.sessionId, instruction: instruction ?? "" });
        return result.accepted ? { ok: true, status: action === "stop" ? "stopped" : "revision_queued",
          message: action === "stop" ? "本次共看已停止，不再发布后续回应。" : "已暂停后续回应；当前对话结束后调整未来内容。" }
          : { ok: false, reason: result.reason };
      } catch { return { ok: false, reason: "control_failed" }; }
    },
  }) };
}

async function analysisAction(input: { runtime?: MediaAnalysisRuntime; characterId: string; userEntry: TimelineEntry; turn?: TurnContext },
  request: { action: string; instruction: string | null; videoUrl?: string | null; lifetimeMinutes?: number | null }) {
  const { runtime } = input;
  if (!runtime) return { ok: false, reason: "not_ready", message: "URL analysis is unavailable in this runtime." };
  if (request.action === "analyze_url") {
    const connection = input.turn?.connection;
    if (!connection) return { ok: false, reason: "not_ready", message: "A current primary operator request is required." };
    if (!request.videoUrl) return { ok: false, reason: "invalid_request", message: "Provide the explicit Bilibili video URL for analyze_url." };
    const result = await runtime.analyze({ characterId: input.characterId, requestId: input.userEntry.id,
      videoUrl: request.videoUrl, instruction: request.instruction ?? input.userEntry.content,
      lifetimeMinutes: request.lifetimeMinutes ?? 120 }, { connection, signal: input.turn?.signal });
    return result.accepted ? { ok: true, status: "analysis_accepted", job: result.job,
      lifetimeMinutes: request.lifetimeMinutes ?? 120,
      message: "已接受视频分析请求，会复用已有结果或原分析请求；结果就绪后在对话中返回。等待期间可以继续聊天。" }
      : { ok: false, reason: result.reason };
  }
  const job = runtime.read(input.characterId);
  if (request.action === "analysis_status") return { ok: true, status: "analysis_status", job };
  if (!job) return { ok: false, reason: "not_found" };
  const result = runtime.cancel(input.characterId, job.requestId);
  if (result.accepted && result.job.status !== "cancelled") return { ok: true, status: "analysis_status", job: result.job,
    message: "这次分析请求已经结束，已完成的回答不会被撤回。" };
  return result.accepted ? { ok: true, status: "analysis_cancelled", job: result.job,
    message: "已停止这次分析的后续处理和回答；原生服务可能仍在运行，已保留原请求。" }
    : { ok: false, reason: result.reason };
}

async function readAnalysisAction(input: { readAnalysis?: CoWatchingAnalysisReader; turn?: TurnContext },
  selection: { analysisId?: string | null; view?: "analysis" | "complete" | null; offset?: number | null }, options: ToolExecutionOptions<unknown>) {
  const request = CoWatchingAnalysisReadParamsSchema.safeParse({ analysisId: selection.analysisId,
    view: selection.view ?? "analysis", offset: selection.offset ?? 0 });
  if (!request.success || !input.readAnalysis) return CoWatchingAnalysisReadResultSchema.parse({ ok: false,
    reason: request.success ? "unavailable" : "invalid_selection", message: "Select an exact listed analysis ID using the available result reader; do not start watching or reanalyze." });
  return input.readAnalysis(request.data, { context: input.turn?.runContext,
    options: { ...options, abortSignal: input.turn?.signal ?? options.abortSignal } });
}
