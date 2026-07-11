import { describe, expect, it, vi } from "vitest";
import type { ScreenshotOutput, CapabilityRequest } from "@taki/shared";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { TIMEOUT_MESSAGE, createCapabilityBroker, type CapabilityNotify } from "./capability-broker.ts";

function broker(timeoutMs?: number) {
  const { logger } = createCaptureLogger();
  return createCapabilityBroker({ logger, timeoutMs });
}

// An arbitrary opaque payload (Option A); the broker no longer knows or checks the shape — the tool does.
const OUTPUT: ScreenshotOutput = { mediaType: "image/png", dataBase64: "AAAA", width: 1920, height: 1080 };

describe("createCapabilityBroker", () => {
  it("notifies the node with a requestId payload and resolves with the output on respond (T3)", async () => {
    const b = broker();
    let sent: CapabilityRequest | undefined;
    const notify: CapabilityNotify = (_method, params) => (sent = params as CapabilityRequest);

    const pending = b.request("screenshot", { area: "full" }, notify);
    expect(sent?.capability).toBe("screenshot");
    expect(sent?.input).toEqual({ area: "full" });
    expect(sent?.requestId).toBeDefined();

    expect(b.resolve({ requestId: sent!.requestId, ok: true, output: OUTPUT })).toEqual({ accepted: true });
    await expect(pending).resolves.toEqual({ ok: true, output: OUTPUT });
  });

  it("passes a node failure arm through as a structured outcome (T3 error arm)", async () => {
    const b = broker();
    let sent: CapabilityRequest | undefined;
    const pending = b.request("screenshot", {}, (_m, p) => (sent = p as CapabilityRequest));

    b.resolve({ requestId: sent!.requestId, ok: false, error: { code: "DENIED", message: "user denied" } });
    await expect(pending).resolves.toEqual({ ok: false, code: "DENIED", message: "user denied" });
  });

  it("fails with CAPABILITY_TIMEOUT when the node never answers (T4)", async () => {
    vi.useFakeTimers();
    try {
      const b = broker(90_000);
      const pending = b.request("screenshot", {}, () => undefined);
      await vi.advanceTimersByTimeAsync(90_000);
      await expect(pending).resolves.toEqual({ ok: false, code: "CAPABILITY_TIMEOUT", message: TIMEOUT_MESSAGE });
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails every pending request on node disconnect and treats a late respond as accepted:false (T5)", async () => {
    const b = broker();
    const ids: string[] = [];
    const notify: CapabilityNotify = (_m, p) => ids.push((p as CapabilityRequest).requestId);
    const first = b.request("screenshot", {}, notify);
    const second = b.request("screenshot", {}, notify);

    b.denyAll("node disconnected");

    await expect(first).resolves.toMatchObject({ ok: false, code: "NODE_DISCONNECTED", message: "node disconnected" });
    await expect(second).resolves.toMatchObject({ ok: false, code: "NODE_DISCONNECTED" });
    expect(b.resolve({ requestId: ids[0]!, ok: true, output: OUTPUT })).toEqual({ accepted: false });
  });

  it("treats an unknown requestId as accepted:false (late/unknown respond)", () => {
    const b = broker();
    expect(b.resolve({ requestId: "22222222-2222-4222-8222-222222222222", ok: true, output: OUTPUT })).toEqual({
      accepted: false,
    });
  });
});
