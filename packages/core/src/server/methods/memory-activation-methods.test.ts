import { describe, expect, it } from "vitest";
import { MEMORY_ACTIVATION_METHODS, type MemoryActivationStatus } from "@taki/shared";
import { createLogger } from "../../logging/logger.ts";
import type { Connection } from "../connection-registry.ts";
import { createMethodRegistry, type MethodContext } from "../method-registry.ts";
import { registerMemoryActivationMethods } from "./memory-activation-methods.ts";

const AT = "2026-09-23T00:00:00.000Z";
const status: MemoryActivationStatus = {
  authority: { mode: "canonical-local", epochId: "epoch" }, runtime: { available: true, unavailableReason: null },
  setup: { phase: "configured", revision: 2, configured: true },
  prerequisites: { banks: [{ scope: "global", characterId: null, localBankId: "bank", nativeBankId: "taki-hs-v1-g-0", verified: true }], blocking: [] },
  run: null, custody: { openGroups: 0, unconsumedWitnesses: 0, pendingSpans: 0 }, operation: null,
  actions: { activate: true, resume: false, recoverBinding: false, cancelOperationId: null }, observedAt: AT,
};

function call(read: () => MemoryActivationStatus, role: "operator" | "node" = "operator", params: unknown = {}) {
  const registry = createMethodRegistry();
  registerMemoryActivationMethods(registry, { status: read, logger: createLogger("fatal") });
  const connection: Connection = { state: { status: "authenticated", deviceId: "d1", role, capabilities: [] } };
  const ctx: MethodContext = { connection, notify: () => undefined, close: () => undefined, onClose: () => undefined };
  return registry.dispatch({ jsonrpc: "2.0", id: 1, method: MEMORY_ACTIVATION_METHODS.status, params }, ctx);
}

describe("memory.activation.status method", () => {
  it("returns the strict read to operators only and rejects any parameter", async () => {
    expect(await call(() => status)).toMatchObject({ result: status });
    expect((await call(() => status, "node") as { error: { data: { code: string } } }).error.data.code).toBe("FORBIDDEN");
    expect((await call(() => status, "operator", { extra: true }) as { error: { message: string } }).error.message).toBe("Invalid params");
  });

  it("sanitizes a failing read into INTERNAL_ERROR without leaking the cause", async () => {
    const response = await call(() => { throw new Error("private marker detail"); });
    expect((response as { error: { data: { code: string } } }).error.data.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(response)).not.toContain("private marker detail");
    const inconsistent = await call(() => ({ ...status, actions: { ...status.actions, resume: true } }));
    expect((inconsistent as { error: { data: { code: string } } }).error.data.code).toBe("INTERNAL_ERROR");
  });
});
