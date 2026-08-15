import { describe, expect, it, vi } from "vitest";
import type { CapabilityCancel, CapabilityRequest, ScreenshotOutput } from "@taki/shared";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { fakeHost, testApproval } from "../testing/capability-tool-harness.ts";
import {
  TIMEOUT_MESSAGE,
  createCapabilityBroker,
  type CapabilityDispatchTarget,
  type CapabilityNotify,
} from "./capability-broker.ts";
import { TERMINAL_RECORD_LIMIT } from "./capability-broker-state.ts";

const HOST_A = "11111111-1111-4111-8111-111111111111";
const HOST_B = "22222222-2222-4222-8222-222222222222";
const OUTPUT: ScreenshotOutput = { mediaType: "image/png", dataBase64: "AAAA", width: 1920, height: 1080 };
const EVIDENCE = { descriptorRevision: 1, classifierRevision: 1, cellKey: "screenshot", effectivePosture: "auto" as const, constraint: "none" as const };

function broker(timeoutMs?: number) {
  const capture = createCaptureLogger();
  return {
    broker: createCapabilityBroker({
      logger: capture.logger,
      approval: testApproval(),
      timeoutMs,
      now: () => Date.parse("2026-08-12T00:00:00.000Z"),
    }),
    records: capture.records,
  };
}

function target(hostId: string, notify: CapabilityNotify, execution: "read" | "effect" = "read"): CapabilityDispatchTarget {
  return {
    hostId,
    connectionGeneration: 1,
    catalogGeneration: 1,
    descriptor: { capabilityId: "screenshot", execution, cancellation: execution === "read" ? "cooperative" : "non-cooperative", governance: { descriptorRevision: 1, classifierId: "fixed-risk", classifierRevision: 1 } },
    connection: fakeHost("screenshot"),
    notify,
    policyGeneration: 1,
    governanceProjection: { registryRevision: 1, descriptorRevision: 1, classifierRevision: 1, cells: [{ key: "screenshot", posture: "auto" as const }], digest: "a".repeat(64) },
    isCurrent: () => true,
  };
}

function governedTarget(hostId: string, notify: CapabilityNotify): CapabilityDispatchTarget {
  return {
    ...target(hostId, notify), policyGeneration: 7,
    governanceProjection: { registryRevision: 1, descriptorRevision: 1, classifierRevision: 1, cells: [{ key: "screenshot", posture: "ask" as const }], digest: "a".repeat(64) },
  };
}

