/**
 * INPUT:  trusted canonical identity/cell sidecar, GovernancePolicyService, and an existing AI SDK Tool closure
 * OUTPUT: wrapGovernedTool(...) — execution-time common policy guard preserving the original tool protocol/closure
 * POS:    core/governance — explicit Core/MCP/Skill adapter primitive; presentation keys and tool metadata grant nothing
 */
import type { Tool } from "ai";
import type { CanonicalCapabilityIdentity } from "@taki/shared";
import type { GovernancePolicyService } from "./governance-policy-service.ts";

export interface GovernedToolBinding {
  identity: CanonicalCapabilityIdentity;
  cellKey: string;
  denyConstraints?: string[];
}

export function wrapGovernedTool(tool: Tool, service: GovernancePolicyService, binding: GovernedToolBinding): Tool {
  const execute = tool.execute;
  if (typeof execute !== "function") return tool;
  return {
    ...tool,
    execute: async (input, options) => {
      const decision = service.authorize(binding);
      if (!decision.allowed) {
        return {
          ok: false,
          code: decision.code,
          message: decision.code === "APPROVAL_REQUIRED"
            ? "approval is required; Slice 4 approval resolution is not installed"
            : `governance denied ${binding.identity.capabilityId}`,
        };
      }
      return execute(input, options);
    },
  } as Tool;
}
