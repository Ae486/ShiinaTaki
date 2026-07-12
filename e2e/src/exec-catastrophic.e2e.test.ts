import { describe, expect, it } from "vitest";
import { withStack } from "./fixture/with-stack.ts";

// #19 — a catastrophic (blocklisted) command is auto-denied with NO dialog, in EVERY mode. The approver is set to
// `allow-once`; the command is STILL refused and audited `auto-allowed`'s opposite — `auto-denied` — proving no ask ran.
describe("catastrophic command is auto-denied without a dialog", () => {
  it("format c: → { ok:false, code:DENIED }, audited auto-denied despite an allow approver", async () => {
    await withStack({ devTrigger: true, autoApprove: "exec=allow-once" }, async (stack) => {
      const result = await stack.l1("exec", { command: "format c:" });
      expect(result).toMatchObject({ ok: false, code: "DENIED" });

      const execDecisions = stack.audit().filter((line) => line.capability === "exec").map((line) => line.decision);
      // `auto-denied` (blocklist), never `allowed-once` — the allow approver was never consulted (no dialog).
      expect(execDecisions).toContain("auto-denied");
      expect(execDecisions).not.toContain("allowed-once");
    });
  });
});
