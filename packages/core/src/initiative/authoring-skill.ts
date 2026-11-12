/**
 * INPUT: an explicit operator setup action and the existing immutable Skill lifecycle
 * OUTPUT: actual bundled Skill bytes imported normally, with collision/disablement preservation
 * POS: core/initiative setup — fixed resource read; no Agent-selected path or replacement bypass
 */
import { readFileSync } from "node:fs";
import type { InitiativeSetupStatus } from "@taki/shared";
import type { SkillLifecycleService } from "../skills/skill-lifecycle-service.ts";
import { validateSkillFiles } from "../skills/skill-package-store.ts";

const NAME = "companion-pattern-authoring";
export function createAuthoringSkillSetup(service: SkillLifecycleService) {
  const bytes = readFileSync(new URL("../../resources/skills/companion-pattern-authoring/SKILL.md", import.meta.url));
  const path = `${NAME}/SKILL.md`;
  const hash = validateSkillFiles([{ path, bytes }], { requireWrapperRoot: true }).hash;
  const state = (): InitiativeSetupStatus["skill"] => {
    const existing = service.list().packages.find((item) => item.skillName === NAME);
    if (!existing) return { state: "missing", packageId: null, configRevision: null };
    const status = existing.contentHash !== hash ? "conflict" : existing.lifecycleState !== "active" ? "unavailable" : !existing.enabled ? "disabled"
      : existing.runtimeState === "available" ? "ready" : "unavailable";
    return { state: status, packageId: existing.packageId, configRevision: existing.configRevision };
  };
  return {
    state,
    async install(): Promise<{ status: "installed" | "unchanged" | "refused"; reason: "name-conflict" | "package-disabled" | "import-failed" | null }> {
      const before = state();
      if (before.state === "ready") return { status: "unchanged", reason: null };
      if (before.state !== "missing") return { status: "refused", reason: before.state === "disabled" ? "package-disabled"
        : before.state === "conflict" ? "name-conflict" : "import-failed" };
      try {
        await service.import({ source: { kind: "directory", files: [{ path, contentBase64: bytes.toString("base64") }] } });
        return state().state === "ready" ? { status: "installed", reason: null } : { status: "refused", reason: "import-failed" };
      } catch {
        // Concurrent explicit setup can have installed the exact immutable package first.
        return state().state === "ready" ? { status: "unchanged", reason: null } : { status: "refused", reason: "import-failed" };
      }
    },
  };
}
