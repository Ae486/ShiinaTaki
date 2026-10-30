/**
 * INPUT: an existing trusted media producer's accepted Co-Watching scope
 * OUTPUT: business-specific M51 classification data, separate from generic publication contracts
 * POS: shared/media-integration — no public tool/RPC or proof of user acceptance
 */
import { z } from "zod";
import { PreparedPublicationSourceSchema } from "./prepared-publication-schema.ts";

export const CoWatchingPublicationSourceSchema = PreparedPublicationSourceSchema.omit({ validity: true }).extend({
  policy: z.literal("accepted_co_watching"), expiresAt: z.iso.datetime({ offset: true }),
});
export type CoWatchingPublicationSource = z.infer<typeof CoWatchingPublicationSourceSchema>;
