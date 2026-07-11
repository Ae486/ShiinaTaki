import { describe, expect, it } from "vitest";
import { realProviderEnv } from "./fixture/paths.ts";
import { withStack } from "./fixture/with-stack.ts";

const hasKey = realProviderEnv() !== null;

describe("L2 agent screenshot (real LLM — the H2 diagnosis)", () => {
  // The empirical H2 check: did the REAL agent invoke the screenshot tool, or fabricate success without it?
  it.skipIf(!hasKey)("agent asked to screenshot invokes the tool, lands a file, leaves an audit line", async () => {
    await withStack({ provider: "real", autoApprove: "screenshot=allow-once" }, async (stack) => {
      const turn = await stack.agentSay(
        "Please take a screenshot of my screen right now using your screenshot tool, then tell me the saved file path.",
        150_000,
      );

      // Evidence bundle first, so a failure prints the verdict, not just a bare mismatch (metadata only, R5).
      const evidence = {
        turnStatus: turn.status,
        turnError: turn.errorMessage,
        toolInvoked: stack.countCoreLog((e) => e.msg === "tool invoked" && e.capability === "screenshot"),
        routingFailed: stack.countCoreLog((e) => e.msg === "capability routing failed"),
        screenshots: stack.screenshots(),
        audit: stack.audit(),
      };
      console.log("[L2 H2 evidence]", JSON.stringify(evidence, null, 2));

      expect(turn.status).toBe("complete");
      // H2 reproduction signature: status complete + toolInvoked 0 + no file. These asserts pin the FULL flow.
      expect(evidence.toolInvoked).toBeGreaterThanOrEqual(1);
      expect(evidence.screenshots.length).toBeGreaterThanOrEqual(1);
      expect(evidence.audit.some((line) => line.capability === "screenshot")).toBe(true);
    });
  }, 180_000);
});
