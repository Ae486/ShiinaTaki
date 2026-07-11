import { describe, expect, it } from "vitest";
import { JSON_RPC_APP_ERROR, type ScreenshotOutput, type JsonRpcRequest, type Role } from "@taki/shared";
import { createCaptureLogger } from "../../testing/capture-logger.ts";
import { createCapabilityBroker, type CapabilityBroker, type CapabilityNotify } from "../../capabilities/capability-broker.ts";
import type { Connection } from "../connection-registry.ts";
import { createMethodRegistry, type MethodContext } from "../method-registry.ts";
import { capabilityRespondMethod } from "./capability-respond.ts";

const OUTPUT: ScreenshotOutput = { mediaType: "image/png", dataBase64: "AAAA", width: 1, height: 1 };

function ctxFor(role: Role): MethodContext {
  const connection: Connection = { state: { status: "authenticated", deviceId: "d", role, capabilities: [] } };
  return { notify: () => undefined, connection, close: () => undefined, onClose: () => undefined };
}
function request(params: unknown): JsonRpcRequest {
  return { jsonrpc: "2.0", id: "1", method: "capability.respond", params };
}
function makeBroker(): CapabilityBroker {
  const { logger } = createCaptureLogger();
  return createCapabilityBroker({ logger });
}
function registryFor(broker: CapabilityBroker) {
  const registry = createMethodRegistry();
  registry.register(capabilityRespondMethod(broker));
  return registry;
}

describe("capabilityRespondMethod (T6)", () => {
  it("forbids an operator role (node-only)", async () => {
    const res = await registryFor(makeBroker()).dispatch(
      request({ requestId: "22222222-2222-4222-8222-222222222222", ok: true, output: OUTPUT }),
      ctxFor("operator"),
    );
    expect(res).toMatchObject({ error: { code: JSON_RPC_APP_ERROR, data: { code: "FORBIDDEN" } } });
  });

  it("settles a pending request for a node", async () => {
    const broker = makeBroker();
    let sentId = "";
    const notify: CapabilityNotify = (_m, params) => (sentId = (params as { requestId: string }).requestId);
    const pending = broker.request("screenshot", {}, notify);

    const res = await registryFor(broker).dispatch(request({ requestId: sentId, ok: true, output: OUTPUT }), ctxFor("node"));
    expect(res).toMatchObject({ result: { accepted: true } });
    await expect(pending).resolves.toEqual({ ok: true, output: OUTPUT });
  });

  it("answers accepted:false for an unknown/late requestId", async () => {
    const res = await registryFor(makeBroker()).dispatch(
      request({ requestId: "33333333-3333-4333-8333-333333333333", ok: false, error: { code: "DENIED", message: "x" } }),
      ctxFor("node"),
    );
    expect(res).toMatchObject({ result: { accepted: false } });
  });
});
