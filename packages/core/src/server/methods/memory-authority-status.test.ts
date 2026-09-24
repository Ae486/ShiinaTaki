import { describe, expect, it } from "vitest";
import { MEMORY_AUTHORITY_METHODS, type MemoryAuthorityStatus } from "@taki/shared";
import { createLogger } from "../../logging/logger.ts";
import type { Connection } from "../connection-registry.ts";
import { createMethodRegistry, type MethodContext } from "../method-registry.ts";
import { memoryAuthorityStatusMethod } from "./memory-authority-status.ts";

const AT = "2026-09-19T00:00:00.000Z";
const status: MemoryAuthorityStatus = {
  authority: { mode: "canonical-local", epochId: "epoch", providerLineageId: null },
  runtime: { providerId: "local", available: true, unavailableReason: null },
  setup: { revision: 0, phase: "unconfigured", lastSuccessfulPhase: null, configFingerprint: null, attemptId: null, compatibility: null,
    banks: [], modelHealth: "not-run", latestError: null, lastAttemptAt: null, lastSuccessAt: null, updatedAt: AT },
  replica: null, pending: null, operations: { active: [], recent: [] }, hindsight: null, derivedFreshness: "unknown", observedAt: AT,
};

function call(read: () => MemoryAuthorityStatus, role: "operator" | "node" = "operator") {
  const registry = createMethodRegistry();
  registry.register(memoryAuthorityStatusMethod({ read, logger: createLogger("fatal") }));
  const connection: Connection = { state: { status: "authenticated", deviceId: "d1", role, capabilities: [] } };
  const ctx: MethodContext = { connection, notify: () => undefined, close: () => undefined, onClose: () => undefined };
  return registry.dispatch({ jsonrpc: "2.0", id: 1, method: MEMORY_AUTHORITY_METHODS.status, params: {} }, ctx);
}

describe("memory.authority.status method", () => {
  it("returns the strict composite read to operators only", async () => {
    expect(await call(() => status)).toMatchObject({ result: status });
    expect((await call(() => status, "node") as { error: { data: { code: string } } }).error.data.code).toBe("FORBIDDEN");
  });

  it("sanitizes a failing read into INTERNAL_ERROR", async () => {
    const response = await call(() => { throw new Error("private marker detail"); });
    expect((response as { error: { data: { code: string } } }).error.data.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(response)).not.toContain("private marker detail");
  });
});
