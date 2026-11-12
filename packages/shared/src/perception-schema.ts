/**
 * INPUT:  candidate operator perception.* params/results and content-free invalidations
 * OUTPUT: PERCEPTION_METHODS + strict pause, card, subscription and change schemas/types
 * POS:    shared/protocol — operator↔Core only; no Rust consumer or Rust protocol fixtures
 */
import { z } from "zod";

// Operator-role methods (mirror of permission.* / media.*): the settings panel drives these. The AGENT has no tool
// that reaches them — un-pausing its own observation would be self-escalation (permission-authorization NL red line).
export const PERCEPTION_METHODS = {
  pauseGet: "perception.pauseGet", // operator → core: read the Privacy Pause snapshot
  pauseSet: "perception.pauseSet", // operator → core: pause (optionally until a deadline) or resume ambient sampling
  card: "perception.card", // operator → core: the activity card { current, recent, samplingStatus, pauseState }
  subscribe: "perception.subscribe", // operator → core: opt in once per physical connection
  changed: "perception.changed", // core → subscribed operators: the read projection may have changed
} as const;

export const PerceptionSubscribeParamsSchema = z.strictObject({});
export type PerceptionSubscribeParams = z.infer<typeof PerceptionSubscribeParamsSchema>;
export const PerceptionSubscribeResultSchema = z.strictObject({ status: z.literal("ok") });
export type PerceptionSubscribeResult = z.infer<typeof PerceptionSubscribeResultSchema>;

// This process-local sequence orders invalidations only. It is neither a persisted cursor nor a revision of a
// card response, and carries no sampled identity, privacy reason or observation content.
export const PerceptionChangedSchema = z.strictObject({ revision: z.int().nonnegative() });
export type PerceptionChanged = z.infer<typeof PerceptionChangedSchema>;

// `until` is an epoch-ms auto-resume deadline (the caller computes "until tomorrow" = local midnight — a timezone
// is the client's business, never the core's); null = paused until manually resumed, or not paused at all.
export const PerceptionPauseStateSchema = z.strictObject({
  paused: z.boolean(),
  until: z.int().positive().nullable(),
});
export type PerceptionPauseState = z.infer<typeof PerceptionPauseStateSchema>;

export const PerceptionPauseGetParamsSchema = z.strictObject({});
export type PerceptionPauseGetParams = z.infer<typeof PerceptionPauseGetParamsSchema>;

// A discriminated union rather than one optional field: a RESUME carries no deadline at all, so a client can never
// send `{paused:false, until:...}` and wonder which half took effect.
export const PerceptionPauseSetParamsSchema = z.discriminatedUnion("paused", [
  z.strictObject({ paused: z.literal(true), until: z.int().positive().nullable().optional() }),
  z.strictObject({ paused: z.literal(false) }),
]);
export type PerceptionPauseSetParams = z.infer<typeof PerceptionPauseSetParamsSchema>;

// One coalesced stretch of foreground activity as the card shows it (the core's ActivityEntry, on the wire).
// windowTitle is already PII-scrubbed at the sense seam — the card never re-derives it.
export const PerceptionActivityEntrySchema = z.strictObject({
  processName: z.string(),
  windowTitle: z.string(),
  startedAt: z.int(),
  durationMs: z.int().min(0),
  samples: z.int().min(1),
  idle: z.boolean(),
});
export type PerceptionActivityEntry = z.infer<typeof PerceptionActivityEntrySchema>;

// Scheduled-loop state only: true does not prove capture, Host availability, or an unpaused tick. False also covers
// a sampler that stopped itself for the session after a denial.
export const PerceptionSamplingStatusSchema = z.strictObject({
  foreground: z.boolean(),
  ambientScreen: z.boolean(),
});
export type PerceptionSamplingStatus = z.infer<typeof PerceptionSamplingStatusSchema>;

export const PerceptionCardParamsSchema = z.strictObject({});
export type PerceptionCardParams = z.infer<typeof PerceptionCardParamsSchema>;

export const PerceptionCardSchema = z.strictObject({
  current: PerceptionActivityEntrySchema.nullable(),
  recent: z.array(PerceptionActivityEntrySchema),
  samplingStatus: PerceptionSamplingStatusSchema,
  pauseState: PerceptionPauseStateSchema,
});
export type PerceptionCard = z.infer<typeof PerceptionCardSchema>;
