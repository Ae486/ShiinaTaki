/**
 * INPUT:  previously persisted exact delta command, live native executor and current W1 owner guard
 * OUTPUT: recovered or applied factual delta result persisted once under the original operation identity
 * POS:    core/memory/transitions — W3 replay primitive; W5 owns orchestration, fences and finite maintenance
 */
import type { HindsightTransitionExecutor } from "@taki/shared";
import type { Database } from "../../db/sqlite.ts";
import type { TransitionCaptureInput } from "../../db/memory-transition-local-capture.ts";
import { readTransitionPreparation, readTransitionDeltaResult, recordTransitionDeltaResult,
  validatePreparedDeltaResult } from "../../db/memory-transition-delta-repo.ts";
import type { HindsightTransitionClient } from "../hindsight/hindsight-transition-client.ts";
import type { HindsightCallContext } from "../hindsight/hindsight-client.ts";
import type { HindsightTransitionSourceClient } from "../hindsight/hindsight-transition-source-client.ts";
import { assertTransitionDeltaDispatch, uploadTransitionSources } from "./transition-source-upload.ts";

export async function executeTransitionDelta(db: Database, input: TransitionCaptureInput & { preparationId: string;
  executor: HindsightTransitionExecutor; client: HindsightTransitionClient & Partial<HindsightTransitionSourceClient>; request(): HindsightCallContext }) {
  const prepared = readTransitionPreparation(db, input.preparationId);
  const existing = readTransitionDeltaResult(db, prepared.transitionId, prepared.scope.localBankId);
  if (existing) { validatePreparedDeltaResult(prepared, existing.result); return existing; }
  if (input.executor.transition_id !== prepared.transitionId) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  const read = { bankId: prepared.scope.nativeBankId, transitionId: prepared.transitionId };
  const historical = await input.client.transitionDelta({ ...read, context: input.request() });
  if (!historical) {
    await uploadTransitionSources(db, { ...input, prepared });
    assertTransitionDeltaDispatch(db, input, prepared);
  }
  const result = historical ?? await input.client.applyTransitionDelta({ bankId: read.bankId,
    request: { ...prepared.request, executor: input.executor }, context: input.request() });
  input.request(); validatePreparedDeltaResult(prepared, result);
  recordTransitionDeltaResult(db, { ...input, result });
  const stored = readTransitionDeltaResult(db, prepared.transitionId, prepared.scope.localBankId);
  if (!stored) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  return stored;
}
