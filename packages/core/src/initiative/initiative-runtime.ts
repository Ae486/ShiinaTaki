/**
 * INPUT: one trusted, already-eligible opportunity with explicit selected fragments and validity ports
 * OUTPUT: existing Run/Attempt/ChatAgent execution followed by structural decision and shared delivery
 * POS: core/initiative — inert adapter until a caller and opt-in setting authorize an opportunity
 */
import { createHash } from "node:crypto";
import { InitiativeSelectedContextSchema, type InitiativeSelectedContext, type InitiativePresentation } from "@taki/shared";
import type { ChatAgent, TurnContext } from "../agents/chat-agent.ts";
import { createHeartbeatDecisionCollector } from "../agents/heartbeat-respond-tool.ts";
import type { TurnQueue } from "../agents/turn-queue.ts";
import type { TurnRegistry } from "../agents/turn-registry.ts";
import type { RunService, RunExecutionContext } from "../harness/run-service.ts";
import type { EffectLifecycleService } from "../harness/effect-lifecycle-service.ts";
import type { RunDeliveryRepo } from "../db/run-delivery-repo.ts";
import type { DeliveryCoordinator } from "../delivery/delivery-coordinator.ts";
import type { InitiativePolicy } from "../config/initiative-policy-config.ts";
import type { InitiativeOpportunityRepo } from "../db/initiative-opportunity-repo.ts";
import { bindCapturedToolExecution } from "../governance/captured-tool-execution.ts";

export interface InitiativeOpportunity {
  opportunityId: string;
  characterId: string;
  selectedContext: InitiativeSelectedContext;
  isCurrent(): boolean;
  deliveryGate(): "ready" | "hold" | "suppress";
  /** Bounded evidence reads/capture execute under this admitted Run's original tools and Effect authority. */
  prepareInput?(turn: TurnContext): Promise<string | undefined>;
  /** Additional stricter-only admission policy; never reapply it after this Run consumes its own allowance. */
  beforeAdmit?(): "budget" | "gap" | undefined;
  /** Critical source/accounting linkage for a newly committed Run, before any model/Effect starts. */
  onAdmitted?(identity: { runId: string; attemptId: string }): boolean;
}
export interface InitiativeDispatchResult {
  status: "refused" | "settled" | "held"; runId?: string; attemptId?: string; reason?: string;
}
export interface InitiativePresentationBinding {
  isCurrent(): boolean;
  accepts(presentation: InitiativePresentation): boolean;
  execute(presentation: InitiativePresentation, turn: TurnContext): Promise<"completed" | "failed" | "outcome_unknown">;
}
interface InitiativeDeps {
  runs: RunService; agent: ChatAgent; queue: TurnQueue; turns: TurnRegistry; effects: EffectLifecycleService;
  deliveries: RunDeliveryRepo; delivery: DeliveryCoordinator;
  opportunities: InitiativeOpportunityRepo;
  policy(): InitiativePolicy;
  timezoneRevision(): number;
  enabled(): boolean;
  authorityCurrent(context: RunExecutionContext): boolean;
  capturePresentation(characterId: string): InitiativePresentationBinding;
}
export interface InitiativeRuntime {
  dispatch(opportunity: InitiativeOpportunity): Promise<InitiativeDispatchResult>;
  resume(runId: string): Promise<"settled" | "held" | "refused">;
  close(): Promise<void>;
}

export function createInitiativeRuntime(deps: InitiativeDeps): InitiativeRuntime {
  let closed = false; const active = new Set<Promise<InitiativeDispatchResult>>();
  const dispatch = async (opportunity: InitiativeOpportunity): Promise<InitiativeDispatchResult> => {
    const selection = InitiativeSelectedContextSchema.parse(opportunity.selectedContext);
    const reason = refusal(deps, { opportunity, selection }, closed);
    if (reason) { deps.deliveries.notePolicy(opportunity.characterId, reason); return { status: "refused", reason }; }
    const release = deps.queue.tryAcquireBackground(opportunity.characterId);
    if (!release) { deps.deliveries.notePolicy(opportunity.characterId, "busy"); return { status: "refused", reason: "busy" }; }
    try {
      const after = refusal(deps, { opportunity, selection }, closed);
      if (after) return { status: "refused", reason: after };
      const key = opportunityKey(opportunity);
      if (!deps.opportunities.reserve({ key, expiresAt: selection.manifest.expiresAt, hourLimit: deps.policy().modelHourLimit })) {
        deps.deliveries.notePolicy(opportunity.characterId, "budget"); return { status: "refused", reason: "budget" };
      }
      try { return await executeOpportunity(deps, opportunity, selection); }
      finally { deps.opportunities.release(key); }
    } finally { release(); }
  };
  return {
    dispatch(opportunity) {
      const task = dispatch(opportunity); active.add(task);
      void task.then(() => active.delete(task), () => active.delete(task)); return task;
    },
    resume: (runId) => deps.delivery.resume(runId),
    async close() { closed = true; deps.delivery.close(); await Promise.allSettled([...active]); },
  };
}

