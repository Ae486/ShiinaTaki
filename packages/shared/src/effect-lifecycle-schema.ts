import { z } from "zod";

const ID = z.string().trim().min(1).max(200);
const DIGEST = z.string().regex(/^[a-f0-9]{64}$/);
const ERROR_CODE = z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,99}$/);
const SAFE_SUMMARY = z.string().max(500).refine((value) => !/(prompt|completion|authorization\s*[:=]|bearer\s+|api[_-]?key\s*[:=]|password\s*[:=]|secret\s*[:=]|token\s*[:=]|cwd\s*[:=]|env\s*[:=])/i.test(value), "effect summary contains forbidden content");

export const EFFECT_SCHEMA_VERSION = "effect.v1" as const;
export const EffectKindSchema = z.enum(["model", "tool", "host", "mcp", "approval", "memory"]);
export const EffectStateSchema = z.enum(["prepared", "waiting", "intent_committed", "effect_running", "settling", "terminal"]);
export const EffectReplayPostureSchema = z.enum(["safe", "never"]);
export const EffectOutcomeSchema = z.enum(["completed", "failed", "cancelled", "deadline_exceeded", "outcome_unknown", "reconciliation_required"]);
export const EffectSourceRefSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("model"), provider: ID, modelId: ID }),
  z.strictObject({ type: z.literal("tool"), toolName: ID }),
  z.strictObject({ type: z.literal("approval"), approvalId: ID }),
  z.strictObject({ type: z.literal("host"), operationId: ID }),
  z.strictObject({ type: z.literal("mcp"), serverId: ID, generation: z.number().int().positive().max(2_000_000_000) }),
  z.strictObject({ type: z.literal("memory"), requestId: ID, authorityEpoch: ID, providerId: ID,
    providerLineageId: ID, capabilityDigest: DIGEST, operation: z.enum(["retain", "recall", "reflect", "edit", "invalidate", "restore"]) }),
]);
export const EffectExecutorRefSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("provider"), provider: ID }),
  z.strictObject({ type: z.literal("core"), module: ID }),
  z.strictObject({ type: z.literal("host"), hostId: ID, connectionGeneration: z.number().int().positive().max(2_000_000_000) }),
  z.strictObject({ type: z.literal("mcp"), serverId: ID, generation: z.number().int().positive().max(2_000_000_000) }),
  z.strictObject({ type: z.literal("memory"), authorityEpoch: ID, providerId: ID, providerLineageId: ID,
    capabilityDigest: DIGEST }),
]);
export const ApprovalEffectRefSchema = z.strictObject({
  approvalId: ID, policyGeneration: z.number().int().positive().max(2_000_000_000),
  approvalGeneration: z.number().int().positive().max(2_000_000_000), bindingDigest: DIGEST,
  expiresAt: z.string().datetime({ offset: true }).optional(),
});
export type ApprovalEffectRef = z.infer<typeof ApprovalEffectRefSchema>;
export const EffectLifecycleSchema = z.strictObject({
  schemaVersion: z.literal(EFFECT_SCHEMA_VERSION), effectId: ID, runId: ID, attemptId: ID,
  kind: EffectKindSchema, state: EffectStateSchema, version: z.number().int().nonnegative().max(2_000_000_000),
  sourceRef: EffectSourceRefSchema, executorRef: EffectExecutorRefSchema.optional(), inputDigest: DIGEST.optional(), approvalRef: ApprovalEffectRefSchema.optional(),
  replayPosture: EffectReplayPostureSchema, capturedGenerationRef: ID.optional(), idempotencyKey: ID.optional(),
  reservedResultRef: ID.optional(), reservedUsageRef: ID.optional(), startedAt: z.string().datetime({ offset: true }).optional(),
  settledAt: z.string().datetime({ offset: true }).optional(), outcome: EffectOutcomeSchema.optional(),
  errorCode: ERROR_CODE.optional(), summary: SAFE_SUMMARY.optional(),
});
export type EffectLifecycle = z.infer<typeof EffectLifecycleSchema>;

export const UsageQualitySchema = z.enum(["reported", "estimated", "unknown"]);
export const UsageRecordSchema = z.strictObject({
  schemaVersion: z.literal(EFFECT_SCHEMA_VERSION), usageId: ID, runId: ID, attemptId: ID, effectId: ID,
  provider: ID, modelId: ID, quality: UsageQualitySchema,
  inputTokens: z.number().int().nonnegative().max(1_000_000_000).optional(),
  outputTokens: z.number().int().nonnegative().max(1_000_000_000).optional(),
  totalTokens: z.number().int().nonnegative().max(1_000_000_000).optional(),
  recordedAt: z.string().datetime({ offset: true }),
});
export type UsageRecord = z.infer<typeof UsageRecordSchema>;
