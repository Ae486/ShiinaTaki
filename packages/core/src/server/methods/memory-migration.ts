/**
 * INPUT:  strict operator migration control params and an on-demand LegacyMigrationRunner
 * OUTPUT: memory.migration.* MethodDefinitions with bounded reports and no memory content
 * POS:    core/server/methods — operator-only offline control plane; caller constructs runner per request
 */
import {
  MEMORY_MIGRATION_METHODS, MemoryMigrationActivateParamsSchema, MemoryMigrationActivationSchema, MemoryMigrationDryRunParamsSchema,
  MemoryMigrationExceptionPageSchema, MemoryMigrationExceptionsParamsSchema, MemoryMigrationExcludeParamsSchema,
  MemoryMigrationReportSchema, MemoryMigrationResumeParamsSchema, MemoryMigrationRunParamsSchema,
  MemoryMigrationStageParamsSchema, MemoryMigrationStatusSchema, MemoryMigrationVerifySchema,
} from "@taki/shared";
import type { LegacyMigrationRunner } from "../../memory/legacy-migration/legacy-migration-runner.ts";
import type { MethodContext, MethodDefinition } from "../method-registry.ts";
import type { z } from "zod";
import { appException } from "../app-error.ts";
import { LEGACY_DIAGNOSTIC_CODES } from "../../memory/legacy-migration/legacy-diagnostics.ts";

export function memoryMigrationMethods(runner: LegacyMigrationRunner): Array<MethodDefinition<unknown>> {
  return [dryRun(runner), stage(runner), resume(runner), status(runner), verify(runner), exceptions(runner), exclude(runner), activate(runner)] as unknown as Array<MethodDefinition<unknown>>;
}

export function createOnDemandMemoryMigrationMethods(factory: () => LegacyMigrationRunner): Array<MethodDefinition<unknown>> {
  const lazy = {
    dryRun: (workspaceRoot: string) => factory().dryRun(workspaceRoot),
    stage: (input: Parameters<LegacyMigrationRunner["stage"]>[0]) => factory().stage(input),
    resume: (input: Parameters<LegacyMigrationRunner["resume"]>[0]) => factory()["resume"](input),
    status: (runId: string) => factory().status(runId),
    verify: (runId: string) => factory().verify(runId),
    exceptions: (input: Parameters<LegacyMigrationRunner["exceptions"]>[0]) => factory().exceptions(input),
    exclude: (input: Parameters<LegacyMigrationRunner["exclude"]>[0]) => factory().exclude(input),
    activate: (input: Parameters<LegacyMigrationRunner["activate"]>[0]) => factory().activate(input),
  } as LegacyMigrationRunner;
  return memoryMigrationMethods(lazy);
}

export function createAsyncOnDemandMemoryMigrationMethods(factory: () => Promise<LegacyMigrationRunner>): Array<MethodDefinition<unknown>> {
  return [
    asyncMethod({ factory, method: MEMORY_MIGRATION_METHODS.dryRun, paramsSchema: MemoryMigrationDryRunParamsSchema, operation: (runner, params) => runner.dryRun(params.workspaceRoot), resultSchema: MemoryMigrationReportSchema }),
    asyncMethod({ factory, method: MEMORY_MIGRATION_METHODS.stage, paramsSchema: MemoryMigrationStageParamsSchema, operation: (runner, params) => runner.stage(params), resultSchema: MemoryMigrationStatusSchema }),
    asyncMethod({ factory, method: MEMORY_MIGRATION_METHODS.resume, paramsSchema: MemoryMigrationResumeParamsSchema, operation: (runner, params) => runner["resume"](params), resultSchema: MemoryMigrationStatusSchema }),
    asyncMethod({ factory, method: MEMORY_MIGRATION_METHODS.status, paramsSchema: MemoryMigrationRunParamsSchema, operation: (runner, params) => runner.status(params.runId), resultSchema: MemoryMigrationStatusSchema }),
    asyncMethod({ factory, method: MEMORY_MIGRATION_METHODS.verify, paramsSchema: MemoryMigrationRunParamsSchema, operation: (runner, params) => runner.verify(params.runId), resultSchema: MemoryMigrationVerifySchema }),
    asyncMethod({ factory, method: MEMORY_MIGRATION_METHODS.exceptions, paramsSchema: MemoryMigrationExceptionsParamsSchema, operation: (runner, params) => runner.exceptions(params), resultSchema: MemoryMigrationExceptionPageSchema }),
    asyncMethod({ factory, method: MEMORY_MIGRATION_METHODS.exclude, paramsSchema: MemoryMigrationExcludeParamsSchema, operation: (runner, params, context) => runner.exclude({ ...params, actor: context.connection.state.status === "authenticated" ? context.connection.state.deviceId : "operator" }), resultSchema: MemoryMigrationStatusSchema }),
    asyncMethod({ factory, method: MEMORY_MIGRATION_METHODS.activate, paramsSchema: MemoryMigrationActivateParamsSchema, operation: (runner, params) => runner.activate(params), resultSchema: MemoryMigrationActivationSchema }),
  ] as unknown as Array<MethodDefinition<unknown>>;
}

