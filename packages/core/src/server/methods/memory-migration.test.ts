import { describe, expect, it, vi } from "vitest";
import { JSON_RPC_APP_ERROR, MEMORY_MIGRATION_METHODS } from "@taki/shared";
import type { LegacyMigrationRunner } from "../../memory/legacy-migration/legacy-migration-runner.ts";
import { createMethodRegistry, type MethodContext } from "../method-registry.ts";
import { createMemoryMigrationMethods } from "./memory-migration.ts";

const context = { notify: () => undefined, close: () => undefined, onClose: () => undefined,
  connection: { state: { status: "authenticated", deviceId: "owner", role: "operator", capabilities: [] } } } as MethodContext;
const report = { reportId: "r", exceptional: 1, plannedZero: 0, plannedOne: 1, plannedMany: 0, sourceCount: 2 };

function harness(runner: Partial<LegacyMigrationRunner>) {
  const factory = vi.fn(async () => runner as LegacyMigrationRunner);
  const registry = createMethodRegistry();
  for (const method of createMemoryMigrationMethods({ runner: factory, workspaceRoot: "C:/core/workspace" })) registry.register(method);
  const call = (method: string, params: unknown) => registry.dispatch({ jsonrpc: "2.0", id: "1", method, params }, context);
  return { factory, call, methods: createMemoryMigrationMethods({ runner: factory, workspaceRoot: "C:/core/workspace" }) };
}

describe("memory migration operator methods", () => {
  it("registers the complete operator-only surface with strict schemas", () => {
    const { methods } = harness({});
    expect(methods.map((method) => method.method)).toEqual(Object.values(MEMORY_MIGRATION_METHODS));
    expect(methods.every((method) => method.roles.length === 1 && method.roles[0] === "operator")).toBe(true);
    const dryRun = methods.find((method) => method.method === MEMORY_MIGRATION_METHODS.dryRun);
    expect(dryRun?.paramsSchema.safeParse({ workspaceRoot: "x", extra: true }).success).toBe(false);
  });

  it("returns bounded reports for the Core workspace only, loading the runner on invocation", async () => {
    const { factory, call } = harness({ dryRun: vi.fn(() => report) });
    expect(factory).not.toHaveBeenCalled();
    const forbidden = await call(MEMORY_MIGRATION_METHODS.dryRun, { workspaceRoot: "C:/elsewhere" });
    expect(forbidden).toMatchObject({ error: { code: JSON_RPC_APP_ERROR, data: { code: "FORBIDDEN" } } });
    expect(factory).not.toHaveBeenCalled();
    const response = await call(MEMORY_MIGRATION_METHODS.dryRun, { workspaceRoot: "C:\\core\\workspace" });
    expect(response).toMatchObject({ result: report });
    expect(factory).toHaveBeenCalledOnce();
  });

  it.each([
    [MEMORY_MIGRATION_METHODS.stage, { workspaceRoot: "C:/core/workspace", owner: "operator" }],
    [MEMORY_MIGRATION_METHODS.resume, { runId: "run", owner: "operator" }],
    [MEMORY_MIGRATION_METHODS.verify, { runId: "run" }],
    [MEMORY_MIGRATION_METHODS.exclude, { runId: "run", sourceId: "source", reason: "unsupported" }],
    [MEMORY_MIGRATION_METHODS.activate, { runId: "run", workspaceRoot: "C:/core/workspace", timeoutMs: 1000 }],
  ])("%s refuses with MEMORY_OPERATION_REQUIRED without touching the runner", async (method, params) => {
    const { factory, call } = harness({});
    const response = await call(method, params);
    expect(response).toMatchObject({ error: { code: JSON_RPC_APP_ERROR, data: { code: "MEMORY_OPERATION_REFUSED", reason: "MEMORY_OPERATION_REQUIRED" } } });
    expect(factory).not.toHaveBeenCalled();
  });

  it("sanitizes dispatch errors to bounded reasons", async () => {
    const { call } = harness({
      dryRun: () => { throw new Error("C:\\secret\\memory.md sqlite raw failure"); },
      status: () => { throw new Error("MIGRATION_NOT_FOUND"); },
    });
    const response = await call(MEMORY_MIGRATION_METHODS.dryRun, { workspaceRoot: "C:/core/workspace" });
    expect(response).toMatchObject({ error: { code: JSON_RPC_APP_ERROR, message: "memory migration failed", data: { code: "INTERNAL_ERROR", reason: "INTEGRITY_MISMATCH" } } });
    expect(JSON.stringify(response)).not.toContain("secret"); expect(JSON.stringify(response)).not.toContain("sqlite");
    expect(await call(MEMORY_MIGRATION_METHODS.status, { runId: "unknown" })).toMatchObject({ error: { data: { code: "INTERNAL_ERROR", reason: "MIGRATION_NOT_FOUND" } } });
  });
});
