/**
 * INPUT: raw Co-Watching and recommendation tool outcomes at the SDK result boundary
 * OUTPUT: verified content, paging and exact job/batch selectors without native or Run bookkeeping
 * POS: core/co-watching — model-only projection; canonical validation, settlement and retention stay unchanged
 */
import type { Tool } from "ai";
import { CoWatchingAnalysisReadResultSchema, MediaAnalysisJobSchema, MediaRecommendationBatchSchema,
  type MediaAnalysisJob, type MediaRecommendationBatch } from "@taki/shared";

function jobView(job: MediaAnalysisJob) {
  return { requestId: job.requestId, videoUrl: job.videoUrl, title: job.title, status: job.status,
    analysisId: job.analysisId, reason: job.reason, expiresAt: job.expiresAt };
}

function batchView(batch: MediaRecommendationBatch) {
  return { batchId: batch.batchId, status: batch.status, jobs: batch.jobs.map(jobView) };
}

export const mediaToolModelOutput: NonNullable<Tool["toModelOutput"]> = ({ input, output }) => {
  if (typeof output !== "object" || output === null || !("ok" in output) || output.ok !== true) {
    return { type: "json", value: output };
  }
  const action = typeof input === "object" && input !== null && "action" in input ? input.action : undefined;
  if (action === "read_analysis") {
    const parsed = CoWatchingAnalysisReadResultSchema.safeParse(output);
    if (parsed.success && parsed.data.ok) {
      const { analysis } = parsed.data;
      return { type: "json", value: { ...output,
        analysis: { analysisId: analysis.analysisId, title: analysis.title, media: analysis.media } } };
    }
  }
  if (["analyze_url", "analysis_status", "analysis_cancel"].includes(action) && "job" in output) {
    const parsed = MediaAnalysisJobSchema.safeParse(output.job);
    if (parsed.success) return { type: "json", value: { ...output, job: jobView(parsed.data) } };
  }
  if (["prepare_recommendations", "preparation_status", "preparation_cancel"].includes(action) && "batch" in output) {
    const parsed = MediaRecommendationBatchSchema.safeParse(output.batch);
    if (parsed.success) return { type: "json", value: { ...output, batch: batchView(parsed.data) } };
  }
  return { type: "json", value: output };
};
