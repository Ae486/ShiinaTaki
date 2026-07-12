import { describe, expect, it } from "vitest";
import { withStack } from "./fixture/with-stack.ts";

// #18 — a chained/redirected command escalates even when its head is allowlisted: `git` auto-runs alone, but
// `git status && del x` is a compound structure, so it must ask (here: denied). `denied` (not `auto-allowed`) is the proof.
describe("chained command escalates past the allowlist", () => {
  it("git status && del x → gate ask → denied (git alone would auto-run)", async () => {
    await withStack(
      { devTrigger: true, autoApprove: "exec=deny", execPolicy: { mode: "allowlist", allowlist: ["git"] } },
      async (stack) => {
        const result = await stack.l1("exec", { command: "git status && del x" });
        expect(result).toMatchObject({ ok: false, code: "DENIED" });

        const execDecisions = stack.audit().filter((line) => line.capability === "exec").map((line) => line.decision);
        // `denied` = escalate → ask → refuse. A bare `git status` would have been `auto-allowed`; this was not.
        expect(execDecisions).toContain("denied");
        expect(execDecisions).not.toContain("auto-allowed");
      },
    );
  });
});
