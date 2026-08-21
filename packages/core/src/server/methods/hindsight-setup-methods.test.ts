import { describe, expect, it, vi } from "vitest";
import { HINDSIGHT_METHODS, JSON_RPC_APP_ERROR, type HindsightSetupSnapshot } from "@taki/shared";
import { createLogger } from "../../logging/logger.ts";
import { hindsightError } from "../../memory/hindsight/hindsight-errors.ts";
import type { HindsightSetupService } from "../../memory/hindsight/hindsight-setup-service.ts";
import type { Connection } from "../connection-registry.ts";
import { createMethodRegistry, type MethodContext } from "../method-registry.ts";
import { registerHindsightSetupMethods } from "./hindsight-setup-methods.ts";

const snapshot: HindsightSetupSnapshot = {
  revision: 1, phase: "compatible", lastSuccessfulPhase: "compatible", configFingerprint: "a".repeat(64), attemptId: null,
  compatibility: null, banks: [], modelHealth: "not-run", latestError: null, lastAttemptAt: null, lastSuccessAt: null,
  updatedAt: "2026-08-21T00:00:00.000Z",
};

function harness(role: "operator" | "node" = "operator", service?: Partial<HindsightSetupService>) {
  const complete: HindsightSetupService = {
    status: vi.fn(() => snapshot), validate: vi.fn(async () => snapshot), setup: vi.fn(async () => snapshot),
    disable: vi.fn(() => ({ ...snapshot, phase: "disabled" as const })),
    llmHealth: vi.fn(async () => ({ status: "healthy" as const, banks: [] })), ...service,
  };
  const registry = createMethodRegistry();
  registerHindsightSetupMethods(registry, { service: complete, logger: createLogger("fatal") });
  const connection: Connection = { state: { status: "authenticated", deviceId: "d1", role, capabilities: [] } };
  const ctx: MethodContext = { connection, notify: () => undefined, close: () => undefined, onClose: () => undefined };
  return { registry, ctx, service: complete };
}

let id = 0;
async function call(input: { method: string; params: unknown; role?: "operator" | "node"; service?: Partial<HindsightSetupService> }) {
  const h = harness(input.role, input.service);
  return { response: await h.registry.dispatch({ jsonrpc: "2.0", id: ++id, method: input.method, params: input.params }, h.ctx), service: h.service };
}

describe("Hindsight setup methods", () => {
  it("keeps every method operator-only", async () => {
    for (const [method, params] of [
      [HINDSIGHT_METHODS.status, {}], [HINDSIGHT_METHODS.validate, { expectedRevision: 1 }],
      [HINDSIGHT_METHODS.setup, { expectedRevision: 1, characterId: "taki" }],
      [HINDSIGHT_METHODS.disable, { expectedRevision: 1 }],
      [HINDSIGHT_METHODS.llmHealth, { expectedRevision: 1, acknowledgeProviderCalls: true }],
    ] as const) {
      const { response } = await call({ method, params, role: "node" });
      expect((response as { error: { data: { code: string } } }).error.data.code).toBe("FORBIDDEN");
    }
  });

  it("status is read-only and does not invoke LLM health", async () => {
    const { response, service } = await call({ method: HINDSIGHT_METHODS.status, params: {} });
    expect(response).toMatchObject({ result: { revision: 1, phase: "compatible" } });
    expect(service.llmHealth).not.toHaveBeenCalled();
  });

  it("requires explicit provider-call acknowledgement before LLM health", async () => {
    const { response, service } = await call({ method: HINDSIGHT_METHODS.llmHealth, params: { expectedRevision: 1 } });
    expect((response as { error: { message: string } }).error.message).toBe("Invalid params");
    expect(service.llmHealth).not.toHaveBeenCalled();
  });

  it("sanitizes Hindsight refusals without secret or provider details", async () => {
    const sentinel = "super-secret-provider-value";
    const { response } = await call({ method: HINDSIGHT_METHODS.validate, params: { expectedRevision: 1 }, service: {
      validate: async () => { void sentinel; throw hindsightError("HINDSIGHT_AUTHENTICATION_FAILED"); },
    } });
    const error = (response as { error: { code: number; data: { code: string; reason: string } } }).error;
    expect(error).toMatchObject({ code: JSON_RPC_APP_ERROR, data: { code: "HINDSIGHT_REFUSED", reason: "HINDSIGHT_AUTHENTICATION_FAILED" } });
    expect(JSON.stringify(response)).not.toContain(sentinel);
  });
});
