/**
 * INPUT:  auxiliary provider-call metadata and bounded operator history filters
 * OUTPUT: strict row, query, cursor, and whole-filter usage aggregate schemas
 * POS:    shared/protocol — observed auxiliary accounting only; never Run billing authority
 */
import { z } from "zod";
import { MaintenanceOperationRefSchema } from "./maintenance-operation-ref-schema.ts";

const Id = z.string().trim().min(1).max(200);
const Label = z.string().trim().min(1).max(200);
const Provider = z.string().trim().min(1).max(100);
const Timestamp = z.iso.datetime({ offset: true }).transform((value) => new Date(value).toISOString());
const SafeCount = z.int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const NullableCount = SafeCount.nullable();

export const AuxiliaryCallSourceSchema = z.enum(["utility", "image-description", "screenshot-description"]);
export type AuxiliaryCallSource = z.infer<typeof AuxiliaryCallSourceSchema>;

export const AuxiliaryUsageCountsSchema = z.strictObject({
  inputTokens: NullableCount,
  noCacheTokens: NullableCount,
  cacheReadTokens: NullableCount,
  cacheWriteTokens: NullableCount,
  outputTokens: NullableCount,
  reasoningTokens: NullableCount,
  totalTokens: NullableCount,
});
export type AuxiliaryUsageCounts = z.infer<typeof AuxiliaryUsageCountsSchema>;

export const AuxiliaryModelCallStatusSchema = z.enum([
  "started", "completed", "failed", "cancelled", "interrupted",
]);
export type AuxiliaryModelCallStatus = z.infer<typeof AuxiliaryModelCallStatusSchema>;

export const AuxiliaryModelCallSchema = z.strictObject({
  callId: z.uuid(),
  taskId: z.uuid().nullable(),
  source: AuxiliaryCallSourceSchema,
  label: Label,
  provider: Provider,
  modelId: Id,
  startedAt: Timestamp,
  finishedAt: Timestamp.nullable(),
  updatedAt: Timestamp,
  status: AuxiliaryModelCallStatusSchema,
  responseId: Id.nullable(),
  usage: AuxiliaryUsageCountsSchema,
  operation: MaintenanceOperationRefSchema.optional(),
});
export type AuxiliaryModelCall = z.infer<typeof AuxiliaryModelCallSchema>;

export const AuxiliaryUsageCursorSchema = z.strictObject({ startedAt: Timestamp, callId: z.uuid() });
export type AuxiliaryUsageCursor = z.infer<typeof AuxiliaryUsageCursorSchema>;

export const AuxiliaryUsageQuerySchema = z.strictObject({
  from: Timestamp,
  to: Timestamp,
  source: AuxiliaryCallSourceSchema.optional(),
  label: Label.optional(),
  provider: Provider.optional(),
  modelId: Id.optional(),
  limit: z.int().min(1).max(100).default(50),
  cursor: AuxiliaryUsageCursorSchema.optional(),
  operation: MaintenanceOperationRefSchema.optional(),
}).superRefine((value, context) => {
  if (Date.parse(value.from) > Date.parse(value.to)) {
    context.addIssue({ code: "custom", path: ["from"], message: "from must not be later than to" });
  }
});
export type AuxiliaryUsageQuery = z.input<typeof AuxiliaryUsageQuerySchema>;

export const AuxiliaryUsageCounterAggregateSchema = z.strictObject({
  sum: NullableCount,
  knownCount: SafeCount,
});
export type AuxiliaryUsageCounterAggregate = z.infer<typeof AuxiliaryUsageCounterAggregateSchema>;

export const AuxiliaryUsageStateCountsSchema = z.strictObject({
  started: SafeCount,
  completed: SafeCount,
  failed: SafeCount,
  cancelled: SafeCount,
  interrupted: SafeCount,
});
export type AuxiliaryUsageStateCounts = z.infer<typeof AuxiliaryUsageStateCountsSchema>;

const TokenAggregatesSchema = z.strictObject({
  inputTokens: AuxiliaryUsageCounterAggregateSchema,
  noCacheTokens: AuxiliaryUsageCounterAggregateSchema,
  cacheReadTokens: AuxiliaryUsageCounterAggregateSchema,
  cacheWriteTokens: AuxiliaryUsageCounterAggregateSchema,
  outputTokens: AuxiliaryUsageCounterAggregateSchema,
  reasoningTokens: AuxiliaryUsageCounterAggregateSchema,
  totalTokens: AuxiliaryUsageCounterAggregateSchema,
});

export const AuxiliaryUsageCacheAggregateSchema = z.strictObject({
  pairedCount: SafeCount,
  inputTokens: NullableCount,
  cacheReadTokens: NullableCount,
  ratio: z.number().finite().nonnegative().max(1).nullable(),
});
export type AuxiliaryUsageCacheAggregate = z.infer<typeof AuxiliaryUsageCacheAggregateSchema>;

export const AuxiliaryUsageResultSchema = z.strictObject({
  scope: z.literal("observed-auxiliary"),
  rows: z.array(AuxiliaryModelCallSchema).max(100),
  nextCursor: AuxiliaryUsageCursorSchema.nullable(),
  totalCalls: SafeCount,
  stateCounts: AuxiliaryUsageStateCountsSchema,
  tokenCounts: TokenAggregatesSchema,
  cacheRead: AuxiliaryUsageCacheAggregateSchema,
});
export type AuxiliaryUsageResult = z.infer<typeof AuxiliaryUsageResultSchema>;
