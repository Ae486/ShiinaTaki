/**
 * INPUT:  trusted canonical identity/cell sidecar, GovernancePolicyService, and an existing AI SDK Tool closure
 * OUTPUT: unchanged guarded execution/results, closed Effect outcomes, and optional wait/dispatch observations
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
import { randomUUID } from "node:crypto";
import type { ToolEffectObserver } from "../observability/tool-effect-observer.ts";
import { classifyToolOutcome } from "../agents/tool-outcome.ts";

export interface GovernedToolBinding {
  identity: CanonicalCapabilityIdentity;
  cellKey: string;
  denyConstraints?: string[];
  effect?: {
    kind?: EffectLifecycle["kind"];
    sourceRef: EffectLifecycle["sourceRef"] | ((input: unknown, effectId: string) => EffectLifecycle["sourceRef"]);
    executorRef?: EffectLifecycle["executorRef"];
    replayPosture?: EffectLifecycle["replayPosture"];
    capturedGenerationRef?: string;
    inputDigest?: (input: unknown) => string;
    onIntent?: (effect: EffectLifecycle, input: unknown) => void;
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
  toolObserver?: ToolEffectObserver;
}

/** Run-owned Effect authority for turns that have no operator socket (for example non-primary Runs). */
export interface GovernedEffectContext {
  runId: string;
  attemptId: string;
  effects: EffectLifecycleService;
  toolObserver?: ToolEffectObserver;
}

export interface GovernedToolContext {
  service: GovernancePolicyService;
  binding: GovernedToolBinding;
  interactive?: InteractiveGovernanceContext;
  effect?: GovernedEffectContext;
  dispatchLease?: GovernedDispatchLease;
}

/** Metadata passed only in-memory from the Core Effect bracket to an explicit Memory adapter. */
export interface EffectExecutionContext {
  effectId: string;
  runId: string;
  attemptId: string;
  sourceRef: EffectLifecycle["sourceRef"];
  executorRef?: EffectLifecycle["executorRef"];
  capturedGenerationRef?: string;
}

const EFFECT_CONTEXT = Symbol("taki.effect-context");
export function effectExecutionContext(options: unknown): EffectExecutionContext | undefined {
  return typeof options === "object" && options !== null
    ? (options as Record<PropertyKey, unknown>)[EFFECT_CONTEXT] as EffectExecutionContext | undefined
    : undefined;
}

