import { describe, expect, it, vi } from "vitest";
import type { ApprovalRequest } from "@taki/shared";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { TIMEOUT_REASON, createApprovalBroker, type ApprovalNotify } from "./approval-broker.ts";

function broker(timeoutMs?: number) {
  const { logger } = createCaptureLogger();
  return createApprovalBroker({ logger, timeoutMs });
}

describe("createApprovalBroker", () => {
  it("notifies with the correct payload and resolves when the operator approves (T9)", async () => {
    const b = broker();
    let sent: ApprovalRequest | undefined;
    const notify: ApprovalNotify = (_method, params) => (sent = params as ApprovalRequest);

    const pending = b.ask({ serverName: "files", toolName: "read", input: { path: "/x" } }, notify);
    expect(sent?.serverName).toBe("files");
    expect(sent?.toolName).toBe("read");
    expect(sent?.input).toEqual({ path: "/x" });

    expect(b.resolve({ approvalId: sent!.approvalId, approved: true, scope: "once" })).toEqual({ accepted: true });
    await expect(pending).resolves.toEqual({ approved: true, scope: "once", reason: undefined });
  });

  it("denies with the timeout reason when the operator never answers (T10)", async () => {
    vi.useFakeTimers();
    try {
      const b = broker(60_000);
      const pending = b.ask({ serverName: "s", toolName: "t", input: {} }, () => undefined);
      await vi.advanceTimersByTimeAsync(60_000);
      await expect(pending).resolves.toEqual({ approved: false, scope: "once", reason: TIMEOUT_REASON });
    } finally {
      vi.useRealTimers();
    }
  });

  it("denies all pending on operator disconnect (T12)", async () => {
    const b = broker();
    const ids: string[] = [];
    const notify: ApprovalNotify = (_m, params) => ids.push((params as ApprovalRequest).approvalId);
    const first = b.ask({ serverName: "a", toolName: "x", input: {} }, notify);
    const second = b.ask({ serverName: "b", toolName: "y", input: {} }, notify);

    b.denyAll("connection closed");

    await expect(first).resolves.toMatchObject({ approved: false, reason: "connection closed" });
    await expect(second).resolves.toMatchObject({ approved: false, reason: "connection closed" });
    // A late respond for an already-settled id is accepted:false, never an error (ruling 3).
    expect(b.resolve({ approvalId: ids[0]!, approved: true, scope: "once" })).toEqual({ accepted: false });
  });

  it("treats an unknown approvalId as accepted:false (T21 late/unknown)", () => {
    const b = broker();
    expect(b.resolve({ approvalId: "never-issued", approved: true, scope: "always" })).toEqual({ accepted: false });
  });
});
