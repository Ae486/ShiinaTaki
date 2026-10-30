/**
 * INPUT:  the complete current Local capture, real B3 verification and the owned native D78 client
 * OUTPUT: all-Bank structured import, native certificates, raw replica checkpoints and B4 readiness
 * POS:    task-only execution coordinator; stable production commands resume, authority is never activated
 */
import type { HindsightPreparedCurrentBank, HindsightSetupSnapshot, HindsightCurrentPreparationGap } from "../../../../../packages/shared/src/index.ts";
import { hindsightCheckpointSetDigest } from "../../../../../packages/core/src/db/hindsight-authority-repo.ts";
import { createHindsightCutoverRunRepo } from "../../../../../packages/core/src/db/hindsight-cutover-run-repo.ts";
import { requireHindsightCurrentCutover } from "../../../../../packages/core/src/db/hindsight-current-cutover-guard.ts";
import { prepareHindsightCurrentBank, readHindsightCurrentPreparation } from "../../../../../packages/core/src/db/hindsight-current-preparation-repo.ts";
import { readHindsightLocalBankBinding } from "../../../../../packages/core/src/db/hindsight-local-bank-binding.ts";
import { createHindsightReplicaRepo } from "../../../../../packages/core/src/db/hindsight-replica-repo.ts";
import type { HindsightCurrentStateClient } from "../../../../../packages/core/src/memory/hindsight/hindsight-current-client.ts";
import { fetchHindsightCurrentBaseline, importHindsightCurrentBank, verifyHindsightCurrentBank } from "../../../../../packages/core/src/memory/hindsight/hindsight-current-orchestrator.ts";
import { hindsightOperationUuid } from "../../../../../packages/core/src/memory/hindsight/hindsight-import-identity.ts";
import { canonicalPayloadHash } from "../../../../../packages/core/src/memory/legacy-migration/legacy-identities.ts";
import { currentCallContext } from "./current-cutover-real-data-client.ts";
import type { RealDataSession } from "./current-cutover-real-data-local.ts";
import { failureCode, requireCondition, type RealDataCommand } from "./current-cutover-real-data-state.ts";

export async function prepareAllBanks(session: RealDataSession, client: HindsightCurrentStateClient): Promise<HindsightPreparedCurrentBank[]> {
  session.stage = "PREPARATION";
  const prepared: HindsightPreparedCurrentBank[] = [];
  const banks = [...session.capture.banks].sort((a, b) => Number(b.scope.kind === "global") - Number(a.scope.kind === "global"));
  for (const bank of banks) {
    session.assertLive();
    const prior = session.db.prepare("SELECT preparation_id FROM hindsight_current_preparations WHERE capture_id=:capture AND source_bank_id=:bank")
      .get({ capture: session.capture.captureId, bank: bank.bankId });
    const value = prior ? readHindsightCurrentPreparation(session.db, String(prior.preparation_id))
      : await prepareOneBank(session, { client, sourceBankId: bank.bankId });
    requireCondition(value.captureId === session.capture.captureId && value.sourceBankId === bank.bankId,
      "REAL_DATA_PREPARATION_IDENTITY_CHANGED");
    recordCommand(session, value);
    reportPreparation(session, value);
    prepared.push(value);
  }
  const gaps = prepared.flatMap((bank) => bank.gaps);
  session.metadata.report("REAL_DATA_ALL_BANKS_PREPARED", { bankCount: prepared.length, gapCount: gaps.length,
    gapCounts: gapCounts(gaps), gapDigest: canonicalPayloadHash(gaps) });
  requireCondition(prepared.length === session.capture.manifest.bankIds.length && gaps.length === 0
    && prepared.every((bank) => bank.request !== null), "HINDSIGHT_CURRENT_PREPARATION_GAPS");
  return prepared;
}

async function prepareOneBank(session: RealDataSession, input: { client: HindsightCurrentStateClient; sourceBankId: string }) {
  const binding = readHindsightLocalBankBinding(session.db, { localEpochId: session.state.sourceEpochId, sourceBankId: input.sourceBankId });
  const baseline = await fetchHindsightCurrentBaseline({ bankId: binding.nativeBankId, ttlSeconds: 3600,
    client: input.client, context: currentCallContext(session) });
  session.assertLive();
  requireCondition(baseline.metadata.manifest.providerLineage === session.state.providerLineage, "REAL_DATA_NATIVE_LINEAGE_CHANGED");
  return prepareHindsightCurrentBank(session.db, { lease: session.lease, manifestId: session.capture.manifest.manifestId,
    expectedEpochId: session.state.sourceEpochId, now: new Date().toISOString(), sourceBankId: input.sourceBankId,
    providerLineage: baseline.metadata.manifest.providerLineage, bankGeneration: baseline.metadata.manifest.bankGeneration, baseline });
}

