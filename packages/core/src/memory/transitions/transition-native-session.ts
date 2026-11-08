/**
 * INPUT:  current Core lease, complete Bank registry and the authenticated native transition client
 * OUTPUT: original acquire/claim/decision dispatch and exact historical reconciliation across lost replies
 * POS:    core/memory/transitions — remote effects stay outside SQLite COMMIT; every Bank retains its own identity
 */
import { randomUUID } from "node:crypto";
import { HindsightTransitionAcquireSchema, type HindsightTransitionStatus, type MemoryTransitionIntent,
  type MemoryTransitionNativeCommand, type HindsightTransitionOutcomeRequest } from "@taki/shared";
import { prepareTransitionNativeCommand, readTransitionNativeCommand, markTransitionNativeDispatched,
  recordTransitionNativeObservation } from "../../db/memory-transition-driver-repo.ts";
import { readTransitionNativeEvidence, requireTransitionCommonBaseline } from "../../db/memory-transition-candidate-repo.ts";
import { recordTransitionVerificationDispatch } from "../../db/memory-transition-verification-dispatch.ts";
import type { TransitionCaptureInput } from "../../db/memory-transition-local-capture.ts";
import type { Database } from "../../db/sqlite.ts";
import { requireHindsightTransitionClient } from "../hindsight/hindsight-transition-capability.ts";
import { requireHindsightApplicationClient } from "../hindsight/hindsight-application-capability.ts";
import { HindsightTransitionRefusal } from "../hindsight/hindsight-transition-client.ts";
import { signHindsightTransitionAcquire, validateHindsightTransitionStatus, hindsightTransitionHash } from "../hindsight/hindsight-transition-proof.ts";
import type { HindsightClient, HindsightCallContext } from "../hindsight/hindsight-client.ts";
import { transitionNativeDecision, requireStoredNativeDecision } from "./transition-native-decision.ts";

export interface TransitionNativeSessionInput {
  db: Database; intent: MemoryTransitionIntent; client: HindsightClient;
  work(): TransitionCaptureInput; request(maintenance?: boolean): HindsightCallContext; changed(): void;
}
export function createTransitionNativeSession(input: TransitionNativeSessionInput) {
  const client = requireHindsightTransitionClient(input.client);
  requireHindsightApplicationClient(client);
  if (!client.currentSnapshotPage || !client.createCurrentSnapshot) unavailable();
  const active = new Map<string, HindsightTransitionStatus>();
  // A renewal can race the single decision request for this Bank. Keep only that
  // in-flight operation so a proven terminal result can settle the old renewal;
  // this is coordination, never a retry or a second Native request.
  const resolutions = new Map<string, Promise<HindsightTransitionStatus>>();
  const observe = (status: HindsightTransitionStatus) => {
    recordTransitionNativeObservation(input.db, { ...input.work(), status });
    active.set(status.bank_id, status); input.changed(); return status;
  };
  const history = async (bankId: string) => {
    try { return observe(await client.transitionStatus({ bankId, transitionId: input.intent.transitionId, context: input.request() })); }
    catch (error) {
      if (error instanceof HindsightTransitionRefusal && error.refusal.reason === "transition_not_found") return null;
      throw error;
    }
  };
  const owned = async (bankId: string): Promise<HindsightTransitionStatus> => {
    let status = await history(bankId);
    if (!status) {
      const command = await acquisition(input, bankId);
      markTransitionNativeDispatched(input.db, { ...input.work(), command });
      if (command.kind !== "acquire") invalid();
      status = observe(await client.acquireTransition({ bankId, request: command.request, context: input.request() }));
    }
    if (status.outcome || status.executor_live) return status;
    const slot = String(status.executor.generation + 1);
    const command = readTransitionNativeCommand(input.db, { transitionId: input.intent.transitionId, bankId, kind: "claim", slot })
      ?? prepareTransitionNativeCommand(input.db, { ...input.work(), command: { kind: "claim", bankId, slot,
        request: { expected_revision: status.revision, attempt_id: randomUUID() } } });
    if (command.kind !== "claim") invalid();
    markTransitionNativeDispatched(input.db, { ...input.work(), command });
    return observe(await client.claimTransition({ bankId, transitionId: input.intent.transitionId,
      request: command.request, context: input.request() }));
  };
  return { client, active, history, owned, observe,
    fence: async (bankId: string) => {
      const status = await owned(bankId);
      if (status.outcome || status.phase === "proven" || status.phase === "fenced") return status;
      return observe(await client.fenceTransition({ bankId, request: status.executor, context: input.request() }));
    },
    verify: async (bankId: string) => {
      const status = await owned(bankId);
      if (status.proof) return status;
      recordTransitionVerificationDispatch(input.db, { ...input.work(), status });
      return observe(await client.verifyTransition({ bankId, request: status.executor, context: input.request(true) }));
    },
    resolve: async (bankId: string, decision: { disposition: HindsightTransitionOutcomeRequest["disposition"]; receiptId: string | null }) => {
      const status = await owned(bankId);
      if (status.outcome) { requireStoredNativeDecision(input, status, decision); return status; }
      const command = transitionNativeDecision(input, status, decision);
      if (command.kind !== "decision") invalid();
      markTransitionNativeDispatched(input.db, { ...input.work(), command });
      const pending = Promise.resolve(client.resolveTransition({ bankId, request: command.request, context: input.request() }))
        .then((result) => observe(result));
      resolutions.set(bankId, pending);
      try { return await pending; }
      finally { if (resolutions.get(bankId) === pending) resolutions.delete(bankId); }
    },
    renew: () => renewNativeSession(input, active, resolutions),
  };
}

