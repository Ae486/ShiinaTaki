/**
 * INPUT:  a sealed v2 Core/Native pair, the stopped target's observed schema and Host-observed physical resources
 * OUTPUT: versioned D1 candidate refusal, complete archive inventory, physical identity, restored inventory and verification
 * POS:    Shared candidate boundary; a verified isolated copy is a historical snapshot, never authority, readiness or promotion
 */
import { z } from "zod";
import { HindsightNativeArchiveManifestSchema, MemoryBackupErrorCodeSchema } from "./hindsight-backup-schema.ts";
import { HindsightCustodyDigestSchema as Digest } from "./hindsight-custody-schema.ts";
import { DeploymentPlanV1Schema, DockerIdSchema } from "./hindsight-deployment-schema.ts";
import { PendingMemorySummarySchema } from "./pending-memory-schema.ts";

export const HINDSIGHT_CANDIDATE_VERSION = 1;
/** PostgreSQL paired backup, SQL-backed file bodies, exact original schema/build; any other profile refuses. */
export const HINDSIGHT_CANDIDATE_PROFILE = "same-version-postgresql-sql-bodies-v1";

const Id = z.string().min(1).max(256);
const Label = z.string().min(1).max(120);
const Count = z.int().nonnegative();
const Name = z.string().regex(/^[A-Za-z0-9_]{1,63}$/);
const unique = (values: readonly unknown[]) => new Set(values).size === values.length;

export const HindsightCandidateRefusalReasonSchema = z.enum([
  "absent", "unreadable", "unsupported", "tampered", "omitted_required_data", "not_isolated", "foreign",
]);
export type HindsightCandidateRefusalReason = z.infer<typeof HindsightCandidateRefusalReasonSchema>;
export const HindsightCandidateSubjectSchema = z.enum([
  "core", "manifest", "archive", "table", "column", "body", "template", "credential", "schema", "identity", "endpoint", "restore",
]);
export type HindsightCandidateSubject = z.infer<typeof HindsightCandidateSubjectSchema>;
/** `name` is a table, column or field label, never a path, body key or secret; `code` keeps the original backup code. */
export const HindsightCandidateRefusalSchema = z.strictObject({
  reason: HindsightCandidateRefusalReasonSchema, subject: HindsightCandidateSubjectSchema,
  name: z.string().min(1).max(160).nullable(), code: MemoryBackupErrorCodeSchema.nullable(),
});
export type HindsightCandidateRefusal = z.infer<typeof HindsightCandidateRefusalSchema>;

export const HindsightCandidateTableFamilySchema = z.enum(["primary", "history", "body", "application", "control", "pending", "template"]);
export type HindsightCandidateTableFamily = z.infer<typeof HindsightCandidateTableFamilySchema>;
export const HindsightCandidateColumnSchema = z.strictObject({ name: Name, typeName: z.string().min(1).max(200) });
export type HindsightCandidateColumn = z.infer<typeof HindsightCandidateColumnSchema>;
const Columns = z.array(HindsightCandidateColumnSchema).min(1).max(256)
  .refine((columns) => unique(columns.map((column) => column.name)), "each column appears once");

/** The Native CLI v2 manifest with its pinned ordered columns; an archive without them cannot prove completeness. */
export const HindsightCandidateArchiveManifestSchema = HindsightNativeArchiveManifestSchema.extend({
  tables: z.record(Name, z.object({ rows: Count, size_bytes: Count,
    columns: z.array(z.strictObject({ name: Name, type_name: z.string().min(1).max(200) })).min(1).max(256)
      .refine((columns) => unique(columns.map((column) => column.name)), "each column appears once") })),
});
export type HindsightCandidateArchiveManifest = z.infer<typeof HindsightCandidateArchiveManifestSchema>;

