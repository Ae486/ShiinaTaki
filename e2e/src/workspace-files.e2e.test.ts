import { describe, expect, it } from "vitest";
import { withStack } from "./fixture/with-stack.ts";

// #14 / #15 — the core-side Workspace file tools: a write+read round-trips inside the Workspace; a path that escapes the
// root is refused BEFORE any IO, with a code and a message that never leaks an absolute path (ruling 9).
describe("workspace file write/read + path-escape confinement", () => {
  it("#14 writes then reads a file back", async () => {
    await withStack({ devTrigger: true }, async (stack) => {
      const write = await stack.l1("write_file", { path: "notes/hello.txt", content: "taki-e2e-content" });
      expect(write).toMatchObject({ ok: true, path: expect.stringContaining("hello.txt") });

      const read = (await stack.l1("read_file", { path: "notes/hello.txt" })) as { ok: boolean; content?: string };
      expect(read.ok).toBe(true);
      expect(read.content).toBe("taki-e2e-content");
    });
  });

  it("#15 rejects a ../../.. escape with no absolute-path leak", async () => {
    await withStack({ devTrigger: true }, async (stack) => {
      const result = (await stack.l1("write_file", { path: "../../../etc/passwd", content: "x" })) as {
        ok: boolean;
        code?: string;
        message?: string;
      };
      expect(result.ok).toBe(false);
      expect(["INVALID_PATH", "OUTSIDE_WORKSPACE"]).toContain(result.code);
      // The message is the errno/reject code only — never the resolved absolute path.
      expect(result.message ?? "").not.toMatch(/[A-Za-z]:[\\/]|\/etc\//);
    });
  });
});
