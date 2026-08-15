import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withStack } from "./fixture/with-stack.ts";

// #12 — clipboard round-trip through the real node (arboard): a written value reads back verbatim. Both the write and
// the read are independently gated (allow-once each).
describe("clipboard write→read round-trip", () => {
  it("reads back the exact value just written", async () => {
    await withStack({ devTrigger: true, autoApprove: "allow-once" }, async (stack) => {
      await stack.setPermissionLevel("relaxed");
      const value = `taki-e2e-${randomUUID()}`;
      const write = await stack.l1("clipboard_write", { text: value });
      expect(write).toMatchObject({ ok: true });

      const read = (await stack.l1("clipboard_read", {})) as { ok: boolean; text?: string };
      expect(read.ok).toBe(true);
      expect(read.text).toBe(value);
    });
  });
});
