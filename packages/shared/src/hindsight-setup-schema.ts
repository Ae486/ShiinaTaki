/**
 * INPUT:  candidate Hindsight setup snapshots, deployment receipts, and operator method payloads
 * OUTPUT: HINDSIGHT_METHODS plus strict state-machine and operator protocol schemas
 * POS:    shared/protocol — operator-only setup surface; never contains secret values or raw provider errors
 */
import { z } from "zod";
import {
  HindsightBankLlmHealthProjectionSchema,
  HindsightBankSetupProjectionSchema,
  HindsightCompatibilityProjectionSchema,
  HindsightSetupErrorSchema,
} from "./hindsight-connection-schema.ts";

export const HINDSIGHT_METHODS = {
  status: "memory.hindsight.status",
  validate: "memory.hindsight.validate",
  setup: "memory.hindsight.setup",
  llmHealth: "memory.hindsight.llm-health",
  disable: "memory.hindsight.disable",
} as const;

export const HindsightSetupPhaseSchema = z.enum([
  "disabled", "unconfigured", "ready-to-validate", "validating", "compatible", "validating-templates",
  "initializing-banks", "applying-templates", "waiting-template-operations", "configured", "failed",
]);
export type HindsightSetupPhase = z.infer<typeof HindsightSetupPhaseSchema>;

const timestamp = z.iso.datetime({ offset: true });
const revision = z.number().int().nonnegative();
const boundedId = z.string().min(1).max(240);

export const HindsightSetupSnapshotSchema = z.strictObject({
  revision,
  phase: HindsightSetupPhaseSchema,
  lastSuccessfulPhase: HindsightSetupPhaseSchema.nullable(),
  configFingerprint: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  attemptId: boundedId.nullable(),
  compatibility: HindsightCompatibilityProjectionSchema.nullable(),
  banks: z.array(HindsightBankSetupProjectionSchema).max(256),
  modelHealth: z.enum(["not-run", "running", "healthy", "degraded", "failed"]),
  latestError: HindsightSetupErrorSchema.nullable(),
  lastAttemptAt: timestamp.nullable(),
  lastSuccessAt: timestamp.nullable(),
  updatedAt: timestamp,
}).superRefine((snapshot, ctx) => {
  // Post-activation provisioning adds per-Character rows that may be pending or failed; they are readiness evidence and
  // must not make the configured snapshot unreadable.
  const verified = (scope: "global" | "character") => snapshot.banks.some((bank) => bank.scope === scope && bank.status === "verified");
  if (snapshot.phase === "configured" && (!verified("global") || !verified("character"))) {
    ctx.addIssue({ code: "custom", message: "configured setup requires verified Global and Character Banks", path: ["banks"] });
  }
  if (snapshot.phase === "configured" && snapshot.compatibility === null) {
    ctx.addIssue({ code: "custom", message: "configured setup requires compatible evidence", path: ["compatibility"] });
  }
});
export type HindsightSetupSnapshot = z.infer<typeof HindsightSetupSnapshotSchema>;

export const HindsightManagedDeploymentReceiptSchema = z.strictObject({
  contractVersion: z.literal(1),
  helperId: boundedId,
  deploymentId: boundedId,
  endpoint: z.string().min(8).max(2048).url(),
  status: z.literal("ready"),
  storage: z.strictObject({
    kind: z.enum(["external-postgresql", "embedded-pg0"]),
    persistent: z.literal(true),
  }),
  immutableHindsightIdentity: boundedId,
  observedAt: timestamp,
});
export type HindsightManagedDeploymentReceipt = z.infer<typeof HindsightManagedDeploymentReceiptSchema>;

export const HindsightStatusParamsSchema = z.strictObject({});
export const HindsightStatusResultSchema = HindsightSetupSnapshotSchema;
export const HindsightValidateParamsSchema = z.strictObject({ expectedRevision: revision });
export const HindsightSetupParamsSchema = z.strictObject({
  expectedRevision: revision,
  characterId: z.string().min(1).max(160),
  managedReceipt: HindsightManagedDeploymentReceiptSchema.optional(),
});
export const HindsightDisableParamsSchema = z.strictObject({ expectedRevision: revision });
export const HindsightLlmHealthParamsSchema = z.strictObject({
  expectedRevision: revision,
  bankId: z.string().min(1).max(120).optional(),
  acknowledgeProviderCalls: z.literal(true),
});
export const HindsightLlmHealthResultSchema = z.strictObject({
  status: z.enum(["healthy", "degraded", "failed"]),
  banks: z.array(HindsightBankLlmHealthProjectionSchema).max(256),
});

export type HindsightStatusParams = z.infer<typeof HindsightStatusParamsSchema>;
export type HindsightValidateParams = z.infer<typeof HindsightValidateParamsSchema>;
export type HindsightSetupParams = z.infer<typeof HindsightSetupParamsSchema>;
export type HindsightDisableParams = z.infer<typeof HindsightDisableParamsSchema>;
export type HindsightLlmHealthParams = z.infer<typeof HindsightLlmHealthParamsSchema>;
export type HindsightLlmHealthResult = z.infer<typeof HindsightLlmHealthResultSchema>;
