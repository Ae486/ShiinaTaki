import { describe, expect, it } from "vitest";
import { withStack } from "./fixture/with-stack.ts";

// #13 — process-list returns pid/name/memory and MUST NOT leak a command line (argv/cmd are excluded in v1, ruling 5).
describe("process-list returns metadata without argv", () => {
  it("has pid/name/memoryBytes and no argv/cmd/command field", async () => {
    await withStack({ devTrigger: true, autoApprove: "process-list=allow-once" }, async (stack) => {
      const result = (await stack.l1("process_list", {})) as {
        ok: boolean;
        count: number;
        processes: Record<string, unknown>[];
      };
      expect(result.ok).toBe(true);
      expect(result.count).toBeGreaterThan(0);
      expect(result.processes.length).toBeGreaterThan(0);

      const sample = result.processes[0] ?? {};
      expect(typeof sample.pid).toBe("number");
      expect(typeof sample.name).toBe("string");
      expect(typeof sample.memoryBytes).toBe("number");
      // The privacy invariant: no command line ever rides a process-list entry.
      for (const process of result.processes) {
        expect(process).not.toHaveProperty("argv");
        expect(process).not.toHaveProperty("cmd");
        expect(process).not.toHaveProperty("command");
      }
    });
  });
});
