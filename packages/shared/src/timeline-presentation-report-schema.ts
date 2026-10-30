/**
 * INPUT: actual committed text exposure on an authenticated operator surface
 * OUTPUT: ordinary Timeline presentation reports using existing Character and seq identity
 * POS: shared/protocol — presentation opportunity, never a reading acknowledgement
 */
import { z } from "zod";
import { PresenceObservedAgeSchema, PresenceSequenceSchema, PresenceSourceIdSchema } from "./presence-schema.ts";

export const TimelinePresentationReportParamsSchema = z.strictObject({
  sourceId: PresenceSourceIdSchema,
  sequence: PresenceSequenceSchema,
  observedAgeMs: PresenceObservedAgeSchema,
  characterId: z.string().min(1).max(200),
  timelineSeq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  exposed: z.boolean(),
});
export type TimelinePresentationReportParams = z.infer<typeof TimelinePresentationReportParamsSchema>;