function refusal(deps: InitiativeDeps, input: Pick<Execution, "opportunity" | "selection">, closed: boolean) {
  const { opportunity, selection } = input;
  if (closed || !deps.enabled()) return "disabled";
  if (Date.parse(selection.manifest.expiresAt) <= Date.now()) return "expired";
  if (!opportunity.isCurrent() || deps.queue.primaryVersion(opportunity.characterId) !== selection.manifest.primaryVersion
    || deps.timezoneRevision() !== selection.manifest.timezoneRevision) return "stale";
  return undefined;
}

async function executeOpportunity(deps: InitiativeDeps, opportunity: InitiativeOpportunity, selection: InitiativeSelectedContext): Promise<InitiativeDispatchResult> {
  const presentation = deps.capturePresentation(opportunity.characterId);
  const gated = opportunity.beforeAdmit?.();
  if (gated) { deps.deliveries.notePolicy(opportunity.characterId, gated); return { status: "refused", reason: gated }; }
  const id = opportunityKey(opportunity);
  const admitted = await deps.runs.admit({ triggerRequestId: id, idempotencyKey: id, characterId: opportunity.characterId,
    initiator: "heartbeat", provenance: { provider: "initiative", sourceRef: id }, deliveryClass: "class_b", contextMode: "autonomous",
    deadlineAt: selection.manifest.expiresAt }, undefined, selection);
  const identity = { runId: admitted.run.runId, attemptId: admitted.attempt.attemptId };
  deps.opportunities.link(id, identity.runId);
  if (admitted.reused) return { status: admitted.run.state === "waiting" ? "held" : "settled", ...identity };
  if (!bindNewOpportunity(deps, opportunity, identity)) return { status: "settled", ...identity };
  deps.delivery.retireCharacter(opportunity.characterId);
  const context = deps.runs.context(identity.runId);
  if (!context) throw new Error("INITIATIVE_CONTEXT_REQUIRED");
  const controller = deps.turns.begin(opportunity.characterId, undefined, identity.runId);
  try {
    if (refusal(deps, { opportunity, selection }, false) || !deps.authorityCurrent(context)) {
      deps.runs.requestCancel(identity.runId); deps.runs.settle(identity.runId, identity.attemptId, "cancelled", { retryable: false });
      return { status: "settled", ...identity };
    }
    if (!deps.runs.start(identity.runId, identity.attemptId)) return { status: "settled", ...identity };
    return await reasonAndDeliver(deps, { opportunity, selection, presentation, identity, context, controller });
  } finally { deps.turns.end(opportunity.characterId, controller); }
}

function bindNewOpportunity(deps: InitiativeDeps, opportunity: InitiativeOpportunity,
  identity: { runId: string; attemptId: string }): boolean {
  try {
    if (opportunity.onAdmitted?.(identity) !== false) return true;
    deps.runs.requestCancel(identity.runId);
    deps.runs.settle(identity.runId, identity.attemptId, "cancelled", { retryable: false });
  } catch {
    // A canonical admission cannot be left runnable when its required domain linkage failed.
    deps.runs.settle(identity.runId, identity.attemptId, "failed", {
      retryable: false, errorCode: "initiative_admission_binding_failed", summary: "Initiative admission binding failed" });
  }
  return false;
}

