import { describe, expect, it, vi } from "vitest";
import type { CanonicalApprovalRequest } from "@taki/shared";
import { createCliApprovalController } from "./approval-controller.ts";

const IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
] as const;

function request(id: string, expiresAt = new Date(Date.now() + 60_000).toISOString()): CanonicalApprovalRequest {
  return {
    approvalId: id,
    expiresAt,
    policyGeneration: 3,
    approvalGeneration: 4,
    binding: {
      bindingRevision: 1,
      identity: { capabilityId: "mcp.tool.call", ownerHostId: "33333333-3333-4333-8333-333333333333" },
      descriptorRevision: 1,
      classifierId: "mcp.tool.call.v1",
      classifierRevision: 1,
      cellKey: "mcp-tool-call",
      decisionScopeDigest: "a".repeat(64),
    },
    disclosureRevision: 1,
    allowedChoices: ["allow_once", "allow_session", "allow_always", "deny"],
    presentation: {
      revision: 1,
      title: "Run MCP tool",
      capabilityLabel: "MCP tool",
      riskSummary: "This tool can change external state.",
      sections: [{ title: "Target", fields: [{ label: "Tool", value: "redacted-tool" }] }],
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("CLI Approval controller", () => {
  it("requires a separate future-background disclosure answer before always", async () => {
    const answers = ["a", "yes"];
    const calls: unknown[] = [];
    const controller = createCliApprovalController({
      ask: async () => answers.shift() ?? null,
      write: () => undefined,
    });
    controller.replace({
      approvalRespond: async (params) => {
        calls.push(params);
        return { status: "accepted", approvalGeneration: 5 };
      },
    });
    controller.receive({ type: "request", request: request(IDS[0]) });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      choice: "allow_always",
      disclosure: { revision: 1, futureBackgroundUseAccepted: true },
    });
  });

  it("retires an active prompt on closed and advances safely to the queued request", async () => {
    const firstAnswer = deferred<string | null>();
    const answers = [firstAnswer.promise, Promise.resolve("d")];
    const calls: unknown[] = [];
    const controller = createCliApprovalController({
      ask: () => answers.shift() ?? Promise.resolve(null),
      write: () => undefined,
    });
    controller.replace({
      approvalRespond: async (params) => {
        calls.push(params);
        return { status: "accepted", approvalGeneration: 4 };
      },
    });
    controller.receive({ type: "request", request: request(IDS[0]) });
    controller.receive({ type: "request", request: request(IDS[1]) });
    controller.receive({
      type: "closed",
      closed: { approvalId: IDS[0], reason: "cancelled", approvalGeneration: 4 },
    });
    firstAnswer.resolve("y");
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ approvalId: IDS[1], choice: "deny" });
  });

  it("fails closed without hanging when stdin is already closed", async () => {
    const calls: unknown[] = [];
    const controller = createCliApprovalController({ ask: async () => null, write: () => undefined });
    controller.replace({
      approvalRespond: async (params) => {
        calls.push(params);
        return { status: "accepted", approvalGeneration: 4 };
      },
    });
    controller.receive({ type: "request", request: request(IDS[0]) });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ choice: "deny" });
  });

  it("retires locally at expiry and sends no authorization", () => {
    vi.useFakeTimers();
    try {
      const calls: unknown[] = [];
      const controller = createCliApprovalController({
        ask: (_query, signal) => new Promise((resolve) => signal?.addEventListener("abort", () => resolve(null), { once: true })),
        write: () => undefined,
      });
      controller.replace({
        approvalRespond: async (params) => {
          calls.push(params);
          return { status: "accepted", approvalGeneration: 4 };
        },
      });
      controller.receive({ type: "request", request: request(IDS[0], new Date(Date.now() + 10).toISOString()) });
      vi.advanceTimersByTime(11);
      expect(calls).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
