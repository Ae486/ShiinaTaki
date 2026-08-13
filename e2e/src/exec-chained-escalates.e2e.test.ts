import { describe, expect, it } from "vitest";
import { withStack } from "./fixture/with-stack.ts";

// #18 — a chained/redirected command escalates even when its head is allowlisted: `git` auto-runs alone, but
// `git status && del x` is compound, so Slice 3 fails closed as APPROVAL_REQUIRED without a local prompt.
describe("chained command escalates past the allowlist", () => {
  it("git status && del x → fail-closed APPROVAL_REQUIRED (git alone would auto-run)", async () => {
    await withStack(
      { devTrigger: true, autoApprove: "exec=deny", execPolicy: { mode: "allowlist", allowlist: ["git"] } },
      async (stack) => {
        const result = await stack.l1("exec", { command: "git status && del x" });
        expect(result).toMatchObject({ ok: false, code: "APPROVAL_REQUIRED" });

        const execDecisions = stack.audit().filter((line) => line.capability === "exec").map((line) => line.decision);
        expect(execDecisions).toContain("auto-denied");
        expect(execDecisions).not.toContain("auto-allowed");
      },
    );
  });
});
