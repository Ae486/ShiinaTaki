/**
 * INPUT:  an already claimed Core operation and the composed W3/W4/native producers
 * OUTPUT: complete healthy transition or durable uncertainty, never an inferred rollback
 * POS:    core/memory/transitions — one operation owns all Banks through finalization, binding and queue settlement
 */
import { createTransitionExecutionHeartbeat } from "./transition-execution-heartbeat.ts";
import { HindsightErrorCodeSchema, MemoryTransitionResolutionSchema, type MemoryTransitionIntent, type MemoryTransitionRequest } from "@taki/shared";
import { claimTransition, readTransitionAttempt, readTransitionIntent, changeTransitionAdmission, updateTransitionAttempt,
  renewTransitionLease, requireTransitionLease, type TransitionLease } from "../../db/memory-transition-repo.ts";
import { recordTransitionProof, readTransitionReceipt, readTransitionProof, settleTransition } from "../../db/memory-transition-evidence-repo.ts";
import { resolveTransition, readTransitionRecovery } from "../../db/memory-transition-recovery-repo.ts";
import { initializeTransitionDriverBanks, readTransitionNativeCommand, transitionNativeDispatched } from "../../db/memory-transition-driver-repo.ts";
import { sealTransitionUndispatched } from "../../db/memory-transition-undispatched.ts";
import { readQueueOutcome, readTransitionQueue } from "../../db/memory-transition-queue-repo.ts";
import { canonicalPayloadHash } from "../legacy-migration/legacy-identities.ts";
import { readTransitionPreview } from "../../db/memory-transition-preview-repo.ts";
import { recordTransitionDriverFailure } from "../../db/memory-transition-driver-failure.ts";
import { hasTransitionVerificationDispatch } from "../../db/memory-transition-verification-dispatch.ts";
import { requireHindsightTransitionSourceCapability } from "../hindsight/hindsight-transition-source-capability.ts";
import { HindsightTransitionRefusal } from "../hindsight/hindsight-transition-client.ts";
import { transitionLocalHash } from "./transition-local-encoding.ts";
import { createTransitionNativeSession, type TransitionNativeSession } from "./transition-native-session.ts";
import { prepareHealthyTransitionCandidate } from "./transition-healthy-candidate.ts";
import { assertTransitionConfiguration } from "./transition-current-identity.ts";
import type { Database } from "../../db/sqlite.ts";
import type { HindsightClient } from "../hindsight/hindsight-client.ts";
import type { MemoryTransitionRuntime } from "./transition-runtime.ts";
import type { MemoryOperationExecution } from "../operations/memory-operation-contract.ts";
import type { Logger } from "../../logging/logger.ts";
import type { TransitionEvidenceContext } from "./transition-evidence-context.ts";

type ExecutionStage = "initializing" | "capability" | "draining" | "fencing" | "candidate" | "proof"
  | "publication" | "native-finalization" | "binding" | "settling" | "abort" | "heartbeat" | "service";

