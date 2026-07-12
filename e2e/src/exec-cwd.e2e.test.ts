import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withStack } from "./fixture/with-stack.ts";

// #21 — exec runs in the node's designated working directory (its exec-cwd, the node-side Workspace). `git init` writes
// its `.git` into cwd; asserting it lands under <nodeDataDir>/exec-cwd proves the spawn's current_dir is that dir.
describe("exec runs in the Workspace cwd", () => {
  it("git init lands .git under the node exec-cwd", async () => {
    await withStack(
      { devTrigger: true, autoApprove: "exec=deny", execPolicy: { mode: "allowlist", allowlist: ["git"] } },
      async (stack) => {
        const result = (await stack.l1("exec", { command: "git init" })) as { ok: boolean; exitCode?: number | null };
        expect(result.ok).toBe(true);
        expect(result.exitCode).toBe(0);
        // The exec-cwd is <nodeDataDir>/exec-cwd (taki-node config); `git init` created its repo there.
        expect(existsSync(join(stack.nodeDataDir, "exec-cwd", ".git"))).toBe(true);
      },
    );
  });
});
