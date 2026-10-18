/**
 * INPUT:  an explicit exact-plan/Bank/child observation request and the current Native read result
 * OUTPUT: bounded observed-at evidence or explicit stale/unavailable states without cached-success fallback
 * POS:    operator read plane — rollout history remains separate and no observation admits provider work
 */
import { z } from "zod";
import { HindsightTemplateIdSchema } from "./hindsight-template-definition-schema.ts";
import { HindsightTemplateRefreshResultSchema } from "./hindsight-template-schema.ts";

export const MemoryTemplateDerivedParamsSchema = z.strictObject({ planId: z.uuid(), bankId: HindsightTemplateIdSchema, childId: z.uuid() });
export type MemoryTemplateDerivedParams = z.infer<typeof MemoryTemplateDerivedParamsSchema>;
export const MemoryTemplateDerivedObservationSchema = z.discriminatedUnion("state", [
  MemoryTemplateDerivedParamsSchema.extend({ state: z.literal("observed"), observedAt: z.iso.datetime({ offset: true }),
    result: HindsightTemplateRefreshResultSchema }),
  MemoryTemplateDerivedParamsSchema.extend({ state: z.literal("stale"), observedAt: z.null(), reason: z.enum(["identity_changed", "quarantined"]) }),
  MemoryTemplateDerivedParamsSchema.extend({ state: z.literal("unavailable"), observedAt: z.null(),
    reason: z.enum(["not_observed", "connection_unavailable", "unsupported", "request_failed", "invalid_evidence"]) }),
]).refine((value) => value.state !== "observed" || value.result.target.bank_id === value.bankId && value.result.child_id === value.childId,
  "derived observation identity does not match its requested Bank and child");
export type MemoryTemplateDerivedObservation = z.infer<typeof MemoryTemplateDerivedObservationSchema>;
