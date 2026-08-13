import { describe, expect, it } from "vitest";
import { withStack } from "./fixture/with-stack.ts";

// Slice 3 deliberately ignores legacy Always as authority. A restart cannot resurrect it: standard remains
// fail-closed APPROVAL_REQUIRED until Slice 4 installs the Core-mediated durable Approval lifecycle.
describe("legacy screenshot Always is inert across a node restart", () => {
  it("returns APPROVAL_REQUIRED before and after restart, with no screenshot bytes", async () => {
    await withStack({
      devTrigger: true,
      gateDecisions: [{ capability: "screenshot", decision: "always" }],
    }, async (stack) => {
      await expect(stack.l1("screenshot", {})).resolves.toMatchObject({ ok: false, code: "APPROVAL_REQUIRED" });
      await stack.killNode();
      await stack.startNode(false);
      await expect(stack.l1("screenshot", {})).resolves.toMatchObject({ ok: false, code: "APPROVAL_REQUIRED" });
      expect(stack.screenshots()).toHaveLength(0);
    });
  });
});
