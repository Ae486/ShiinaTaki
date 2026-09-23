/**
 * INPUT:  hindsight.activate requests (new / resume / recover), the Hindsight activation service and the owner's row lookups
 * OUTPUT: the activation kind handler — synchronous side-effect-free admission with Core-minted identities, deferred claim,
 *         producer checkpoints from the chain, receipt-based settlement, pre-claim cancel and read-only boot observation
 * POS:    core/memory/operations — family hindsight-activation; recover on a committed epoch repairs the binding only
 */
import type { MemoryActivationRun, MemoryHindsightActivateSource, MemoryOperationRequest } from "@taki/shared";
import { hindsightActivationErrorCode } from "../hindsight-activation/hindsight-activation-errors.ts";
import type { HindsightActivationPlan } from "../hindsight-activation/hindsight-activation-reads.ts";
import { leaseOwner, type HindsightActivationControl, type HindsightActivationService } from "../hindsight-activation/hindsight-activation-service.ts";
import { HINDSIGHT_ACTIVATION_FAMILY } from "../hindsight-activation/hindsight-activation-status.ts";
import {
  MemoryOperationRefusal, refuseWhileExclusiveFamilyBusy, type MemoryOperationContext, type MemoryOperationExecution, type MemoryOperationKindHandler,
  type MemoryOperationSettlement,
} from "./memory-operation-contract.ts";
import {
  blockedSettlement, committedSettlement, failed, hindsightRef, identityOf, interruptedBeforeClaim, mintRef, unknown, withPhase, type HindsightRef,
} from "./memory-operation-hindsight-evidence.ts";

type ActivateRequest = Extract<MemoryOperationRequest, { kind: "hindsight.activate" }>;
type Execution = MemoryOperationExecution<ActivateRequest>;
type Claim = "claimed" | "lost" | "interrupted";
type ProvenPlan = HindsightActivationPlan & { runId: string; predecessorEpochId: string; configFingerprint: string };

export const hindsightActivateKind: MemoryOperationKindHandler<ActivateRequest> = {
  family: () => HINDSIGHT_ACTIVATION_FAMILY,
  admit: (request, ctx) => {
    const service = requireHindsight(ctx);
    refuseWhileExclusiveFamilyBusy(ctx);
    const plan = service.plan();
    return request.source.mode === "recover" ? admitRecover(request.source, ctx, { service, plan }) : admitActivation(request.source, ctx, { service, plan });
  },
  execute: async (execution) => {
    const service = requireHindsight(execution.ctx);
    const ref = hindsightRef(execution.producer);
    const claimed = await claim(execution, service);
    if (claimed !== "claimed") return claimed === "lost" ? null : interruptedBeforeClaim(ref);
    if (execution.request.source.mode === "recover") return repairBinding(service, ref, execution.checkpoint);
    const plan = service.plan();
    if (plan.blocking.length > 0) return blockedSettlement(ref, plan.blocking);
    if (plan.predecessorEpochId === null) return failed({ code: "HINDSIGHT_PREDECESSOR_STALE", producer: ref });
    return activate(service, execution, { ref, predecessorEpochId: plan.predecessorEpochId });
  },
  observeBoot: (operation, ctx) => ctx.hindsight ? observeBoot(ctx.hindsight, hindsightRef(operation.producer)) : null,
  cancel: (operation) => { if (operation.state !== "admitted") throw new MemoryOperationRefusal("MEMORY_OPERATION_RUNNING"); },
};

function requireHindsight(ctx: MemoryOperationContext): HindsightActivationService {
  if (!ctx.hindsight) throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED");
  return ctx.hindsight;
}

/** One macrotask lets the admitted row be read or cancelled first; a stopping service never claims, and a lost CAS never works. */
async function claim(execution: Pick<Execution, "tryClaim">, service: HindsightActivationService): Promise<Claim> {
  await new Promise<void>((done) => setImmediate(done));
  if (service.stopRequested()) return "interrupted";
  return execution.tryClaim() ? "claimed" : "lost";
}

function provenLocal(plan: HindsightActivationPlan): ProvenPlan {
  if (plan.authority.mode !== "canonical-local" || plan.runId === null || plan.predecessorEpochId === null) throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED");
  if (!plan.configured || plan.drifted || plan.configFingerprint === null) throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED");
  return { ...plan, runId: plan.runId, predecessorEpochId: plan.predecessorEpochId, configFingerprint: plan.configFingerprint };
}

function admitActivation(source: Exclude<MemoryHindsightActivateSource, { mode: "recover" }>, ctx: MemoryOperationContext,
  input: { service: HindsightActivationService; plan: HindsightActivationPlan }): HindsightRef {
  const plan = provenLocal(input.plan);
  const run = input.service.status({ runId: plan.runId, predecessorEpochId: plan.predecessorEpochId }).run;
  if (source.mode === "new") {
    // The client's view must match the proven Local epoch and B3 revision; an existing run continues through resume only.
    if (source.expectedEpochId !== plan.predecessorEpochId || source.setupRevision !== plan.setupRevision || run !== null) throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED");
    return mintRef(plan, null);
  }
  if (source.runId !== plan.runId || run === null) throw new MemoryOperationRefusal("MEMORY_OPERATION_NOT_FOUND");
  if (run.receipt !== null) throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED");
  return mintRef(plan, priorProducer(ctx, plan.runId));
}

/** The newest family row for this run carries the identities the earlier attempt minted; the client never resupplies them. */
function priorProducer(ctx: MemoryOperationContext, runId: string): HindsightRef | null {
  const prior = ctx.latestInFamily(HINDSIGHT_ACTIVATION_FAMILY);
  return prior?.producer?.kind === "hindsight" && prior.producer.runId === runId ? prior.producer : null;
}

