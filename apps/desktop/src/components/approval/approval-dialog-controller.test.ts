import { describe, expect, it, vi } from "vitest";
import type { CanonicalApprovalRequest } from "@taki/shared";
import {
  createApprovalDialogController,
  type ApprovalDialogClient,
  type ApprovalDialogSnapshot,
} from "./approval-dialog-controller.ts";
import type { ApprovalPushEvent } from "@/lib/ws-client-routes.js";

const IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
] as const;

function request(approvalId: string, always = true): CanonicalApprovalRequest {
  return {
    approvalId,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    policyGeneration: 3,
    approvalGeneration: 4,
    binding: {
      bindingRevision: 1,
      identity: {
        capabilityId: "mcp.tool.call",
        ownerHostId: "33333333-3333-4333-8333-333333333333",
        subject: { subjectId: "server:tool", revision: "1" },
      },
      descriptorRevision: 1,
      classifierId: "mcp.tool.call.v1",
      classifierRevision: 1,
      cellKey: "mcp-tool-call",
      decisionScopeDigest: "a".repeat(64),
    },
    ...(always ? { disclosureRevision: 1 } : {}),
    allowedChoices: always
      ? ["allow_once", "allow_session", "allow_always", "deny"]
      : ["allow_once", "deny"],
    presentation: {
      revision: 1,
      title: "Run MCP tool",
      capabilityLabel: "MCP tool",
      riskSummary: "This tool can change external state.",
      sections: [{ title: "Target", fields: [{ label: "Tool", value: "redacted-tool" }] }],
    },
  };
}

function client(): ApprovalDialogClient & { push(event: ApprovalPushEvent): void; calls: unknown[] } {
  let handler: ((event: ApprovalPushEvent) => void) | null = null;
  const calls: unknown[] = [];
  return {
    calls,
    onApproval(next) {
      handler = next;
      return () => { handler = null; };
    },
    onClose() {
      // The controller tests explicitly call replace() to model transport/client retirement.
    },
    push(event) { handler?.(event); },
    async approvalRespond(params) {
      calls.push(params);
      return { status: "accepted", approvalGeneration: 4 };
    },
  };
}