export function attachEffectExecutionContext(options: unknown, effect: EffectExecutionContext): unknown {
  if (typeof options !== "object" || options === null) return options;
  return { ...(options as Record<string, unknown>), [EFFECT_CONTEXT]: effect };
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
  recordGovernance(context, decision, options);
  if (decision.allowed) return executeWithEffect({ execute, context, input, options });
  if (decision.code !== "APPROVAL_REQUIRED" || !interactive) return denied(decision, binding);
  const requestedBinding = approvalBinding(binding, decision.evaluation, service);
  const handle = requestApproval({ interactive, binding, decision, requestedBinding });
  // A durable waiting Effect represents a real operator prompt. Session/always authority is already resolved and has
  // no canonical Approval ID, so it must proceed directly to target intent instead of creating an untraceable wait.
  let waiting: ReturnType<NonNullable<EffectLifecycleService["prepareWaiting"]>> | undefined;
  if (handle.approvalId && interactive.effects && interactive.runId && interactive.attemptId && interactive.effects.prepareWaiting) {
    try {
      const effectId = randomUUID();
      waiting = interactive.effects.prepareWaiting({ ...effectIntent(context, interactive.runId, interactive.attemptId, effectId, input), effectId, approvalRef: { approvalId: handle.approvalId, policyGeneration: decision.evaluation.policyGeneration, approvalGeneration: interactive.approval.approvalGeneration(), bindingDigest: requestedBinding.decisionScopeDigest } });
      binding.effect?.onIntent?.(waiting, input);
      observePhase(context, options, "approval");
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
    recordGovernance(context, current, options);
    if (current.allowed) return executeWithEffect({ execute, context, input, options, waiting });
    if (current.code === "APPROVAL_REQUIRED" && interactive.approval.isCurrentAuthority({
      connection: interactive.connection,
      decision: approved,
      binding: approvalBinding(binding, current.evaluation, service),
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

function requestApproval(args: {
  interactive: InteractiveGovernanceContext;
  binding: GovernedToolBinding;
  decision: Exclude<ReturnType<GovernancePolicyService["authorize"]>, { allowed: true }>;
  requestedBinding: ReturnType<typeof approvalBinding>;
}) {
  return args.interactive.approval.request({
    owner: args.interactive.connection,
    policyGeneration: args.decision.evaluation.policyGeneration,
    binding: args.requestedBinding,
    presentation: args.interactive.presentation,
    observation: args.interactive.runId && args.interactive.attemptId
      ? { runId: args.interactive.runId, attemptId: args.interactive.attemptId, capabilityId: args.binding.identity.capabilityId }
      : undefined,
  });
}

async function executeWithEffect(args: ExecuteGovernedArgs & { waiting?: ReturnType<NonNullable<EffectLifecycleService["prepareWaiting"]>> }) {
  const { execute, context, input, options, waiting } = args;
  const interactive = context.interactive;
  const effects = context.effect?.effects ?? interactive?.effects;
  const runId = context.effect?.runId ?? interactive?.runId;
  const attemptId = context.effect?.attemptId ?? interactive?.attemptId;
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
    const effectId = randomUUID();
    const effect = committed?.effect ?? (effects && runId && attemptId ? effects.prepare({ ...effectIntent(context, runId, attemptId, effectId, input), effectId }) : undefined);
    if (waiting && (committed?.stale || !effect)) return { ok: false, code: "STALE_EFFECT", message: "tool authorization became stale" };
    const toolCallId = toolCallIdOf(options);
    if (effect && toolCallId) (context.effect?.toolObserver ?? interactive?.toolObserver)?.bindEffect({ toolCallId, effectId: effect.effectId });
    context.binding.effect?.onIntent?.(effect!, input);
    const executionOptions = effect ? withEffectContext(options, effect) : options;
    observePhase(context, options, "executing");
    const raw = await Promise.resolve(execute(input, executionOptions as Parameters<NonNullable<Tool["execute"]>>[1])).catch((error: unknown) => {
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

function observePhase(context: GovernedToolContext, options: unknown, phase: "approval" | "executing"): void {
  const toolCallId = toolCallIdOf(options);
  if (!toolCallId) return;
  try {
    (context.effect?.toolObserver ?? context.interactive?.toolObserver)?.phase?.({ toolCallId, phase });
  } catch { /* Optional display observers cannot suppress an authorized dispatch or settle an Effect. */ }
}

function withEffectContext(options: unknown, effect: EffectLifecycle): unknown {
  return attachEffectExecutionContext(options, {
    effectId: effect.effectId, runId: effect.runId, attemptId: effect.attemptId,
    sourceRef: effect.sourceRef, executorRef: effect.executorRef, capturedGenerationRef: effect.capturedGenerationRef,
  });
}

// eslint-disable-next-line max-params
function effectIntent(context: GovernedToolContext, runId: string, attemptId: string, effectId: string, input: unknown) {
  const declared = context.binding.effect;
  return {
    runId,
    attemptId,
    kind: declared?.kind ?? "tool" as const,
    sourceRef: typeof declared?.sourceRef === "function" ? declared.sourceRef(input, effectId) : declared?.sourceRef ?? { type: "tool" as const, toolName: context.binding.identity.capabilityId },
    executorRef: declared?.executorRef,
    replayPosture: declared?.replayPosture ?? "never" as const,
    capturedGenerationRef: declared?.capturedGenerationRef,
    inputDigest: declared?.inputDigest?.(input),
    idempotencyKey: declared?.kind === "memory" ? effectId : undefined,
  };
}

function settleToolResult(effects: EffectLifecycleService, effect: EffectLifecycle, result: unknown): void {
  const classified = classifyToolOutcome({ type: "tool-result", output: result });
  effects.settle({
    effectId: effect.effectId,
    runId: effect.runId,
    attemptId: effect.attemptId,
    expectedVersion: effect.version,
    outcome: classified.outcome,
    summary: classified.outcome === "completed" ? "tool completed" : undefined,
    errorCode: classified.errorCode,
  });
}

function recordGovernance(
  context: GovernedToolContext,
  decision: ReturnType<GovernancePolicyService["authorize"]>,
  options: unknown,
): void {
  const effects = context.effect?.effects ?? context.interactive?.effects;
  const runId = context.effect?.runId ?? context.interactive?.runId;
  const attemptId = context.effect?.attemptId ?? context.interactive?.attemptId;
  if (!effects?.record || !runId || !attemptId) return;
  const posture = decision.evaluation.posture;
  try {
    effects.record({
      runId, attemptId, schemaVersion: "run-event.v1", category: "governance",
      kind: "governance.evaluated", occurredAt: new Date().toISOString(), source: "core.governance-policy",
      payload: {
        kind: "governance.evaluated",
        state: posture === "auto" ? "allowed" : posture === "ask" ? "approval_required" : "denied",
        capabilityId: context.binding.identity.capabilityId,
        ...(toolCallIdOf(options) ? { toolCallId: toolCallIdOf(options) } : {}),
        decision: posture === "auto" ? "allow" : posture,
        ...(!decision.allowed ? { reasonCode: decision.code.toLowerCase() } : {}),
      },
    });
  } catch { /* governance truth remains authoritative when observer recording fails */ }
}

function toolCallIdOf(options: unknown): string | undefined {
  if (typeof options !== "object" || options === null) return undefined;
  const value = (options as { toolCallId?: unknown }).toolCallId;
  return typeof value === "string" && value.length > 0 ? value.slice(0, 200) : undefined;
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
  service: GovernancePolicyService,
) {
  const classifier = service.classifierMetadata(binding.identity.capabilityId);
  const scope = {
    bindingRevision: 1 as const,
    identity: binding.identity,
    descriptorRevision: evaluation.descriptorRevision,
    classifierId: classifier.classifierId,
    classifierRevision: classifier.classifierRevision,
    cellKey: binding.cellKey,
  };
  return { ...scope, decisionScopeDigest: approvalDecisionScopeDigest(scope) };
}
