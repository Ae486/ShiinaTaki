/**
 * INPUT: committed initiative decisions and delivery transitions
 * OUTPUT: v2 business events with no protected text or invented presentation outcomes
 * POS: shared/protocol — mixed-version reader companion to unchanged v1 producers
 */
import { z } from "zod";
const Id = z.string().min(1).max(200);
export const InitiativeEventKindSchema = z.enum([
  "initiative.decision", "delivery.staged", "delivery.held", "delivery.resumed",
  "delivery.dispatch_committed", "delivery.sent", "delivery.unknown", "delivery.no_target",
  "delivery.expired", "delivery.suppressed", "delivery.presentation_settled",
  "delivery.presented", "delivery.feedback_settled",
]);
export const InitiativeEventPayloadSchema = z.strictObject({
  kind: InitiativeEventKindSchema,
  state: z.enum(["committed", "staged", "held", "resumed", "dispatch_committed", "sent", "unknown", "no_target", "expired", "suppressed", "completed", "failed", "presented", "feedback_settled"]),
  deliveryId: Id,
  outcome: z.enum(["silent", "express", "speak"]).optional(),
  selectedCount: z.number().int().min(0).max(4).optional(),
  consideredCount: z.number().int().min(0).max(4).optional(),
  reasonCode: z.enum(["busy", "stale", "expired", "disabled", "policy", "budget", "gap", "binding_lost", "transport", "presentation"]).optional(),
  opportunityMs: z.number().int().min(0).max(3_600_000).optional(),
  disposition: z.enum(["engaged", "weak_non_engagement", "unknown"]).optional(),
}).superRefine((value, ctx) => {
  const feedback = value.kind === "delivery.feedback_settled";
  const presented = value.kind === "delivery.presented";
  // These fields are producer facts, never defaults inferred from a transport outcome.
  if (feedback || presented) {
    if (value.state !== (feedback ? "feedback_settled" : "presented") || (feedback && value.opportunityMs === undefined)
      || (feedback ? value.disposition === undefined : value.disposition !== undefined)) {
      ctx.addIssue({ code: "custom", message: "Presentation and feedback require matching observed facts" });
    }
  } else if (value.opportunityMs !== undefined || value.disposition !== undefined
    || value.state === "presented" || value.state === "feedback_settled") {
    ctx.addIssue({ code: "custom", message: "Feedback fields require a presentation or feedback producer" });
  }
});
export type InitiativeEventPayload = z.infer<typeof InitiativeEventPayloadSchema>;
export const RunEventV2Schema = z.strictObject({
  eventId: Id, runId: Id, attemptId: Id, seq: z.number().int().min(1).max(2_000_000_000),
  schemaVersion: z.literal("run-event.v2"), category: z.literal("lifecycle"), kind: InitiativeEventKindSchema,
  occurredAt: z.string().datetime({ offset: true }), source: z.literal("core.delivery"),
  correlation: z.strictObject({ triggerRequestId: Id.optional(), taskId: Id.optional(), parentRunId: Id.optional() }).optional(),
  payload: InitiativeEventPayloadSchema,
}).refine((event) => event.kind === event.payload.kind, "payload kind mismatch");
export type RunEventV2 = z.infer<typeof RunEventV2Schema>;