describe("Approval dialog controller", () => {
  it("queues socket-local requests FIFO and advances only after the active request closes", () => {
    const snapshots: ApprovalDialogSnapshot[] = [];
    const connection = client();
    const controller = createApprovalDialogController((view) => snapshots.push(view));
    controller.replace(connection);
    connection.push({ type: "request", request: request(IDS[0]) });
    connection.push({ type: "request", request: request(IDS[1]) });
    expect(controller.snapshot()).toMatchObject({ request: { approvalId: IDS[0] }, queued: 1 });
    connection.push({
      type: "closed",
      closed: { approvalId: IDS[0], reason: "answered", approvalGeneration: 4 },
    });
    expect(controller.snapshot()).toMatchObject({ request: { approvalId: IDS[1] }, queued: 0 });
    expect(snapshots.length).toBeGreaterThan(2);
  });

  it("keeps a prompt visible with bounded feedback when Core rejects its scope", async () => {
    const connection = client();
    connection.approvalRespond = async (params) => {
      connection.calls.push(params);
      return connection.calls.length === 1
        ? { status: "scope_not_allowed", approvalGeneration: 4 }
        : { status: "accepted", approvalGeneration: 4 };
    };
    const controller = createApprovalDialogController(() => undefined);
    controller.replace(connection);
    connection.push({ type: "request", request: request(IDS[0]) });
    await controller.choose("allow_session");
    expect(controller.snapshot()).toMatchObject({
      request: { approvalId: IDS[0] },
      status: { kind: "error", message: "该允许范围不适用于当前操作，请选择其他选项。", dismissible: false },
    });
    await controller.choose("allow_once");
    expect(connection.calls.map((call) => (call as { choice: string }).choice)).toEqual(["allow_session", "allow_once"]);
    expect(controller.snapshot().request).toBeNull();
  });

  it("requires a distinct current disclosure acknowledgement before sending always", async () => {
    const connection = client();
    const controller = createApprovalDialogController(() => undefined);
    controller.replace(connection);
    connection.push({ type: "request", request: request(IDS[0]) });
    await controller.choose("allow_always");
    expect(connection.calls).toEqual([]);
    expect(controller.snapshot().status).toMatchObject({ kind: "error" });
    controller.acknowledgeDisclosure(true);
    await controller.choose("allow_always");
    expect(connection.calls).toEqual([expect.objectContaining({
      choice: "allow_always",
      disclosure: { revision: 1, futureBackgroundUseAccepted: true },
    })]);
  });

  it("keeps the prompt visible with an explicit error if an invalid always request lacks disclosure", async () => {
    const connection = client();
    const controller = createApprovalDialogController(() => undefined);
    controller.replace(connection);
    const invalid = { ...request(IDS[0], false), allowedChoices: ["allow_once", "allow_always", "deny"] };
    connection.push({ type: "request", request: invalid as CanonicalApprovalRequest });
    await controller.choose("allow_always");
    expect(connection.calls).toEqual([]);
    expect(controller.snapshot()).toMatchObject({
      request: { approvalId: IDS[0] },
      status: { kind: "error", message: expect.stringContaining("缺少披露版本"), dismissible: false },
    });
  });

  it("surfaces a late response before dismissing the retired prompt", async () => {
    const connection = client();
    connection.approvalRespond = async () => ({ status: "late", approvalGeneration: 5 });
    const controller = createApprovalDialogController(() => undefined);
    controller.replace(connection);
    connection.push({ type: "request", request: request(IDS[0]) });
    await controller.choose("allow_once");
    expect(controller.snapshot()).toMatchObject({
      request: { approvalId: IDS[0] },
      status: { kind: "error", message: "此审批已结束，Core 未执行这次响应。", dismissible: true },
    });
    controller.dismiss();
    expect(controller.snapshot().request).toBeNull();
  });

  it("retires an answered close immediately and suppresses the late response", async () => {
    const result = deferred<{ status: "accepted"; approvalGeneration: number }>();
    const connection = client();
    connection.approvalRespond = () => result.promise;
    const controller = createApprovalDialogController(() => undefined);
    controller.replace(connection);
    connection.push({ type: "request", request: request(IDS[0]) });
    const responding = controller.choose("allow_once");
    connection.push({
      type: "closed",
      closed: { approvalId: IDS[0], reason: "answered", approvalGeneration: 4 },
    });
    expect(controller.snapshot().request).toBeNull();
    result.resolve({ status: "accepted", approvalGeneration: 4 });
    await responding;
    expect(controller.snapshot().request).toBeNull();
  });

  it("retires a prompt at its local expiry backstop", () => {
    vi.useFakeTimers();
    try {
      const connection = client();
      const controller = createApprovalDialogController(() => undefined);
      controller.replace(connection);
      connection.push({ type: "request", request: { ...request(IDS[0]), expiresAt: new Date(Date.now() + 10).toISOString() } });
      expect(controller.snapshot().request).not.toBeNull();
      vi.advanceTimersByTime(11);
      expect(controller.snapshot().request).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a retired client's late response and clears its entire queue immediately", async () => {
    let resolve!: (value: { status: "accepted"; approvalGeneration: number }) => void;
    const first = client();
    first.approvalRespond = () => new Promise((done) => { resolve = done; });
    const second = client();
    const controller = createApprovalDialogController(() => undefined);
    controller.replace(first);
    first.push({ type: "request", request: request(IDS[0]) });
    const responding = controller.choose("allow_once");
    controller.replace(second);
    resolve({ status: "accepted", approvalGeneration: 4 });
    await responding;
    expect(controller.snapshot()).toEqual({
      request: null, queued: 0, status: { kind: "ready" }, disclosureAcknowledged: false,
    });
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
