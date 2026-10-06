/**
 * INPUT: complete current Source artifact inventory and exact per-record historical references
 * OUTPUT: explicit application-only aliases, ordered Source reference sets and durable upload evidence
 * POS: shared W3 Source preservation — physical documents and original fragments have independent identities
 */
import { z } from "zod";
import { HindsightCurrentCanonicalSourceSchema } from "./hindsight-current-canonical-schema.ts";
import { TakiApplicationArtifactVersionSchema, TakiApplicationNativeVersionSchema, TakiApplicationBodyRefSchema,
  TakiApplicationNamespaceSchema } from "./hindsight-application-primitives-schema.ts";
import { HindsightTransitionSourceUploadSchema } from "./hindsight-transition-source-schema.ts";
import { TakiApplicationSourceBodySchema } from "./hindsight-application-artifact-schema.ts";
const Id = z.string().min(1).max(256); const Hash = z.string().regex(/^[0-9a-f]{64}$/);

export const MemoryTransitionSourceAliasSchema = z.strictObject({ bankId: Id, documentId: Id, physicalDocumentId: Id,
  artifact: TakiApplicationArtifactVersionSchema, native: TakiApplicationNativeVersionSchema, evidenceId: Hash,
  retired: z.boolean().default(false),
}).refine((value) => value.artifact.key.artifact_kind === "source" && value.native.object_kind === "document", "Source alias kind mismatch");
export type MemoryTransitionSourceAlias = z.infer<typeof MemoryTransitionSourceAliasSchema>;
export const MemoryTransitionSourceReferenceSchema = z.strictObject({ documentId: Id,
  artifact: TakiApplicationArtifactVersionSchema.nullable(), intent: z.enum(["existing", "local"]), source: HindsightCurrentCanonicalSourceSchema,
}).refine((value) => value.documentId === value.source.documentId && (value.artifact === null || value.artifact.key.artifact_kind === "source")
  && (value.intent !== "existing" || value.artifact !== null), "Source reference identity mismatch");
export type MemoryTransitionSourceReference = z.infer<typeof MemoryTransitionSourceReferenceSchema>;
export const MemoryTransitionSourceSetSchema = z.strictObject({ bankId: Id, memoryId: Id, references: z.array(MemoryTransitionSourceReferenceSchema) });
export type MemoryTransitionSourceSet = z.infer<typeof MemoryTransitionSourceSetSchema>;
export const MemoryTransitionSourceUploadSchema = z.strictObject({ version: z.literal(1), uploadId: Hash, transitionId: z.uuid(),
  captureId: Hash, localBankId: Id, documentId: Id, nativeBankId: Id, namespace: TakiApplicationNamespaceSchema,
  sourceHash: Hash, ref: TakiApplicationBodyRefSchema, base64: z.string(),
  request: HindsightTransitionSourceUploadSchema,
}).refine((value) => value.ref.body_schema === "application-source.v1", "Transition upload is a Source body");
export type MemoryTransitionSourceUpload = z.infer<typeof MemoryTransitionSourceUploadSchema>;
export const MemoryTransitionSourceUploadAttemptSchema = z.strictObject({ attemptId: Hash, transitionId: z.uuid(), uploadId: Hash,
  request: HindsightTransitionSourceUploadSchema,
});
export type MemoryTransitionSourceUploadAttempt = z.infer<typeof MemoryTransitionSourceUploadAttemptSchema>;
export const MemoryTransitionPendingSourceSchema = z.strictObject({ localBankId: Id, nativeBankId: Id,
  namespace: TakiApplicationNamespaceSchema, evidenceId: Hash, proofHash: Hash,
  artifact: TakiApplicationArtifactVersionSchema, bodyRef: TakiApplicationBodyRefSchema, base64: z.string(),
  operationId: z.uuid(), documentId: Id, source: TakiApplicationSourceBodySchema, tombstoned: z.boolean(),
}).refine((value) => value.artifact.key.artifact_kind === "source" && value.bodyRef.body_schema === "application-source.v1"
  && value.source.operation_id === value.operationId && value.source.original_witness === null
  && value.source.original_source.documentId === value.documentId && value.source.original_source.bankId === value.nativeBankId,
"Pending Source must retain its original unconfirmed operation identity");
export type MemoryTransitionPendingSource = z.infer<typeof MemoryTransitionPendingSourceSchema>;
