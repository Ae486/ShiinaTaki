/**
 * INPUT: a real primary user entry/Run/Attempt and the existing independent analysis runtime
 * OUTPUT: Skill-disclosed bounded recommendation preparation/status/scoped cancellation
 * POS: core/co-watching — governed control composition; native results never grant Co-Watching consent or speech
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { TimelineEntry } from "@taki/shared";
import type { TurnContext } from "../agents/chat-agent.ts";
import type { MediaAnalysisRuntime } from "./media-analysis-runtime.ts";
import { mediaToolModelOutput } from "./media-tool-model-output.ts";

export const MEDIA_RECOMMENDATIONS_SKILL = "taki-media-recommendations";

const Input = z.strictObject({
  action: z.enum(["prepare_recommendations", "preparation_status", "preparation_cancel"])
    .describe("Prepare only explicitly selected videos, inspect the latest/exact batch, or cancel an exact batch/item."),
  videoUrls: z.array(z.url().max(4_096)).min(1).max(3).nullable()
    .describe("For prepare_recommendations only: 1–3 selected direct HTTPS Bilibili BV video URLs, optionally ?p=N. Never pass the entire browsing list. Null otherwise."),
  lifetimeMinutes: z.int().min(5).max(720).nullable()
    .describe("Maximum preparation lifetime; null means 120 minutes. Null for status/cancel."),
  batchId: z.uuid().nullable()
    .describe("Null for prepare. Status may use null for the latest batch. Cancel requires the exact returned batchId."),
  jobRequestId: z.uuid().nullable()
    .describe("For cancel only: an exact requestId from that batch's jobs, or null to cancel all pending items. Null otherwise."),
});

export function createManageMediaRecommendationsTool(input: {
  runtime: MediaAnalysisRuntime; characterId: string; userEntry: TimelineEntry; turn?: TurnContext;
}): ToolSet {
  const { runtime, turn, userEntry, characterId } = input;
  if (userEntry.role !== "user" || turn?.turnKind === "non-primary" || !turn?.connection || !turn.runId || !turn.attemptId) return {};
  const { connection, runId, attemptId } = turn;
  return { manage_media_recommendations: tool({
    description: "Prepare 1–3 explicitly selected recommendation videos using existing native analysis, without playback or Co-Watching consent. " +
      "Requires this real primary conversation's source authority; heartbeat/scheduled work is unsupported. " +
      "Preparation is sequential and native-only: no Character commentary, final summary, Timeline reply, invitation, exposure, click or feedback is produced. " +
      "Accepted means queued, not completed. Inspect preparation_status for actual per-video outcomes; use existing analysis reads when the user later asks. " +
      "Declining or choosing direct viewing does not cancel preparation. Exact completed results/original requests are reused; unknown outcomes never justify a fresh request. " +
      "preparation_cancel stops only selected pending Taki follow-up, retains completed results and does not claim the upstream job stopped. " +
      "Read each job's status and reason: failed, cancelled and analysis_unknown are distinct; a missing batch means no retained batch was found, not successful preparation. " +
      "Preserve batchId and jobs[].requestId for exact status/cancel; completed jobs' analysisId selects an existing analysis read. " +
      "Native MCP capabilities retain their existing permissions/Approval and captured service generation.",
    inputSchema: Input,
    toModelOutput: mediaToolModelOutput,
    async execute({ action, videoUrls, lifetimeMinutes, batchId, jobRequestId }) {
      if (turn.signal?.aborted) return { ok: false, reason: "turn_cancelled" };
      if (connection.state.status !== "authenticated" || connection.state.role !== "operator") return { ok: false, reason: "source_unavailable" };
      try {
        if (action === "prepare_recommendations") {
          if (!videoUrls || batchId !== null || jobRequestId !== null) return { ok: false, reason: "invalid_request" };
          const result = await runtime.prepare({ characterId, requestId: userEntry.id, videoUrls, lifetimeMinutes: lifetimeMinutes ?? 120 },
            { runId, attemptId, userTimelineSeq: userEntry.seq, userTimelineId: userEntry.id,
              interactive: { connection, signal: turn.signal } });
          return result.accepted ? { ok: true, status: "preparation_accepted", batch: result.batch,
            lifetimeMinutes: lifetimeMinutes ?? 120 } : { ok: false, reason: result.reason };
        }
        if (videoUrls !== null || lifetimeMinutes !== null || action === "preparation_status" && jobRequestId !== null) {
          return { ok: false, reason: "invalid_request" };
        }
        if (action === "preparation_status") return { ok: true, status: "preparation_status", batch: runtime.preparation(characterId, batchId ?? undefined) };
        if (!batchId) return { ok: false, reason: "invalid_request" };
        const result = runtime.cancelPreparation(characterId, { batchId, jobRequestId: jobRequestId ?? undefined });
        return result.accepted ? { ok: true, status: "preparation_status", batch: result.batch } : { ok: false, reason: result.reason };
      } catch { return { ok: false, reason: "control_failed" }; }
    },
  }) };
}
