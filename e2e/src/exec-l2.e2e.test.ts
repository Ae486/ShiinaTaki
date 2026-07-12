import { describe, expect, it } from "vitest";
import { realProviderEnv } from "./fixture/paths.ts";
import { withStack } from "./fixture/with-stack.ts";

const hasKey = realProviderEnv() !== null;

// L2 dual-track (PRD): L1 exec-* tests prove governance deterministically, but they bypass the model. This drives the
// REAL agent — the only way to catch the tool-call hallucination (does the model actually invoke exec, or fabricate?).
// Key-gated so CI stays green; on a keyed machine it MAY red until agent-tool-timeline lands — that red is the net
// catching H2, NOT a broken test. Do not weaken these assertions to make them pass.
describe("L2 — real agent (may red until agent-tool-timeline)", () => {
  it.skipIf(!hasKey)(
    "asked to run `hostname` actually invokes exec and it exits 0",
    async () => {
      await withStack({ provider: "real", autoApprove: "exec=allow-once" }, async (stack) => {
        const turn = await stack.agentSay(
          "Run the shell command `hostname` on my computer using your exec tool, then tell me its output.",
          150_000,
        );

        const evidence = {
          turnStatus: turn.status,
          turnError: turn.errorMessage,
          toolInvoked: stack.countCoreLog((e) => e.msg === "tool invoked" && e.capability === "exec"),
          execRanExitZero: stack.countCoreLog((e) => e.msg === "exec ran" && e.exitCode === 0),
          audit: stack.audit(),
        };
        console.log("[L2 exec evidence]", JSON.stringify(evidence, null, 2));

        expect(turn.status).toBe("complete");
        // (a) the agent really called the tool; (b) the command actually ran and exited 0 (end-to-end).
        expect(evidence.toolInvoked).toBeGreaterThanOrEqual(1);
        expect(evidence.execRanExitZero).toBeGreaterThanOrEqual(1);
        expect(evidence.audit.some((line) => line.capability === "exec")).toBe(true);
      });
    },
    180_000,
  );
});