interface AsyncMethodInput<P> { factory: () => Promise<LegacyMigrationRunner>; method: string; paramsSchema: z.ZodType<P>; operation: (runner: LegacyMigrationRunner, params: P, context: MethodContext) => unknown; resultSchema: z.ZodType }
function asyncMethod<P>(input: AsyncMethodInput<P>): MethodDefinition<P> {
  return { method: input.method, roles: ["operator"], paramsSchema: input.paramsSchema, handler: async (params, context) => safeAsync(async () => input.resultSchema.parse(await input.operation(await input.factory(), params, context))) };
}
function dryRun(runner: LegacyMigrationRunner): MethodDefinition<z.infer<typeof MemoryMigrationDryRunParamsSchema>> { return { method: MEMORY_MIGRATION_METHODS.dryRun, roles: ["operator"], paramsSchema: MemoryMigrationDryRunParamsSchema, handler: (params) => safe(() => MemoryMigrationReportSchema.parse(runner.dryRun(params.workspaceRoot))) }; }
function stage(runner: LegacyMigrationRunner): MethodDefinition<z.infer<typeof MemoryMigrationStageParamsSchema>> { return { method: MEMORY_MIGRATION_METHODS.stage, roles: ["operator"], paramsSchema: MemoryMigrationStageParamsSchema, handler: (params) => safe(() => MemoryMigrationStatusSchema.parse(runner.stage(params))) }; }
function resume(runner: LegacyMigrationRunner): MethodDefinition<z.infer<typeof MemoryMigrationResumeParamsSchema>> { const continueRun = runner["resume"]; return { method: MEMORY_MIGRATION_METHODS.resume, roles: ["operator"], paramsSchema: MemoryMigrationResumeParamsSchema, handler: (params) => safe(() => MemoryMigrationStatusSchema.parse(continueRun(params))) }; }
function status(runner: LegacyMigrationRunner): MethodDefinition<z.infer<typeof MemoryMigrationRunParamsSchema>> { return { method: MEMORY_MIGRATION_METHODS.status, roles: ["operator"], paramsSchema: MemoryMigrationRunParamsSchema, handler: (params) => safe(() => MemoryMigrationStatusSchema.parse(runner.status(params.runId))) }; }
function verify(runner: LegacyMigrationRunner): MethodDefinition<z.infer<typeof MemoryMigrationRunParamsSchema>> { return { method: MEMORY_MIGRATION_METHODS.verify, roles: ["operator"], paramsSchema: MemoryMigrationRunParamsSchema, handler: (params) => safe(() => MemoryMigrationVerifySchema.parse(runner.verify(params.runId))) }; }
function exceptions(runner: LegacyMigrationRunner): MethodDefinition<z.infer<typeof MemoryMigrationExceptionsParamsSchema>> { return { method: MEMORY_MIGRATION_METHODS.exceptions, roles: ["operator"], paramsSchema: MemoryMigrationExceptionsParamsSchema, handler: (params) => safe(() => MemoryMigrationExceptionPageSchema.parse(runner.exceptions(params))) }; }
function exclude(runner: LegacyMigrationRunner): MethodDefinition<z.infer<typeof MemoryMigrationExcludeParamsSchema>> { return { method: MEMORY_MIGRATION_METHODS.exclude, roles: ["operator"], paramsSchema: MemoryMigrationExcludeParamsSchema, handler: (params, context) => safe(() => { const actor = context.connection.state.status === "authenticated" ? context.connection.state.deviceId : "operator"; return MemoryMigrationStatusSchema.parse(runner.exclude({ ...params, actor })); }) }; }
function activate(runner: LegacyMigrationRunner): MethodDefinition<z.infer<typeof MemoryMigrationActivateParamsSchema>> { return { method: MEMORY_MIGRATION_METHODS.activate, roles: ["operator"], paramsSchema: MemoryMigrationActivateParamsSchema, handler: async (params) => safeAsync(() => runner.activate(params).then((result) => MemoryMigrationActivationSchema.parse(result))) }; }

function safe<T>(operation: () => T): T {
  try { return operation(); } catch (error) { throw appException("INTERNAL_ERROR", "memory migration failed", { reason: migrationReason(error) }); }
}

async function safeAsync<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) { throw appException("INTERNAL_ERROR", "memory migration failed", { reason: migrationReason(error) }); }
}

function migrationReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return (LEGACY_DIAGNOSTIC_CODES as readonly string[]).includes(message) ? message : "INTEGRITY_MISMATCH";
}
