/**
 * INPUT:  original provider writes and separately verified native/application completion evidence
 * OUTPUT: lossless internal parent-intent state and an immutable operation identity
 * POS:    core/db — whole-write journal contract; native Pending completion is only one child effect
 */
import { z } from "zod";
import {
  HindsightCurrentCanonicalRecordSchema, HindsightMemoryMutationResultV1Schema, HindsightMemoryRetainCompletedResultV1Schema,
  MemoryErrorCodeSchema, PendingMemoryOperationSchema, TakiApplicationArtifactVersionSchema,
  TakiApplicationMemoryBodySchema, TakiApplicationNamespaceSchema, TakiApplicationNativeVersionSchema, TakiApplicationTimeSchema,
  type JsonValue,
} from "@taki/shared";
import { HindsightApplicationCommandKeySchema, applicationCommandIntentHash } from "./hindsight-application-command-contract.ts";

export const HindsightMemoryWriteIdentitySchema = z.strictObject({
  key: HindsightApplicationCommandKeySchema, namespace: TakiApplicationNamespaceSchema,
  actor: z.enum(["foreground-agent", "background-policy", "operator", "migration"]), operation: PendingMemoryOperationSchema,
}).refine((value) => value.operation.request.bankId === value.key.bankId, "write belongs to another Bank");
export type HindsightMemoryWriteIdentity = z.infer<typeof HindsightMemoryWriteIdentitySchema>;

export const HindsightMemoryWriteTargetSchema = z.strictObject({
  native: TakiApplicationNativeVersionSchema, artifact: TakiApplicationArtifactVersionSchema,
  body: TakiApplicationMemoryBodySchema, record: HindsightCurrentCanonicalRecordSchema,
});
export type HindsightMemoryWriteTarget = z.infer<typeof HindsightMemoryWriteTargetSchema>;
export const HindsightMemoryWriteTerminalSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("retain"), result: HindsightMemoryRetainCompletedResultV1Schema }),
  z.strictObject({ kind: z.literal("mutation"), result: HindsightMemoryMutationResultV1Schema
    .refine((value) => value.outcome !== "pending", "a terminal write cannot remain pending") }),
  z.strictObject({ kind: z.literal("error"), code: MemoryErrorCodeSchema }),
]);
export type HindsightMemoryWriteTerminal = z.infer<typeof HindsightMemoryWriteTerminalSchema>;
const References = HindsightMemoryRetainCompletedResultV1Schema.shape.memories;
export const HindsightMemoryWriteStateSchema = z.strictObject({
  identity: HindsightMemoryWriteIdentitySchema, intentHash: z.string().regex(/^[a-f0-9]{64}$/),
  preparedAt: TakiApplicationTimeSchema, updatedAt: TakiApplicationTimeSchema,
  revision: z.int().positive(), nativeOperationId: z.string().min(1).max(256).nullable(),
  target: HindsightMemoryWriteTargetSchema.nullable(), applicationKey: HindsightApplicationCommandKeySchema.nullable(),
  references: z.strictObject({ resultHash: z.string().regex(/^[a-f0-9]{64}$/), memories: References }).nullable(),
  terminal: HindsightMemoryWriteTerminalSchema.nullable(),
}).superRefine((value, context) => {
  const { identity, target, terminal } = value; const request = identity.operation.request;
  const fail = () => context.addIssue({ code: "custom", message: "write evidence identity disagrees" });
  if (target && (identity.operation.kind !== "mutation" || !("memoryId" in request)
    || target.native.object_kind !== "memory_unit" || target.native.object_id !== request.memoryId
    || target.native.object_revision !== request.expectedRevision || target.artifact.key.artifact_kind !== "memory"
    || target.record.unit.memoryId !== request.memoryId || target.record.unit.revision !== request.expectedRevision
    || target.record.unit.bankId !== identity.key.bankId || target.record.unit.authorityEpochId !== identity.key.authorityEpochId)) fail();
  if (identity.operation.kind === "retain" && (target !== null || value.nativeOperationId === null)) fail();
  if (value.references && identity.operation.kind !== "retain") fail();
  if (value.applicationKey && (value.applicationKey.authorityEpochId !== identity.key.authorityEpochId
    || value.applicationKey.bankId !== identity.key.bankId || identity.operation.kind !== "mutation")) fail();
  if (terminal && terminal.kind !== "error" && terminal.kind !== identity.operation.kind) fail();
  if (terminal?.kind === "mutation" && terminal.result.record && (terminal.result.record.unit.bankId !== identity.key.bankId
    || terminal.result.record.unit.authorityEpochId !== identity.key.authorityEpochId
    || !("memoryId" in request) || terminal.result.record.unit.memoryId !== request.memoryId)) fail();
});
export type HindsightMemoryWriteState = z.infer<typeof HindsightMemoryWriteStateSchema>;
export type HindsightMemoryWriteJob = HindsightMemoryWriteState & { sequence: number };

export function hindsightMemoryWriteIntentHash(identity: HindsightMemoryWriteIdentity): string {
  return applicationCommandIntentHash({ key: identity.key, namespace: identity.namespace,
    intent: { domain: "taki-memory-write.v1", actor: identity.actor, operation: identity.operation } as JsonValue });
}
