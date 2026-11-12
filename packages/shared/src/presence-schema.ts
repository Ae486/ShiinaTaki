/**
 * INPUT: authenticated operator surface reports without content or device assertions
 * OUTPUT: strict bounded source, input-age and aggregate presence protocol
 * POS: shared/protocol — connection identity and receipt time remain Core-owned
 */
import { z } from "zod";

export const PRESENCE_METHODS = {
  report: "presence.report", read: "presence.read", presentationReport: "timeline.presentation.report",
} as const;

export const PresenceSourceIdSchema = z.string().min(1).max(100);
export const PresenceSequenceSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const PresenceObservedAgeSchema = z.number().int().min(0).max(30_000);
export const PresenceSurfaceSchema = z.enum(["home", "chat", "pet", "phone"]);
export const PresenceReportParamsSchema = z.strictObject({
  sourceId: PresenceSourceIdSchema,
  sequence: PresenceSequenceSchema,
  observedAgeMs: PresenceObservedAgeSchema,
  surface: PresenceSurfaceSchema,
  state: z.enum(["active", "retired"]),
  visible: z.boolean(),
  focused: z.boolean(),
  // C3 additive producer evidence. Missing on C2 clients means suspended; it never upgrades presence itself.
  inputContinuity: z.enum(["tracked", "suspended"]).optional(),
  lastInput: z.strictObject({
    sequence: PresenceSequenceSchema,
    kind: z.enum(["pointer", "keyboard", "touch"]),
    ageMs: z.number().int().min(0).max(86_400_000),
  }).nullable(),
});
export type PresenceReportParams = z.infer<typeof PresenceReportParamsSchema>;

export const PresenceReportResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("accepted"), leaseMs: z.number().int().nonnegative().max(30_000) }),
  z.strictObject({ status: z.literal("refused"), reason: z.enum([
    "invalid-report", "unauthorized", "stale-source", "stale-sequence", "stale-observation",
    "stale-input", "source-limit", "exposure-limit", "unknown-message", "rate-limited",
  ]) }),
]);
export type PresenceReportResult = z.infer<typeof PresenceReportResultSchema>;

export const PresenceReadParamsSchema = z.strictObject({});
export const PresenceSnapshotSchema = z.strictObject({
  state: z.enum(["present", "unknown"]),
  sourceCount: z.number().int().min(0).max(128),
  deviceCount: z.number().int().min(0).max(128),
  inputFreshSources: z.number().int().min(0).max(128),
  nativePresence: z.enum(["present", "inactive", "unknown"]),
  observedAt: z.string().datetime(),
});
export type PresenceSnapshot = z.infer<typeof PresenceSnapshotSchema>;
