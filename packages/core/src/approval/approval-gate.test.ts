import { describe, expect, it, vi } from "vitest";
import { createApprovalGate, type ApprovalToolResolver } from "./approval-gate.ts";
import type { ApprovalBroker, ApprovalOutcome } from "./approval-broker.ts";
import type { DecisionStore } from "./decision-store.ts";

const resolver: ApprovalToolResolver = {
  describe: (key) => (key === "files_read" ? { serverName: "files", toolName: "read" } : undefined),
};

function gate(overrides: { get?: DecisionStore["get"]; ask?: ApprovalBroker["ask"] } = {}) {
  const remember = vi.fn();
  const denyAll = vi.fn();
  const decisions: DecisionStore = { get: overrides.get ?? (() => undefined), remember };
  const broker: ApprovalBroker = {
    ask: overrides.ask ?? (async () => ({ approved: true, scope: "once" }) satisfies ApprovalOutcome),
    resolve: () => ({ accepted: true }),
    denyAll,
  };
  return { gate: createApprovalGate({ mcp: resolver, broker, decisions }), remember, denyAll };
}

describe("createApprovalGate", () => {
  it("returns not-applicable for an internal (non-MCP) tool and never asks (T15)", async () => {
    const ask = vi.fn();
    const { gate: g } = gate({ ask: ask as unknown as ApprovalBroker["ask"] });
    expect(await g.decide({ toolName: "memory_write", input: {} }, () => undefined)).toBe("not-applicable");
    expect(await g.decide({ toolName: "load_skill", input: {} }, () => undefined)).toBe("not-applicable");
    expect(ask).not.toHaveBeenCalled();
  });

  it("auto-approves a remembered `always` without asking", async () => {
    const ask = vi.fn();
    const { gate: g } = gate({ get: () => "always", ask: ask as unknown as ApprovalBroker["ask"] });
    expect(await g.decide({ toolName: "files_read", input: {} }, () => undefined)).toBe("approved");
    expect(ask).not.toHaveBeenCalled();
  });

  it("auto-denies a remembered `never` without asking", async () => {
    const ask = vi.fn();
    const { gate: g } = gate({ get: () => "never", ask: ask as unknown as ApprovalBroker["ask"] });
    expect(await g.decide({ toolName: "files_read", input: {} }, () => undefined)).toMatchObject({ type: "denied" });
    expect(ask).not.toHaveBeenCalled();
  });

  it("asks the broker for an unremembered MCP tool and records the outcome", async () => {
    const outcome: ApprovalOutcome = { approved: true, scope: "always" };
    const { gate: g, remember } = gate({ ask: async () => outcome });
    expect(await g.decide({ toolName: "files_read", input: { path: "/x" } }, () => undefined)).toBe("approved");
    expect(remember).toHaveBeenCalledWith("files", "read", outcome);
  });

  it("returns a denied status carrying the broker's reason", async () => {
    const { gate: g } = gate({ ask: async () => ({ approved: false, scope: "once", reason: "approval timed out" }) });
    expect(await g.decide({ toolName: "files_read", input: {} }, () => undefined)).toEqual({
      type: "denied",
      reason: "approval timed out",
    });
  });

  it("denies an unremembered MCP tool when no notify sink exists (fail-closed, no operator to ask)", async () => {
    const ask = vi.fn();
    const { gate: g } = gate({ ask: ask as unknown as ApprovalBroker["ask"] });
    expect(await g.decide({ toolName: "files_read", input: {} })).toMatchObject({ type: "denied" });
    expect(ask).not.toHaveBeenCalled();
  });

  it("still honors a remembered `always` without a notify sink", async () => {
    const { gate: g } = gate({ get: () => "always" });
    expect(await g.decide({ toolName: "files_read", input: {} })).toBe("approved");
  });

  it("denyPending forwards to the broker", () => {
    const { gate: g, denyAll } = gate();
    g.denyPending("connection closed");
    expect(denyAll).toHaveBeenCalledWith("connection closed");
  });
});
