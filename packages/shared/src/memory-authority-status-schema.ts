/**
 * INPUT:  the active authority selection, selected runtime availability, B3 setup, B5 replica, Pending and operation rows
 * OUTPUT: MEMORY_AUTHORITY_METHODS plus one strict composite memory.authority.status read contract
 * POS:    shared/protocol — operator-only read; unknown stays unknown (no fabricated lag, health, freshness or zero counts)
 */
import { z } from "zod";
import { HindsightSetupSnapshotSchema } from "./hindsight-setup-schema.ts";
import { MemoryOperationSchema } from "./memory-operation-schema.ts";
import { MemoryReplicaSyncStatusSchema } from "./memory-replica-schedule-schema.ts";
import { PendingMemorySummarySchema } from "./pending-memory-schema.ts";

export const MEMORY_AUTHORITY_METHODS = { status: "memory.authority.status" } as const;

const Id = z.string().min(1).max(256);
const Timestamp = z.iso.datetime({ offset: true });

export const MemoryRuntimeUnavailableReasonSchema = z.enum(["authority_mismatch", "connection_unavailable", "stopped", "not_installed"]);
export type MemoryRuntimeUnavailableReason = z.infer<typeof MemoryRuntimeUnavailableReasonSchema>;

export const MemoryAuthorityStatusParamsSchema = z.strictObject({});
export const MemoryAuthorityStatusSchema = z.strictObject({
  authority: z.strictObject({
    mode: z.enum(["legacy-markdown", "canonical-local", "hindsight"]),
    epochId: Id.nullable(),
    providerLineageId: z.uuid().nullable(),
  }),
  runtime: z.strictObject({
    providerId: z.enum(["legacy-markdown", "local", "hindsight"]),
    available: z.boolean(),
    unavailableReason: MemoryRuntimeUnavailableReasonSchema.nullable(),
  }),
  setup: HindsightSetupSnapshotSchema,
  replica: z.array(MemoryReplicaSyncStatusSchema).max(256).nullable(),
  pending: z.array(z.strictObject({
    bankId: Id,
    summary: PendingMemorySummarySchema,
    parentWritesPending: z.int().min(0),
  })).max(256).nullable(),
  operations: z.strictObject({
    active: z.array(MemoryOperationSchema).max(50),
    recent: z.array(MemoryOperationSchema).max(20),
  }),
  derivedFreshness: z.literal("unknown"),
  observedAt: Timestamp,
}).superRefine((status, context) => {
  const fail = (message: string) => context.addIssue({ code: "custom", message });
  const hindsightLive = status.authority.mode === "hindsight" && status.runtime.available;
  if (hindsightLive !== (status.replica !== null) || hindsightLive !== (status.pending !== null)) {
    fail("replica and pending evidence exist exactly when the Hindsight runtime is available");
  }
  if (status.runtime.available !== (status.runtime.unavailableReason === null)) fail("runtime availability and reason disagree");
});
export type MemoryAuthorityStatus = z.infer<typeof MemoryAuthorityStatusSchema>;
export type MemoryAuthorityStatusParams = z.infer<typeof MemoryAuthorityStatusParamsSchema>;