/** The stopped target's exact identity and base tables as observed through the candidate-bound Host proof. */
export const HindsightCandidateSchemaInventorySchema = z.strictObject({
  schema: Label, alembicRevision: Label, compatibilityBuild: Label, upstreamCommit: Label,
  tables: z.array(z.strictObject({ name: Name, columns: Columns })).max(512),
}).refine((value) => unique(value.tables.map((table) => table.name)), "each table appears once");
export type HindsightCandidateSchemaInventory = z.infer<typeof HindsightCandidateSchemaInventorySchema>;

/**
 * `rowsDigest`: sha256 over the ascending sorted sha256 digests of every binary COPY tuple (field count, lengths and
 * bytes as streamed), so restored rows compare independently of COPY order and ZIP compression.
 */
const TableDigest = { name: Name, rows: Count, rowsDigest: Digest };
export const HindsightCandidateTableInventorySchema = z.strictObject({
  ...TableDigest, family: HindsightCandidateTableFamilySchema, bytes: Count, sha256: Digest, columns: Columns,
});
export const HindsightCandidateBankInventorySchema = z.strictObject({
  bankId: Id, checkpointHash: Digest, closureHash: Digest, heads: Count, artifacts: Count, bodies: Count,
  pending: PendingMemorySummarySchema, openParentWrites: Count,
});
export const HindsightCandidateInventorySchema = z.strictObject({
  version: z.literal(HINDSIGHT_CANDIDATE_VERSION), profile: z.literal(HINDSIGHT_CANDIDATE_PROFILE),
  backupId: z.uuid(), requestHash: Digest, targetSchemaHash: Digest,
  core: z.strictObject({ sha256: Digest, bytes: z.int().positive(), migrationHead: z.int().positive(), epochId: Id,
    providerLineageId: z.uuid(), schemaHash: Digest, tables: z.array(z.strictObject({ name: Id, rows: Count })).min(1) }),
  archive: z.strictObject({ sha256: Digest, bytes: z.int().positive(), schema: Label,
    alembicRevision: Label, compatibilityBuild: Label, upstreamCommit: Label }),
  tables: z.array(HindsightCandidateTableInventorySchema).min(1).max(512),
  classified: z.array(z.strictObject({ name: Name, kind: z.enum(["migration_metadata", "derived"]) })).max(8),
  bodies: z.strictObject({ referenced: Count, stored: Count }),
  banks: z.array(HindsightCandidateBankInventorySchema).max(256),
}).refine((value) => unique(value.tables.map((table) => table.name)) && unique(value.banks.map((bank) => bank.bankId)),
  "each table and Bank appears once");
export type HindsightCandidateInventory = z.infer<typeof HindsightCandidateInventorySchema>;

const Plan = DeploymentPlanV1Schema.shape;
/** Ownership the controlling Core recorded for this candidate; physical observations must match it exactly. */
export const HindsightCandidateOwnershipSchema = z.strictObject({
  candidateId: z.uuid(), coreHostId: Plan.coreHostId, executionHostId: Plan.executionHostId,
  installationId: Plan.installationId, engineId: Plan.engineId, imageId: Plan.imageId,
});
export type HindsightCandidateOwnership = z.infer<typeof HindsightCandidateOwnershipSchema>;
/** A fresh Host observation; names, labels or a distinct port alone never prove isolation. */
export const HindsightCandidatePhysicalIdentitySchema = z.strictObject({
  version: z.literal(HINDSIGHT_CANDIDATE_VERSION), role: z.enum(["candidate", "source"]), resourceId: z.uuid(),
  coreHostId: Plan.coreHostId, executionHostId: Plan.executionHostId, installationId: Plan.installationId,
  engineId: Plan.engineId, imageId: Plan.imageId, containerId: DockerIdSchema, startupId: z.uuid(),
  volumes: z.array(z.strictObject({ name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/), backingId: Digest,
    writableAttachments: z.array(DockerIdSchema).min(1).max(8).refine(unique, "each attachment appears once") })).min(1).max(8),
  postgres: z.strictObject({ systemIdentifier: z.string().regex(/^[1-9][0-9]{0,19}$/), database: Label }),
  listener: z.strictObject({ address: z.literal("127.0.0.1"), port: z.int().min(1024).max(65535), processIdentity: Digest }),
}).refine((value) => unique(value.volumes.map((volume) => volume.name)) && unique(value.volumes.map((volume) => volume.backingId)),
  "each volume and backing appears once");
