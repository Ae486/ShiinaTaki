/**
 * INPUT:  the live Hindsight connection state, B3 Bank rows, replica binding evidence and open lifecycle operations
 * OUTPUT: HindsightBankReadinessSchema, MemoryHindsightStatusSectionSchema (the memory.authority.status `hindsight` section)
 *         and the bank.provision / connection.revalidate request, producer, result and closed error-code schemas
 * POS:    shared/protocol — lifecycle contracts under Hindsight authority; actions and origins are Core-derived, never client rules
 */
import { z } from "zod";
import { HindsightErrorCodeSchema } from "./hindsight-connection-schema.ts";
import { MemoryReplicaErrorCodeSchema } from "./memory-replica-schedule-schema.ts";

const Id = z.string().min(1).max(256);
const CharacterId = z.string().min(1).max(160);
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Timestamp = z.iso.datetime({ offset: true });

export const HindsightBankReadinessSchema = z.enum(["ready", "syncing", "provisioning", "failed", "not_provisioned"]);
export type HindsightBankReadiness = z.infer<typeof HindsightBankReadinessSchema>;

const BankSchema = z.strictObject({
  scope: z.enum(["global", "character"]),
  characterId: Id.nullable(),
  /** Null only for a Character whose identity cannot map to a native Bank id. */
  nativeBankId: z.string().min(1).max(120).nullable(),
  readiness: HindsightBankReadinessSchema,
  errorCode: HindsightErrorCodeSchema.nullable(),
});

export const MemoryHindsightStatusSectionSchema = z.strictObject({
  connection: z.strictObject({
    config: z.enum(["ready", "disabled", "unconfigured"]),
    drift: z.enum(["none", "config_changed", "unreviewed"]),
    admittedAt: Timestamp.nullable(),
  }),
  banks: z.array(BankSchema).max(256),
  actions: z.strictObject({ revalidate: z.boolean(), provision: z.array(CharacterId).max(256) }),
}).superRefine((section, context) => {
  const fail = (message: string) => context.addIssue({ code: "custom", message });
  if (section.connection.config !== "ready" && (section.connection.drift !== "none" || section.connection.admittedAt !== null)) {
    fail("drift and admission evidence exist only for a ready connection");
  }
  const identities = section.banks.map((bank) => bank.scope === "global" ? "global" : `character:${bank.characterId}`);
  if (new Set(identities).size !== identities.length) fail("each Bank scope appears once");
  for (const bank of section.banks) {
    if ((bank.scope === "character") !== (bank.characterId !== null)) fail("Bank scope and Character binding disagree");
    if (bank.nativeBankId === null && bank.readiness !== "not_provisioned") fail("only an unprovisioned Bank lacks a native id");
    if (bank.errorCode !== null && (bank.readiness === "ready" || bank.readiness === "syncing")) fail("a serving Bank carries no setup error");
  }
  if (new Set(section.actions.provision).size !== section.actions.provision.length) fail("provision actions are unique");
});
export type MemoryHindsightStatusSection = z.infer<typeof MemoryHindsightStatusSectionSchema>;

export const MemoryHindsightLifecycleErrorCodeSchema = z.enum([
  ...MemoryReplicaErrorCodeSchema.options, "MEMORY_AUTHORITY_MISMATCH", "MEMORY_RUNTIME_UNAVAILABLE",
  "HINDSIGHT_LIFECYCLE_INTERRUPTED", "HINDSIGHT_LIFECYCLE_INTERNAL_ERROR",
]);
export type MemoryHindsightLifecycleErrorCode = z.infer<typeof MemoryHindsightLifecycleErrorCodeSchema>;
/** Core stamps who started a lifecycle operation so the automatic once-guard never counts an operator click. */
export const MemoryHindsightLifecycleOriginSchema = z.enum(["operator", "automatic"]);
export type MemoryHindsightLifecycleOrigin = z.infer<typeof MemoryHindsightLifecycleOriginSchema>;

export const MemoryBankProvisionRequestSchema = z.strictObject({ kind: z.literal("bank.provision"), characterId: CharacterId });
export const MemoryConnectionRevalidateRequestSchema = z.strictObject({ kind: z.literal("connection.revalidate"), expectedEpochId: Id });
export const MemoryBankProducerRefSchema = z.strictObject({
  kind: z.literal("bank"), origin: MemoryHindsightLifecycleOriginSchema, characterId: CharacterId, nativeBankId: Id,
  templateRevision: Id, admittedEpochId: Id, configFingerprint: Digest,
  phase: z.enum(["reserved", "probing", "applying", "syncing", "completed"]),
});
export const MemoryConnectionProducerRefSchema = z.strictObject({
  kind: z.literal("connection"), origin: MemoryHindsightLifecycleOriginSchema, epochId: Id,
  /** The published runtime's fingerprint at admission; null while the binding is unavailable. */
  fingerprintBefore: Digest.nullable(),
  /** The live configuration fingerprint the operation revalidates; null when the configuration was not ready. */
  fingerprintAfter: Digest.nullable(),
  phase: z.enum(["reserved", "validating", "verifying-banks", "recording", "rebinding", "completed"]),
});
export const MemoryBankResultSchema = z.strictObject({
  kind: z.literal("bank"), characterId: CharacterId, nativeBankId: Id, readiness: z.enum(["ready", "syncing", "failed"]),
});
export const MemoryConnectionResultSchema = z.strictObject({
  kind: z.literal("connection"), outcome: z.enum(["unchanged", "rebound", "binding_unavailable"]), fingerprint: Digest,
});
export type MemoryBankProvisionRequest = z.infer<typeof MemoryBankProvisionRequestSchema>;
export type MemoryConnectionRevalidateRequest = z.infer<typeof MemoryConnectionRevalidateRequestSchema>;
export type MemoryBankProducerRef = z.infer<typeof MemoryBankProducerRefSchema>;
export type MemoryConnectionProducerRef = z.infer<typeof MemoryConnectionProducerRefSchema>;
export type MemoryBankResult = z.infer<typeof MemoryBankResultSchema>;
export type MemoryConnectionResult = z.infer<typeof MemoryConnectionResultSchema>;