/** Under a committed Hindsight authority only the exact committed epoch may be re-submitted, and only to repair its binding. */
function admitRecover(source: Extract<MemoryHindsightActivateSource, { mode: "recover" }>, ctx: MemoryOperationContext,
  input: { service: HindsightActivationService; plan: HindsightActivationPlan }): HindsightRef {
  const { authority } = input.plan;
  if (authority.mode !== "hindsight" || authority.epochId !== source.epochId || authority.transactionId === null || input.plan.runId === null) {
    throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED");
  }
  const prior = ctx.latestInFamily(HINDSIGHT_ACTIVATION_FAMILY)?.producer;
  const committed = prior?.kind === "hindsight" && prior.transactionId === authority.transactionId && prior.hindsightEpochId === source.epochId
    ? prior : input.service.committedProducer({ epochId: source.epochId, transactionId: authority.transactionId });
  if (!committed) throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED");
  return withPhase(committed, "binding");
}

async function activate(service: HindsightActivationService, execution: Execution, input: { ref: HindsightRef; predecessorEpochId: string }): Promise<MemoryOperationSettlement> {
  let latest = input.ref;
  const identity = identityOf(input.ref, { operationId: execution.operationId, predecessorEpochId: input.predecessorEpochId });
  const control: HindsightActivationControl = {
    checkpoint: (producer) => { latest = producer; execution.checkpoint(producer); },
    stopRequested: () => false,
    ...(execution.request.source.mode === "resume" ? takeOver(service, execution.ctx, identity.runId) : {}),
  };
  try {
    const receipt = execution.request.source.mode === "resume"
      ? await service.resumeActivation(identity, control) : await service.start(identity, control);
    return committedSettlement(service, latest, receipt.hindsightEpochId);
  } catch (error) {
    return activateFailure(service, latest, error);
  }
}

/** A lease left by a terminal (or another boot's, hence reconciled) operation is displaceable; a live holder is not. */
function takeOver(service: HindsightActivationService, ctx: MemoryOperationContext, runId: string): Pick<HindsightActivationControl, "takeOverFrom"> {
  const owner = service.status({ runId, predecessorEpochId: null }).leaseOwner;
  if (owner === null) return {};
  const match = /^hindsight-activation:(.+)$/.exec(owner);
  if (!match || owner !== leaseOwner(match[1]!)) return {};
  const holder = ctx.lookup(match[1]!);
  return !holder || holder.terminalAt !== null ? { takeOverFrom: owner } : {};
}

/** Classification after a thrown activation: the receipt, not the exception, decides whether the authority switched. */
function activateFailure(service: HindsightActivationService, ref: HindsightRef, error: unknown): MemoryOperationSettlement {
  let receipt: MemoryActivationRun["receipt"]; let localSelected: boolean;
  try {
    receipt = service.status({ runId: ref.runId, predecessorEpochId: null }).run?.receipt ?? null;
    localSelected = service.authority().mode === "canonical-local";
  } catch {
    return unknown("commitment_unknown", ref);
  }
  if (receipt) return receipt.transactionId === ref.transactionId ? committedSettlement(service, ref, receipt.epochId) : unknown("commitment_unknown", ref);
  if (!localSelected) return unknown("commitment_unknown", ref);
  const code = hindsightActivationErrorCode(error);
  return failed({ code, reason: code === "HINDSIGHT_ACTIVATION_INTERRUPTED" ? "producer_incomplete" : "producer_failed", producer: ref });
}

function repairBinding(service: HindsightActivationService, ref: HindsightRef, checkpoint: (producer: HindsightRef) => void): MemoryOperationSettlement {
  checkpoint(withPhase(ref, "binding"));
  try { service.recover(ref.hindsightEpochId); }
  catch (error) {
    // The commit is proven; a thrown repair (custody refusal, failed construction) is this command's own failure, never a completion.
    const settlement = committedSettlement(service, ref, ref.hindsightEpochId);
    return { ...settlement, state: "failed", reason: settlement.reason ?? "producer_failed", errorCode: hindsightActivationErrorCode(error) };
  }
  return committedSettlement(service, ref, ref.hindsightEpochId);
}

function observeBoot(service: HindsightActivationService, ref: HindsightRef): MemoryOperationSettlement {
  let run: MemoryActivationRun | null; let plan: HindsightActivationPlan;
  try { run = service.status({ runId: ref.runId, predecessorEpochId: null }).run; plan = service.plan(); }
  catch { return unknown("commitment_unknown", ref); }
  if (run?.receipt) return run.receipt.transactionId === ref.transactionId ? committedSettlement(service, ref, run.receipt.epochId) : unknown("commitment_unknown", ref);
  if (plan.authority.mode !== "canonical-local" || plan.runId !== ref.runId) return unknown("commitment_unknown", ref);
  return unknown("producer_incomplete", withPhase(ref, observedPhase(run, ref)));
}

/** The durable cutover phase is the only progress a restart can trust; the row's own checkpoint fills the gaps it cannot see. */
function observedPhase(run: MemoryActivationRun | null, ref: HindsightRef): HindsightRef["progress"]["phase"] {
  if (!run) return ref.progress.phase;
  if (run.phase === "ready") return "ready";
  if (run.phase === "replica-verified") return "verifying";
  if (run.phase === "importing") return ref.progress.phase === "reserved" || ref.progress.phase === "draining" ? "importing" : ref.progress.phase;
  return ref.progress.phase;
}
