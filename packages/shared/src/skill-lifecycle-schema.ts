/**
 * INPUT: operator Skill lifecycle requests/results crossing the Core WebSocket boundary
 * OUTPUT: strict skill.* method, package view, import, runtime, and refusal schemas
 * POS:    shared protocol authority; package bytes never appear in Core-authoritative result projections
 */
import { z } from "zod";

export const SKILL_METHODS = {
  list: "skill.list", inspect: "skill.inspect", import: "skill.import", enable: "skill.enable",
  disable: "skill.disable", remove: "skill.remove", reconcile: "skill.reconcile",
} as const;
export const SKILL_IMPORT_MAX_BYTES = 20_000_000;
export const SKILL_FILE_MAX_BYTES = 16 * 1024 * 1024;
export const SKILL_MD_MAX_BYTES = 1024 * 1024;
export const SKILL_TOTAL_MAX_BYTES = 64 * 1024 * 1024;
export const SKILL_FILE_COUNT_MAX = 2_048;
export const SKILL_RESOURCE_MAX_BYTES = 256 * 1024;
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SKILL_NAME_MAX_LENGTH = 64;
export const SKILL_DESCRIPTION_MAX_LENGTH = 1_024;
export const SKILL_COMPATIBILITY_MAX_LENGTH = 500;
export const SKILL_RELATIVE_PATH_MAX_LENGTH = 512;
export const SKILL_SOURCE_LOCATOR_MAX_LENGTH = 256;
export const SKILL_SCAN_VERSION_MAX_LENGTH = 64;
export const SKILL_FAILURE_REASON_MAX_LENGTH = 512;

const RevisionSchema = z.number().int().positive();
const TimestampSchema = z.iso.datetime({ offset: true });
const NameSchema = z.string().min(1).max(SKILL_NAME_MAX_LENGTH).regex(SKILL_NAME_PATTERN);
const HashSchema = z.string().regex(/^sha256\.[0-9a-f]{64}$/);
const HostIdSchema = z.string().uuid();
const RelativePathSchema = z.string().min(1).max(SKILL_RELATIVE_PATH_MAX_LENGTH).regex(/^[^\\:\0][^\\0]*$/);

export const SkillSourceKindSchema = z.enum(["directory", "zip", "legacy-directory"]);
export type SkillSourceKind = z.infer<typeof SkillSourceKindSchema>;
export const SkillLifecycleStateSchema = z.enum(["active", "quarantined", "rejected"]);
export type SkillLifecycleState = z.infer<typeof SkillLifecycleStateSchema>;
export const SkillTrustSchema = z.enum(["bundled-reviewed", "operator-local", "external-archive", "legacy-local", "blocked"]);
export type SkillTrust = z.infer<typeof SkillTrustSchema>;
export const SkillScanVerdictSchema = z.enum(["passed", "review", "rejected"]);
export type SkillScanVerdict = z.infer<typeof SkillScanVerdictSchema>;
export const SkillRuntimeStateSchema = z.enum(["available", "disabled", "invalid"]);
export type SkillRuntimeState = z.infer<typeof SkillRuntimeStateSchema>;
export const SkillScanFindingCodeSchema = z.enum(["executable-looking-file", "scripts-directory", "unknown-file"]);
export type SkillScanFindingCode = z.infer<typeof SkillScanFindingCodeSchema>;
export const SkillScanFindingSchema = z.strictObject({ code: SkillScanFindingCodeSchema, path: RelativePathSchema });
export type SkillScanFinding = z.infer<typeof SkillScanFindingSchema>;

export const SkillStandardMetadataSchema = z.strictObject({
  name: NameSchema,
  description: z.string().min(1).max(SKILL_DESCRIPTION_MAX_LENGTH),
  license: z.string().max(SKILL_MD_MAX_BYTES).optional(),
  compatibility: z.string().min(1).max(SKILL_COMPATIBILITY_MAX_LENGTH).optional(),
  metadata: z.record(z.string().max(SKILL_MD_MAX_BYTES), z.string().max(SKILL_MD_MAX_BYTES)).optional(),
  "allowed-tools": z.string().max(SKILL_MD_MAX_BYTES).optional(),
});
export type SkillStandardMetadata = z.infer<typeof SkillStandardMetadataSchema>;

