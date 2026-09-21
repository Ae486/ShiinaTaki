/**
 * INPUT:  strict operator migration params, the Core workspace root and an on-demand LegacyMigrationRunner
 * OUTPUT: memory.migration.* MethodDefinitions: dryRun/status/exceptions bounded reads; stage/resume/verify/exclude/
 *         activate refuse with MEMORY_OPERATION_REQUIRED (durable mutations live in memory.operations.submit)
 * POS:    core/server/methods — retained operator read plane confined to the Core workspace and known runs
 */
import { resolve } from "node:path";
import {
  ErrorCodeSchema, MEMORY_MIGRATION_METHODS, MemoryMigrationActivateParamsSchema, MemoryMigrationDryRunParamsSchema,
  MemoryMigrationExceptionPageSchema, MemoryMigrationExceptionsParamsSchema, MemoryMigrationExcludeParamsSchema,
  MemoryMigrationReportSchema, MemoryMigrationResumeParamsSchema, MemoryMigrationRunParamsSchema,
  MemoryMigrationStageParamsSchema, MemoryMigrationStatusSchema,
} from "@taki/shared";
import { JSONRPCErrorException } from "json-rpc-2.0";
import type { z } from "zod";
import { LEGACY_DIAGNOSTIC_CODES } from "../../memory/legacy-migration/legacy-diagnostics.ts";
import type { LegacyMigrationRunner } from "../../memory/legacy-migration/legacy-migration-runner.ts";
import { appException } from "../app-error.ts";
import type { MethodDefinition } from "../method-registry.ts";

export interface MemoryMigrationMethodDeps { runner: () => Promise<LegacyMigrationRunner>; workspaceRoot: string }

/** Registration order mirrors MEMORY_MIGRATION_METHODS; refused mutations keep their strict schemas so older clients still resolve them. */
export function createMemoryMigrationMethods(deps: MemoryMigrationMethodDeps): Array<MethodDefinition<unknown>> {
  return [
    read(deps, { method: MEMORY_MIGRATION_METHODS.dryRun, paramsSchema: MemoryMigrationDryRunParamsSchema, resultSchema: MemoryMigrationReportSchema,
      admit: (params) => confineWorkspace(deps, params.workspaceRoot), operation: (runner) => runner.dryRun(deps.workspaceRoot) }),
    refusedMutation(MEMORY_MIGRATION_METHODS.stage, MemoryMigrationStageParamsSchema),
    refusedMutation(MEMORY_MIGRATION_METHODS.resume, MemoryMigrationResumeParamsSchema),
    read(deps, { method: MEMORY_MIGRATION_METHODS.status, paramsSchema: MemoryMigrationRunParamsSchema, resultSchema: MemoryMigrationStatusSchema,
      operation: (runner, params) => runner.status(params.runId) }),
    refusedMutation(MEMORY_MIGRATION_METHODS.verify, MemoryMigrationRunParamsSchema),
    read(deps, { method: MEMORY_MIGRATION_METHODS.exceptions, paramsSchema: MemoryMigrationExceptionsParamsSchema, resultSchema: MemoryMigrationExceptionPageSchema,
      operation: (runner, params) => runner.exceptions(params) }),
    refusedMutation(MEMORY_MIGRATION_METHODS.exclude, MemoryMigrationExcludeParamsSchema),
    refusedMutation(MEMORY_MIGRATION_METHODS.activate, MemoryMigrationActivateParamsSchema),
  ];
}

interface ReadInput<P> {
  method: string; paramsSchema: z.ZodType<P>; resultSchema: z.ZodType; operation: (runner: LegacyMigrationRunner, params: P) => unknown;
  /** Runs before the offline runner is loaded; a confinement refusal must not cost a runner construction. */
  admit?: (params: P) => void;
}
function read<P>(deps: MemoryMigrationMethodDeps, input: ReadInput<P>): MethodDefinition<unknown> {
  const definition: MethodDefinition<P> = {
    method: input.method, roles: ["operator"], paramsSchema: input.paramsSchema,
    handler: (params) => sanitized(async () => {
      input.admit?.(params);
      return input.resultSchema.parse(await input.operation(await deps.runner(), params));
    }),
  };
  return definition as MethodDefinition<unknown>;
}

function refusedMutation(method: string, paramsSchema: z.ZodType): MethodDefinition<unknown> {
  return { method, roles: ["operator"], paramsSchema, handler: () => {
    throw appException(ErrorCodeSchema.enum.MEMORY_OPERATION_REFUSED, "memory migration mutations require memory.operations.submit", { reason: "MEMORY_OPERATION_REQUIRED" });
  } };
}

/** Client roots never select a filesystem location; only the Core workspace itself may be previewed. */
function confineWorkspace(deps: MemoryMigrationMethodDeps, requested: string): void {
  if (resolve(requested) !== resolve(deps.workspaceRoot)) throw appException(ErrorCodeSchema.enum.FORBIDDEN, "memory migration reads are confined to the Core workspace");
}

const READ_REASONS: readonly string[] = [...LEGACY_DIAGNOSTIC_CODES, "MIGRATION_NOT_FOUND", "MIGRATION_SUPERSEDED"];

async function sanitized<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof JSONRPCErrorException) throw error;
    const message = error instanceof Error ? error.message : "";
    throw appException(ErrorCodeSchema.enum.INTERNAL_ERROR, "memory migration failed", { reason: READ_REASONS.includes(message) ? message : "INTEGRITY_MISMATCH" });
  }
}
