/**
 * INPUT:  real Core process, external debug taki-node, operator permission methods, and deterministic L1 capability calls.
 * OUTPUT: process proof for compatible catalog, Core policy changes, Host stricter deny, and live projection replacement.
 * POS:    e2e — Slice-3 governance convergence smoke; no LLM and no test-only policy bypass.
 */
import { describe, expect, it } from "vitest";
import {
  JsonRpcSuccessResponseSchema,
  PermissionCellSetResultSchema,
  PermissionCellsStateSchema,
  PermissionLevelStateSchema,
} from "@taki/shared";
import type { RpcSocket } from "./fixture/rpc-socket.ts";
import { withStack } from "./fixture/with-stack.ts";

async function result(socket: RpcSocket, method: string, params: unknown): Promise<unknown> {
  return JsonRpcSuccessResponseSchema.parse(await socket.request(method, params)).result;
}

describe("Core governance authority with an external taki-node", () => {
  it("publishes a compatible catalog, applies Core policy, preserves Host deny, and replaces generations", async () => {
    await withStack({
      devTrigger: true,
      execPolicy: { mode: "allowlist", allowlist: ["hostname"] },
      gateDecisions: [{ capability: "process-list", decision: "never" }],
    }, async (stack) => {
      // withStack reaches this callback only after the real node publishes a catalog accepted by Core and reports
      // state=connected. The external process remaining alive pins that compatibility handshake.
      expect(stack.node()?.child.exitCode ?? null).toBeNull();
      const socket = await stack.operator();
      const initial = PermissionLevelStateSchema.parse(await result(socket, "permission.levelGet", {}));
      expect(initial).toMatchObject({ level: "standard", policyGeneration: 1 });
      await expect(stack.l1("screenshot", {})).resolves.toMatchObject({ ok: false, code: "APPROVAL_REQUIRED" });

      const relaxed = PermissionLevelStateSchema.parse(await result(socket, "permission.levelSet", {
        level: "relaxed",
        expectedPolicyGeneration: initial.policyGeneration,
      }));
      expect(relaxed.policyGeneration).toBe(initial.policyGeneration + 1);
      await expect(stack.l1("exec", { command: "hostname" })).resolves.toMatchObject({ ok: true, exitCode: 0 });

      const denied = PermissionCellSetResultSchema.parse(await result(socket, "permission.cellSet", {
        key: "exec:simple-allowlisted",
        level: "relaxed",
        posture: "deny",
        expectedPolicyGeneration: relaxed.policyGeneration,
      }));
      expect(denied.policyGeneration).toBe(relaxed.policyGeneration + 1);
      await expect(stack.l1("exec", { command: "hostname" })).resolves.toMatchObject({ ok: false, code: "DENIED" });

      const cells = PermissionCellsStateSchema.parse(await result(socket, "permission.cellsGet", {}));
      expect(cells.cells.find((cell) => cell.key === "process-list" && cell.level === "relaxed")).toMatchObject({
        effectivePosture: "auto",
      });
      await expect(stack.l1("process_list", {})).resolves.toMatchObject({ ok: false, code: "DENIED" });

      const reset = PermissionCellSetResultSchema.parse(await result(socket, "permission.cellSet", {
        key: "exec:simple-allowlisted",
        level: "relaxed",
        posture: null,
        expectedPolicyGeneration: denied.policyGeneration,
      }));
      expect(reset.policyGeneration).toBe(denied.policyGeneration + 1);
      await expect(stack.l1("exec", { command: "hostname" })).resolves.toMatchObject({ ok: true, exitCode: 0 });

      const decisions = stack.audit().filter((entry) => entry.capability === "exec").map((entry) => entry.decision);
      expect(decisions).toEqual(expect.arrayContaining(["auto-allowed", "auto-denied"]));
      expect(stack.audit().filter((entry) => entry.capability === "process-list").map((entry) => entry.decision))
        .toContain("auto-denied");
    });
  }, 90_000);
});
