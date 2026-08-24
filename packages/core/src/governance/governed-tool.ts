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
import type { EffectLifecycle } from "@taki/shared";
import type { EffectLifecycleService } from "../harness/effect-lifecycle-service.ts";

export interface GovernedToolBinding {
  identity: CanonicalCapabilityIdentity;
  cellKey: string;
  denyConstraints?: string[];
  effect?: {
    sourceRef: EffectLifecycle["sourceRef"];
    executorRef?: EffectLifecycle["executorRef"];
    replayPosture?: EffectLifecycle["replayPosture"];
    capturedGenerationRef?: string;
  };
}

export interface GovernedDispatchLease {
  acquire(): boolean;
  release(): void;
  unavailable: unknown;
  acceptResult?(result: unknown): unknown;
}

export interface InteractiveGovernanceContext {
  approval: ApprovalInteractionService;
  connection: Connection;
  signal?: AbortSignal;
  presentation: ApprovalPresentation;
  runId?: string;
  attemptId?: string;
  effects?: EffectLifecycleService;
}

export interface GovernedToolContext {
  service: GovernancePolicyService;
  binding: GovernedToolBinding;
  interactive?: InteractiveGovernanceContext;
  dispatchLease?: GovernedDispatchLease;
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
  if (decision.allowed) return executeWithEffect({ execute, context, input, options });
  if (decision.code !== "APPROVAL_REQUIRED" || !interactive) return denied(decision, binding);
  const requestedBinding = approvalBinding(binding, decision.evaluation);
  const handle = interactive.approval.request({
    owner: interactive.connection,
    policyGeneration: decision.evaluation.policyGeneration,
    binding: requestedBinding,
    presentation: interactive.presentation,
  });
  // A durable waiting Effect represents a real operator prompt. Session/always authority is already resolved and has
  // no canonical Approval ID, so it must proceed directly to target intent instead of creating an untraceable wait.
  let waiting: ReturnType<NonNullable<EffectLifecycleService["prepareWaiting"]>> | undefined;
  if (handle.approvalId && interactive.effects && interactive.runId && interactive.attemptId && interactive.effects.prepareWaiting) {
    try {
      waiting = interactive.effects.prepareWaiting({ ...effectIntent(context, interactive.runId, interactive.attemptId), approvalRef: { approvalId: handle.approvalId, policyGeneration: decision.evaluation.policyGeneration, approvalGeneration: interactive.approval.approvalGeneration(), bindingDigest: requestedBinding.decisionScopeDigest } });
    } catch {
      handle.cancel();
      return { ok: false, code: "STALE_EFFECT", message: "tool authorization became stale" };
    }
  }
  const cancel = (): void => void handle.cancel();
  interactive.signal?.addEventListener("abort", cancel, { once: true });
  try {
    const approved = await handle.result;
    if (!approved.allowed) {
      if (waiting && interactive.effects?.settleWaiting) interactive.effects.settleWaiting({ effectId: waiting.effectId, runId: waiting.runId, attemptId: waiting.attemptId, expectedVersion: waiting.version, outcome: approved.reason === "expired" ? "deadline_exceeded" : approved.reason === "cancelled" ? "cancelled" : "failed", errorCode: `approval_${approved.reason}` });
      return { ok: false, code: "APPROVAL_REQUIRED", message: "approval was not granted" };
    }
    const current = service.authorize(binding);
    if (current.allowed) return executeWithEffect({ execute, context, input, options, waiting });
    const currentBinding = approvalBinding(binding, current.evaluation);
    if (current.code === "APPROVAL_REQUIRED" && interactive.approval.isCurrentAuthority({
      connection: interactive.connection,
      decision: approved,
      binding: currentBinding,
      approvedBinding: requestedBinding,
      policyGeneration: current.evaluation.policyGeneration,
      approvedPolicyGeneration: decision.evaluation.policyGeneration,
    })) return executeWithEffect({ execute, context, input, options, waiting });
    if (waiting && interactive.effects?.settleWaiting) interactive.effects.settleWaiting({ effectId: waiting.effectId, runId: waiting.runId, attemptId: waiting.attemptId, expectedVersion: waiting.version, outcome: "failed", errorCode: "approval_invalidated" });
    return { ok: false, code: current.code, message: current.evaluation.reason };
  } finally {
    interactive.signal?.removeEventListener("abort", cancel);
  }
}

async function executeWithEffect(args: ExecuteGovernedArgs & { waiting?: ReturnType<NonNullable<EffectLifecycleService["prepareWaiting"]>> }) {
  const { execute, context, input, options, waiting } = args;
  const interactive = context.interactive;
  const effects = interactive?.effects;
  const runId = interactive?.runId;
  const attemptId = interactive?.attemptId;
  const lease = context.dispatchLease;
  if (lease && !lease.acquire()) {
    if (waiting && effects?.settleWaiting) effects.settleWaiting({
      effectId: waiting.effectId,
      runId: waiting.runId,
      attemptId: waiting.attemptId,
      expectedVersion: waiting.version,
      outcome: "failed",
      errorCode: "mcp_stale_generation",
    });
    return lease.unavailable;
  }
  try {
    const committed = waiting && effects?.commitIntent ? effects.commitIntent({ effectId: waiting.effectId, runId: waiting.runId, attemptId: waiting.attemptId, expectedVersion: waiting.version }) : undefined;
    const effect = committed?.effect ?? (effects && runId && attemptId ? effects.prepare(effectIntent(context, runId, attemptId)) : undefined);
    if (waiting && (committed?.stale || !effect)) return { ok: false, code: "STALE_EFFECT", message: "tool authorization became stale" };
    const raw = await Promise.resolve(execute(input, options)).catch((error: unknown) => {
      if (effect && effects) effects.settle({ effectId: effect.effectId, runId: effect.runId, attemptId: effect.attemptId, expectedVersion: effect.version, outcome: "failed", errorCode: "tool_error" });
      throw error;
    });
    const result = lease?.acceptResult ? lease.acceptResult(raw) : raw;
    if (effect && effects) settleToolResult(effects, effect, result);
    return result;
  } finally {
    lease?.release();
  }
}

function effectIntent(context: GovernedToolContext, runId: string, attemptId: string) {
  const declared = context.binding.effect;
  return {
    runId,
    attemptId,
    kind: "tool" as const,
    sourceRef: declared?.sourceRef ?? { type: "tool" as const, toolName: context.binding.identity.capabilityId },
    executorRef: declared?.executorRef,
    replayPosture: declared?.replayPosture ?? "never" as const,
    capturedGenerationRef: declared?.capturedGenerationRef,
  };
}

function settleToolResult(effects: EffectLifecycleService, effect: EffectLifecycle, result: unknown): void {
  const failure = toolFailure(result);
  effects.settle({
    effectId: effect.effectId,
    runId: effect.runId,
    attemptId: effect.attemptId,
    expectedVersion: effect.version,
    outcome: failure?.outcome ?? "completed",
    summary: failure ? undefined : "tool completed",
    errorCode: failure?.errorCode,
  });
}

function toolFailure(result: unknown) {
  if (typeof result !== "object" || result === null || !("ok" in result) || (result as { ok?: unknown }).ok !== false) return undefined;
  const failure = result as { code?: unknown; state?: unknown };
  const outcome = failure.state === "outcome_unknown" ? "outcome_unknown" as const
    : failure.state === "cancelled" ? "cancelled" as const : "failed" as const;
  const errorCode = typeof failure.code === "string" ? failure.code.toLowerCase().slice(0, 100) : "tool_failed";
  return { outcome, errorCode };
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
