/**
 * INPUT: operator timezone settings and connection-bound designated-device reports
 * OUTPUT: strict User Timezone state, revision checks and bounded operator protocol
 * POS: shared/protocol — the existing Core singleton is the only timezone authority; no Rust consumer
 */
import { z } from "zod";

const Revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const Timestamp = z.iso.datetime();
const DeviceId = z.uuid();

export const UserTimezoneNameSchema = z.string().min(1).max(100)
  .regex(/^[A-Za-z][A-Za-z0-9_+/-]*$/)
  .refine((value) => {
    try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; }
    catch { return false; }
  }, "must be an IANA timezone");

export const USER_TIMEZONE_METHODS = {
  read: "user-timezone.read", update: "user-timezone.update", report: "user-timezone.report",
} as const;

export const UserTimezoneStateSchema = z.strictObject({
  timezone: UserTimezoneNameSchema,
  mode: z.enum(["fixed", "follow-primary-device"]),
  authorityDeviceId: DeviceId.nullable(),
  revision: Revision,
  updatedAt: Timestamp,
  confirmedAt: Timestamp.nullable(),
  source: z.enum(["bootstrap", "operator", "device"]),
  sourceDeviceId: DeviceId.nullable(),
}).refine((value) => (value.mode === "fixed") === (value.authorityDeviceId === null), {
  message: "only follow mode designates an authority device",
}).refine((value) => value.source === "bootstrap"
  ? value.confirmedAt === null && value.sourceDeviceId === null
  : value.confirmedAt !== null && value.sourceDeviceId !== null, {
  message: "confirmation and source identity must describe actual evidence",
});
export type UserTimezoneState = z.infer<typeof UserTimezoneStateSchema>;

export const UserTimezoneRefusalReasonSchema = z.enum([
  "revision-conflict", "unknown-authority", "foreign-authority", "stale-source",
]);
export type UserTimezoneRefusalReason = z.infer<typeof UserTimezoneRefusalReasonSchema>;
export const UserTimezoneReadParamsSchema = z.strictObject({ claimReportSource: z.literal(true).optional() });
export type UserTimezoneReadParams = z.infer<typeof UserTimezoneReadParamsSchema>;
export const UserTimezoneReadResultSchema = z.strictObject({
  state: UserTimezoneStateSchema,
  reportStatus: z.enum(["fixed", "unavailable", "awaiting-report", "current"]),
  reportSourceId: z.uuid().optional(),
  refusal: UserTimezoneRefusalReasonSchema.optional(),
});
export type UserTimezoneReadResult = z.infer<typeof UserTimezoneReadResultSchema>;

export const UserTimezoneUpdateParamsSchema = z.discriminatedUnion("mode", [
  z.strictObject({ expectedRevision: Revision, mode: z.literal("fixed"), timezone: UserTimezoneNameSchema }),
  z.strictObject({ expectedRevision: Revision, mode: z.literal("follow-primary-device"), authorityDeviceId: DeviceId }),
]);
export type UserTimezoneUpdateParams = z.infer<typeof UserTimezoneUpdateParamsSchema>;
export const UserTimezoneReportParamsSchema = z.strictObject({
  expectedRevision: Revision, timezone: UserTimezoneNameSchema, reportSourceId: z.uuid(),
});
export type UserTimezoneReportParams = z.infer<typeof UserTimezoneReportParamsSchema>;
export const UserTimezoneMutationResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("accepted"), state: UserTimezoneStateSchema }),
  z.strictObject({ status: z.literal("ignored-fixed"), state: UserTimezoneStateSchema }),
  z.strictObject({ status: z.literal("refused"), reason: UserTimezoneRefusalReasonSchema, state: UserTimezoneStateSchema }),
]);
export type UserTimezoneMutationResult = z.infer<typeof UserTimezoneMutationResultSchema>;
