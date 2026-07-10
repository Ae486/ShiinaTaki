import { describe, expect, it } from "vitest";
import { JSON_RPC_APP_ERROR, type JsonRpcRequest, type Role } from "@taki/shared";
import { createCaptureLogger } from "../../testing/capture-logger.ts";
import { createApprovalBroker, type ApprovalBroker, type ApprovalNotify } from "../../approval/approval-broker.ts";
import type { Connection } from "../connection-registry.ts";
import { createMethodRegistry, type MethodContext } from "../method-registry.ts";
import { approvalRespondMethod } from "./approval-respond.ts";

function ctxFor(role: Role): MethodContext {
  const connection: Connection = { state: { status: "authenticated", deviceId: "d", role, capabilities: [] } };
  return { notify: () => undefined, connection, close: () => undefined, onClose: () => undefined };
}
function request(params: unknown): JsonRpcRequest {
  return { jsonrpc: "2.0", id: "1", method: "approval.respond", params };
}
function makeBroker(): ApprovalBroker {
  const { logger } = createCaptureLogger();
  return createApprovalBroker({ logger });
}
function registryFor(broker: ApprovalBroker) {
  const registry = createMethodRegistry();
  registry.register(approvalRespondMethod(broker));
  return registry;
}

describe("approvalRespondMethod (T21)", () => {
  it("forbids a node role (operator-only)", async () => {
    const res = await registryFor(makeBroker()).dispatch(
      request({ approvalId: "x", approved: true, scope: "once" }),
      ctxFor("node"),
    );
    expect(res).toMatchObject({ error: { code: JSON_RPC_APP_ERROR, data: { code: "FORBIDDEN" } } });
  });

  it("resolves a pending ask for an operator", async () => {
    const broker = makeBroker();
    let sentId = "";
    const notify: ApprovalNotify = (_m, params) => (sentId = (params as { approvalId: string }).approvalId);
    const pending = broker.ask({ serverName: "s", toolName: "t", input: {} }, notify);

    const res = await registryFor(broker).dispatch(
      request({ approvalId: sentId, approved: true, scope: "once" }),
      ctxFor("operator"),
    );
    expect(res).toMatchObject({ result: { accepted: true } });
    await expect(pending).resolves.toMatchObject({ approved: true });
  });

  it("answers accepted:false for an unknown/late approvalId", async () => {
    const res = await registryFor(makeBroker()).dispatch(
      request({ approvalId: "never-issued", approved: true, scope: "always" }),
      ctxFor("operator"),
    );
    expect(res).toMatchObject({ result: { accepted: false } });
  });
});
