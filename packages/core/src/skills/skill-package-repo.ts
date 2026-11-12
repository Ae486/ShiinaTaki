/**
 * INPUT: Core SQLite wrapper plus validated Skill lifecycle mutations
 * OUTPUT: durable package rows with optimistic checks, uniqueness and post-commit/pre-read-back observation
 * POS:    core/skills repository; sole durable Skill state writer, never package-byte authority
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database, SqlStatement } from "../db/sqlite.ts";
import { SKILL_DESCRIPTION_MAX_LENGTH, SKILL_FAILURE_REASON_MAX_LENGTH, SKILL_FILE_COUNT_MAX, SKILL_NAME_MAX_LENGTH, SKILL_NAME_PATTERN, SKILL_RELATIVE_PATH_MAX_LENGTH, SKILL_SCAN_VERSION_MAX_LENGTH, SKILL_SOURCE_LOCATOR_MAX_LENGTH, SkillLifecycleStateSchema, SkillScanFindingSchema, SkillScanVerdictSchema, SkillSourceKindSchema, SkillTrustSchema, type SkillScanFinding, type SkillScanVerdict, type SkillSourceKind, type SkillTrust, type SkillLifecycleState } from "@taki/shared";
import type { SkillPackageRow } from "./skill-package-types.ts";
import { notifyExtensionChange, type ExtensionChangeObserver } from "../extensions/notify-extension-change.ts";

const NameSchema = z.string().min(1).max(SKILL_NAME_MAX_LENGTH).regex(SKILL_NAME_PATTERN);
const DescriptionSchema = z.string().min(1).max(SKILL_DESCRIPTION_MAX_LENGTH);
const HashSchema = z.string().regex(/^sha256\.[0-9a-f]{64}$/u);
const FindingsSchema = z.array(SkillScanFindingSchema).max(SKILL_FILE_COUNT_MAX);
const FindingsJsonSchema = z.string().max(SKILL_FILE_COUNT_MAX * (SKILL_RELATIVE_PATH_MAX_LENGTH + 64));
const TimestampSchema = z.iso.datetime({ offset: true });
const RowSchema = z.strictObject({
  package_id: z.string().uuid(), skill_name: NameSchema.nullable(), description: DescriptionSchema.nullable(), owner_host_id: z.string().uuid(),
  content_hash: HashSchema.nullable(), lifecycle_state: SkillLifecycleStateSchema, enabled: z.union([z.literal(0), z.literal(1)]),
  source_kind: SkillSourceKindSchema, source_locator: z.string().max(SKILL_SOURCE_LOCATOR_MAX_LENGTH), trust: SkillTrustSchema,
  scan_version: z.string().min(1).max(SKILL_SCAN_VERSION_MAX_LENGTH), scan_verdict: SkillScanVerdictSchema, scan_findings: FindingsJsonSchema, failure_reason: z.string().max(SKILL_FAILURE_REASON_MAX_LENGTH).nullable(),
  config_revision: z.number().int().positive(), created_at: TimestampSchema, updated_at: TimestampSchema,
});
const WriteSchema = z.strictObject({
  packageId: z.string().uuid().optional(), skillName: NameSchema.nullable(), description: DescriptionSchema.nullable(), ownerHostId: z.string().uuid(), contentHash: HashSchema.nullable(),
  lifecycleState: SkillLifecycleStateSchema, enabled: z.boolean(), sourceKind: SkillSourceKindSchema, sourceLocator: z.string().max(SKILL_SOURCE_LOCATOR_MAX_LENGTH), trust: SkillTrustSchema,
  scanVersion: z.string().min(1).max(SKILL_SCAN_VERSION_MAX_LENGTH), scanVerdict: SkillScanVerdictSchema, scanFindings: FindingsSchema, failureReason: z.string().max(SKILL_FAILURE_REASON_MAX_LENGTH).nullable(),
});
const UpdateSchema = z.strictObject({
  packageId: z.string().uuid(), expectedConfigRevision: z.number().int().positive(), enabled: z.boolean().optional(),
  lifecycleState: SkillLifecycleStateSchema.optional(), contentHash: HashSchema.nullable().optional(), skillName: NameSchema.nullable().optional(),
  description: DescriptionSchema.nullable().optional(), failureReason: z.string().max(SKILL_FAILURE_REASON_MAX_LENGTH).nullable().optional(),
  scanVerdict: SkillScanVerdictSchema.optional(), scanFindings: FindingsSchema.optional(), sourceKind: SkillSourceKindSchema.optional(),
  sourceLocator: z.string().max(SKILL_SOURCE_LOCATOR_MAX_LENGTH).optional(), trust: SkillTrustSchema.optional(), scanVersion: z.string().min(1).max(SKILL_SCAN_VERSION_MAX_LENGTH).optional(),
});
export class SkillConfigConflictError extends Error { readonly currentConfigRevision: number; constructor(revision: number) { super("Skill configuration revision conflict"); this.name = "SkillConfigConflictError"; this.currentConfigRevision = revision; } }
export class SkillRepoRefusedError extends Error { readonly reason: "unknown-package" | "duplicate-skill"; constructor(reason: "unknown-package" | "duplicate-skill") { super("Skill lifecycle operation refused"); this.name = "SkillRepoRefusedError"; this.reason = reason; } }

export interface SkillPackageWrite { packageId?: string; skillName: string | null; description: string | null; ownerHostId: string; contentHash: string | null; lifecycleState: SkillLifecycleState; enabled: boolean; sourceKind: SkillSourceKind; sourceLocator: string; trust: SkillTrust; scanVersion: string; scanVerdict: SkillScanVerdict; scanFindings: SkillScanFinding[]; failureReason: string | null; }
export interface SkillPackageRepo {
  list(): SkillPackageRow[]; get(packageId: string): SkillPackageRow | null;
  /** Observe only a successful SQLite write, before its fallible row projection is read back. */
  insert(input: SkillPackageWrite, onCommitted?: ExtensionChangeObserver): SkillPackageRow;
  update(input: { packageId: string; expectedConfigRevision: number; enabled?: boolean; lifecycleState?: SkillLifecycleState; contentHash?: string | null; skillName?: string | null; description?: string | null; failureReason?: string | null; scanVerdict?: SkillScanVerdict; scanFindings?: SkillScanFinding[]; sourceKind?: SkillSourceKind; sourceLocator?: string; trust?: SkillTrust; scanVersion?: string }, onCommitted?: ExtensionChangeObserver): SkillPackageRow;
  remove(input: { packageId: string; expectedConfigRevision: number }, onCommitted?: ExtensionChangeObserver): void;
  count(): number;
}

