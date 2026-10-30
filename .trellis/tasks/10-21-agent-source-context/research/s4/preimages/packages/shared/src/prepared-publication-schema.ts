/**
 * INPUT: trusted accepted-source snapshots and reference-only prepared-output requests
 * OUTPUT: bounded internal publication/edit contracts; no caller-selected text, class or root authority
 * POS: shared/protocol — Core integration contracts only; no model tool or public RPC is installed
 */
import { z } from "zod";
import { DeliveryStateSchema } from "./initiative-schema.ts";

const Id = z.string().min(1).max(200);
const Time = z.string().datetime({ offset: true });
export const PREPARED_PUBLICATION_PROVIDER = "core.prepared-publication";

export const PreparedPublicationRequestSchema = z.strictObject({ candidateRef: Id, expectedRevision: Id });
export type PreparedPublicationRequest = z.infer<typeof PreparedPublicationRequestSchema>;
export const PreparedPublicationRunInputSchema = PreparedPublicationRequestSchema.extend({ rootRunId: Id });
export type PreparedPublicationRunInput = z.infer<typeof PreparedPublicationRunInputSchema>;

export const PreparedPublicationSourceSchema = z.strictObject({
  sourceRef: Id, acceptanceRef: Id, characterId: Id, revision: Id, expiresAt: Time,
});
export type PreparedPublicationSource = z.infer<typeof PreparedPublicationSourceSchema>;
// Scope data is not a grant: only a trusted Core adapter can register its separate live authorization handle.
export const PreparedPublicationAuthorizationScopeSchema = PreparedPublicationSourceSchema.omit({ revision: true }).extend({
  deliveryClass: z.literal("class_a"),
});
export type PreparedPublicationAuthorizationScope = z.infer<typeof PreparedPublicationAuthorizationScopeSchema>;
export const PreparedPublicationCandidateSchema = z.strictObject({
  candidateRef: Id, revision: Id, expiresAt: Time,
  // The delivery schema trims utterances. Refuse a noncanonical producer value instead of changing exact text.
  text: z.string().min(1).max(8_000).refine((text) => text.trim() === text, "text must already be canonical"),
});
export type PreparedPublicationCandidate = z.infer<typeof PreparedPublicationCandidateSchema>;
export const PreparedPublicationEditSchema = z.strictObject({ editId: Id, expectedRevision: Id });
export type PreparedPublicationEdit = z.infer<typeof PreparedPublicationEditSchema>;

export const PreparedPublicationResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("recorded"), runId: Id, deliveryId: Id, state: DeliveryStateSchema }),
  z.strictObject({ status: z.literal("deferred"), reason: z.enum(["foreground_busy", "held_slot_busy"]) }),
  z.strictObject({ status: z.literal("refused"), reason: z.enum([
    "invalid_input", "root_unavailable", "source_unavailable", "revision_unavailable", "output_committed", "closed",
  ]) }),
]);
export type PreparedPublicationResult = z.infer<typeof PreparedPublicationResultSchema>;
