import { describe, expect, it } from "vitest";
import { withStack } from "./fixture/with-stack.ts";

// #16 — a simple allowlisted command auto-runs with NO gate ask. The approver is set to `deny`; the command still runs
// (exitCode 0) and is audited `auto-allowed` — both prove the allowlist bypassed the dialog entirely.
describe("exec allowlist auto-run (no gate ask)", () => {
  it("hostname (allowlisted) runs despite an exec=deny approver", async () => {
    await withStack(
      { devTrigger: true, autoApprove: "exec=deny", execPolicy: { mode: "allowlist", allowlist: ["hostname"] } },
      async (stack) => {
        const result = (await stack.l1("exec", { command: "hostname" })) as { ok: boolean; exitCode?: number | null };
        expect(result.ok).toBe(true);
        expect(result.exitCode).toBe(0);

        const execDecisions = stack.audit().filter((line) => line.capability === "exec").map((line) => line.decision);
        expect(execDecisions).toContain("auto-allowed");
        expect(execDecisions).not.toContain("denied");
      },
    );
  });
});
