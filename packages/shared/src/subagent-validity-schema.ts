/**
 * INPUT: trusted work-owner validity
 * OUTPUT: explicit source deadline or continuing generic work
 * POS: shared/protocol — task validity independent of model-request and publication freshness
 */
import { z } from "zod";

export const SubagentValiditySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("until_cancelled") }),
  z.strictObject({ kind: z.literal("expires_at"), expiresAt: z.iso.datetime({ offset: true }) }),
]);
export type SubagentValidity = z.infer<typeof SubagentValiditySchema>;