export type HindsightCandidatePhysicalIdentity = z.infer<typeof HindsightCandidatePhysicalIdentitySchema>;

/** Read back from the stopped candidate after restore with the same row digest rule as the archive inventory. */
export const HindsightCandidateRestoredInventorySchema = z.strictObject({
  version: z.literal(HINDSIGHT_CANDIDATE_VERSION), candidateId: z.uuid(), archiveSha256: Digest,
  schema: HindsightCandidateSchemaInventorySchema, tables: z.array(z.strictObject(TableDigest)).max(512),
}).refine((value) => unique(value.tables.map((table) => table.name)), "each table appears once");
export type HindsightCandidateRestoredInventory = z.infer<typeof HindsightCandidateRestoredInventorySchema>;

/** Supplied only by the installed observer, never inferred from ZIP columns or operator JSON. */
export const HindsightCandidateEnvironmentSchema = z.strictObject({
  postgresVersion: Label, softwareArtifactHash: Digest, databaseEncoding: z.literal("UTF8"),
  extensions: z.array(z.strictObject({ name: Name, version: Label })).min(1).max(32)
    .refine((values) => unique(values.map((value) => value.name)), "each extension appears once"),
  schemaObjectsHash: Digest, bodyStorage: z.literal("postgresql"),
});
export type HindsightCandidateEnvironment = z.infer<typeof HindsightCandidateEnvironmentSchema>;
/**
 * Archive-correlated original source observation and independently read target, including types/constraints/triggers.
 * These are reference shapes, not authority. Only the installed producer can resolve/verify capture evidence;
 * a matching caller object, current source query or target compared with itself cannot establish source provenance.
 */
export const HindsightCandidateProvenanceSchema = z.strictObject({
  archiveSha256: Digest, sourceIdentityHash: Digest, candidateIdentityHash: Digest,
  sourceCapture: z.strictObject({ backupId: z.uuid(), requestHash: Digest, coreSha256: Digest, evidenceHash: Digest }),
  source: HindsightCandidateEnvironmentSchema, candidate: HindsightCandidateEnvironmentSchema,
  executionFence: z.strictObject({ profile: z.literal("archive-validation-only-v1"), evidenceHash: Digest }),
});
export type HindsightCandidateProvenance = z.infer<typeof HindsightCandidateProvenanceSchema>;

export const HindsightCandidateEvidenceSchema = z.enum(["physical_identity", "restored_equality", "fresh_template_observation", "environment_provenance"]);
const Verified = { version: z.literal(HINDSIGHT_CANDIDATE_VERSION), candidateId: z.uuid(), inventoryHash: Digest, identityHash: Digest };
export const HindsightCandidateVerificationSchema = z.discriminatedUnion("stage", [
  z.strictObject({ version: z.literal(HINDSIGHT_CANDIDATE_VERSION), stage: z.literal("refused"), candidateId: z.uuid(),
    refusal: HindsightCandidateRefusalSchema }),
  z.strictObject({ ...Verified, identityHash: Digest.nullable(), stage: z.literal("unverified"),
    missing: z.array(HindsightCandidateEvidenceSchema).min(1).max(4).refine(unique, "each missing evidence appears once") })
    .refine((value) => (value.identityHash === null) === value.missing.includes("physical_identity"), "missing identity has no digest"),
  z.strictObject({ ...Verified, stage: z.literal("baseline_verified"), requestHash: Digest, nativeSchema: Label, observedTemplates: Count }),
]);
export type HindsightCandidateVerification = z.infer<typeof HindsightCandidateVerificationSchema>;