function recordCommand(session: RealDataSession, prepared: HindsightPreparedCurrentBank): void {
  const value: RealDataCommand = { sourceBankId: prepared.sourceBankId, bankId: prepared.bankId,
    preparationId: prepared.preparationId, operationId: prepared.operationId,
    verificationId: hindsightOperationUuid(`d78-real-data-verification/v1/${prepared.preparationId}`),
    replicaEpochId: hindsightOperationUuid(`d78-real-data-replica/v1/${prepared.preparationId}`) };
  const prior = session.state.commands.find((item) => item.sourceBankId === prepared.sourceBankId);
  if (prior) requireCondition(canonicalPayloadHash(prior) === canonicalPayloadHash(value), "REAL_DATA_COMMAND_IDENTITY_CHANGED");
  else session.state.commands.push(value);
  session.metadata.save();
}

function reportPreparation(session: RealDataSession, value: HindsightPreparedCurrentBank): void {
  const request = value.request;
  session.metadata.report("REAL_DATA_BANK_PREPARED", { sourceBankId: value.sourceBankId, bankId: value.bankId,
    preparationId: value.preparationId, operationId: value.operationId, requestHash: request?.request_hash ?? null,
    requestBytes: request ? Buffer.byteLength(JSON.stringify(request), "utf8") : null,
    documentCount: request?.documents.length ?? null, unitCount: request?.memory_units.length ?? null,
    preservedControlCount: request?.preserve.length ?? null, gapCount: value.gaps.length,
    gapCounts: gapCounts(value.gaps), gapDigest: canonicalPayloadHash(value.gaps) });
}

export async function importAllBanks(session: RealDataSession, input: { client: HindsightCurrentStateClient; prepared: HindsightPreparedCurrentBank[] }): Promise<void> {
  session.stage = "IMPORT";
  for (const bank of input.prepared) {
    const imported = await importOneBank(session, { client: input.client, bank });
    session.assertLive();
    session.metadata.report("REAL_DATA_BANK_IMPORTED", { bankId: bank.bankId, operationId: imported.result.operation_id,
      requestHash: imported.result.request_hash, resultHash: imported.result.result_hash,
      mappingCount: imported.mappings.length, mappingPages: imported.pages.length });
  }
  requireCondition(session.state.acknowledgements.import === "recovered", "REAL_DATA_IMPORT_REPLAY_NOT_PROVEN");
}

async function importOneBank(session: RealDataSession, input: { client: HindsightCurrentStateClient; bank: HindsightPreparedCurrentBank }) {
  const invoke = () => importHindsightCurrentBank({ db: session.db, preparationId: input.bank.preparationId,
    client: input.client, context: currentCallContext(session) });
  const before = session.state.counters.transferDispatches;
  let value;
  try { value = await invoke(); }
  catch (error) {
    if (session.state.acknowledgements.import !== "lost" || session.state.acknowledgementIds.import !== input.bank.operationId
      || failureCode(error) !== "HINDSIGHT_UNREACHABLE") throw error;
    session.reopen();
    const dispatched = session.state.counters.transferDispatches;
    value = await invoke();
    requireCondition(session.state.counters.transferDispatches === dispatched, "REAL_DATA_IMPORT_REPLAY_REDISPATCHED");
  }
  if (session.state.acknowledgements.import === "lost" && session.state.acknowledgementIds.import === input.bank.operationId) {
    session.state.acknowledgements.import = "recovered";
    session.metadata.save();
    session.metadata.report("REAL_DATA_IMPORT_ACK_RECOVERED", { operationId: input.bank.operationId,
      dispatchesBefore: before, dispatchesAfter: session.state.counters.transferDispatches });
  }
  return value;
}

