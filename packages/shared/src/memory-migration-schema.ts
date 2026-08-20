/**
 * INPUT:  operator-only legacy migration requests and bounded reports
 * OUTPUT: strict shared schemas for dry-run, stage, status, verify, exceptions, exclusion, and activation
 * POS:    shared protocol — migration control-plane shapes; no memory content crosses this boundary
 */
import { z } from "zod";

const RunId = z.string().min(1).max(256);
const Page = z.object({ cursor: z.string().max(256).nullable(), limit: z.int().min(1).max(100) }).strict();
export const MEMORY_MIGRATION_METHODS = { dryRun: "memory.migration.dryRun", stage: "memory.migration.stage", resume: "memory.migration.resume", status: "memory.migration.status", verify: "memory.migration.verify", exceptions: "memory.migration.exceptions", exclude: "memory.migration.exclude", activate: "memory.migration.activate" } as const;
export const MemoryMigrationDryRunParamsSchema = z.object({ workspaceRoot: z.string().min(1).max(1024) }).strict();
export const MemoryMigrationStageParamsSchema = z.object({ workspaceRoot: z.string().min(1).max(1024), owner: z.string().min(1).max(128) }).strict();
export const MemoryMigrationResumeParamsSchema = z.object({ runId: RunId, owner: z.string().min(1).max(128) }).strict();
export const MemoryMigrationRunParamsSchema = z.object({ runId: RunId }).strict();
export const MemoryMigrationActivateParamsSchema = z.object({ runId: RunId, workspaceRoot: z.string().min(1).max(1024), timeoutMs: z.int().min(100).max(60_000) }).strict();
export const MemoryMigrationExceptionsParamsSchema = MemoryMigrationRunParamsSchema.merge(Page);
export const MemoryMigrationExcludeParamsSchema = z.object({ runId: RunId, sourceId: RunId, reason: z.string().min(1).max(512) }).strict();
export const MemoryMigrationReportSchema = z.object({ reportId: z.string().min(1).max(256), exceptional: z.int().min(0), plannedZero: z.int().min(0), plannedOne: z.int().min(0), plannedMany: z.int().min(0), sourceCount: z.int().min(0) }).strict();
export const MemoryMigrationStatusSchema = z.object({ runId: RunId, phase: z.string().min(1).max(32), status: z.string().min(1).max(32), sourceCount: z.int().min(0), resolvedCount: z.int().min(0), blockingCount: z.int().min(0) }).strict();
export const MemoryMigrationExceptionSchema = z.object({ sourceId: RunId, code: z.string().min(1).max(64), relativePath: z.string().max(1024).optional() }).strict();
export const MemoryMigrationExceptionPageSchema = z.object({ items: z.array(MemoryMigrationExceptionSchema).max(100), nextCursor: z.string().max(256).nullable() }).strict();
export const MemoryMigrationVerifySchema = z.object({ runId: RunId, verified: z.boolean(), manifestDigest: z.string().max(128).nullable(), readinessDigest: z.string().max(128).nullable(), blockingCount: z.int().min(0) }).strict();
export const MemoryMigrationActivationSchema = z.object({ runId: RunId, activated: z.boolean(), mode: z.enum(["legacy-markdown", "canonical-local"]), epochId: z.string().max(256).nullable() }).strict();
export type MemoryMigrationReport = z.infer<typeof MemoryMigrationReportSchema>;
export type MemoryMigrationStatus = z.infer<typeof MemoryMigrationStatusSchema>;
export type MemoryMigrationVerify = z.infer<typeof MemoryMigrationVerifySchema>;
export type MemoryMigrationActivation = z.infer<typeof MemoryMigrationActivationSchema>;
