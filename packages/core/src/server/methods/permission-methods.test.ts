import { afterEach, describe, expect, it, vi } from "vitest";
import { CANONICAL_GOVERNANCE_REGISTRY, JSON_RPC_APP_ERROR, PERMISSION_METHODS } from "@taki/shared";
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
  const service = createGovernancePolicyService(createGovernancePolicyRepo(db));
  registerPermissionMethods(registry, { service, logger });
  const connection: Connection = { state: { status: "authenticated", deviceId: "d1", role, capabilities: [] } };
  const ctx: MethodContext = { connection, notify: () => undefined, close: () => undefined, onClose: () => undefined };
  const dispatch = (method: string, params: unknown) => registry.dispatch({ jsonrpc: "2.0", id: ++id, method, params }, ctx);
  return { dispatch, generation: service.level().policyGeneration };
}

let id = 0;
async function call(method: string, params: unknown, role: "operator" | "node" = "operator") {
  return build(role).dispatch(method, params);
}

describe("permission methods", () => {
  it("reads the durable level and full cell projection", async () => {
    const { dispatch, generation } = build();
    const state = { level: "standard", policyGeneration: generation, registryRevision: CANONICAL_GOVERNANCE_REGISTRY.registryRevision };
    expect(await dispatch(PERMISSION_METHODS.levelGet, {})).toMatchObject({ result: state });
    expect(await dispatch(PERMISSION_METHODS.cellsGet, {})).toMatchObject({ result: state });
  });

  it("mutates with optimistic generation and reports stale conflicts", async () => {
    const { dispatch, generation } = build();
    expect(await dispatch(PERMISSION_METHODS.levelSet, { level: "strict", expectedPolicyGeneration: generation })).toMatchObject({ result: { level: "strict", policyGeneration: generation + 1 } });
    const conflict = await dispatch(PERMISSION_METHODS.levelSet, { level: "relaxed", expectedPolicyGeneration: generation }) as { error: { code: number; data: { code: string; currentPolicyGeneration: number } } };
    expect(conflict.error).toMatchObject({ code: JSON_RPC_APP_ERROR, data: { code: "POLICY_CONFLICT", currentPolicyGeneration: generation + 1 } });
  });

  it("keeps generation stable for validated no-ops, including immutable factory values", async () => {
    const { dispatch, generation } = build();
    expect(await dispatch(PERMISSION_METHODS.levelSet, {
      level: "standard", expectedPolicyGeneration: generation,
    })).toMatchObject({ result: { level: "standard", policyGeneration: generation } });
    expect(await dispatch(PERMISSION_METHODS.cellSet, {
      key: "skill-load", level: "standard", posture: "auto", expectedPolicyGeneration: generation,
    })).toMatchObject({
      result: { policyGeneration: generation, cell: { overridePosture: null, effectivePosture: "auto" } },
    });
  });

  it("does not invalidate Approval state for policy no-ops", async () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    dbs.push(db);
    const registry = createMethodRegistry();
    const onChanged = vi.fn();
    const service = createGovernancePolicyService(createGovernancePolicyRepo(db));
    const generation = service.level().policyGeneration;
    registerPermissionMethods(registry, {
      service, logger, onChanged,
    });
    const connection: Connection = {
      state: { status: "authenticated", deviceId: "d1", role: "operator", capabilities: [] },
    };
    const ctx: MethodContext = { connection, notify: () => undefined, close: () => undefined, onClose: () => undefined };

    expect(await registry.dispatch({
      jsonrpc: "2.0", id: ++id, method: PERMISSION_METHODS.levelSet,
      params: { level: "standard", expectedPolicyGeneration: generation },
    }, ctx)).toMatchObject({ result: { level: "standard", policyGeneration: generation } });

    expect(onChanged).not.toHaveBeenCalled();
  });

  it("resets an existing override through null and advances exactly once", async () => {
    const { dispatch, generation } = build();

    expect(await dispatch(PERMISSION_METHODS.cellSet, {
      key: "screenshot", level: "standard", posture: "deny", expectedPolicyGeneration: generation,
    })).toMatchObject({ result: { policyGeneration: generation + 1, cell: { overridePosture: "deny" } } });
    expect(await dispatch(PERMISSION_METHODS.cellSet, {
      key: "screenshot", level: "standard", posture: null, expectedPolicyGeneration: generation + 1,
    })).toMatchObject({
      result: { policyGeneration: generation + 2, cell: { overridePosture: null, effectivePosture: "ask" } },
    });
  });

  it("returns structured second-confirm/immutable refusals", async () => {
    const { dispatch, generation } = build();
    const response = await dispatch(PERMISSION_METHODS.cellSet, { key: "exec:blocked", level: "standard", posture: "auto", expectedPolicyGeneration: generation }) as { error: { data: { code: string; reason: string } } };
    expect(response.error.data).toEqual({ code: "GOVERNANCE_REFUSED", reason: "second-confirm-required" });
  });

  it("accepts a second-confirmed material relaxation", async () => {
    const { dispatch, generation } = build();
    expect(await dispatch(PERMISSION_METHODS.cellSet, {
      key: "exec:blocked",
      level: "standard",
      posture: "auto",
      expectedPolicyGeneration: generation,
      secondConfirm: true,
    })).toMatchObject({
      result: { policyGeneration: generation + 1, cell: { overridePosture: "auto", effectivePosture: "auto" } },
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
