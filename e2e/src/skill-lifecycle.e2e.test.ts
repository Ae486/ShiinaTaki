/**
 * INPUT:  one real Core process, a paired operator socket, and bounded browser-directory Skill packages
 * OUTPUT: process proof for import/inspect/disable/restart/enable/replace/reconcile/remove without filesystem edits
 * POS:    e2e — the Standard Skill Lifecycle operator vertical; unit suites own lease and adversarial archive proofs
 */
import { describe, expect, it } from "vitest";
import {
  JsonRpcSuccessResponseSchema,
  SKILL_METHODS,
  type SkillImportSource,
  type SkillInspectResult,
  type SkillListResult,
  type SkillMutationResult,
  type SkillReconcileResult,
  type SkillRemoveResult,
} from "@taki/shared";
import { withStack, type Stack } from "./fixture/with-stack.ts";

async function resultOf<T>(stack: Stack, method: string, params: unknown): Promise<T> {
  const frame = await (await stack.operator()).request(method, params);
  return JsonRpcSuccessResponseSchema.parse(frame).result as T;
}

function directorySource(body: string, description: string): SkillImportSource {
  const skill = `---\nname: demo\ndescription: ${description}\nlicense: MIT\nmetadata:\n  owner: e2e\n---\n${body}`;
  return {
    kind: "directory",
    files: [
      { path: "demo/SKILL.md", contentBase64: Buffer.from(skill).toString("base64") },
      { path: "demo/references/help.txt", contentBase64: Buffer.from(`help:${body}`).toString("base64") },
    ],
  };
}

describe("standard Skill lifecycle (real core process)", () => {
  it("persists operator lifecycle truth across restart and replaces content without restarting", async () => {
    await withStack({ provider: "dummy", startNode: false }, async (stack) => {
      const imported = await resultOf<SkillMutationResult>(stack, SKILL_METHODS.import, {
        source: directorySource("first body", "First demo"),
      });
      expect(imported.package).toMatchObject({
        skillName: "demo",
        description: "First demo",
        enabled: true,
        configRevision: 1,
        lifecycleState: "active",
        runtimeState: "available",
      });

      const firstInspect = await resultOf<SkillInspectResult>(stack, SKILL_METHODS.inspect, {
        packageId: imported.package.packageId,
      });
      expect(firstInspect.metadata).toMatchObject({ name: "demo", description: "First demo", license: "MIT", metadata: { owner: "e2e" } });
      expect(firstInspect.files).toEqual(["SKILL.md", "references/help.txt"]);

      const disabled = await resultOf<SkillMutationResult>(stack, SKILL_METHODS.disable, {
        packageId: imported.package.packageId,
        expectedConfigRevision: imported.package.configRevision,
      });
      expect(disabled.package).toMatchObject({ enabled: false, configRevision: 2, runtimeState: "disabled" });

      await stack.restartCore();
      const afterRestart = await resultOf<SkillListResult>(stack, SKILL_METHODS.list, {});
      expect(afterRestart.packages).toHaveLength(1);
      expect(afterRestart.packages[0]).toMatchObject({
        packageId: imported.package.packageId,
        contentHash: imported.package.contentHash,
        enabled: false,
        configRevision: 2,
        runtimeState: "disabled",
      });

      const enabled = await resultOf<SkillMutationResult>(stack, SKILL_METHODS.enable, {
        packageId: imported.package.packageId,
        expectedConfigRevision: 2,
      });
      expect(enabled.package).toMatchObject({ enabled: true, configRevision: 3, runtimeState: "available" });

      const replaced = await resultOf<SkillMutationResult>(stack, SKILL_METHODS.import, {
        source: directorySource("second body", "Second demo"),
        replacePackageId: imported.package.packageId,
        expectedConfigRevision: enabled.package.configRevision,
      });
      expect(replaced.package).toMatchObject({
        packageId: imported.package.packageId,
        description: "Second demo",
        enabled: true,
        configRevision: 4,
        runtimeState: "available",
      });
      expect(replaced.package.contentHash).not.toBe(imported.package.contentHash);

      const reconciled = await resultOf<SkillReconcileResult>(stack, SKILL_METHODS.reconcile, {});
      expect(reconciled).toMatchObject({ checked: 1, invalidated: 0 });
      const replacedInspect = await resultOf<SkillInspectResult>(stack, SKILL_METHODS.inspect, {
        packageId: imported.package.packageId,
      });
      expect(replacedInspect.metadata).toMatchObject({ description: "Second demo" });

      const removed = await resultOf<SkillRemoveResult>(stack, SKILL_METHODS.remove, {
        packageId: imported.package.packageId,
        expectedConfigRevision: replaced.package.configRevision,
      });
      expect(removed).toEqual({ status: "removed", packageId: imported.package.packageId });
      expect((await resultOf<SkillListResult>(stack, SKILL_METHODS.list, {})).packages).toEqual([]);
    });
  }, 300_000);
});