async function renewNativeSession(input: TransitionNativeSessionInput, active: Map<string, HindsightTransitionStatus>,
  resolutions: Map<string, Promise<HindsightTransitionStatus>>): Promise<void> {
  const client = requireHindsightTransitionClient(input.client);
  for (const [bankId, status] of active) {
    if (status.outcome) continue;
    // Both success and refusal can arrive after the original decision response.
    // Reconcile only that executor's already verified outcome; never renew again.
    try {
      const renewed = await client.renewTransition({ bankId, request: status.executor, context: input.request() });
      active.set(bankId, acceptRenewal(status, active.get(bankId), renewed));
    } catch (error) {
      const settled = await isTerminalRenewalRace(input, status, { error, resolving: resolutions.get(bankId), current: () => active.get(bankId) });
      if (!settled) throw error;
    }
  }
}

async function isTerminalRenewalRace(input: TransitionNativeSessionInput, sent: HindsightTransitionStatus,
  race: { error: unknown; resolving: Promise<HindsightTransitionStatus> | undefined; current(): HindsightTransitionStatus | undefined }): Promise<boolean> {
  const { error, resolving } = race;
  if (!(error instanceof HindsightTransitionRefusal) || error.refusal.reason !== "executor_lost") return false;
  if (resolving) {
    try { await resolving; } catch { return false; }
  }
  const current = race.current();
  if (!current || current.bank_id !== sent.bank_id || !current.outcome || current.revision <= sent.revision
    || hindsightTransitionHash(current.request) !== hindsightTransitionHash(sent.request)
    || hindsightTransitionHash(current.executor) !== hindsightTransitionHash(sent.executor)
    || (current.proof === null) !== (sent.proof === null)
    || current.proof && sent.proof && hindsightTransitionHash(current.proof) !== hindsightTransitionHash(sent.proof)) return false;
  try {
    requireStoredNativeDecision(input, current, { disposition: current.outcome.request.disposition,
      receiptId: current.outcome.request.core_receipt_id });
    return true;
  } catch { return false; }
}
export type TransitionNativeSession = ReturnType<typeof createTransitionNativeSession>;

