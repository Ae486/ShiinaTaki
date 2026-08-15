import { describe, expect, it } from "vitest";
import type { ToolSet } from "ai";
import { JSON_RPC_APP_ERROR, JSON_RPC_ERROR_CODES, type JsonRpcRequest, type Role } from "@taki/shared";
import { createCaptureLogger } from "../../testing/capture-logger.ts";
import type { Connection } from "../connection-registry.ts";
import { createMethodRegistry, type MethodContext } from "../method-registry.ts";
import { capabilityTriggerMethod, devTriggerEnabled } from "./capability-trigger.ts";

function ctxFor(role: Role): MethodContext {
  const connection: Connection = { state: { status: "authenticated", deviceId: "d", role, capabilities: [] } };
  return { notify: () => undefined, connection, close: () => undefined, onClose: () => undefined };
}
function request(params: unknown): JsonRpcRequest {
  return { jsonrpc: "2.0", id: "1", method: "capability.trigger", params };
}

// One fake tool whose execute echoes what it was called with — proves the trigger drives the REAL execute path.
interface EchoCall {
  input: unknown;
  toolCallId: string;
}
function toolsWithEcho(seen: EchoCall[]): ToolSet {
  return {
    echo: {
      execute: async (input: unknown, options: { toolCallId: string }) => {
        seen.push({ input, toolCallId: options.toolCallId });
        return { ok: true, echoed: input };
      },
    },
  } as unknown as ToolSet;
}
function registryFor(tools: ToolSet) {
  const { logger } = createCaptureLogger();
  const registry = createMethodRegistry();
  registry.register(capabilityTriggerMethod({ tools: () => tools, logger }));
  return registry;
}

describe("devTriggerEnabled", () => {
  it("is true only for the exact string \"1\"", () => {
    expect(devTriggerEnabled({ TAKI_DEV_TRIGGER: "1" })).toBe(true);
    expect(devTriggerEnabled({ TAKI_DEV_TRIGGER: "0" })).toBe(false);
    expect(devTriggerEnabled({ TAKI_DEV_TRIGGER: "true" })).toBe(false);
    expect(devTriggerEnabled({})).toBe(false);
  });
});

describe("capabilityTriggerMethod (dev L1 drive)", () => {
  it("is METHOD_NOT_FOUND when the method was never registered (no env gate)", async () => {
    // Mirrors main.ts NOT registering the trigger without TAKI_DEV_TRIGGER=1: an empty registry has no such method.
    const res = await createMethodRegistry().dispatch(request({ capability: "echo", input: {} }), ctxFor("operator"));
    expect(res).toMatchObject({ error: { code: JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND } });
  });

  it("forbids a node role (operator-only)", async () => {
    const res = await registryFor(toolsWithEcho([])).dispatch(request({ capability: "echo", input: {} }), ctxFor("node"));
    expect(res).toMatchObject({ error: { code: JSON_RPC_APP_ERROR, data: { code: "FORBIDDEN" } } });
  });

  it("returns a structured UNSUPPORTED_CAPABILITY for an unknown capability", async () => {
    const res = await registryFor(toolsWithEcho([])).dispatch(
      request({ capability: "not-a-tool", input: {} }),
      ctxFor("operator"),
    );
    expect(res).toMatchObject({ result: { ok: false, code: "UNSUPPORTED_CAPABILITY" } });
  });

  it("drives the real tool execute and returns its result (no separate execute path)", async () => {
    const seen: EchoCall[] = [];
    const res = await registryFor(toolsWithEcho(seen)).dispatch(
      request({ capability: "echo", input: { a: 1 } }),
      ctxFor("operator"),
    );
    expect(res).toMatchObject({ result: { ok: true, echoed: { a: 1 } } });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.input).toEqual({ a: 1 });
    expect(seen[0]?.toolCallId).toMatch(/[0-9a-f-]{36}/);
  });

  it("defaults a missing input to {}", async () => {
    const seen: EchoCall[] = [];
    await registryFor(toolsWithEcho(seen)).dispatch(request({ capability: "echo" }), ctxFor("operator"));
    expect(seen[0]?.input).toEqual({});
  });
});