export async function verifyAllBanks(session: RealDataSession, input: { client: HindsightCurrentStateClient; prepared: HindsightPreparedCurrentBank[] }): Promise<void> {
  session.stage = "VERIFICATION";
  let complete = 0;
  for (const bank of input.prepared) {
    const command = session.state.commands.find((item) => item.preparationId === bank.preparationId);
    requireCondition(command, "REAL_DATA_COMMAND_MISSING");
    const result = await verifyOneBank(session, { client: input.client, command });
    session.assertLive();
    const status = result.status;
    const certificate = status.certificate;
    if (result.evidence && certificate) complete++;
    session.metadata.report("REAL_DATA_BANK_VERIFICATION", { bankId: bank.bankId, verificationId: command.verificationId,
      state: status.state, revision: status.revision, reasons: status.reasons, candidateHash: status.candidate_hash,
      requiredSetHash: status.required_set_hash, sourceScopeCount: status.source_scope_count, modelCount: status.model_count,
      certificateHash: certificate?.certificate_hash ?? null, evidenceId: result.evidence?.evidenceId ?? null,
      evidenceCounts: certificate?.evidence.counts ?? null, snapshotId: certificate?.snapshot.snapshot_id ?? null,
      snapshotCount: certificate?.snapshot.manifest.total_records ?? null, snapshotRecordsHash: certificate?.snapshot_records_hash ?? null,
      checkpointCursor: createHindsightReplicaRepo(session.db).checkpoint(bank.bankId)?.endCursor ?? null });
  }
  requireCondition(complete === input.prepared.length, "HINDSIGHT_CURRENT_VERIFICATION_INCOMPLETE");
  requireCondition(session.state.acknowledgements.verification === "recovered", "REAL_DATA_VERIFICATION_REPLAY_NOT_PROVEN");
}

async function verifyOneBank(session: RealDataSession, input: { client: HindsightCurrentStateClient; command: RealDataCommand }) {
  const command = input.command;
  const invoke = () => verifyHindsightCurrentBank({ db: session.db, preparationId: command.preparationId, lease: session.lease,
    verificationId: command.verificationId, replicaEpochId: command.replicaEpochId, client: input.client,
    context: currentCallContext(session), now: () => new Date().toISOString() });
  let value;
  try { value = await invoke(); }
  catch (error) {
    if (session.state.acknowledgements.verification !== "lost" || session.state.acknowledgementIds.verification !== command.verificationId
      || failureCode(error) !== "HINDSIGHT_UNREACHABLE") throw error;
    session.reopen();
    const advances = session.state.counters.verificationAdvances;
    value = await invoke();
    requireCondition(session.state.counters.verificationAdvances === advances, "REAL_DATA_VERIFICATION_REPLAY_REPEATED_MODEL_WORK");
  }
  if (value.evidence && session.state.acknowledgements.verification === "lost"
    && session.state.acknowledgementIds.verification === command.verificationId) {
    session.state.acknowledgements.verification = "recovered";
    session.metadata.save();
    session.metadata.report("REAL_DATA_VERIFICATION_ACK_RECOVERED", { verificationId: command.verificationId,
      verificationAdvances: session.state.counters.verificationAdvances });
  }
  return value;
}

export function proveReadiness(session: RealDataSession, setup: HindsightSetupSnapshot): void {
  session.stage = "B4_READINESS";
  session.assertLive();
  requireCondition(setup.configFingerprint, "REAL_DATA_B3_FINGERPRINT_MISSING");
  const replica = createHindsightReplicaRepo(session.db);
  const banks = setup.banks.map((bank) => {
    const checkpoint = replica.checkpoint(bank.externalBankId);
    requireCondition(checkpoint, "HINDSIGHT_CHECKPOINT_MISSING");
    return { bankId: bank.externalBankId, templateDigest: bank.templateDigest, checkpoint };
  });
  const checkpointSetDigest = hindsightCheckpointSetDigest(banks);
  requireHindsightCurrentCutover(session.db, { manifest: session.capture.manifest, now: new Date().toISOString() });
  const runs = createHindsightCutoverRunRepo(session.db);
  if (runs.status(session.state.b2RunId).phase !== "ready") {
    runs.markReady({ lease: session.lease, configFingerprint: setup.configFingerprint, checkpointSetDigest, now: new Date().toISOString() });
  }
  const input = { runId: session.state.b2RunId, expectedRevision: setup.revision, expectedEpochId: session.state.sourceEpochId };
  const result = runs.verify(input);
  requireCondition(result.eligible, "REAL_DATA_B4_NOT_READY");
  session.reopen();
  const reopened = createHindsightCutoverRunRepo(session.db).verify(input);
  requireCondition(reopened.eligible, "REAL_DATA_REOPENED_B4_NOT_READY");
  session.metadata.report("REAL_DATA_B4_READY", { runId: input.runId, bankCount: banks.length,
    checkpointSetDigest, eligible: reopened.eligible, blockingCodes: reopened.blockingCodes,
    currentState: reopened.status.currentState, localAuthority: reopened.status.authority,
    ...session.state.counters, acknowledgements: session.state.acknowledgements });
}

function gapCounts(gaps: HindsightCurrentPreparationGap[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const gap of gaps) counts[gap.code] = (counts[gap.code] ?? 0) + 1;
  return counts;
}
