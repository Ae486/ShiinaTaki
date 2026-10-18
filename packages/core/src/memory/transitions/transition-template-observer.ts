/**
 * INPUT:  an admitted healthy identity, complete W2 evidence and the actual authenticated Native transport
 * OUTPUT: an immutable per-Bank association sealed only after independent W2/core/observation comparison
 * POS:    healthy producer outside SQLite transactions; no writes, maintenance, providers or backup artifact creation
 */
import type { HindsightTemplateTarget, MemoryTransitionIntent, MemoryTransitionNativeEvidence } from "@taki/shared";
import type { Database } from "../../db/sqlite.ts";
import type { HindsightClient, HindsightCallContext } from "../hindsight/hindsight-client.ts";
import { createHindsightTemplateBackupRequest } from "../hindsight-backup/hindsight-template-backup-attestation.ts";
import { observeHindsightTemplateBackup } from "../hindsight-backup/hindsight-template-backup-observer.ts";
import { readTransitionTemplateState, assertTransitionTemplatesCurrent } from "./transition-template-state.ts";
import { templateEqual } from "../hindsight/template-lifecycle/template-integrity.ts";
import { sealTransitionNativeEvidence } from "./transition-native-evidence.ts";
import { verifyTransitionTemplateObservation } from "./transition-template-evidence.ts";

interface Input {
  db: Database; intent: MemoryTransitionIntent; evidence: MemoryTransitionNativeEvidence;
  client: HindsightClient; request(): HindsightCallContext;
}

export async function associateTransitionTemplateEvidence(input: Input): Promise<MemoryTransitionNativeEvidence> {
  const expected = input.intent.request.expected;
  assertTransitionTemplatesCurrent(input.db, expected);
  if (!expected.templates) return input.evidence;
  const proof = input.evidence.status.proof; if (!proof || input.evidence.templateBackup) invalid();
  const target = { provider_lineage: proof.provider_lineage, bank_id: proof.bank_id, bank_generation: proof.bank_generation };
  input.request();
  const state = readTransitionTemplateState(input.db, expected, [target]);
  if (!templateEqual(state.commitment, expected.templates)) invalid();
  const bank = state.body.banks.find((value) => templateEqual(value.target, target));
  const template = state.templates.find((value) => templateEqual(value.target, target));
  if (!bank || !template) invalid();
  const request = createHindsightTemplateBackupRequest({ backupId: input.intent.transitionId, createdAt: input.intent.admittedAt,
    providerLineageId: target.provider_lineage, operationIds: [],
    state: { templates: [template], operationIds: bankOperationIds(state, target) } });
  const context = input.request();
  const observation = await observeHindsightTemplateBackup(input.client, { request, ...context });
  input.request();
  if (!templateEqual(readTransitionTemplateState(input.db, expected, [target]).body, state.body)) invalid();
  const { evidenceId, ...body } = input.evidence;
  return sealTransitionNativeEvidence({ ...body, templateBackup: { version: 1, admitted: expected.templates,
    w2EvidenceId: evidenceId, w2ProofHash: proof.proof_hash, defaultsHash: state.body.defaultsHash, hold: state.body.hold,
    bank, request, observation } });
}

/** Recovery must re-observe today's configuration/inventory, while the original W2 and association remain immutable. */
export async function assertFreshTransitionTemplateEvidence(input: Input): Promise<void> {
  const expected = input.intent.request.expected;
  assertTransitionTemplatesCurrent(input.db, expected);
  if (!expected.templates) { if (input.evidence.templateBackup) invalid(); return; }
  const prior = input.evidence.templateBackup;
  if (!prior || !templateEqual(prior.admitted, expected.templates)) invalid();
  const target = prior.bank.target;
  const state = readTransitionTemplateState(input.db, expected, [target]);
  const bank = state.body.banks.find((value) => templateEqual(value.target, target));
  if (!templateEqual(state.commitment, expected.templates) || !templateEqual(bank, prior.bank)
    || prior.defaultsHash !== state.body.defaultsHash || !templateEqual(prior.hold, state.body.hold)
    || !templateEqual(bankOperationIds(state, target), prior.request.operationIds)) invalid();
  const observation = await observeHindsightTemplateBackup(input.client, { request: prior.request,
    schema: prior.observation.schema, archived: prior.observation.proof, ...input.request() });
  input.request();
  verifyTransitionTemplateObservation(input.evidence, observation);
  if (!templateEqual(readTransitionTemplateState(input.db, expected, [target]).body, state.body)) invalid();
}

function bankOperationIds(state: ReturnType<typeof readTransitionTemplateState>, target: HindsightTemplateTarget): string[] {
  const keys = new Set(state.receipts.filter((receipt) => templateEqual(receipt.target, target)).flatMap((receipt) => [
    "template-receipt:" + receipt.request_id, ...receipt.children.map((child) => "template-refresh-result:" + child.child_id),
  ]));
  // Only Core's verified terminal semantic observations request refresh membership; pending/unknown jobs remain distinct.
  return state.operationIds.filter((id) => keys.has(id));
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
