import { describe, expect, it } from "vitest";
import { withStack } from "./fixture/with-stack.ts";

// #11 — shell-open must refuse dangerous URL schemes AFTER the gate authorizes (the scheme allowlist is the node
// handler's own defense). A refusal is a structured EXEC_FAILED "unsupported url scheme"; nothing is launched.
describe("shell-open rejects dangerous url schemes", () => {
  it("javascript: and file: → EXEC_FAILED unsupported url scheme", async () => {
    await withStack({ devTrigger: true, autoApprove: "shell-open=allow-once" }, async (stack) => {
      for (const target of ["javascript:alert(1)", "file:///etc/passwd"]) {
        const result = (await stack.l1("shell_open", { kind: "url", target })) as {
          ok: boolean;
          code?: string;
          message?: string;
        };
        expect(result.ok).toBe(false);
        expect(result.code).toBe("EXEC_FAILED");
        expect(result.message).toContain("unsupported url scheme");
      }
    });
  });
});