interface Execution {
  opportunity: InitiativeOpportunity; selection: InitiativeSelectedContext; presentation: InitiativePresentationBinding;
  identity: { runId: string; attemptId: string }; context: RunExecutionContext; controller: AbortController;
}
async function reasonAndDeliver(deps: InitiativeDeps, execution: Execution): Promise<InitiativeDispatchResult> {
  const { opportunity, selection, presentation, identity, context, controller } = execution;
  const current = () => !controller.signal.aborted && deps.enabled() && opportunity.isCurrent()
    && deps.queue.primaryVersion(opportunity.characterId) === selection.manifest.primaryVersion
    && deps.timezoneRevision() === selection.manifest.timezoneRevision
    && Date.now() < Date.parse(selection.manifest.expiresAt) && deps.authorityCurrent(context);
  const collector = () => createHeartbeatDecisionCollector({ candidateIds: selection.candidateIds,
    isCurrent: () => current() && deps.runs.status(identity.runId).run.state === "running",
    acceptsPresentation: (value) => presentation.isCurrent() && presentation.accepts(value),
    acceptsDecision: (decision) => decision.outcome === "silent" || selection.candidatePolicies === undefined
      || decision.selectedCandidateIds.every((id) => selection.candidatePolicies?.some((policy) =>
        policy.candidateId === id && policy.allowedOutcomes.includes(decision.outcome)) === true) });
  const turn: TurnContext = { ...identity, turnKind: "non-primary", signal: controller.signal,
    onCommitModelIntent() {
      if (!current()) throw new Error("INITIATIVE_CONTEXT_RETIRED");
      deps.opportunities.charge(opportunityKey(opportunity), deps.policy().modelHourLimit);
    },
    runContext: context, decisionCollector: collector(), onRetry(reason) {
      const next = deps.runs.retry(identity.runId, identity.attemptId, reason).run.activeAttemptId;
      if (!next || next === identity.attemptId) return false;
      identity.attemptId = next; turn.attemptId = next; turn.decisionCollector?.close(); turn.decisionCollector = collector(); return true;
    } };
  try {
    if (opportunity.prepareInput) {
      // Evidence preparation runs before the Agent's normal tool binding. Retain the captured
      // authority and closures, adding only this execution's lifecycle and cancellation metadata.
      const prepared = await opportunity.prepareInput({ ...turn, runContext: { ...context,
        tools: bindCapturedToolExecution(context.tools ?? {}, { ...identity, effects: deps.effects, signal: controller.signal }) } });
      if (!current() || opportunity.deliveryGate() === "suppress" || !prepared?.trim() || prepared.length > 8_000) {
        throw new Error("INITIATIVE_PREPARATION_REFUSED");
      }
      turn.controlInput = prepared;
    }
    for await (const delta of deps.agent.stream({ characterId: opportunity.characterId, message: "Initiative judgment" }, turn)) { void delta; }
    if (!current() || deps.effects.unfinished(identity.runId).length > 0) throw new Error("INITIATIVE_SETTLEMENT_REFUSED");
    const decision = turn.decisionCollector?.decision();
    if (!decision) throw new Error("DECISION_MISSING");
    const record = deps.deliveries.stage({ ...identity, characterId: opportunity.characterId, deliveryClass: "class_b",
      decision, expiresAt: new Date(Math.min(Date.parse(selection.manifest.expiresAt), Date.now() + deps.policy().outputTtlMs)).toISOString(),
      primaryVersion: selection.manifest.primaryVersion, consideredCount: selection.candidateIds.length });
    deps.deliveries.notePolicy(opportunity.characterId, "accepted");
    const status = await deps.delivery.finish(record, { controller, isCurrent: () => current() && (decision.outcome === "silent" || !decision.presentation || presentation.isCurrent()),
      gate: opportunity.deliveryGate, present: (value) => presentation.execute(value, turn) });
    return { status, ...identity };
  } catch {
    deps.runs.settle(identity.runId, identity.attemptId, controller.signal.aborted ? "cancelled" : "failed",
      { retryable: false, errorCode: "initiative_decision_failed", summary: "Initiative decision did not settle" });
    return { status: "settled", ...identity };
  } finally { turn.decisionCollector?.close(); }
}

function opportunityKey(opportunity: InitiativeOpportunity): string {
  return `initiative:${createHash("sha256").update(`${opportunity.characterId}\n${opportunity.opportunityId}`).digest("hex")}`;
}
