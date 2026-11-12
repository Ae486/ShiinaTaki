import { afterEach, expect, it } from "vitest";
import { AuxiliaryUsageResultSchema, OBSERVABILITY_METHODS, type MonitorMode, type Role } from "@taki/shared";
import { createAuxiliaryUsageRepo } from "../../db/auxiliary-usage-repo.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { openDatabase } from "../../db/sqlite.ts";
import { createConnectionRegistry } from "../connection-registry.ts";
import { createMethodRegistry, type MethodContext } from "../method-registry.ts";
import { registerAuxiliaryUsageMethod } from "./auxiliary-usage-method.ts";

const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach((close) => close()));
const at = "2026-11-01T00:00:00.000Z";
function fixture(role: Role = "operator") {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  cleanup.push(() => db.close());
  const repo = createAuxiliaryUsageRepo(db);
  repo.start({ callId: "f4d80501-80a5-4a40-8ff0-794a8be3a834", taskId: null, source: "utility", label: "compaction",
    provider: "provider", modelId: "model", startedAt: at });
  const registry = createMethodRegistry();
  let mode: MonitorMode = "FEEDBACK_ONLY";
  registerAuxiliaryUsageMethod(registry, { repo, mode: () => mode });
  const connections = createConnectionRegistry();
  const connection = connections.create();
  connections.authenticate(connection, { deviceId: "test", role, capabilities: [] });
  const context: MethodContext = { connection, notify: () => undefined, close: () => undefined, onClose: () => undefined };
  return { repo, setMode: (next: MonitorMode) => { mode = next; },
    dispatch: (params: unknown = { from: at, to: "2026-11-02T00:00:00.000Z" }) => registry.dispatch({
      jsonrpc: "2.0", id: 1, method: OBSERVABILITY_METHODS.auxiliaryUsage, params,
    }, context) };
}

it("returns durable auxiliary observations through the authenticated registry without reconciling reads", async () => {
  const f = fixture();
  const response = await f.dispatch();
  expect(response).toHaveProperty("result");
  if ("result" in response) {
    const result = AuxiliaryUsageResultSchema.parse(response.result);
    expect(result).toMatchObject({ scope: "observed-auxiliary", totalCalls: 1, stateCounts: { started: 1 } });
    expect(result.rows[0]?.usage.inputTokens).toBeNull();
  }
});

it("refuses disabled monitoring while preserving recording and permits live re-enable", async () => {
  const f = fixture();
  f.setMode("DISABLED");
  expect(await f.dispatch()).toMatchObject({ error: { message: "OBSERVABILITY_DISABLED" } });
  f.setMode("FULL_LOCAL");
  expect(await f.dispatch()).toMatchObject({ result: { totalCalls: 1 } });
});

it("rejects node access and unbounded query input", async () => {
  expect(await fixture("node").dispatch()).toHaveProperty("error");
  expect(await fixture().dispatch({ from: at, to: at, limit: 101 })).toHaveProperty("error");
  expect(await fixture().dispatch({ from: at })).toHaveProperty("error");
});
