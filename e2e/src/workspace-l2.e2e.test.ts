import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { realProviderEnv } from "./fixture/paths.ts";
import { withStack } from "./fixture/with-stack.ts";

const hasKey = realProviderEnv() !== null;

// Scans the Workspace for any file whose contents include the token — robust to whatever filename the agent picks,
// while still proving the write happened with the correct content.
function workspaceHoldsToken(workspaceDir: string, token: string): boolean {
  if (!existsSync(workspaceDir)) return false;
  for (const entry of readdirSync(workspaceDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    try {
      if (readFileSync(join(entry.parentPath, entry.name), "utf8").includes(token)) return true;
    } catch {
      // Non-UTF8 or vanished file — not our note; keep scanning.
    }
  }
  return false;
}

// L2 dual-track (PRD): the L1 workspace test proves confinement; this proves the AGENT actually writes+reads. Asserts
// the write tool ran (log) AND the file really landed with the token (on-disk). Key-gated; MAY red until
// agent-tool-timeline (H2) — a red is the diagnostic baseline, not a broken test. Do not weaken these assertions.
describe("L2 — real agent (may red until agent-tool-timeline)", () => {
  it.skipIf(!hasKey)(
    "asked to write then read a file actually invokes the Workspace file tools",
    async () => {
      await withStack({ provider: "real", autoApprove: "allow-once" }, async (stack) => {
        const token = `taki-l2-${randomUUID()}`;
        const turn = await stack.agentSay(
          `Create a text file named l2-note.txt in your workspace containing exactly this text: ${token}. ` +
            "Then read it back and tell me what it contains.",
          150_000,
        );

        const workspaceDir = join(stack.coreDataDir, "workspace");
        const evidence = {
          turnStatus: turn.status,
          turnError: turn.errorMessage,
          writeInvoked: stack.countCoreLog((e) => e.msg === "workspace file written"),
          readInvoked: stack.countCoreLog((e) => e.msg === "workspace file read"),
          fileHoldsToken: workspaceHoldsToken(workspaceDir, token),
        };
        console.log("[L2 workspace evidence]", JSON.stringify(evidence, null, 2));

        expect(turn.status).toBe("complete");
        // (a) the agent really called write_file; (b) the token actually landed on disk in the Workspace.
        expect(evidence.writeInvoked).toBeGreaterThanOrEqual(1);
        expect(evidence.fileHoldsToken).toBe(true);
      });
    },
    180_000,
  );
});
