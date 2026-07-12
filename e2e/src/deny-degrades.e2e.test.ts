import { describe, expect, it } from "vitest";
import { withStack } from "./fixture/with-stack.ts";

// #6 / #23 — a scripted `deny` must degrade into a structured error the model can read: no crash, no file, no output.
describe("deny path degrades to a structured error", () => {
  it("#6 screenshot deny → { ok:false, code:DENIED }, no file, node survives", async () => {
    await withStack({ devTrigger: true, autoApprove: "deny" }, async (stack) => {
      const result = await stack.l1("screenshot", {});
      expect(result).toMatchObject({ ok: false, code: "DENIED" });
      expect(stack.screenshots()).toHaveLength(0);
      // A denied capability is a normal outcome — the node must still be running afterwards.
      expect(stack.node()?.child.exitCode ?? null).toBeNull();
    });
  });

  it("#23 exec deny (a non-allowlisted command escalates, then is denied) → { ok:false, code:DENIED }, audited denied", async () => {
    await withStack({ devTrigger: true, autoApprove: "exec=deny" }, async (stack) => {
      const result = await stack.l1("exec", { command: "whoami" });
      expect(result).toMatchObject({ ok: false, code: "DENIED" });
      // `denied` (asked-then-refused) distinguishes this from `auto-denied` (block/disabled) — it proves the gate asked.
      const execDecisions = stack.audit().filter((line) => line.capability === "exec").map((line) => line.decision);
      expect(execDecisions).toContain("denied");
    });
  });
});
