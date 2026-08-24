import { describe, expect, it, vi } from "vitest";
import { JSON_RPC_APP_ERROR, MEMORY_MIGRATION_METHODS } from "@taki/shared";
import type { LegacyMigrationRunner } from "../../memory/legacy-migration/legacy-migration-runner.ts";
import { createMethodRegistry, type MethodContext } from "../method-registry.ts";
import { createAsyncOnDemandMemoryMigrationMethods, memoryMigrationMethods } from "./memory-migration.ts";

describe("memory migration operator methods", () => {
  it("registers the complete operator-only surface with strict schemas", () => {
    const runner = {} as LegacyMigrationRunner; const methods = memoryMigrationMethods(runner);
    expect(methods.map((method) => method.method)).toEqual(Object.values(MEMORY_MIGRATION_METHODS));
    expect(methods.every((method) => method.roles.length === 1 && method.roles[0] === "operator")).toBe(true);
    const dryRun = methods.find((method) => method.method === MEMORY_MIGRATION_METHODS.dryRun);
    expect(dryRun?.paramsSchema.safeParse({ workspaceRoot: "x", extra: true }).success).toBe(false);
  });

  it("returns bounded reports without exposing content", async () => {
    const runner = { dryRun: vi.fn(() => ({ reportId: "r", exceptional: 1, plannedZero: 0, plannedOne: 1, plannedMany: 0, sourceCount: 2 })) } as unknown as LegacyMigrationRunner;
    const method = memoryMigrationMethods(runner).find((item) => item.method === MEMORY_MIGRATION_METHODS.dryRun);
    const result = await method?.handler({ workspaceRoot: "workspace" }, {} as never);
    expect(result).toEqual({ reportId: "r", exceptional: 1, plannedZero: 0, plannedOne: 1, plannedMany: 0, sourceCount: 2 });
    expect(JSON.stringify(result)).not.toContain("memory text");
  });

  it("loads the offline runner only on operator invocation and sanitizes dispatch errors", async () => {
    const factory = vi.fn(async () => ({ dryRun: () => { throw new Error("C:\\secret\\memory.md sqlite raw failure"); } }) as unknown as LegacyMigrationRunner);
    const registry = createMethodRegistry();
    for (const method of createAsyncOnDemandMemoryMigrationMethods(factory)) registry.register(method);
    expect(factory).not.toHaveBeenCalled();
    const context = { notify: () => undefined, close: () => undefined, onClose: () => undefined, connection: { state: { status: "authenticated", deviceId: "owner", role: "operator", capabilities: [] } } } as MethodContext;
    const response = await registry.dispatch({ jsonrpc: "2.0", id: "1", method: MEMORY_MIGRATION_METHODS.dryRun, params: { workspaceRoot: "workspace" } }, context);
    expect(factory).toHaveBeenCalledOnce();
    expect(response).toMatchObject({ error: { code: JSON_RPC_APP_ERROR, message: "memory migration failed", data: { code: "INTERNAL_ERROR", reason: "INTEGRITY_MISMATCH" } } });
    expect(JSON.stringify(response)).not.toContain("secret"); expect(JSON.stringify(response)).not.toContain("sqlite");
  });
});