function acceptRenewal(sent: HindsightTransitionStatus, current: HindsightTransitionStatus | undefined,
  renewed: HindsightTransitionStatus): HindsightTransitionStatus {
  validateHindsightTransitionStatus(renewed, { bankId: sent.bank_id, transitionId: sent.executor.transition_id });
  if (hindsightTransitionHash(renewed.request) !== hindsightTransitionHash(sent.request)
    || hindsightTransitionHash(renewed.executor) !== hindsightTransitionHash(sent.executor)
    || renewed.revision < sent.revision || sent.proof && hindsightTransitionHash(renewed.proof) !== hindsightTransitionHash(sent.proof)
    || renewed.revision === sent.revision && statusAuthority(renewed) !== statusAuthority(sent)) invalid();
  if (!current || hindsightTransitionHash(current.request) !== hindsightTransitionHash(sent.request)
    || current.revision < sent.revision || current.executor.generation < sent.executor.generation) invalid();
  // A legitimate takeover supersedes this response, even if its transport validation succeeded for the old token.
  if (current.executor.generation > sent.executor.generation) {
    if (current.revision <= renewed.revision) invalid();
    return current;
  }
  if (hindsightTransitionHash(current.executor) !== hindsightTransitionHash(sent.executor)) invalid();
  if (current.revision > renewed.revision) return current;
  if (current.revision === renewed.revision) {
    if (statusAuthority(current) !== statusAuthority(renewed)) invalid();
    return Date.parse(current.lease_expires_at) >= Date.parse(renewed.lease_expires_at) ? current : renewed;
  }
  if (current.outcome || current.proof && hindsightTransitionHash(current.proof) !== hindsightTransitionHash(renewed.proof)) invalid();
  return renewed;
}

/** Counters and lease liveness may change without a phase revision; durable identity/proof/outcome may not. */
function statusAuthority(status: HindsightTransitionStatus): string {
  const liveness = ["lease_expires_at", "executor_live", "active_writers", "accepted_operations"];
  return hindsightTransitionHash(Object.fromEntries(Object.entries(status).filter(([key]) => !liveness.includes(key))));
}
async function acquisition(input: TransitionNativeSessionInput, bankId: string): Promise<MemoryTransitionNativeCommand> {
  const prior = readTransitionNativeCommand(input.db, { transitionId: input.intent.transitionId, bankId, kind: "acquire", slot: "original" });
  if (prior) return prior;
  const expected = input.intent.request.expected;
  const bank = expected.banks.find((row) => (row.nativeBankId ?? row.targetBankId) === bankId); if (!bank) invalid();
  const baseline = expected.sourceProvider === "local" ? requireTransitionCommonBaseline(input.db, {
    baselineId: expected.baselineHash!, receiptId: expected.baselineReceiptId!, epochId: expected.predecessorEpochId }) : null;
  const previous = baseline?.candidate.scopes.find((scope) => scope.localBankId === bank.sourceBankId);
  const proof = previous ? readTransitionNativeEvidence(input.db, previous.evidenceId).status.proof : null;
  const unused = expected.sourceProvider === "local" && !previous
    ? await requireHindsightTransitionClient(input.client).unusedTransitionScope({ bankId, context: input.request() }) : null;
  input.work().assertConfiguration();
  const request = signHindsightTransitionAcquire(bankId, HindsightTransitionAcquireSchema.parse({
    transition_id: input.intent.transitionId, attempt_id: randomUUID(), provider_lineage: expected.sourceProvider === "local"
      ? expected.targetLineageId : expected.sourceLineageId, bank_generation: bank.nativeGeneration ?? unused?.bank_generation,
    direction: expected.sourceProvider === "local" ? "reenter-hindsight" : "return-local",
    baseline_transition_id: previous ? baseline!.baseline.transitionId : null,
    baseline_proof_hash: proof?.proof_hash ?? null, unused_scope: unused, request_hash: "0".repeat(64) }));
  return prepareTransitionNativeCommand(input.db, { ...input.work(), command: { kind: "acquire", bankId, slot: "original", request } });
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
function unavailable(): never { throw new Error("MEMORY_TRANSITION_UNAVAILABLE"); }