export interface HealthyTransitionExecutionDependencies {
  db: Database; ownerId: string; runtime: MemoryTransitionRuntime; client(): HindsightClient;
  fingerprint(): string | null; now(): string; ready(epochId: string, provider: "local" | "hindsight", verification?: TransitionEvidenceContext): boolean;
  requestTimeoutMs: number; maintenanceTimeoutMs: number; signal: AbortSignal;
  logger?: Pick<Logger, "warn">;
}
interface Execution {
  deps: HealthyTransitionExecutionDependencies; intent: MemoryTransitionIntent;
  input: MemoryOperationExecution<MemoryTransitionRequest>; lease: TransitionLease; native?: TransitionNativeSession;
  stage: ExecutionStage;
  boundary(terminal?: boolean): Promise<void>;
  request(maintenance?: boolean): { signal: AbortSignal; timeoutMs: number };
  work(): { lease: TransitionLease; now: string; assertConfiguration(): void }; changed(): void;
}
export async function executeHealthyTransition(deps: HealthyTransitionExecutionDependencies,
  input: MemoryOperationExecution<MemoryTransitionRequest>): Promise<void> {
  if (input.producer.kind !== "transition") invalid();
  const intent = readTransitionIntent(deps.db, input.producer.transitionId); if (!intent) invalid();
  const attempt = claimTransition(deps.db, { transitionId: intent.transitionId, operationId: input.operationId,
    ownerId: deps.ownerId, now: deps.now(), leaseMs: 300_000 });
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, deps.signal]);
  const changed = () => input.checkpoint(input.producer);
  const work = () => ({ lease: execution.lease, now: deps.now(), assertConfiguration: () => {
    if (signal.aborted) throw new Error("MEMORY_TRANSITION_OUTCOME_UNKNOWN");
    requireTransitionLease(deps.db, { lease: execution.lease, now: deps.now() });
    assertTransitionConfiguration(deps.db, intent.request.expected, deps.fingerprint());
  } });
  const request = (maintenance = false) => { work().assertConfiguration(); return { signal,
    timeoutMs: maintenance ? deps.maintenanceTimeoutMs : deps.requestTimeoutMs }; };
  const execution: Execution = { deps, intent, input, lease: attempt, work, changed, request, stage: "initializing",
    boundary: (terminal) => heartbeat.boundary(terminal) };
  const heartbeat = createExecutionHeartbeat(execution, controller, signal);
  try {
    // Register every admitted scope before constructing a client. A constructor/capability failure is still
    // owned by this attempt and can release only through factual non-dispatch evidence for the entire inventory.
    initializeTransitionDriverBanks(deps.db, work());
    execution.native = createTransitionNativeSession({ db: deps.db, intent, client: deps.client(), work, changed, request });
    await run(execution); heartbeat.check();
  }
  catch (error) {
    logHealthyTransitionFailure(deps.logger, error, execution.stage);
    // No exception establishes absence. A safe abort needs positive evidence for every Bank; otherwise the
    // original operation keeps its exact request and explicit recovery will resume that same transition.
    if (!deps.signal.aborted && !signal.aborted && !readTransitionReceipt(deps.db, intent.transitionId)) {
      try { await abort(execution); return; } catch (abortError) {
        logHealthyTransitionFailure(deps.logger, abortError, "abort");
        // Preserve the unresolved original effect below.
      }
    }
    recordUnknown(execution);
  } finally { await heartbeat.stop(); }
}

