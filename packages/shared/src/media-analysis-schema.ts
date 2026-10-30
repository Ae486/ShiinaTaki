/**
 * INPUT: primary URL-analysis or bounded recommendation selections and Core-owned accepted-work views
 * OUTPUT: explicit answer and silent recommendation preparation acceptance/status contracts
 * POS: shared/protocol — Skill action data; no new RPC, scheduler, consent or execution ledger
 */
import { z } from "zod";

export const MediaAnalysisStartSchema = z.strictObject({
  characterId: z.string().min(1).max(160), requestId: z.uuid(), videoUrl: z.url().max(4_096),
  instruction: z.string().min(1).max(32_000), lifetimeMinutes: z.int().min(5).max(720),
});
export type MediaAnalysisStart = z.infer<typeof MediaAnalysisStartSchema>;
export const MediaAnalysisFailureSchema = z.enum([
  "probe_failed", "analysis_failed", "analysis_unknown", "analysis_unavailable", "analysis_mismatch",
  "authority_changed", "summary_failed", "delivery_failed", "expired", "cancelled", "shutdown",
]);
export type MediaAnalysisFailure = z.infer<typeof MediaAnalysisFailureSchema>;
export const MediaAnalysisJobSchema = z.strictObject({
  requestId: z.uuid(), characterId: z.string().min(1).max(160), videoUrl: z.url().max(4_096),
  status: z.enum(["accepted", "probing", "analyzing", "summarizing", "delivering", "completed", "failed", "cancelled"]),
  runId: z.uuid().nullable(), analysisId: z.uuid().nullable(), title: z.string().max(240).nullable(),
  reason: MediaAnalysisFailureSchema.nullable(), expiresAt: z.iso.datetime(),
});
export type MediaAnalysisJob = z.infer<typeof MediaAnalysisJobSchema>;
export const MediaAnalysisControlResultSchema = z.discriminatedUnion("accepted", [
  z.strictObject({ accepted: z.literal(true), job: MediaAnalysisJobSchema }),
  z.strictObject({ accepted: z.literal(false), reason: z.enum(["invalid_request", "not_ready", "already_active", "request_conflict", "not_found"]) }),
]);
export type MediaAnalysisControlResult = z.infer<typeof MediaAnalysisControlResultSchema>;

export const MediaRecommendationStartSchema = z.strictObject({
  characterId: z.string().min(1).max(160), requestId: z.uuid(),
  videoUrls: z.array(z.url().max(4_096)).min(1).max(3), lifetimeMinutes: z.int().min(5).max(720),
});
export type MediaRecommendationStart = z.infer<typeof MediaRecommendationStartSchema>;
export const MediaRecommendationBatchSchema = z.strictObject({
  batchId: z.uuid(), characterId: z.string().min(1).max(160),
  status: z.enum(["preparing", "completed", "failed", "cancelled"]),
  jobs: z.array(MediaAnalysisJobSchema).min(1).max(3),
});
export type MediaRecommendationBatch = z.infer<typeof MediaRecommendationBatchSchema>;
export const MediaRecommendationControlResultSchema = z.discriminatedUnion("accepted", [
  z.strictObject({ accepted: z.literal(true), batch: MediaRecommendationBatchSchema }),
  z.strictObject({ accepted: z.literal(false), reason: z.enum([
    "invalid_request", "not_ready", "already_active", "request_conflict", "not_found", "source_unavailable",
  ]) }),
]);
export type MediaRecommendationControlResult = z.infer<typeof MediaRecommendationControlResultSchema>;
