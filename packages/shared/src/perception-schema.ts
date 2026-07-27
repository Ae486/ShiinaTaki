/**
 * INPUT:  candidate perception.* params/results (the operator's privacy + activity-card surface)
 * OUTPUT: PERCEPTION_METHODS + pause-state / pause-set / activity-card schemas (+types)
 * POS:    shared/protocol — the Privacy Pause + activity-card contract (T3b; panel UI lands with #26); operator-only,
 *         NO Rust mirror (webview↔core only, like the media and avatar surfaces) and so no golden fixtures — the
 *         fixture sweep is the Rust anti-drift contract, and nothing Rust-side consumes these shapes.
 */
import { z } from "zod";

// Operator-role methods (mirror of permission.* / media.*): the settings panel drives these. The AGENT has no tool
// that reaches them — un-pausing its own observation would be self-escalation (permission-authorization NL red line).
export const PERCEPTION_METHODS = {
  pauseGet: "perception.pauseGet", // operator → core: read the Privacy Pause snapshot
  pauseSet: "perception.pauseSet", // operator → core: pause (optionally until a deadline) or resume ambient sampling
  card: "perception.card", // operator → core: the activity card { current, recent, samplingStatus, pauseState }
} as const;

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

// "Is it observing me right now" — the Recall tray-indicator concern, per sampler. False also covers a sampler that
// stopped itself for the session after a denial, so the badge never claims sampling that is not happening.
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
