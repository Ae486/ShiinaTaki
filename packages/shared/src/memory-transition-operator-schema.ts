/**
 * INPUT: Core-selected authority and original durable operation/transition evidence.
 * OUTPUT: bounded operator overview and closed reasons for preview/recovery actions.
 * POS: shared/protocol — availability is advisory; confirmation still passes full producer admission.
 */
import { z } from "zod";
import { MemoryOperationSchema } from "./memory-operation-schema.ts";
import { MemoryTransitionKindSchema } from "./memory-transition-schema.ts";
import { MemoryTransitionReadSchema, MemoryEmergencyTransitionPreviewSchema } from "./memory-transition-driver-schema.ts";

export const MemoryTransitionActionReasonSchema = z.enum([
  "wrong-provider", "configuration", "baseline", "capability", "foreign-branch", "quarantined",
  "busy", "stale", "lease-active", "settled", "unavailable", "unknown",
]);
export type MemoryTransitionActionReason = z.infer<typeof MemoryTransitionActionReasonSchema>;
export const MemoryTransitionActionSchema = z.strictObject({ allowed: z.boolean(), reason: MemoryTransitionActionReasonSchema.nullable() })
  .refine((value) => value.allowed === (value.reason === null), "allowed actions have no refusal reason");
export const MemoryTransitionOverviewParamsSchema = z.strictObject({});
export const MemoryTransitionEmergencyDisclosureSchema = z.strictObject({ banks: MemoryEmergencyTransitionPreviewSchema.shape.banks,
  backupAgeSeconds: MemoryEmergencyTransitionPreviewSchema.shape.backupAgeSeconds,
  lastVerifiedBackupId: MemoryEmergencyTransitionPreviewSchema.shape.lastVerifiedBackupId });
export const MemoryTransitionOverviewSchema = z.strictObject({
  provider: z.enum(["local", "hindsight"]).nullable(), epochId: z.string().nullable(),
  actions: z.array(z.strictObject({ kind: MemoryTransitionKindSchema, ...MemoryTransitionActionSchema.shape })).length(3)
    .refine((values) => new Set(values.map((value) => value.kind)).size === 3
      && values.every((value) => value.allowed === (value.reason === null)), "one consistent action per direction"),
  entries: z.array(z.strictObject({ operation: MemoryOperationSchema, status: MemoryTransitionReadSchema,
    cancel: MemoryTransitionActionSchema, recovery: MemoryTransitionActionSchema,
    currentAuthority: z.boolean(), emergency: MemoryTransitionEmergencyDisclosureSchema.nullable() })).max(50),
  /** History is explicitly bounded; no UI claim of a complete ledger. */
  hasOlder: z.boolean(),
});
export type MemoryTransitionOverview = z.infer<typeof MemoryTransitionOverviewSchema>;
