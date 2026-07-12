import { describe, expect, it } from "vitest";
import { withStack } from "./fixture/with-stack.ts";

// #20 (slow, ~30s) — a long allowlisted command is killed at the node's 30s exec deadline: timedOut:true, exitCode:null.
// SLOW: it burns the full sandbox timeout on purpose. The L1 request budget is widened so it outlives the capability.
describe("exec timeout kills a long command (slow)", () => {
  it(
    "ping -n 40 127.0.0.1 is killed → timedOut, exitCode null",
    async () => {
      await withStack(
        { devTrigger: true, autoApprove: "exec=deny", execPolicy: { mode: "allowlist", allowlist: ["ping"] } },
        async (stack) => {
          const result = (await stack.l1("exec", { command: "ping -n 40 127.0.0.1" }, 90_000)) as {
            ok: boolean;
            timedOut?: boolean;
            exitCode?: number | null;
          };
          expect(result.ok).toBe(true);
          expect(result.timedOut).toBe(true);
          expect(result.exitCode).toBeNull();
        },
      );
    },
    90_000,
  );
});
