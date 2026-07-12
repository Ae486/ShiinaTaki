import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { realProviderEnv } from "./fixture/paths.ts";
import { withStack } from "./fixture/with-stack.ts";

const hasKey = realProviderEnv() !== null;

// L2 dual-track (PRD): the L1 clipboard round-trip proves the capability works; this proves the AGENT actually uses it.
// The agent is asked to copy a unique token; we then verify the OS clipboard holds it via an L1 read (devTrigger) — an
// end-to-end content check independent of the model's own text. Key-gated; MAY red until agent-tool-timeline (H2), and
// a red is the diagnostic, not a broken test — do not weaken these assertions.
describe("L2 — real agent (may red until agent-tool-timeline)", () => {
  it.skipIf(!hasKey)(
    "asked to copy text actually invokes clipboard-write and the OS clipboard holds it",
    async () => {
      await withStack({ provider: "real", autoApprove: "allow-once", devTrigger: true }, async (stack) => {
        const token = `taki-l2-${randomUUID()}`;
        const turn = await stack.agentSay(
          `Copy this exact text to my clipboard using your clipboard tool: ${token}`,
          150_000,
        );

        // Read the real OS clipboard back through L1 (no model) — the ground-truth end-to-end signal.
        const read = (await stack.l1("clipboard_read", {})) as { ok: boolean; text?: string };
        const evidence = {
          turnStatus: turn.status,
          turnError: turn.errorMessage,
          writeInvoked: stack.countCoreLog((e) => e.msg === "tool invoked" && e.capability === "clipboard-write"),
          clipboardMatches: read.ok && read.text === token,
        };
        console.log("[L2 clipboard evidence]", JSON.stringify(evidence, null, 2));

        expect(turn.status).toBe("complete");
        // (a) the agent really called clipboard-write; (b) the token actually reached the OS clipboard.
        expect(evidence.writeInvoked).toBeGreaterThanOrEqual(1);
        expect(evidence.clipboardMatches).toBe(true);
      });
    },
    180_000,
  );
});
