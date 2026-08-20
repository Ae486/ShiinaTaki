import { describe, expect, it } from "vitest";
import { withStack } from "./fixture/with-stack.ts";

// Slice 3 is fail-closed on ask and never invokes the legacy local approver. The model receives APPROVAL_REQUIRED,
// no execution occurs, and the Node stays healthy for the future Core-mediated Approval lifecycle.
describe("approval-required path degrades to a structured error", () => {
  it("#6 screenshot ask → APPROVAL_REQUIRED, no file, node survives", async () => {
    await withStack({ devTrigger: true, autoApprove: "deny" }, async (stack) => {
      const result = await stack.l1("screenshot", {});
      expect(result).toMatchObject({ ok: false, code: "APPROVAL_REQUIRED" });
      expect(stack.screenshots()).toHaveLength(0);
      // A denied capability is a normal outcome — the node must still be running afterwards.
      expect(stack.node()?.child.exitCode ?? null).toBeNull();
    });
  });

  it("#23 non-allowlisted exec ask → APPROVAL_REQUIRED and no execution", async () => {
    await withStack({ devTrigger: true, autoApprove: "exec=deny" }, async (stack) => {
      const result = await stack.l1("exec", { command: "whoami" });
      expect(result).toMatchObject({ ok: false, code: "APPROVAL_REQUIRED" });
      const execDecisions = stack.audit().filter((line) => line.capability === "exec").map((line) => line.decision);
      expect(execDecisions).toEqual([]);
    });
  });
});
