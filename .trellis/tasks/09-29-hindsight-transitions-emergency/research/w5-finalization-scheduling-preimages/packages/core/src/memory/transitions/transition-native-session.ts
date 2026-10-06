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
import { signHindsightTransitionAcquire } from "../hindsight/hindsight-transition-proof.ts";
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
      return observe(await client.resolveTransition({ bankId, request: command.request, context: input.request() }));
    },
    renew: async () => {
      for (const [bankId, status] of active) {
        if (status.outcome) continue;
        // Renewal changes neither executor nor proof. A failed renewal never replaces the request identity.
        const renewed = await client.renewTransition({ bankId, request: status.executor, context: input.request() });
        active.set(bankId, renewed);
      }
    },
  };
}
export type TransitionNativeSession = ReturnType<typeof createTransitionNativeSession>;
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
