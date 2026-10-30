/**
 * INPUT:  an admitted complete target snapshot and the actual verified Taki Bank template
 * OUTPUT: frozen Bank/control-resource witnesses, refusing unowned or unaccounted target objects
 * POS:    core/memory/hindsight — D78 admission preparation; native rechecks under its writer lock
 */
import type { HindsightLogicalSnapshotMetadata, HindsightLogicalSnapshotPage, HindsightLogicalSnapshotRecord,
  HindsightCurrentTransferRequest } from "@taki/shared";
import { verifyLogicalSnapshot } from "./hindsight-snapshot-validator.ts";
import { loadTakiBankTemplate, takiBankTemplateDigest, verifyTakiBankTemplate } from "./taki-bank-template-v1.ts";
import { hindsightCurrentStateHash } from "./hindsight-current-state-hash.ts";
import { HindsightBankTemplateManifestSchema } from "./hindsight-contracts.ts";

export interface HindsightCurrentBaseline {
  metadata: HindsightLogicalSnapshotMetadata; pages: HindsightLogicalSnapshotPage[];
}

export function nativeCurrentPayload(record: HindsightLogicalSnapshotRecord): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record.payload.value).map(([key, value]) =>
    [key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), value]));
}

export function prepareCurrentBaseline(input: {
  baseline: HindsightCurrentBaseline; bankId: string; providerLineage: string; bankGeneration: string;
  scope: "global" | "character"; templateRevision: string; templateDigest: string; now: string;
  supersede: HindsightCurrentTransferRequest["supersede"];
}): Pick<HindsightCurrentTransferRequest, "target_bank" | "preserve"> {
  const snapshot = verifyLogicalSnapshot({ ...input.baseline, expectedBankId: input.bankId,
    expectedProviderLineage: input.providerLineage, now: input.now });
  if (snapshot.metadata.manifest.bankGeneration !== input.bankGeneration) fail();
  const template = loadTakiBankTemplate(input.templateRevision, input.scope);
  if (takiBankTemplateDigest(template) !== input.templateDigest) fail();
  const banks = snapshot.records.filter((record) => record.payload.kind === "bank");
  const bank = banks[0]; if (banks.length !== 1 || !bank || bank.payload.kind !== "bank") fail();
  const controls = snapshot.records.filter((record) => record.payload.kind === "mental_model"
    ? template.ownership.mentalModelIds.includes(record.objectId)
    : record.payload.kind === "directive" && template.ownership.directiveNames.includes(record.payload.value.name));
  if (controls.length !== template.ownership.mentalModelIds.length + template.ownership.directiveNames.length) fail();
  verifyTakiBankTemplate(HindsightBankTemplateManifestSchema.parse({ version: "1", bank: bank.payload.value.config,
    mental_models: controls.filter((record) => record.payload.kind === "mental_model").map((record) => ({
      ...nativeCurrentPayload(record), id: record.objectId })),
    directives: controls.filter((record) => record.payload.kind === "directive").map(nativeCurrentPayload),
  }), template);
  const accepted = new Set([key(bank), ...controls.map(key)]);
  for (const item of input.supersede) {
    const record = snapshot.records.find((candidate) => key(candidate) === `${item.object_kind}:${item.object_id}`);
    if (!record || accepted.has(key(record)) || record.objectRevision !== item.object_revision
      || hindsightCurrentStateHash(nativeCurrentPayload(record)) !== item.payload_hash) fail();
    accepted.add(key(record));
  }
  if (accepted.size !== snapshot.records.length || snapshot.records.some((record) => !accepted.has(key(record)))) fail();
  return { target_bank: { ...witness(bank), object_kind: "bank" }, preserve: controls.map((record) => {
    if (record.objectKind !== "mental_model" && record.objectKind !== "directive") fail();
    return { ...witness(record), object_kind: record.objectKind };
  }) };
}

function witness(record: HindsightLogicalSnapshotRecord) {
  return { object_id: record.objectId, object_revision: record.objectRevision,
    payload_hash: hindsightCurrentStateHash(nativeCurrentPayload(record)) };
}
function key(record: HindsightLogicalSnapshotRecord): string { return `${record.objectKind}:${record.objectId}`; }
function fail(): never { throw new Error("HINDSIGHT_CURRENT_TARGET_CONFLICT"); }
