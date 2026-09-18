/**
 * INPUT:  original Bank/source/Block evidence and exact D77 artifact mutations
 * OUTPUT: typed application bodies, bindings, immutable CAS commands and historical receipts
 * POS:    shared application-state wire — original evidence identities remain separate from current native bindings
 */
import { z } from "zod";
import { HindsightCurrentCanonicalBankSchema, HindsightCurrentCanonicalSourceSchema } from "./hindsight-current-canonical-schema.ts";
import { MemoryBankScopeSchema } from "./memory-provider-domain-schema.ts";
import { TakiApplicationJsonObjectSchema } from "./hindsight-application-json.ts";
import {
  TakiApplicationIdSchema as Id, TakiApplicationHashSchema as Hash, TakiApplicationRevisionSchema as Revision,
  TakiApplicationTimeSchema as Time, TakiApplicationCountSchema as Count, TakiApplicationObjectKindSchema,
  TakiApplicationNamespaceSchema, TakiApplicationNativeVersionSchema, TakiApplicationArtifactKeySchema,
  TakiApplicationArtifactVersionSchema, TakiApplicationBodyRefSchema, TakiApplicationCheckpointSchema,
  TakiApplicationFailureCodeSchema,
} from "./hindsight-application-primitives-schema.ts";

export const TakiApplicationBankBodySchema = z.strictObject({
  scope: MemoryBankScopeSchema, original_bank: HindsightCurrentCanonicalBankSchema.nullable(),
  original_provider_lineage: z.uuid().nullable(), original_authority_epoch_id: Id.nullable(),
});
export type TakiApplicationBankBody = z.infer<typeof TakiApplicationBankBodySchema>;
export const TakiApplicationOriginalWitnessSchema = z.strictObject({
  source_kind: TakiApplicationObjectKindSchema, source_id: Id, source_revision: Revision, source_payload_hash: Hash,
});
export const TakiApplicationSourceBodySchema = z.strictObject({
  original_source: HindsightCurrentCanonicalSourceSchema, encoded_metadata: TakiApplicationJsonObjectSchema.nullable(),
  original_witness: TakiApplicationOriginalWitnessSchema.nullable(), operation_id: z.uuid().nullable(),
});
export type TakiApplicationSourceBody = z.infer<typeof TakiApplicationSourceBodySchema>;
export const TakiApplicationBlockBodySchema = z.strictObject({
  block_id: Id, scope: MemoryBankScopeSchema, content: z.string(), block_revision: Revision,
  updated_at: Time, writer: z.enum(["user", "background"]), block_contract_version: z.literal(1).default(1),
});
export type TakiApplicationBlockBody = z.infer<typeof TakiApplicationBlockBodySchema>;

export const TakiApplicationBindingSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("exact_native"), native: TakiApplicationNativeVersionSchema }),
  z.strictObject({ kind: z.literal("awaiting_native"), operation_id: z.uuid(), document_id: Id }),
  z.strictObject({ kind: z.literal("core_block") }),
]);
export type TakiApplicationBinding = z.infer<typeof TakiApplicationBindingSchema>;
export const TakiApplicationArtifactSchema = z.strictObject({
  namespace: TakiApplicationNamespaceSchema, bank_id: Id, key: TakiApplicationArtifactKeySchema, revision: Revision,
  body_ref: TakiApplicationBodyRefSchema, binding: TakiApplicationBindingSchema, tombstoned: z.boolean(),
  created_at: Time, updated_at: Time, record_hash: Hash,
});
export type TakiApplicationArtifact = z.infer<typeof TakiApplicationArtifactSchema>;
export const TakiApplicationActorSchema = z.strictObject({ kind: z.enum(["user", "background", "restore"]), actor_ref: Id });
export type TakiApplicationActor = z.infer<typeof TakiApplicationActorSchema>;

export const TakiApplicationCommandSchema = z.discriminatedUnion("command", [
  z.strictObject({ command: z.literal("put_artifact"), key: TakiApplicationArtifactKeySchema,
    expected_artifact: TakiApplicationArtifactVersionSchema.nullable(), body_ref: TakiApplicationBodyRefSchema,
    binding: TakiApplicationBindingSchema, expected_native: TakiApplicationNativeVersionSchema.nullable(), actor: TakiApplicationActorSchema }),
  z.strictObject({ command: z.literal("rebind_artifact"), key: TakiApplicationArtifactKeySchema,
    expected_artifact: TakiApplicationArtifactVersionSchema, expected_native: TakiApplicationNativeVersionSchema,
    body_ref: TakiApplicationBodyRefSchema, actor: TakiApplicationActorSchema }),
  z.strictObject({ command: z.literal("retire_artifact"), key: TakiApplicationArtifactKeySchema,
    expected_artifact: TakiApplicationArtifactVersionSchema, expected_native: TakiApplicationNativeVersionSchema.nullable(),
    reason: z.enum(["superseded", "explicit_delete", "scope_retired"]), actor: TakiApplicationActorSchema }),
]);
export type TakiApplicationCommand = z.infer<typeof TakiApplicationCommandSchema>;
export const TakiApplicationCommandsSchema = z.strictObject({ commands: z.array(TakiApplicationCommandSchema).min(1) })
  .refine((value) => new Set(value.commands.map((command) => JSON.stringify(command.key))).size === value.commands.length,
    "a command body cannot mutate an artifact twice");
export type TakiApplicationCommands = z.infer<typeof TakiApplicationCommandsSchema>;
export const TakiApplicationCommitRequestSchema = z.strictObject({
  namespace: TakiApplicationNamespaceSchema, operation_id: z.uuid(), request_hash: Hash, commands_ref: TakiApplicationBodyRefSchema,
});
export type TakiApplicationCommitRequest = z.infer<typeof TakiApplicationCommitRequestSchema>;
export const TakiApplicationErrorResponseSchema = z.strictObject({
  error: z.literal("application_state_error"), code: TakiApplicationFailureCodeSchema, detail: z.string(),
  checkpoint: TakiApplicationCheckpointSchema.nullable().optional(), minimum_state_cursor: Count.nullable().optional(),
});
export type TakiApplicationErrorResponse = z.infer<typeof TakiApplicationErrorResponseSchema>;
export const TakiApplicationCommitReceiptSchema = z.strictObject({
  namespace: TakiApplicationNamespaceSchema, bank_id: Id, operation_id: z.uuid(), request_hash: Hash,
  state: z.enum(["completed", "refused"]), result_hash: Hash, checkpoint: TakiApplicationCheckpointSchema.nullable(),
  affected_versions_ref: TakiApplicationBodyRefSchema.nullable(), refusal: TakiApplicationErrorResponseSchema.nullable(), completed_at: Time,
});
export type TakiApplicationCommitReceipt = z.infer<typeof TakiApplicationCommitReceiptSchema>;
export const TakiApplicationCommitStatusSchema = z.strictObject({
  namespace: TakiApplicationNamespaceSchema, bank_id: Id, operation_id: z.uuid(),
  state: z.enum(["absent", "completed", "refused"]), receipt: TakiApplicationCommitReceiptSchema.nullable(),
});
export type TakiApplicationCommitStatus = z.infer<typeof TakiApplicationCommitStatusSchema>;
export const TakiApplicationAffectedVersionsSchema = z.strictObject({ artifacts: z.array(TakiApplicationArtifactVersionSchema) });
export type TakiApplicationAffectedVersions = z.infer<typeof TakiApplicationAffectedVersionsSchema>;
