import { describe, expect, it } from "vitest";
import { JSON_RPC_ERROR_CODES } from "@taki/shared";
import { withStack } from "./fixture/with-stack.ts";

// The security-relevant deliverable: the dev L1 drive has ZERO surface unless TAKI_DEV_TRIGGER=1. This proves the env
// double-gate against the REAL main.ts composition root (the unit test only proves the registry-level shape).
describe("dev capability.trigger env gating", () => {
  it("is absent without TAKI_DEV_TRIGGER=1 → METHOD_NOT_FOUND", async () => {
    await withStack({}, async (stack) => {
      const socket = await stack.operator();
      const frame = await socket.request("capability.trigger", { capability: "screenshot", input: {} });
      expect(frame).toMatchObject({ error: { code: JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND } });
    });
  });

  it("is present with devTrigger and drives a real capability (screenshot lands a file)", async () => {
    await withStack({ devTrigger: true, autoApprove: "screenshot=allow-once" }, async (stack) => {
      const result = await stack.l1("screenshot", {});
      expect(result).toMatchObject({ ok: true });
      expect(stack.screenshots().length).toBeGreaterThanOrEqual(1);
    });
  });
});
