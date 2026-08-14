/**
 * INPUT:  trusted canonical identity/cell sidecar, GovernancePolicyService, and an existing AI SDK Tool closure
 * OUTPUT: wrapGovernedTool(...) — execution-time common policy guard preserving the original tool protocol/closure
 * POS:    core/governance — explicit Core/MCP/Skill adapter primitive; presentation keys and tool metadata grant nothing
 */
import type { Tool } from "ai";
import type { CanonicalCapabilityIdentity } from "@taki/shared";
import type { GovernancePolicyService } from "./governance-policy-service.ts";
import type { ApprovalInteractionService } from "../approval/approval-interaction-service.ts";
import type { ApprovalPresentation } from "@taki/shared";
import type { Connection } from "../server/connection-registry.ts";
import { approvalDecisionScopeDigest } from "../approval/approval-binding.ts";

export interface GovernedToolBinding {
  identity: CanonicalCapabilityIdentity;
  cellKey: string;
  denyConstraints?: string[];
}

export interface InteractiveGovernanceContext {
  approval: ApprovalInteractionService;
  connection: Connection;
  signal?: AbortSignal;
  presentation: ApprovalPresentation;
}

export interface GovernedToolContext {
  service: GovernancePolicyService;
  binding: GovernedToolBinding;
  interactive?: InteractiveGovernanceContext;
}

export function wrapGovernedTool(tool: Tool, context: GovernedToolContext): Tool {
  const execute = tool.execute;
  if (typeof execute !== "function") return tool;
  return {
    ...tool,
    execute: (input, options) => executeGoverned({ execute, context, input, options }),
  } as Tool;
}

interface ExecuteGovernedArgs {
  execute: NonNullable<Tool["execute"]>;
  context: GovernedToolContext;
  input: Parameters<NonNullable<Tool["execute"]>>[0];
  options: Parameters<NonNullable<Tool["execute"]>>[1];
}

async function executeGoverned(args: ExecuteGovernedArgs) {
  const { execute, context, input, options } = args;
  const { service, binding, interactive } = context;
  const decision = service.authorize(binding);
  if (decision.allowed) return execute(input, options);
  if (decision.code !== "APPROVAL_REQUIRED" || !interactive) return denied(decision, binding);
  const requestedBinding = approvalBinding(binding, decision.evaluation);
  const handle = interactive.approval.request({
    owner: interactive.connection,
    policyGeneration: decision.evaluation.policyGeneration,
    binding: requestedBinding,
    presentation: interactive.presentation,
  });
  const cancel = (): void => void handle.cancel();
  interactive.signal?.addEventListener("abort", cancel, { once: true });
  try {
    const approved = await handle.result;
    if (!approved.allowed) return { ok: false, code: "APPROVAL_REQUIRED", message: "approval was not granted" };
    const current = service.authorize(binding);
    if (current.allowed) return execute(input, options);
    const currentBinding = approvalBinding(binding, current.evaluation);
    if (current.code === "APPROVAL_REQUIRED" && interactive.approval.isCurrentAuthority({
      connection: interactive.connection,
      decision: approved,
      binding: currentBinding,
      approvedBinding: requestedBinding,
      policyGeneration: current.evaluation.policyGeneration,
      approvedPolicyGeneration: decision.evaluation.policyGeneration,
    })) return execute(input, options);
    return { ok: false, code: current.code, message: current.evaluation.reason };
  } finally {
    interactive.signal?.removeEventListener("abort", cancel);
  }
}

function denied(
  decision: Exclude<ReturnType<GovernancePolicyService["authorize"]>, { allowed: true }>,
  binding: GovernedToolBinding,
) {
  return {
    ok: false,
    code: decision.code,
    message: decision.code === "APPROVAL_REQUIRED"
      ? "approval requires an active operator connection"
      : `governance denied ${binding.identity.capabilityId}`,
  };
}

function approvalBinding(
  binding: GovernedToolBinding,
  evaluation: ReturnType<GovernancePolicyService["evaluate"]>,
) {
  const scope = {
    bindingRevision: 1 as const,
    identity: binding.identity,
    descriptorRevision: evaluation.descriptorRevision,
    classifierId: classifierId(binding.identity.capabilityId),
    classifierRevision: 1,
    cellKey: binding.cellKey,
  };
  return { ...scope, decisionScopeDigest: approvalDecisionScopeDigest(scope) };
}

function classifierId(capabilityId: string): string {
  if (capabilityId === "mcp.tool.call") return "mcp-tool-call";
  return "fixed-risk";
}
