/**
 * INPUT:  copied Core template attestation and independently produced Native backup-v2 evidence
 * OUTPUT: exact inventory, selection, projection and configuration comparison after ordinary cursor checks
 * POS:    pure shared pair consumer for capture/admit/verify/restore; later ordinary memory cursors remain legal
 */
import { HindsightTemplateBackupAttestationSchema, HindsightBackupNativeProofV2Schema, HindsightBackupNativeProofBodyV2Schema,
  hindsightTemplateBackupObservationValue,
  type HindsightTemplateBackupBankAttestation, type HindsightTemplateBackupBankProofV2 } from "@taki/shared";
import { templateEqual } from "../hindsight/template-lifecycle/template-integrity.ts";
import type { HindsightBackupCoreIdentityV2, HindsightBackupPairResult, HindsightBackupPairProof } from "./hindsight-backup-pair.ts";
import { hindsightBackupHash, hindsightBackupValueWithout } from "./hindsight-template-backup-integrity.ts";

const mismatch = (reason: Exclude<HindsightBackupPairResult, { ok: true }>["reason"], bankId: string | null = null): HindsightBackupPairResult =>
  ({ ok: false, reason, bankId });

export function verifyHindsightTemplateBackupPair(core: HindsightBackupCoreIdentityV2, native: HindsightBackupPairProof): HindsightBackupPairResult {
  const proof = "zipSha256" in native ? HindsightBackupNativeProofV2Schema.safeParse(native) : HindsightBackupNativeProofBodyV2Schema.safeParse(native);
  if (!proof.success) return mismatch("template_proof_missing");
  const attestation = HindsightTemplateBackupAttestationSchema.safeParse(core.templates);
  if (!attestation.success) return mismatch("template_unpublished");
  const templates = attestation.data;
  if (hindsightBackupHash("attestation", hindsightBackupValueWithout(templates, "attestationHash")) !== templates.attestationHash
    || templates.authorityEpochId !== core.authority.epochId || templates.providerLineageId !== core.authority.providerLineageId) return mismatch("template_selection");
  if (core.requestHash !== proof.data.requestHash) return mismatch("template_request");
  const banks = new Map(proof.data.templates.map((bank) => [bank.target.bank_id, bank]));
  if (banks.size !== templates.banks.length || banks.size !== core.banks.length) return mismatch("bank_set");
  for (const bank of templates.banks) {
    const entry = banks.get(bank.target.bank_id);
    const copied = core.banks.find((value) => value.bankId === bank.canonicalIdentity);
    if (!entry || !copied || copied.nativeBankId !== bank.target.bank_id) return mismatch("native_bank_id", bank.canonicalIdentity);
    if (!templateEqual(bank.target, entry.target)) return mismatch("generation", bank.canonicalIdentity);
    const result = verifyHindsightTemplateBackupBank(bank, entry, core.requestHash);
    if (!result.ok) return result;
  }
  return { ok: true };
}

export function verifyHindsightTemplateBackupBank(core: HindsightTemplateBackupBankAttestation, native: HindsightTemplateBackupBankProofV2,
  requestHash: string): HindsightBackupPairResult {
  const bankId = core.canonicalIdentity;
  if (!templateEqual(core.receiptInventory, native.receiptInventory)) return mismatch("template_inventory", bankId);
  if (core.selected === null) {
    if (native.selected.state !== "unselected") return mismatch("template_selection", bankId);
    return native.receiptInventory.count === 0 ? { ok: true } : mismatch("template_inventory", bankId);
  }
  if (native.selected.state !== "selected") return mismatch("template_selection", bankId);
  const expected = core.selected; const actual = native.selected;
  if (expected.requestId !== actual.requestId || expected.requestHash !== actual.requestHash || expected.receiptHash !== actual.receiptHash) {
    return mismatch("template_selection", bankId);
  }
  if (expected.databaseDefinitionHash !== actual.databaseDefinitionHash) {
    return mismatch("template_projection", bankId);
  }
  const observation = actual.configurationObservation;
  if (expected.inheritedConfigHash !== actual.inheritedConfigHash || observation.inheritedConfigHash !== actual.inheritedConfigHash
    || observation.requestHash !== requestHash || hindsightBackupHash("observation", hindsightTemplateBackupObservationValue(native.target, observation))
      !== observation.observationHash) return mismatch("template_configuration", bankId);
  if (expected.definitionProjectionHash !== actual.definitionProjectionHash) return mismatch("template_projection", bankId);
  return { ok: true };
}
