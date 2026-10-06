/**
 * INPUT:  Core-owned manual replica requests and their exact scheduler claim and settlement
 * OUTPUT: validated durable producer evidence; timestamps are diagnostics, never attribution keys
 * POS:    shared — B5 request identity shared by the scheduler repository and operation owner
 */
import { z } from "zod";
import { MemoryReplicaErrorCodeSchema, MemoryReplicaRunKindSchema } from "./memory-replica-schedule-schema.ts";
import { MemoryReplicaLeaseSchema } from "./memory-replica-schema.ts";

const Timestamp = z.iso.datetime({ offset: true });
export const MemoryReplicaRequestSchema = z.strictObject({
  requestId: z.uuid(), bankId: z.string().min(1).max(256), kind: MemoryReplicaRunKindSchema,
  state: z.enum(["queued", "claimed", "succeeded", "failed", "cancelled"]),
  claim: MemoryReplicaLeaseSchema.nullable(), createdAt: Timestamp, settledAt: Timestamp.nullable(),
  errorCode: MemoryReplicaErrorCodeSchema.nullable(),
  nextAction: z.enum(["automatic_retry_scheduled", "explicit_retry_required"]).nullable(),
  lastSuccessAt: Timestamp.nullable(),
}).superRefine((row, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  if (row.claim && row.claim.bankId !== row.bankId) fail("claim belongs to another Bank");
  if ((row.state === "queued" || row.state === "cancelled") && row.claim !== null) fail("unclaimed request cannot carry a claim");
  if ((row.state === "claimed" || row.state === "succeeded") && row.claim === null) fail("claimed request requires its lease");
  if ((row.state === "queued" || row.state === "claimed") !== (row.settledAt === null)) fail("terminal request requires settlement");
  if ((row.state === "failed") !== (row.errorCode !== null && row.nextAction !== null)) fail("failure requires diagnostics");
  if (row.state !== "failed" && (row.errorCode !== null || row.nextAction !== null)) fail("non-failure cannot carry errors");
  if (row.state === "succeeded" && row.lastSuccessAt === null) fail("success requires its own completion time");
});
export type MemoryReplicaRequest = z.infer<typeof MemoryReplicaRequestSchema>;