describe("createCapabilityBroker", () => {
  it("mints sealed control and accepts only the owning Host/generation response", async () => {
    const { broker: b } = broker();
    let sent: CapabilityRequest | undefined;
    const pending = b.request(target(HOST_A, (_method, params) => (sent = params as CapabilityRequest)), { area: "full" });
    expect(sent?.control.targetHostId).toBe(HOST_A);
    expect(sent?.control.inputDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(b.resolve({ requestId: sent!.requestId, control: sent!.control, state: "completed", output: OUTPUT, governance: EVIDENCE }, {
      hostId: HOST_B, connectionGeneration: 1,
    })).toEqual({ accepted: false, reason: "wrong_host" });
    expect(b.resolve({ requestId: sent!.requestId, control: sent!.control, state: "completed", output: OUTPUT, governance: EVIDENCE }, {
      hostId: HOST_A, connectionGeneration: 1,
    })).toEqual({ accepted: true });
    expect(b.resolve({ requestId: sent!.requestId, control: sent!.control, state: "completed", output: OUTPUT, governance: EVIDENCE }, {
      hostId: HOST_A, connectionGeneration: 1,
    })).toEqual({ accepted: false, reason: "duplicate" });
    await expect(pending).resolves.toEqual({ ok: true, output: OUTPUT });
  });

  it("keeps terminal provenance checks before duplicate classification", async () => {
    const { broker: b } = broker();
    let sent: CapabilityRequest | undefined;
    const pending = b.request(target(HOST_A, (_method, value) => (sent = value as CapabilityRequest)), {});
    const response = { requestId: sent!.requestId, control: sent!.control, state: "completed" as const, output: OUTPUT, governance: EVIDENCE };
    expect(b.resolve(response, { hostId: HOST_A, connectionGeneration: 1 })).toEqual({ accepted: true });
    await pending;

    expect(b.resolve(response, { hostId: HOST_B, connectionGeneration: 1 })).toEqual({
      accepted: false,
      reason: "wrong_host",
    });
    expect(b.resolve(response, { hostId: HOST_A, connectionGeneration: 2 })).toEqual({
      accepted: false,
      reason: "stale_generation",
    });
    expect(b.resolve({ ...response, control: { ...response.control, catalogGeneration: 2 } }, {
      hostId: HOST_A, connectionGeneration: 1,
    })).toEqual({ accepted: false, reason: "stale_generation" });
  });

  it("disconnect settles only the owning Host generation", async () => {
    const { broker: b } = broker();
    const first = b.request(target(HOST_A, () => undefined), {});
    let sentA: CapabilityRequest | undefined;
    const late = b.request(target(HOST_A, (_m, p) => (sentA = p as CapabilityRequest)), {});
    let sentB: CapabilityRequest | undefined;
    const second = b.request(target(HOST_B, (_m, p) => (sentB = p as CapabilityRequest)), {});
    b.cancelGeneration(HOST_A, 1, "Host disconnected");
    await expect(first).resolves.toMatchObject({ ok: false, code: "NODE_DISCONNECTED" });
    await expect(late).resolves.toMatchObject({ ok: false, code: "NODE_DISCONNECTED" });
    expect(b.resolve({ requestId: sentA!.requestId, control: sentA!.control, state: "completed", output: OUTPUT, governance: EVIDENCE }, {
      hostId: HOST_A, connectionGeneration: 1,
    })).toEqual({ accepted: false, reason: "late" });
    expect(b.resolve({ requestId: sentB!.requestId, control: sentB!.control, state: "completed", output: OUTPUT, governance: EVIDENCE }, {
      hostId: HOST_B, connectionGeneration: 1,
    })).toEqual({ accepted: true });
    await expect(second).resolves.toEqual({ ok: true, output: OUTPUT });
  });

  it("deadline cancels a cooperative read but settles an effect outcome_unknown", async () => {
    vi.useFakeTimers();
    try {
      const { broker: b } = broker(100);
      let cancel: CapabilityCancel | undefined;
      let sentRead: CapabilityRequest | undefined;
      const read = b.request(target(HOST_A, (method, params) => {
        if (method === "capability.request") sentRead = params as CapabilityRequest;
        if (method === "capability.cancel") cancel = params as CapabilityCancel;
      }), {});
      const effect = b.request(target(HOST_B, () => undefined, "effect"), {});
      await vi.advanceTimersByTimeAsync(100);
      expect(cancel?.reason).toBe("deadline_exceeded");
      await expect(read).resolves.toEqual({ ok: false, code: "CAPABILITY_TIMEOUT", message: TIMEOUT_MESSAGE });
      await expect(effect).resolves.toMatchObject({ ok: false, code: "OUTCOME_UNKNOWN", state: "outcome_unknown" });
      expect(b.resolve({ requestId: sentRead!.requestId, control: sentRead!.control, state: "completed", output: OUTPUT, governance: EVIDENCE }, {
        hostId: HOST_A, connectionGeneration: 1,
      })).toEqual({ accepted: false, reason: "late" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns unknown_request for never-issued and insertion-order-evicted terminal IDs", async () => {
    const { broker: b } = broker();
    expect(b.resolve({
      requestId: "33333333-3333-4333-8333-333333333333",
      control: terminalControl(HOST_A),
      state: "completed",
      output: OUTPUT,
      governance: EVIDENCE,
    }, { hostId: HOST_A, connectionGeneration: 1 })).toEqual({ accepted: false, reason: "unknown_request" });

    let first: CapabilityRequest | undefined;
    for (let index = 0; index <= TERMINAL_RECORD_LIMIT; index += 1) {
      let sent: CapabilityRequest | undefined;
      const pending = b.request(target(HOST_A, (_method, value) => (sent = value as CapabilityRequest)), {});
      if (index === 0) first = sent;
      b.resolve({ requestId: sent!.requestId, control: sent!.control, state: "completed", output: OUTPUT, governance: EVIDENCE }, {
        hostId: HOST_A, connectionGeneration: 1,
      });
      await pending;
    }

    expect(b.resolve({ requestId: first!.requestId, control: first!.control, state: "completed", output: OUTPUT, governance: EVIDENCE }, {
      hostId: HOST_A, connectionGeneration: 1,
    })).toEqual({ accepted: false, reason: "unknown_request" });
  });

  it("does not include stable hostId in per-request broker logs", async () => {
    const { broker: b, records } = broker();
    let sent: CapabilityRequest | undefined;
    const pending = b.request(target(HOST_A, (_method, value) => (sent = value as CapabilityRequest)), {});
    b.resolve({ requestId: sent!.requestId, control: sent!.control, state: "completed", output: OUTPUT, governance: EVIDENCE }, {
      hostId: HOST_A, connectionGeneration: 1,
    });
    await pending;

    const requestLogs = records.filter((record) => record.msg === "capability requested" || record.msg === "capability settled");
    expect(requestLogs).toHaveLength(2);
    for (const record of requestLogs) {
      expect(record.obj).not.toHaveProperty("hostId");
      expect(JSON.stringify(record.obj)).not.toContain(HOST_A);
    }
  });

  it("rejects Host evidence that widens the projected posture", async () => {
    const { broker: b } = broker();
    let sent: CapabilityRequest | undefined;
    const pending = b.request(governedTarget(HOST_A, (_method, value) => (sent = value as CapabilityRequest)), {});
    b.resolve({ requestId: sent!.requestId, control: sent!.control, state: "completed", output: OUTPUT, governance: {
      descriptorRevision: 1, classifierRevision: 1, cellKey: "screenshot", effectivePosture: "auto", constraint: "none",
    } }, { hostId: HOST_A, connectionGeneration: 1 });
    await expect(pending).resolves.toMatchObject({ ok: false, code: "DENIED" });
  });

  it("passes the Host fail-closed approval-required outcome through distinctly", async () => {
    const { broker: b } = broker();
    let sent: CapabilityRequest | undefined;
    const pending = b.request(governedTarget(HOST_A, (_method, value) => (sent = value as CapabilityRequest)), {});
    b.resolve({
      requestId: sent!.requestId,
      control: sent!.control,
      state: "failed",
      error: { code: "APPROVAL_REQUIRED", message: "approval required" },
      governance: { descriptorRevision: 1, classifierRevision: 1, cellKey: "screenshot", effectivePosture: "ask", constraint: "none" },
    }, { hostId: HOST_A, connectionGeneration: 1 });
    await expect(pending).resolves.toEqual({ ok: false, code: "APPROVAL_REQUIRED", message: "approval required" });
  });
});

function terminalControl(hostId: string) {
  return {
    runId: "44444444-4444-4444-8444-444444444444",
    operationId: "55555555-5555-4555-8555-555555555555",
    attemptId: "66666666-6666-4666-8666-666666666666",
    targetHostId: hostId,
    connectionGeneration: 1,
    catalogGeneration: 1,
    policyGeneration: 1,
    governanceProjection: { registryRevision: 1, descriptorRevision: 1, classifierRevision: 1, cells: [{ key: "screenshot", posture: "auto" as const }], digest: "a".repeat(64) },
    approvalGeneration: 1,
    capabilityId: "screenshot",
    inputDigest: "0".repeat(64),
    idempotencyKey: "77777777-7777-4777-8777-777777777777",
    dispatchedAt: "2026-08-12T00:00:00.000Z",
    deadlineAt: "2026-08-12T00:01:30.000Z",
  };
}
