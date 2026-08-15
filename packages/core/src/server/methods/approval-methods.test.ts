import { describe, expect, it, vi } from "vitest";
import { APPROVAL_METHODS, type JsonRpcRequest } from "@taki/shared";
import type { ApprovalInteractionService } from "../../approval/approval-interaction-service.ts";
import { ApprovalGenerationConflictError } from "../../approval/approval-state-repo.ts";
import type { Connection } from "../connection-registry.ts";
import { createMethodRegistry, type MethodContext } from "../method-registry.ts";
import { registerApprovalMethods } from "./approval-methods.ts";

const connection: Connection = {
  state: { status: "authenticated", deviceId: "operator", role: "operator", capabilities: [] },
};
const ctx: MethodContext = {
  connection, notify: () => undefined, close: () => undefined, onClose: () => undefined,
};

function request(method: string, params: unknown): JsonRpcRequest {
  return { jsonrpc: "2.0", id: "1", method, params };
}

function registry(service: ApprovalInteractionService) {
  const value = createMethodRegistry();
  registerApprovalMethods(value, service);
  return value;
}

describe("registerApprovalMethods", () => {
  it("passes the exact Connection object into approval.respond", async () => {
    const respond = vi.fn((_connection: Connection, _params: unknown) => {
      void _connection;
      void _params;
      return { status: "late" as const, approvalGeneration: 2 };
    });
    const service = { respond } as unknown as ApprovalInteractionService;
    const result = await registry(service).dispatch(request(APPROVAL_METHODS.respond, {
      approvalId: "11111111-1111-4111-8111-111111111111",
      choice: "deny",
      expectedApprovalGeneration: 2,
    }), ctx);
    expect(respond.mock.calls[0]?.[0]).toBe(connection);
    expect(result).toMatchObject({ result: { status: "late", approvalGeneration: 2 } });
  });

  it("lists and revokes through bounded canonical results", async () => {
    const service = {
      list: vi.fn(() => ({ approvalGeneration: 1, governanceRegistryRevision: 1, disclosureRevision: 1, decisions: [] })),
      revoke: vi.fn(() => { throw new ApprovalGenerationConflictError(4); }),
    } as unknown as ApprovalInteractionService;
    const methods = registry(service);
    await expect(methods.dispatch(request(APPROVAL_METHODS.list, {}), ctx)).resolves.toMatchObject({
      result: { approvalGeneration: 1, decisions: [] },
    });
    await expect(methods.dispatch(request(APPROVAL_METHODS.revoke, {
      decisionId: "11111111-1111-4111-8111-111111111111", expectedApprovalGeneration: 1,
    }), ctx)).resolves.toMatchObject({ result: { status: "stale_generation", approvalGeneration: 4 } });
  });
});
