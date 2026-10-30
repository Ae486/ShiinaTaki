/**
 * INPUT:  selected Local capture, verified B3 binding and a complete native baseline snapshot
 * OUTPUT: immutable transfer-aware preparation, exact replays and explicit representation gaps
 * POS:    core/db — D78 command freeze before network; no changes to historical v1 evidence
 */
import { HindsightPreparedCurrentBankSchema, type HindsightPreparedCurrentBank, type HindsightCurrentTransferRequest } from "@taki/shared";
import { canonicalJson, canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";
import { prepareCurrentBaseline, type HindsightCurrentBaseline } from "../memory/hindsight/hindsight-current-baseline.ts";
import { buildCurrentTransferRequest } from "../memory/hindsight/hindsight-current-request.ts";
import { hindsightOperationUuid } from "../memory/hindsight/hindsight-import-identity.ts";
import { captureHindsightCurrentLocal, type HindsightCurrentCaptureInput } from "./hindsight-current-capture-repo.ts";
import { readHindsightLocalBankBinding } from "./hindsight-local-bank-binding.ts";
import { createHindsightBankSetupRepo } from "./hindsight-bank-setup-repo.ts";
import type { Database } from "./sqlite.ts";

export interface HindsightCurrentPreparationInput extends HindsightCurrentCaptureInput {
  sourceBankId: string; providerLineage: string; bankGeneration: string; baseline: HindsightCurrentBaseline;
  supersede?: HindsightCurrentTransferRequest["supersede"];
}

export function prepareHindsightCurrentBank(db: Database, input: HindsightCurrentPreparationInput): HindsightPreparedCurrentBank {
  let prepared: HindsightPreparedCurrentBank | undefined;
  db.transaction(() => {
    const capture = captureHindsightCurrentLocal(db, input);
    const bank = readHindsightLocalBankBinding(db, { localEpochId: input.expectedEpochId, sourceBankId: input.sourceBankId });
    const identity = bank.scope.kind === "global" ? "global" : `character:${bank.scope.characterId}`;
    const setup = createHindsightBankSetupRepo(db).get(identity);
    if (!setup || setup.status !== "verified") throw new Error("HINDSIGHT_TEMPLATE_NOT_VERIFIED");
    const baseline = prepareCurrentBaseline({ baseline: input.baseline, bankId: bank.nativeBankId,
      providerLineage: input.providerLineage, bankGeneration: input.bankGeneration, scope: bank.scope.kind,
      templateRevision: setup.templateRevision, templateDigest: setup.templateDigest, now: input.now, supersede: input.supersede ?? [] });
    const operationId = hindsightOperationUuid(`current-state/v1/${capture.captureId}/${bank.nativeBankId}/${input.providerLineage}/${input.bankGeneration}`);
    const native = buildCurrentTransferRequest({ capture, sourceBankId: bank.sourceBankId, bankId: bank.nativeBankId,
      operationId, providerLineage: input.providerLineage, bankGeneration: input.bankGeneration, baseline, supersede: input.supersede ?? [] });
    const body = { schemaVersion: 1 as const, captureId: capture.captureId, runId: capture.manifest.runId,
      manifestId: capture.manifest.manifestId, localManifestDigest: capture.manifest.manifestDigest,
      localEpochId: capture.manifest.localEpochId, sourceBankId: bank.sourceBankId, bankId: bank.nativeBankId,
      bankScope: bank.scope, templateDigest: setup.templateDigest, operationId, ...native };
    const value = HindsightPreparedCurrentBankSchema.parse({ ...body, preparationId: canonicalPayloadHash(["taki-current-preparation.v1", body]) });
    prepared = savePreparation(db, value);
  });
  if (!prepared) throw new Error("HINDSIGHT_CURRENT_PREPARATION_MISSING");
  return prepared;
}

function savePreparation(db: Database, prepared: HindsightPreparedCurrentBank): HindsightPreparedCurrentBank {
  const existing = db.prepare("SELECT preparation_id FROM hindsight_current_preparations WHERE capture_id=:capture AND bank_id=:bank")
    .get({ capture: prepared.captureId, bank: prepared.bankId });
  if (existing) {
    const prior = readHindsightCurrentPreparation(db, String(existing.preparation_id));
    if (canonicalJson(prior) !== canonicalJson(prepared)) throw new Error("HINDSIGHT_CURRENT_PREPARATION_CONFLICT");
    return prior;
  }
  db.prepare(`INSERT INTO hindsight_current_preparations
    (preparation_id,capture_id,operation_id,bank_id,source_bank_id,preparation_json) VALUES (:id,:capture,:operation,:bank,:source,:json)`)
    .run({ id: prepared.preparationId, capture: prepared.captureId, operation: prepared.operationId,
      bank: prepared.bankId, source: prepared.sourceBankId, json: canonicalJson(prepared) });
  return prepared;
}

export function readHindsightCurrentPreparation(db: Database, id: string): HindsightPreparedCurrentBank {
  const row = db.prepare("SELECT * FROM hindsight_current_preparations WHERE preparation_id=:id").get({ id });
  if (!row) throw new Error("HINDSIGHT_CURRENT_PREPARATION_MISSING");
  const value = HindsightPreparedCurrentBankSchema.parse(JSON.parse(String(row.preparation_json)));
  const { preparationId, ...body } = value;
  if (preparationId !== canonicalPayloadHash(["taki-current-preparation.v1", body]) || preparationId !== row.preparation_id
    || value.captureId !== row.capture_id || value.operationId !== row.operation_id || value.bankId !== row.bank_id
    || value.sourceBankId !== row.source_bank_id) throw new Error("HINDSIGHT_CURRENT_PREPARATION_CORRUPT");
  return value;
}