/** One existing heartbeat owns renewal; independent synchronous validators yield only after their transactions end. */
function createExecutionHeartbeat(execution: Execution, controller: AbortController, signal: AbortSignal) {
  return createTransitionExecutionHeartbeat({ signal, abort: () => controller.abort(),
    renew: async () => {
      renewTransitionLease(execution.deps.db, execution.work()); await execution.native?.renew();
    },
    assertCurrent: () => execution.work().assertConfiguration(),
    failure: (error) => logHealthyTransitionFailure(execution.deps.logger, error, "heartbeat"),
  });
}
function refresh(execution: Execution): void {
  const attempt = readTransitionAttempt(execution.deps.db, execution.intent.transitionId); if (!attempt) invalid();
  if (attempt.operationId !== execution.input.operationId || attempt.attemptId !== execution.lease.attemptId) throw new Error("MEMORY_TRANSITION_LEASE_LOST");
  execution.lease = attempt; execution.changed();
}
function phase(execution: Execution, next: "draining" | "fenced" | "proven" | "binding" | "settling"): void {
  updateTransitionAttempt(execution.deps.db, { ...execution.work(), patch: { phase: next } }); refresh(execution);
}
async function run(execution: Execution): Promise<void> {
  const { deps, intent } = execution; const native = execution.native ?? invalid();
  execution.stage = "capability";
  const manifest = await native.client.compatibility(execution.request());
  requireHindsightTransitionSourceCapability(manifest);
  const preview = readTransitionPreview(deps.db, execution.input.request.previewId);
  if (preview.capabilityHash !== transitionLocalHash(manifest)) throw new Error("MEMORY_TRANSITION_STALE");
  // A sent abort may have released one Bank already. Continue that exact release decision after lost replies;
  // it cannot be repurposed as a new final-proof attempt while another Bank still owns the old fence.
  if (deps.db.prepare("SELECT id FROM memory_transition_native_commands WHERE transition_id=:id AND kind='decision' AND slot LIKE 'abort:%' LIMIT 1")
    .get({ id: intent.transitionId })) { await abort(execution); return; }
  if (!readTransitionReceipt(deps.db, intent.transitionId)) {
    execution.stage = "draining";
    let attempt = readTransitionAttempt(deps.db, intent.transitionId)!;
    if (!attempt.admissionOpenedAt) { changeTransitionAdmission(deps.db, { ...execution.work(), action: "open" }); refresh(execution); }
    if (attempt.phase === "admitted") phase(execution, "draining");
    // Reconstructed source runtimes refuse unresolved transitions at boot. Their absence proves only that this
    // process has no live owners to drain; the durable source/native fences and saved custody still gate COMMIT.
    if ((attempt.phase === "admitted" || attempt.phase === "draining")
      && deps.ready(intent.request.expected.predecessorEpochId, intent.request.expected.sourceProvider)) {
      await deps.runtime.quiesce({ ...execution.work(), timeoutMs: 30_000 });
    }
    attempt = readTransitionAttempt(deps.db, intent.transitionId)!;
    if (attempt.cutoffSequence === null) { changeTransitionAdmission(deps.db, { ...execution.work(), action: "close" }); refresh(execution); }
    if (attempt.phase === "draining") phase(execution, "fenced");
    execution.work().assertConfiguration();
    // Acquire the entire admitted inventory before one Bank's final maintenance. No complete proof can forget
    // another Bank, and heartbeat keeps already acquired scopes alive while a later Bank runs finite work.
    execution.stage = "fencing";
    for (const bank of intent.request.expected.banks) await native.fence(bank.nativeBankId ?? bank.targetBankId ?? invalid());
    execution.stage = "candidate";
    const candidate = await prepareHealthyTransitionCandidate({ db: deps.db, intent, native, work: execution.work,
      request: execution.request, changed: execution.changed });
    execution.stage = "proof";
    const old = readTransitionAttempt(deps.db, intent.transitionId)!;
    const oldProof = old.lastEvidenceId ? readTransitionProof(deps.db, old.lastEvidenceId) : undefined;
    if (!oldProof || oldProof.attemptId !== old.attemptId) {
      const proof = deps.runtime.proof({ ...execution.work(), candidateId: candidate.candidateId });
      recordTransitionProof(deps.db, { ...execution.work(), proof }); refresh(execution);
    }
    if (old.phase !== "proven") phase(execution, "proven");
    execution.stage = "publication";
    deps.runtime.publish({ ...execution.work(), candidateId: candidate.candidateId }); refresh(execution);
  }
  await finalize(execution);
}
async function finalize(execution: Execution): Promise<void> {
  const { deps, intent } = execution; const native = execution.native ?? invalid();
  const receipt = readTransitionReceipt(deps.db, intent.transitionId); if (!receipt) invalid();
  execution.stage = "native-finalization";
  await execution.boundary();
  // Native activation of every Hindsight Bank precedes binding and all queued effects. A Local target can be
  // bound independently, but completion still waits for every native retirement outcome.
  for (const bank of intent.request.expected.banks) {
    const status = await native.resolve(bank.nativeBankId ?? bank.targetBankId ?? invalid(), {
      disposition: receipt.identity.targetProvider === "hindsight" ? "activate" : "retire", receiptId: receipt.receiptId });
    deps.runtime.nativeOutcome({ ...execution.work(), status }); execution.changed();
    await execution.boundary();
  }
  const current = readTransitionAttempt(deps.db, intent.transitionId)!;
  if (current.phase === "committed") phase(execution, "binding");
  execution.stage = "binding";
  await deps.runtime.bind(intent.transitionId);
  await execution.boundary();
  if (!deps.ready(receipt.newEpochId, receipt.identity.targetProvider)) throw new Error("MEMORY_TRANSITION_OUTCOME_UNKNOWN");
  await execution.boundary();
  if (readTransitionAttempt(deps.db, intent.transitionId)?.phase === "binding") phase(execution, "settling");
  execution.stage = "settling";
  await deps.runtime.executeIntents(execution.lease);
  await execution.boundary();
  const release = deps.runtime.nativeRelease(execution.work());
  // No renewal may race the terminal resolution. The live lease and configuration are checked again after joining.
  await execution.boundary(true);
  const body = { version: 1 as const, operationId: execution.input.operationId, transitionId: intent.transitionId, release,
    result: { kind: "transition" as const, transitionId: intent.transitionId, receiptId: receipt.receiptId,
      authorityCommitted: true, runtime: "ready" as const, queue: "settled" as const, outcome: "completed" as const, errorCode: null } };
  resolveTransition(deps.db, { ...execution.work(), resolution: MemoryTransitionResolutionSchema.parse({ ...body,
    resolutionId: canonicalPayloadHash(["taki-transition-resolution.v1", body]) }) });
  execution.changed();
}
async function abort(execution: Execution): Promise<void> {
  execution.stage = "abort";
  const { deps, intent } = execution;
  // Once re-entry has prepared effect-bearing deltas, only exact history/resume may resolve them. In particular,
  // do not persist an abort decision that could race a still-running delta or strand later explicit recovery.
  if (intent.request.expected.sourceProvider === "local" && deps.db.prepare("SELECT id FROM memory_transition_preparations WHERE transition_id=:id LIMIT 1")
    .get({ id: intent.transitionId })) throw new Error("MEMORY_TRANSITION_OUTCOME_UNKNOWN");
  const attempt = readTransitionAttempt(deps.db, intent.transitionId)!;
  if (attempt.cutoffSequence === null) { changeTransitionAdmission(deps.db, { ...execution.work(), action: "close" }); refresh(execution); }
  const failures: unknown[] = []; const undispatched: string[] = [];
  for (const bank of intent.request.expected.banks) {
    const bankId = bank.nativeBankId ?? bank.targetBankId ?? invalid();
    try {
      const command = readTransitionNativeCommand(deps.db, { transitionId: intent.transitionId, bankId, kind: "acquire", slot: "original" });
      if (!command || !transitionNativeDispatched(deps.db, command.commandId)) undispatched.push(bankId);
      else {
        deps.runtime.nativeOutcome({ ...execution.work(), status: await abortNativeBank(execution, bankId) });
      }
    } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new Error("MEMORY_TRANSITION_OUTCOME_UNKNOWN");
  // Seal absent dispatch only after every sent acquisition has a positive abort outcome. Sealing earlier would
  // permanently block an untouched Bank when recovery must resume the still-owned all-Bank transition instead.
  for (const bankId of undispatched) sealTransitionUndispatched(deps.db, { ...execution.work(), bankId });
  deps.runtime.abort({ ...execution.work(), failed: true });
  await deps.runtime.resumeSource(execution.input.operationId); execution.changed();
}
async function abortNativeBank(execution: Execution, bankId: string) {
  const { deps, intent } = execution; const native = execution.native ?? invalid();
  const recovering = !!readTransitionRecovery(deps.db, execution.input.operationId);
  const status = await native.owned(bankId);
  // New failed verification remains unknown until explicit recovery, avoiding an immediate second maintenance
  // run while handling an error. Existing completed Banks are looked up without reopening their maintenance.
  if (recovering && !status.outcome && hasTransitionVerificationDispatch(deps.db, intent.transitionId, bankId)) await native.verify(bankId);
  try { return await native.resolve(bankId, { disposition: "abort", receiptId: null }); }
  catch (error) {
    // Recorded055 history has no verification journal. Missing rows prove nothing; only the native producer's
    // exact incomplete-maintenance refusal permits this new, journaled continuation of the same finite plan.
    if (!recovering || !(error instanceof HindsightTransitionRefusal) || error.refusal.reason !== "native_maintenance_incomplete") throw error;
    await native.verify(bankId);
    return native.resolve(bankId, { disposition: "abort", receiptId: null });
  }
}
function recordUnknown(execution: Execution): void {
  const { deps, intent } = execution;
  const receipt = readTransitionReceipt(deps.db, intent.transitionId);
  const queue = readTransitionQueue(deps.db, intent.transitionId);
  const settled = queue.every((item) => { const outcome = readQueueOutcome(deps.db, item.intentId); return outcome && outcome.status !== "outcome_unknown"; });
  const result = { kind: "transition" as const, transitionId: intent.transitionId, receiptId: receipt?.receiptId ?? null,
    authorityCommitted: !!receipt, runtime: receipt && deps.ready(receipt.newEpochId, receipt.identity.targetProvider) ? "ready" as const : "unavailable" as const,
    queue: settled ? "settled" as const : "unsettled" as const, outcome: "outcome_unknown" as const,
    errorCode: "MEMORY_TRANSITION_OUTCOME_UNKNOWN" as const };
  if (!readTransitionRecovery(deps.db, execution.input.operationId)) settleTransition(deps.db, { ...execution.work(), result });
  else recordTransitionDriverFailure(deps.db, execution.input.operationId, result);
  execution.changed();
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }

/** Only exact, closed-set codes leave the catch. Never serialize arbitrary error names, bodies or stacks. */
export function logHealthyTransitionFailure(logger: Pick<Logger, "warn"> | undefined, error: unknown, stage: ExecutionStage): void {
  try {
    const codes = ["MEMORY_TRANSITION_LEASE_LOST", "MEMORY_TRANSITION_STALE", "MEMORY_TRANSITION_PROOF_INVALID",
      "MEMORY_TRANSITION_CONFLICT", "MEMORY_TRANSITION_OUTCOME_UNKNOWN", "MEMORY_TRANSITION_UNAVAILABLE"];
    const message = error instanceof Error ? error.message : undefined;
    const hindsight = HindsightErrorCodeSchema.safeParse(message);
    const code = message !== undefined && codes.includes(message) ? message
      : hindsight.success ? hindsight.data : "MEMORY_TRANSITION_UNCLASSIFIED";
    logger?.warn({ code, stage }, "healthy transition execution failed");
  }
  catch { /* A diagnostic sink must not change abort, publication or unknown-outcome handling. */ }
}
