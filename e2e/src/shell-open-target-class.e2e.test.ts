import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withStack } from "./fixture/with-stack.ts";

// Slice 3 keeps legacy Never as a Host-local deny-only floor, ignores legacy Always, and never invokes a local prompt.
// The Rust classifier still selects exact cells; bounded evidence is verified by Core even though the audit capability
// remains the public capability name under the new final-enforcement path.
describe("shell-open governance remains class-scoped", () => {
  it("legacy url-safe Never denies the matching class without launching", async () => {
    await withStack({
      devTrigger: true,
      gateDecisions: [
        { capability: "shell-open:url-safe", decision: "never" },
        { capability: "shell-open", decision: "always" },
      ],
    }, async (stack) => {
      await expect(stack.l1("shell_open", { kind: "url", target: "http://127.0.0.1:9/taki-e2e" }))
        .resolves.toMatchObject({ ok: false, code: "DENIED" });
      expect(stack.audit().map((line) => [line.capability, line.decision])).toEqual([["shell-open", "auto-denied"]]);
    });
  });

  it("a legacy url-safe Always cannot authorize local classes; blocked remains DENIED", async () => {
    await withStack({
      devTrigger: true,
      gateDecisions: [
        { capability: "shell-open:url-safe", decision: "always" },
        { capability: "shell-open", decision: "always" },
      ],
    }, async (stack) => {
      await expect(stack.l1("shell_open", { kind: "path", target: "C:\\Windows\\System32\\cmd.exe" }))
        .resolves.toMatchObject({ ok: false, code: "APPROVAL_REQUIRED" });
      await expect(stack.l1("shell_open", { kind: "path", target: join(stack.nodeDataDir, "report.pdf") }))
        .resolves.toMatchObject({ ok: false, code: "APPROVAL_REQUIRED" });
      await expect(stack.l1("shell_open", { kind: "url", target: "javascript:alert(1)" }))
        .resolves.toMatchObject({ ok: false, code: "DENIED" });
      expect(stack.audit().map((line) => line.decision)).toEqual(["auto-denied"]);
    });
  });

  it("local-file asks remain fail-closed and never execute or persist a local allow", async () => {
    await withStack({ devTrigger: true, autoApprove: "shell-open:local-file=allow-always" }, async (stack) => {
      const target = join(stack.nodeDataDir, "missing-report.pdf");
      for (let index = 0; index < 2; index += 1) {
        await expect(stack.l1("shell_open", { kind: "path", target }))
          .resolves.toMatchObject({ ok: false, code: "APPROVAL_REQUIRED" });
      }
      expect(stack.audit().map((line) => line.decision)).toEqual([]);
    });
  });
});
