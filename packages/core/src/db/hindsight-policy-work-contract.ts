/**
 * INPUT:  verified native/application policy targets and registry-owned Block snapshots
 * OUTPUT: exact durable work identities, lease/result schemas and immutable proposal validation
 * POS:    core/db — curator journal contract; native writes and application command execution remain separate
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  HindsightCurrentCanonicalBankSchema, TakiApplicationArtifactSchema, TakiApplicationArtifactVersionSchema,
  TakiApplicationNativeRecordSchema, TakiApplicationNativeVersionSchema, TakiApplicationMemoryBodySchema,
  TakiApplicationBlockBodySchema, TakiApplicationNamespaceSchema, TakiApplicationIdSchema,
  TakiApplicationTimeSchema, TakiApplicationAssessmentFailureSchema, MemoryBankScopeSchema, hindsightApplicationTaggedJson,
} from "@taki/shared";
import { getBlock } from "../memory/block-registry.ts";
import { hindsightApplicationHash, hindsightApplicationNativeHash, sameApplicationValue, withoutApplicationHash } from "../memory/hindsight/hindsight-application-integrity.ts";
import { projectHindsightApplicationNativeUnit } from "../memory/hindsight/hindsight-application-projection.ts";
import { proposeHindsightPolicyAssessment, proposeHindsightPolicyFailure } from "../memory/hindsight/hindsight-policy-assessment.ts";

const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const HindsightPolicyWorkScopeSchema = z.strictObject({
  authorityEpochId: TakiApplicationIdSchema, bankId: TakiApplicationIdSchema, namespace: TakiApplicationNamespaceSchema,
});
export type HindsightPolicyWorkScope = z.infer<typeof HindsightPolicyWorkScopeSchema>;
export const HindsightPolicyWorkKeySchema = HindsightPolicyWorkScopeSchema.extend({ workId: TakiApplicationIdSchema });
export type HindsightPolicyWorkKey = z.infer<typeof HindsightPolicyWorkKeySchema>;
export const HindsightPolicySourceRefSchema = z.strictObject({ bankId: TakiApplicationIdSchema,
  namespace: TakiApplicationNamespaceSchema, native: TakiApplicationNativeVersionSchema, artifact: TakiApplicationArtifactVersionSchema });
export type HindsightPolicySourceRef = z.infer<typeof HindsightPolicySourceRefSchema>;
export const HindsightPolicyTargetSchema = z.strictObject({ kind: z.literal("policy"), bank: HindsightCurrentCanonicalBankSchema,
  native: TakiApplicationNativeRecordSchema, artifact: TakiApplicationArtifactSchema, memory: TakiApplicationMemoryBodySchema });
export type HindsightPolicyTarget = z.infer<typeof HindsightPolicyTargetSchema>;
export const HindsightPolicyBlockSnapshotSchema = z.strictObject({ blockId: TakiApplicationIdSchema,
  scope: MemoryBankScopeSchema, value: TakiApplicationBlockBodySchema.nullable() });
export type HindsightPolicyBlockSnapshot = z.infer<typeof HindsightPolicyBlockSnapshotSchema>;
export const HindsightPolicyBlockTargetSchema = z.strictObject({ kind: z.literal("block"), bank: HindsightCurrentCanonicalBankSchema,
  blockId: TakiApplicationIdSchema, block: TakiApplicationBlockBodySchema.nullable(), artifact: TakiApplicationArtifactSchema.nullable(),
  sources: z.array(HindsightPolicySourceRefSchema), contextBlocks: z.array(HindsightPolicyBlockSnapshotSchema) });
export type HindsightPolicyBlockTarget = z.infer<typeof HindsightPolicyBlockTargetSchema>;
export const HindsightPolicyWorkTargetSchema = z.discriminatedUnion("kind", [HindsightPolicyTargetSchema, HindsightPolicyBlockTargetSchema]);
export type HindsightPolicyWorkTarget = z.infer<typeof HindsightPolicyWorkTargetSchema>;
export const HindsightPolicyPromptEvidenceSchema = z.strictObject({ promptVersion: z.string().min(1), promptHash: Hash });
export type HindsightPolicyPromptEvidence = z.infer<typeof HindsightPolicyPromptEvidenceSchema>;
export const HindsightPolicyWorkResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("assessment"), body: TakiApplicationMemoryBodySchema, prompt: HindsightPolicyPromptEvidenceSchema, at: TakiApplicationTimeSchema }),
  z.strictObject({ kind: z.literal("assessment-failure"), body: TakiApplicationMemoryBodySchema,
    prompt: HindsightPolicyPromptEvidenceSchema.nullable(), failure: TakiApplicationAssessmentFailureSchema, nextAttemptAt: TakiApplicationTimeSchema }),
  z.strictObject({ kind: z.literal("block-update"), body: TakiApplicationBlockBodySchema, prompt: HindsightPolicyPromptEvidenceSchema, at: TakiApplicationTimeSchema }),
  z.strictObject({ kind: z.literal("block-unchanged"), prompt: HindsightPolicyPromptEvidenceSchema, at: TakiApplicationTimeSchema }),
]);
export type HindsightPolicyWorkResult = z.infer<typeof HindsightPolicyWorkResultSchema>;
export const HindsightPolicyWorkRecordSchema = z.strictObject({
  key: HindsightPolicyWorkKeySchema, target: HindsightPolicyWorkTargetSchema,
  state: z.enum(["ready", "claimed", "saved", "completed", "superseded"]), revision: z.int().positive(), claims: z.int().nonnegative(),
  claimToken: z.uuid().nullable(), claimUntil: TakiApplicationTimeSchema.nullable(), nextAttemptAt: TakiApplicationTimeSchema.nullable(),
  prompt: HindsightPolicyPromptEvidenceSchema.nullable(), result: HindsightPolicyWorkResultSchema.nullable(),
  commandRequestId: TakiApplicationIdSchema, lastFailure: z.enum(["model_unavailable", "model_failed", "invalid_result", "revision_conflict", "cancelled", "publication_pending"]).nullable(),
  createdAt: TakiApplicationTimeSchema, updatedAt: TakiApplicationTimeSchema, finishedAt: TakiApplicationTimeSchema.nullable(),
});
export type HindsightPolicyWorkRecord = z.infer<typeof HindsightPolicyWorkRecordSchema>;

export function hindsightPolicyWorkIdentity(scope: HindsightPolicyWorkScope, target: HindsightPolicyWorkTarget): string {
  const captured = { authorityEpochId: scope.authorityEpochId, bankId: scope.bankId, namespace: scope.namespace };
  return `policy-work:${policyWorkValueHash({ domain: "hindsight-policy-work.v1", scope: captured, target })}`;
}
export function policyWorkValueHash(value: unknown): string { return createHash("sha256").update(hindsightApplicationTaggedJson(value)).digest("hex"); }

export function validateHindsightPolicyWorkTarget(scope: HindsightPolicyWorkScope, target: HindsightPolicyWorkTarget): void {
  if (target.bank.authorityEpochId !== scope.authorityEpochId || target.bank.bankId !== scope.bankId) invalid();
  if (target.kind === "block") { validateBlockTarget(scope, target); return; }
  if (target.native.version.object_kind !== "memory_unit" || target.native.payload.bank_id !== scope.bankId
    || hindsightApplicationNativeHash(target.native.payload) !== target.native.version.payload_hash
    || target.artifact.binding.kind !== "exact_native" || !sameApplicationValue(target.artifact.binding.native, target.native.version)
    || target.artifact.key.artifact_kind !== "memory" || target.artifact.tombstoned
    || !sameApplicationValue(target.memory.assessment.target, target.native.version)
    || target.artifact.body_ref.body_schema !== "application-memory.v1"
    || hindsightApplicationHash({ ...scope, domain: "body", value: target.memory }) !== target.artifact.body_ref.payload_hash) invalid();
  validateArtifact(scope, target.artifact);
}

export function policyAssessmentTarget(scope: HindsightPolicyWorkScope, target: HindsightPolicyTarget) {
  const native = target.native.version;
  const artifact = { key: target.artifact.key, revision: target.artifact.revision, record_hash: target.artifact.record_hash };
  return { context: { namespace: scope.namespace, authorityEpochId: scope.authorityEpochId,
    bank: target.bank, activeCharacterId: target.bank.scope.characterId,
    native: { status: "verified" as const, namespace: scope.namespace, bankId: scope.bankId, native,
      unit: projectHindsightApplicationNativeUnit({ ...scope, native: target.native }) } },
    state: { status: "present" as const, namespace: scope.namespace, bankId: scope.bankId, native, artifact, body: target.memory },
    expectedNative: native, expectedArtifact: artifact, expectedPolicyVersion: target.memory.policy.policyVersion };
}

export function validateHindsightPolicyWorkResult(record: Pick<HindsightPolicyWorkRecord, "key" | "target" | "prompt">, result: HindsightPolicyWorkResult): void {
  if (!sameApplicationValue(result.prompt, record.prompt)) invalid();
  if (record.target.kind === "policy") {
    const target = policyAssessmentTarget(record.key, record.target);
    const proposed = result.kind === "assessment" ? proposeHindsightPolicyAssessment({ ...target, policy: assessmentFields(result.body.policy),
      intent: "automatic", prompt: result.prompt, completedAt: result.at }) : result.kind === "assessment-failure"
        ? proposeHindsightPolicyFailure({ ...target, failure: result.failure, prompt: result.prompt, nextAttemptAt: result.nextAttemptAt }) : null;
    if (!proposed || !("body" in result) || !sameApplicationValue(proposed, result.body)) invalid();
  } else {
    if (result.kind === "block-unchanged") return;
    if (result.kind !== "block-update" || result.body.block_id !== record.target.blockId
      || !sameApplicationValue(result.body.scope, record.target.bank.scope) || result.body.writer !== "background"
      || result.body.block_revision !== (record.target.block?.block_revision ?? 0) + 1 || result.body.updated_at !== result.at) invalid();
  }
}

function assessmentFields(policy: HindsightPolicyTarget["memory"]["policy"]) {
  const { layerId, importance, visibility, disclosure, emotionalWeight, retention } = policy;
  return { layerId, importance, visibility, disclosure, emotionalWeight, retention };
}

function validateBlockTarget(scope: HindsightPolicyWorkScope, target: HindsightPolicyBlockTarget): void {
  const definition = getBlock(target.blockId);
  if (!definition || definition.writer !== "background" || (definition.ownership === "global" ? "global" : "character") !== target.bank.scope.kind) invalid();
  if (target.block && (target.block.block_id !== target.blockId || target.block.writer !== "background"
    || !sameApplicationValue(target.block.scope, target.bank.scope))) invalid();
  for (const snapshot of target.contextBlocks) {
    const registry = getBlock(snapshot.blockId); const block = snapshot.value;
    if (!registry || (registry.ownership === "global" ? "global" : "character") !== snapshot.scope.kind
      || snapshot.scope.kind === "character" && !sameApplicationValue(snapshot.scope, target.bank.scope)
      || block && (block.block_id !== snapshot.blockId || registry.writer !== block.writer || !sameApplicationValue(block.scope, snapshot.scope))) invalid();
  }
  if (target.artifact) {
    validateArtifact(scope, target.artifact);
    if (target.artifact.tombstoned || target.artifact.binding.kind !== "core_block" || target.artifact.key.artifact_kind !== "block"
      || target.artifact.body_ref.body_schema !== "application-block.v1" || !target.block
      || hindsightApplicationHash({ ...scope, domain: "body", value: target.block }) !== target.artifact.body_ref.payload_hash) invalid();
  }
}
function validateArtifact(scope: HindsightPolicyWorkScope, artifact: HindsightPolicyTarget["artifact"]): void {
  if (artifact.bank_id !== scope.bankId || !sameApplicationValue(artifact.namespace, scope.namespace)
    || hindsightApplicationHash({ ...scope, domain: "record", value: withoutApplicationHash(artifact, "record_hash") }) !== artifact.record_hash) invalid();
}
function invalid(): never { throw new Error("MEMORY_INTEGRITY_ERROR"); }
