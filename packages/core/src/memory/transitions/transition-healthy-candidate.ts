/**
 * INPUT:  the actual fenced all-Bank native sessions and current Local source when re-entering
 * OUTPUT: persisted complete native evidence plus the checked W3 candidate and final post-maintenance mapping
 * POS:    core/memory/transitions — healthy orchestration; no alternative transfer or synthetic first-activation history
 */
import type { HindsightTransitionStatus, MemoryTransitionIntent } from "@taki/shared";
import { captureTransitionLocal, type TransitionCaptureInput } from "../../db/memory-transition-local-capture.ts";
import { persistTransitionNativeEvidence, readTransitionCandidate, readTransitionNativeEvidence } from "../../db/memory-transition-candidate-repo.ts";
import { prepareTransitionDelta, readTransitionPreparation } from "../../db/memory-transition-delta-repo.ts";
import type { Database } from "../../db/sqlite.ts";
import { loadTransitionNativeEvidence } from "./transition-native-loader.ts";
import { buildTransitionLocalCandidate } from "./transition-local-candidate.ts";
import { buildTransitionHindsightCandidate } from "./transition-final-mapping.ts";
import { executeTransitionDelta } from "./transition-delta-execution.ts";
import { requireHindsightApplicationClient } from "../hindsight/hindsight-application-capability.ts";
import { loadTransitionUnusedInventory } from "./transition-unused-inventory.ts";
import { transitionLocalHash } from "./transition-local-encoding.ts";
import type { HindsightCallContext } from "../hindsight/hindsight-client.ts";
import type { TransitionNativeSession } from "./transition-native-session.ts";

interface Input { db: Database; intent: MemoryTransitionIntent; native: TransitionNativeSession;
  work(): TransitionCaptureInput; request(): HindsightCallContext; changed(): void }
export async function prepareHealthyTransitionCandidate(input: Input) {
  const existing = input.db.prepare("SELECT id FROM memory_transition_candidates WHERE transition_id=:id AND slot='final'")
    .get({ id: input.intent.transitionId });
  if (existing) return readTransitionCandidate(input.db, String(existing.id));
  const capture = input.intent.request.expected.sourceProvider === "local" ? captureTransitionLocal(input.db, input.work()) : null;
  const preparations: string[] = []; const evidenceIds: string[] = [];
  for (const bank of input.intent.request.expected.banks) {
    const bankId = bank.nativeBankId ?? bank.targetBankId; if (!bankId) invalid();
    const fenced = await input.native.fence(bankId);
    if (capture) {
      const prepared = await prepareBankDelta(input, { target: fenced, localBankId: bank.sourceBankId, captureId: capture.captureId });
      // Inventory renewal can reclaim an expired Native executor. Preserve the prepared logical request,
      // but dispatch under the current fence rather than the status captured before inventory loading.
      const executor = (await input.native.fence(bankId)).executor;
      await executeTransitionDelta(input.db, { ...input.work(), preparationId: prepared.preparationId,
        executor, client: input.native.client, request: input.request });
      preparations.push(prepared.preparationId); input.changed();
    }
    const status = await input.native.verify(bankId);
    evidenceIds.push(await nativeEvidence(input, status)); input.changed();
  }
  return capture ? buildTransitionHindsightCandidate(input.db, { ...input.work(), preparationIds: preparations, evidenceIds })
    : buildTransitionLocalCandidate(input.db, { ...input.work(), evidenceIds });
}
async function prepareBankDelta(input: Input, bank: { target: HindsightTransitionStatus; localBankId: string; captureId: string }) {
  const row = input.db.prepare("SELECT id FROM memory_transition_preparations WHERE transition_id=:transition AND slot=:bank")
    .get({ transition: input.intent.transitionId, bank: bank.localBankId });
  if (row) return readTransitionPreparation(input.db, String(row.id));
  const previous = bank.target.request.baseline_transition_id;
  const retired = previous ? await input.native.client.transitionStatus({ bankId: bank.target.bank_id,
    transitionId: previous, context: input.request() }) : null;
  const unusedInventory = bank.target.request.unused_scope ? await loadTransitionUnusedInventory(input, bank.target) : undefined;
  return prepareTransitionDelta(input.db, { ...input.work(), ...bank, retired, unusedInventory });
}
async function nativeEvidence(input: Input, status: HindsightTransitionStatus): Promise<string> {
  const row = input.db.prepare("SELECT id FROM memory_transition_native_evidence WHERE transition_id=:id AND slot=:bank")
    .get({ id: input.intent.transitionId, bank: status.bank_id });
  if (row) {
    // Final proof and all loaded bytes are immutable. Executor takeover/renewal changes live status only;
    // rebuilding that historical document would collide with its original immutable Bank slot.
    const prior = readTransitionNativeEvidence(input.db, String(row.id));
    if (prior.transitionId !== input.intent.transitionId || prior.status.bank_id !== status.bank_id
      || transitionLocalHash(prior.status.request) !== transitionLocalHash(status.request)
      || !status.proof || transitionLocalHash(prior.status.proof) !== transitionLocalHash(status.proof)
      || status.phase !== "proven" || status.outcome || status.active_writers !== 0 || status.accepted_operations !== 0) invalid();
    input.work().assertConfiguration(); return prior.evidenceId;
  }
  const client = requireHindsightApplicationClient(input.native.client);
  if (!client.currentSnapshotPage) invalid();
  const evidence = await loadTransitionNativeEvidence({ status,
    client: { ...input.native.client, ...client, currentSnapshotPage: client.currentSnapshotPage }, request: input.request });
  persistTransitionNativeEvidence(input.db, { ...input.work(), evidence }); return evidence.evidenceId;
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
