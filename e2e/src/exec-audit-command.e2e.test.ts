import { describe, expect, it } from "vitest";
import { withStack } from "./fixture/with-stack.ts";

// #22 — the audit line carries `command` ONLY for exec (the blast-radius record, ruling 9); every other capability
// stays names-only. Drive one exec (auto-run) + one screenshot and compare their audit lines.
describe("audit records command for exec, absent for non-exec", () => {
  it("exec line has command; screenshot line does not", async () => {
    await withStack(
      { devTrigger: true, autoApprove: "allow-once", execPolicy: { mode: "allowlist", allowlist: ["hostname"] } },
      async (stack) => {
        expect(await stack.l1("exec", { command: "hostname" })).toMatchObject({ ok: true });
        expect(await stack.l1("screenshot", {})).toMatchObject({ ok: true });

        const audit = stack.audit();
        const execLine = audit.find((line) => line.capability === "exec");
        const shotLine = audit.find((line) => line.capability === "screenshot");
        expect(execLine?.command).toBe("hostname");
        expect(shotLine).toBeDefined();
        expect(shotLine?.command).toBeUndefined();
      },
    );
  });
});
