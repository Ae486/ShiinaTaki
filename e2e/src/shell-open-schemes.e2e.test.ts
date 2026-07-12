import { describe, expect, it } from "vitest";
import { withStack } from "./fixture/with-stack.ts";

// #11 — dangerous url schemes classify as `shell-open:blocked` and are refused AT THE GATE: auto-denied, no dialog,
// the handler is never reached (its own scheme allowlist remains as defense-in-depth). An allow-everything approver
// proves the refusal never came from a dialog.
describe("shell-open rejects dangerous url schemes", () => {
  it("javascript: and file: → DENIED at the gate, audited auto-denied, no ask", async () => {
    await withStack({ devTrigger: true, autoApprove: "allow-always" }, async (stack) => {
      for (const target of ["javascript:alert(1)", "file:///etc/passwd"]) {
        const result = await stack.l1("shell_open", { kind: "url", target });
        expect(result).toMatchObject({ ok: false, code: "DENIED" });
      }
      expect(stack.audit().map((line) => [line.capability, line.decision])).toEqual([
        ["shell-open:blocked", "auto-denied"],
        ["shell-open:blocked", "auto-denied"],
      ]);
    });
  });
});
