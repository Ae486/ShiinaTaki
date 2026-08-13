import { afterEach, describe, expect, it } from "vitest";
import { JSON_RPC_APP_ERROR, PERMISSION_METHODS } from "@taki/shared";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { createGovernancePolicyRepo } from "../../governance/governance-policy-repo.ts";
import { createGovernancePolicyService } from "../../governance/governance-policy-service.ts";
import { createLogger } from "../../logging/logger.ts";
import type { Connection } from "../connection-registry.ts";
import { createMethodRegistry, type MethodContext } from "../method-registry.ts";
import { registerPermissionMethods } from "./permission-methods.ts";

const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });
const logger = createLogger("fatal");

function build(role: "operator" | "node" = "operator") {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  dbs.push(db);
  const registry = createMethodRegistry();
  registerPermissionMethods(registry, createGovernancePolicyService(createGovernancePolicyRepo(db)), logger);
  const connection: Connection = { state: { status: "authenticated", deviceId: "d1", role, capabilities: [] } };
  const ctx: MethodContext = { connection, notify: () => undefined, close: () => undefined, onClose: () => undefined };
  return { registry, ctx };
}

let id = 0;
async function call(method: string, params: unknown, role: "operator" | "node" = "operator") {
  const { registry, ctx } = build(role);
  return registry.dispatch({ jsonrpc: "2.0", id: ++id, method, params }, ctx);
}

describe("permission methods", () => {
  it("reads the durable level and full cell projection", async () => {
    expect(await call(PERMISSION_METHODS.levelGet, {})).toMatchObject({ result: { level: "standard", policyGeneration: 1, registryRevision: 1 } });
    expect(await call(PERMISSION_METHODS.cellsGet, {})).toMatchObject({ result: { level: "standard", policyGeneration: 1 } });
  });

  it("mutates with optimistic generation and reports stale conflicts", async () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    dbs.push(db);
    const registry = createMethodRegistry();
    registerPermissionMethods(registry, createGovernancePolicyService(createGovernancePolicyRepo(db)), logger);
    const connection: Connection = { state: { status: "authenticated", deviceId: "d1", role: "operator", capabilities: [] } };
    const ctx: MethodContext = { connection, notify: () => undefined, close: () => undefined, onClose: () => undefined };
    const dispatch = (method: string, params: unknown) => registry.dispatch({ jsonrpc: "2.0", id: ++id, method, params }, ctx);
    expect(await dispatch(PERMISSION_METHODS.levelSet, { level: "strict", expectedPolicyGeneration: 1 })).toMatchObject({ result: { level: "strict", policyGeneration: 2 } });
    const conflict = await dispatch(PERMISSION_METHODS.levelSet, { level: "relaxed", expectedPolicyGeneration: 1 }) as { error: { code: number; data: { code: string; currentPolicyGeneration: number } } };
    expect(conflict.error).toMatchObject({ code: JSON_RPC_APP_ERROR, data: { code: "POLICY_CONFLICT", currentPolicyGeneration: 2 } });
  });

  it("keeps generation stable for validated no-ops, including immutable factory values", async () => {
    expect(await call(PERMISSION_METHODS.levelSet, {
      level: "standard", expectedPolicyGeneration: 1,
    })).toMatchObject({ result: { level: "standard", policyGeneration: 1 } });
    expect(await call(PERMISSION_METHODS.cellSet, {
      key: "skill-load", level: "standard", posture: "auto", expectedPolicyGeneration: 1,
    })).toMatchObject({
      result: { policyGeneration: 1, cell: { overridePosture: null, effectivePosture: "auto" } },
    });
  });

  it("resets an existing override through null and advances exactly once", async () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    dbs.push(db);
    const registry = createMethodRegistry();
    registerPermissionMethods(registry, createGovernancePolicyService(createGovernancePolicyRepo(db)), logger);
    const connection: Connection = { state: { status: "authenticated", deviceId: "d1", role: "operator", capabilities: [] } };
    const ctx: MethodContext = { connection, notify: () => undefined, close: () => undefined, onClose: () => undefined };
    const dispatch = (params: unknown) => registry.dispatch({
      jsonrpc: "2.0", id: ++id, method: PERMISSION_METHODS.cellSet, params,
    }, ctx);

    expect(await dispatch({
      key: "screenshot", level: "standard", posture: "deny", expectedPolicyGeneration: 1,
    })).toMatchObject({ result: { policyGeneration: 2, cell: { overridePosture: "deny" } } });
    expect(await dispatch({
      key: "screenshot", level: "standard", posture: null, expectedPolicyGeneration: 2,
    })).toMatchObject({
      result: { policyGeneration: 3, cell: { overridePosture: null, effectivePosture: "ask" } },
    });
  });

  it("returns structured second-confirm/immutable refusals", async () => {
    const response = await call(PERMISSION_METHODS.cellSet, { key: "exec:blocked", level: "standard", posture: "auto", expectedPolicyGeneration: 1 }) as { error: { data: { code: string; reason: string } } };
    expect(response.error.data).toEqual({ code: "GOVERNANCE_REFUSED", reason: "second-confirm-required" });
  });

  it("accepts a second-confirmed material relaxation", async () => {
    expect(await call(PERMISSION_METHODS.cellSet, {
      key: "exec:blocked",
      level: "standard",
      posture: "auto",
      expectedPolicyGeneration: 1,
      secondConfirm: true,
    })).toMatchObject({
      result: { policyGeneration: 2, cell: { overridePosture: "auto", effectivePosture: "auto" } },
    });
  });

  it("keeps every method operator-only", async () => {
    for (const [method, params] of [
      [PERMISSION_METHODS.levelGet, {}],
      [PERMISSION_METHODS.levelSet, { level: "strict", expectedPolicyGeneration: 1 }],
      [PERMISSION_METHODS.cellsGet, {}],
      [PERMISSION_METHODS.cellSet, { key: "screenshot", level: "standard", posture: "deny", expectedPolicyGeneration: 1 }],
    ] as const) {
      const response = await call(method, params, "node") as { error: { data: { code: string } } };
      expect(response.error.data.code).toBe("FORBIDDEN");
    }
  });
});
