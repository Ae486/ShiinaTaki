/**
 * INPUT: trusted accepted-work Run identity and bounded quiescent transition facts
 * OUTPUT: internal transition contracts and strict v3 lifecycle events
 * POS: shared/protocol — extends the Run ledger; grants no source or publication authority
 */
import { z } from "zod";

export const ACCEPTED_WORK_PROVIDER = "core.accepted-work";
const Id = z.string().min(1).max(200);
export const RunWorkTransitionSchema = z.strictObject({
  runId: Id, attemptId: Id, expectedRunVersion: z.number().int().nonnegative(),
});
export const RunWorkHoldSchema = RunWorkTransitionSchema.extend({ reasonRef: Id });
export type RunWorkTransition = z.infer<typeof RunWorkTransitionSchema>;
export type RunWorkHold = z.infer<typeof RunWorkHoldSchema>;
export const RunWorkRefusalSchema = z.enum([
  "invalid_input", "missing_run", "wrong_scope", "stale_version", "stale_attempt",
  "invalid_state", "expired", "unfinished_effect", "delivery_pending", "binding_lost", "authority_changed", "closed",
]);
export type RunWorkRefusal = z.infer<typeof RunWorkRefusalSchema>;
export const RunWorkResultSchema = z.discriminatedUnion("changed", [
  z.strictObject({ changed: z.literal(true), state: z.enum(["waiting", "running"]), runVersion: z.number().int().nonnegative() }),
  z.strictObject({ changed: z.literal(false), reason: RunWorkRefusalSchema }),
]);
export type RunWorkResult = z.infer<typeof RunWorkResultSchema>;

const payload = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("run.work_held"), state: z.literal("waiting"), runVersion: z.number().int().nonnegative() }),
  z.strictObject({ kind: z.literal("run.work_resumed"), state: z.literal("running"), runVersion: z.number().int().nonnegative() }),
]);
export const RunWorkEventSchema = z.strictObject({
  eventId: Id, runId: Id, attemptId: Id, seq: z.number().int().min(1).max(2_000_000_000),
  schemaVersion: z.literal("run-event.v3"), category: z.literal("lifecycle"),
  kind: z.enum(["run.work_held", "run.work_resumed"]),
  occurredAt: z.string().datetime({ offset: true }), source: z.literal("core.run-work"),
  correlation: z.strictObject({ triggerRequestId: Id.optional(), taskId: Id.optional(), parentRunId: Id.optional() }).optional(),
  payload,
}).refine((event) => event.kind === event.payload.kind, "payload kind mismatch");
export type RunWorkEvent = z.infer<typeof RunWorkEventSchema>;