interface Statements { list: SqlStatement; get: SqlStatement; count: SqlStatement; activeName: SqlStatement; insert: SqlStatement; update: SqlStatement; remove: SqlStatement; revision: SqlStatement; }
export function createSkillPackageRepo(db: Database, deps: { ownerHostId: string; now?: () => string }): SkillPackageRepo {
  const statements: Statements = {
    list: db.prepare("SELECT * FROM skill_packages ORDER BY COALESCE(skill_name, package_id)"),
    get: db.prepare("SELECT * FROM skill_packages WHERE package_id = :packageId"),
    count: db.prepare("SELECT COUNT(*) AS n FROM skill_packages"),
    activeName: db.prepare("SELECT package_id FROM skill_packages WHERE lifecycle_state='active' AND skill_name=:skillName"),
    insert: db.prepare("INSERT INTO skill_packages (package_id,skill_name,description,owner_host_id,content_hash,lifecycle_state,enabled,source_kind,source_locator,trust,scan_version,scan_verdict,scan_findings,failure_reason,config_revision,created_at,updated_at) VALUES (:packageId,:skillName,:description,:ownerHostId,:contentHash,:lifecycleState,:enabled,:sourceKind,:sourceLocator,:trust,:scanVersion,:scanVerdict,:scanFindings,:failureReason,1,:at,:at)"),
    update: db.prepare("UPDATE skill_packages SET enabled=:enabled, lifecycle_state=:lifecycleState, content_hash=:contentHash, skill_name=:skillName, description=:description, source_kind=:sourceKind, source_locator=:sourceLocator, trust=:trust, scan_version=:scanVersion, failure_reason=:failureReason, scan_verdict=:scanVerdict, scan_findings=:scanFindings, config_revision=config_revision+1, updated_at=:at WHERE package_id=:packageId AND config_revision=:expected"),
    remove: db.prepare("DELETE FROM skill_packages WHERE package_id=:packageId AND config_revision=:expected"),
    revision: db.prepare("SELECT config_revision FROM skill_packages WHERE package_id=:packageId"),
  };
  const now = deps.now ?? (() => new Date().toISOString());
  return {
    list: () => statements.list.all().map(readRow), get: (packageId) => readOne(statements.get.get({ packageId })), count: () => Number(statements.count.get()?.n ?? 0),
    insert: (input, onCommitted) => {
      const validated = WriteSchema.parse(input); const row = { ...validated, packageId: validated.packageId ?? randomUUID() };
      if (row.lifecycleState === "active" && row.skillName && statements.activeName.get({ skillName: row.skillName })) throw new SkillRepoRefusedError("duplicate-skill");
      statements.insert.run({ ...row, enabled: row.enabled ? 1 : 0, scanFindings: JSON.stringify(row.scanFindings), at: now() });
      notifyExtensionChange(onCommitted, ["skills"]);
      return readOne(statements.get.get({ packageId: row.packageId })) as SkillPackageRow;
    },
    update: (input, onCommitted) => {
      const validated = UpdateSchema.parse(input); const current = readOne(statements.get.get({ packageId: validated.packageId }));
      if (!current) throw new SkillRepoRefusedError("unknown-package");
      const result = statements.update.run({ packageId: validated.packageId, expected: validated.expectedConfigRevision, enabled: (validated.enabled ?? current.enabled) ? 1 : 0, lifecycleState: validated.lifecycleState ?? current.lifecycleState, contentHash: validated.contentHash === undefined ? current.contentHash : validated.contentHash, skillName: validated.skillName === undefined ? current.skillName : validated.skillName, description: validated.description === undefined ? current.description : validated.description, sourceKind: validated.sourceKind ?? current.sourceKind, sourceLocator: validated.sourceLocator ?? current.sourceLocator, trust: validated.trust ?? current.trust, scanVersion: validated.scanVersion ?? current.scanVersion, failureReason: validated.failureReason === undefined ? current.failureReason : validated.failureReason, scanVerdict: validated.scanVerdict ?? current.scanVerdict, scanFindings: JSON.stringify(validated.scanFindings ?? current.scanFindings), at: now() });
      if (result.changes === 0) throw new SkillConfigConflictError(current.configRevision);
      notifyExtensionChange(onCommitted, ["skills"]);
      return readOne(statements.get.get({ packageId: validated.packageId })) as SkillPackageRow;
    },
    remove: (input, onCommitted) => {
      const current = statements.revision.get({ packageId: input.packageId }); const revision = Number(current?.config_revision ?? 0);
      if (revision === 0) throw new SkillRepoRefusedError("unknown-package");
      if (statements.remove.run({ packageId: input.packageId, expected: input.expectedConfigRevision }).changes === 0) throw new SkillConfigConflictError(revision);
      notifyExtensionChange(onCommitted, ["skills"]);
    },
  };
}

function readOne(raw: Record<string, unknown> | undefined): SkillPackageRow | null { if (!raw) return null; const row = RowSchema.parse(raw); return { packageId: row.package_id, skillName: row.skill_name, description: row.description, ownerHostId: row.owner_host_id, contentHash: row.content_hash, lifecycleState: row.lifecycle_state, enabled: row.enabled === 1, sourceKind: row.source_kind, sourceLocator: row.source_locator, trust: row.trust, scanVersion: row.scan_version, scanVerdict: row.scan_verdict, scanFindings: FindingsSchema.parse(JSON.parse(row.scan_findings)), failureReason: row.failure_reason, configRevision: row.config_revision, createdAt: row.created_at, updatedAt: row.updated_at }; }
function readRow(raw: Record<string, unknown>): SkillPackageRow { return readOne(raw) as SkillPackageRow; }
