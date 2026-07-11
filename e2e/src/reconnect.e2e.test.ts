import { describe, expect, it } from "vitest";
import { NODE_DEVICE_NAME, withStack } from "./fixture/with-stack.ts";

const isNodePairing = (entry: Record<string, unknown>): boolean =>
  entry.msg === "pairing code issued" && entry.deviceName === NODE_DEVICE_NAME;

describe("node reconnect (no LLM)", () => {
  it("pairs once, then reconnects with the persisted token — no second pairing code", async () => {
    await withStack({}, async (stack) => {
      // Boot already paired the node (withStack fed the pairing code) and saw state=connected.
      expect(stack.countCoreLog(isNodePairing)).toBe(1);

      await stack.killNode();

      // Same TAKI_DATA_DIR -> secrets.json holds the issued token; no pairing code is fed this time.
      await stack.startNode(false);

      expect(stack.countCoreLog(isNodePairing)).toBe(1);
      const node = stack.node();
      expect(node?.stderr.count((line) => line.includes("state=connected"))).toBeGreaterThanOrEqual(1);
    });
  });
});
