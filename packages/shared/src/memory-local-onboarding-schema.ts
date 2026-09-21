/**
 * INPUT:  authenticated Local onboarding reads, explicit exclusions and durable invalidations
 * OUTPUT: strict memory.onboarding method, status, action and diagnostic contracts
 * POS:    shared/protocol — operator-only view of Core-owned workspace, producer and runtime evidence
 */
import { z } from "zod";
import { MemoryOperationSchema } from "./memory-operation-schema.ts";
import { MemoryLocalProgressSchema } from "./memory-local-operation-schema.ts";
import { MemoryMigrationReportSchema } from "./memory-migration-schema.ts";
import { MemoryRuntimeUnavailableReasonSchema } from "./memory-authority-status-schema.ts";

const Id = z.string().min(1).max(256);
export const MEMORY_ONBOARDING_METHODS = {
  preview: "memory.onboarding.preview", status: "memory.onboarding.status",
  exceptions: "memory.onboarding.exceptions", exclude: "memory.onboarding.exclude",
  subscribe: "memory.onboarding.subscribe", changed: "memory.onboarding.changed",
} as const;
export const MemoryOnboardingPreviewParamsSchema = z.strictObject({});
export const MemoryOnboardingPreviewResultSchema = MemoryMigrationReportSchema;
export const MemoryOnboardingStatusParamsSchema = z.strictObject({});
export const MemoryOnboardingReceiptSchema = z.strictObject({
  runId: Id, snapshotId: Id, epochId: Id, transactionId: Id, activatedAt: z.iso.datetime({ offset: true }),
});
export const MemoryOnboardingRunSchema = z.strictObject({
  runId: Id, snapshotId: Id, epochId: Id, status: z.enum(["running", "failed", "ready", "completed"]),
  supersededByRunId: Id.nullable(), progress: MemoryLocalProgressSchema,
  receipt: MemoryOnboardingReceiptSchema.nullable(),
});
export const MemoryOnboardingActionsSchema = z.strictObject({
  preview: z.boolean(), prepare: z.boolean(), resume: z.boolean(), replace: z.boolean(),
  activate: z.boolean(), recoverBinding: z.boolean(), reconcileSources: z.boolean(),
  cancelOperationId: z.uuid().nullable(), retryOperationId: z.uuid().nullable(),
});
export const MemoryOnboardingStatusSchema = z.strictObject({
  authority: z.strictObject({ mode: z.enum(["legacy-markdown", "canonical-local", "hindsight"]), epochId: Id.nullable() }),
  runtime: z.strictObject({ available: z.boolean(), unavailableReason: MemoryRuntimeUnavailableReasonSchema.nullable() }),
  run: MemoryOnboardingRunSchema.nullable(), operation: MemoryOperationSchema.nullable(),
  custody: z.strictObject({ openGroups: z.int().nonnegative(), recoverableGroups: z.int().nonnegative() }),
  actions: MemoryOnboardingActionsSchema, observedAt: z.iso.datetime({ offset: true }),
}).superRefine((value, ctx) => {
  if (value.runtime.available !== (value.runtime.unavailableReason === null)) {
    ctx.addIssue({ code: "custom", message: "runtime availability and reason disagree" });
  }
});
export const MemoryOnboardingExceptionsParamsSchema = z.strictObject({
  runId: Id, cursor: Id.nullable().optional(), limit: z.int().min(1).max(100).default(100),
});
export const MemoryOnboardingExceptionSchema = z.strictObject({
  sourceId: Id, code: z.string().min(1).max(64), relativePath: z.string().max(1024).optional(), canExclude: z.boolean(),
});
export const MemoryOnboardingExceptionsResultSchema = z.strictObject({
  items: z.array(MemoryOnboardingExceptionSchema).max(100), nextCursor: Id.nullable(),
});
export const MemoryOnboardingExcludeParamsSchema = z.strictObject({ runId: Id, sourceId: Id, reason: z.string().trim().min(1).max(512) });
export const MemoryOnboardingExcludeResultSchema = MemoryOnboardingStatusSchema;
export const MemoryOnboardingSubscribeParamsSchema = z.strictObject({});
export const MemoryOnboardingSubscribeResultSchema = z.strictObject({ status: z.literal("ok") });
export const MemoryOnboardingChangedSchema = z.strictObject({ reason: z.enum(["producer", "exclusion", "candidate", "binding"]) });
export type MemoryOnboardingPreviewResult = z.infer<typeof MemoryOnboardingPreviewResultSchema>;
export type MemoryOnboardingPreviewParams = z.infer<typeof MemoryOnboardingPreviewParamsSchema>;
export type MemoryOnboardingStatusParams = z.infer<typeof MemoryOnboardingStatusParamsSchema>;
export type MemoryOnboardingStatus = z.infer<typeof MemoryOnboardingStatusSchema>;
export type MemoryOnboardingRun = z.infer<typeof MemoryOnboardingRunSchema>;
export type MemoryOnboardingActions = z.infer<typeof MemoryOnboardingActionsSchema>;
export type MemoryOnboardingReceipt = z.infer<typeof MemoryOnboardingReceiptSchema>;
export type MemoryOnboardingExceptionsParams = z.infer<typeof MemoryOnboardingExceptionsParamsSchema>;
export type MemoryOnboardingExceptionsResult = z.infer<typeof MemoryOnboardingExceptionsResultSchema>;
export type MemoryOnboardingExcludeParams = z.infer<typeof MemoryOnboardingExcludeParamsSchema>;
export type MemoryOnboardingExcludeResult = z.infer<typeof MemoryOnboardingExcludeResultSchema>;
export type MemoryOnboardingChanged = z.infer<typeof MemoryOnboardingChangedSchema>;
export type MemoryOnboardingSubscribeResult = z.infer<typeof MemoryOnboardingSubscribeResultSchema>;
