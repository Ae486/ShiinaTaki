/**
 * INPUT: a registered analysis selection and a verified native result page
 * OUTPUT: bounded ordinary-conversation read contracts, separate from watching acceptance
 * POS: shared/protocol — result data and pagination only; no new execution or publication authority
 */
import { z } from "zod";
import { CoWatchingAnalysisSchema } from "./co-watching-schema.ts";

// Keep an explicit read below the normal tool-result budget; full original material remains pageable.
export const CO_WATCHING_ANALYSIS_PAGE_CHARS = 16_384;
export const CoWatchingAnalysisViewSchema = z.enum(["analysis", "complete"]);
export const CoWatchingAnalysisReadParamsSchema = z.strictObject({
  analysisId: z.uuid(),
  view: CoWatchingAnalysisViewSchema.default("analysis"),
  offset: z.int().nonnegative().default(0),
});
export type CoWatchingAnalysisReadParams = z.infer<typeof CoWatchingAnalysisReadParamsSchema>;
export const CoWatchingAnalysisReadFailureSchema = z.enum([
  "not_found", "unavailable", "cancelled", "reference_changed", "invalid_selection", "invalid_offset", "identity_mismatch",
]);
export const CoWatchingAnalysisReadResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true), status: z.literal("analysis_read"),
    analysis: CoWatchingAnalysisSchema,
    view: CoWatchingAnalysisViewSchema,
    content: z.string().max(CO_WATCHING_ANALYSIS_PAGE_CHARS + 1024),
    offset: z.int().nonnegative(), totalChars: z.int().nonnegative(),
    nextOffset: z.int().nonnegative().nullable(), truncated: z.boolean(),
  }),
  z.strictObject({ ok: z.literal(false), reason: CoWatchingAnalysisReadFailureSchema, message: z.string().max(500) }),
]);
export type CoWatchingAnalysisReadResult = z.infer<typeof CoWatchingAnalysisReadResultSchema>;
