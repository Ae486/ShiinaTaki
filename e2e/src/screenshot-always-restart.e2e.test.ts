import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withStack } from "./fixture/with-stack.ts";

// #5 — an `allow-always` grant must survive a node restart via persisted gate-decisions.json: the SECOND screenshot
// authorizes with NO fresh ask (audited `auto-allowed`, not `allowed-always`).
describe("screenshot Always persists across a node restart (no second ask)", () => {
  it("grants once (allowed-always), then auto-allows after restart", async () => {
    await withStack({ devTrigger: true, autoApprove: "screenshot=allow-always" }, async (stack) => {
      const first = await stack.l1("screenshot", {});
      expect(first).toMatchObject({ ok: true });

      // Restart the node with the SAME data dir: gate-decisions.json holds the persisted Always verdict.
      await stack.killNode();
      expect(existsSync(join(stack.nodeDataDir, "gate-decisions.json"))).toBe(true);
      await stack.startNode(false);

      const second = await stack.l1("screenshot", {});
      expect(second).toMatchObject({ ok: true });

      // Two files landed; the audit trail proves the second ran without a fresh dialog.
      expect(stack.screenshots().length).toBe(2);
      const screenshotDecisions = stack.audit().filter((line) => line.capability === "screenshot").map((line) => line.decision);
      expect(screenshotDecisions).toEqual(["allowed-always", "auto-allowed"]);
    });
  });
});