export const SkillFileEntrySchema = z.strictObject({ path: RelativePathSchema, contentBase64: z.string().max(SKILL_TOTAL_MAX_BYTES * 2) });
export type SkillFileEntry = z.infer<typeof SkillFileEntrySchema>;
export const SkillImportSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("zip"), fileName: z.string().min(1).max(SKILL_SOURCE_LOCATOR_MAX_LENGTH).regex(/^[^/\\:\0]+$/u), archiveBase64: z.string().max(SKILL_IMPORT_MAX_BYTES * 2) }),
  z.strictObject({ kind: z.literal("directory"), files: z.array(SkillFileEntrySchema).min(1).max(SKILL_FILE_COUNT_MAX) }),
]);
export type SkillImportSource = z.infer<typeof SkillImportSourceSchema>;

export const SkillPackageViewSchema = z.strictObject({
  packageId: HostIdSchema, skillName: NameSchema.nullable(), description: z.string().min(1).max(SKILL_DESCRIPTION_MAX_LENGTH).nullable(), ownerHostId: HostIdSchema,
  contentHash: HashSchema.nullable(), enabled: z.boolean(), configRevision: RevisionSchema, sourceKind: SkillSourceKindSchema,
  sourceLocator: z.string().max(SKILL_SOURCE_LOCATOR_MAX_LENGTH), trust: SkillTrustSchema, scanVersion: z.string().max(SKILL_SCAN_VERSION_MAX_LENGTH), scanVerdict: SkillScanVerdictSchema,
  scanFindings: z.array(SkillScanFindingSchema).max(SKILL_FILE_COUNT_MAX), lifecycleState: SkillLifecycleStateSchema,
  runtimeState: SkillRuntimeStateSchema, catalogGeneration: z.number().int().positive().nullable(), createdAt: TimestampSchema,
  updatedAt: TimestampSchema, failureReason: z.string().max(SKILL_FAILURE_REASON_MAX_LENGTH).nullable(),
});
export type SkillPackageView = z.infer<typeof SkillPackageViewSchema>;

export const SkillListParamsSchema = z.strictObject({});
export const SkillInspectParamsSchema = z.strictObject({ packageId: HostIdSchema });
export const SkillImportParamsSchema = z.strictObject({ source: SkillImportSourceSchema, replacePackageId: HostIdSchema.optional(), expectedConfigRevision: RevisionSchema.optional() }).superRefine((value, ctx) => {
  if (value.replacePackageId !== undefined && value.expectedConfigRevision === undefined) ctx.addIssue({ code: "custom", path: ["expectedConfigRevision"], message: "replacement requires expectedConfigRevision" });
  if (value.replacePackageId === undefined && value.expectedConfigRevision !== undefined) ctx.addIssue({ code: "custom", path: ["expectedConfigRevision"], message: "expectedConfigRevision is replacement-only" });
});
export const SkillMutationParamsSchema = z.strictObject({ packageId: HostIdSchema, expectedConfigRevision: RevisionSchema });
export const SkillReconcileParamsSchema = z.strictObject({});
export type SkillListParams = z.infer<typeof SkillListParamsSchema>;
export type SkillInspectParams = z.infer<typeof SkillInspectParamsSchema>;
export type SkillImportParams = z.infer<typeof SkillImportParamsSchema>;
export type SkillMutationParams = z.infer<typeof SkillMutationParamsSchema>;
export type SkillReconcileParams = z.infer<typeof SkillReconcileParamsSchema>;

export const SkillInspectResultSchema = z.strictObject({ package: SkillPackageViewSchema, metadata: SkillStandardMetadataSchema.nullable(), files: z.array(RelativePathSchema).max(SKILL_FILE_COUNT_MAX) });
export const SkillListResultSchema = z.strictObject({ packages: z.array(SkillPackageViewSchema), catalogGeneration: z.number().int().positive() });
export const SkillMutationResultSchema = z.strictObject({ package: SkillPackageViewSchema });
export const SkillRemoveResultSchema = z.strictObject({ status: z.literal("removed"), packageId: HostIdSchema });
export const SkillReconcileResultSchema = z.strictObject({ checked: z.number().int().nonnegative(), invalidated: z.number().int().nonnegative(), catalogGeneration: z.number().int().positive() });
export type SkillInspectResult = z.infer<typeof SkillInspectResultSchema>;
export type SkillListResult = z.infer<typeof SkillListResultSchema>;
export type SkillMutationResult = z.infer<typeof SkillMutationResultSchema>;
export type SkillRemoveResult = z.infer<typeof SkillRemoveResultSchema>;
export type SkillReconcileResult = z.infer<typeof SkillReconcileResultSchema>;
export const SkillRefusalReasonSchema = z.enum(["unknown-package", "duplicate-skill", "invalid-package", "unsafe-package", "package-disabled", "revision-conflict", "source-too-large"]);
export type SkillRefusalReason = z.infer<typeof SkillRefusalReasonSchema>;
