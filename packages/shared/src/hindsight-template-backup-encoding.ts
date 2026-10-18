/**
 * INPUT:  validated versioned backup values, full lifecycle projections and complete receipt inventories
 * OUTPUT: separate backup-domain canonical bytes, identity normalization and explicit transport byte budgets
 * POS:    Shared backup encoding; existing lifecycle domains and historical v1 bytes remain unchanged
 */
import { hindsightCurrentStateJson } from "./hindsight-current-state-encoding.ts";
import { normalizeHindsightTemplateRequest } from "./hindsight-template-encoding.ts";
import { HindsightTemplateTargetSchema, type HindsightTemplateTarget } from "./hindsight-template-definition-schema.ts";
import { HindsightTemplateBackupReceiptTupleSchema, type HindsightTemplateBackupReceiptTuple,
  type HindsightTemplateBackupConfigurationObservation } from "./hindsight-template-backup-schema.ts";
import type { HindsightTemplateSnapshot } from "./hindsight-template-schema.ts";
import type { HindsightBackupNativeRequestV2 } from "./hindsight-backup-v2-schema.ts";

export const HINDSIGHT_BACKUP_V2_REQUEST_MAX_BYTES = 640 * 1024 * 1024;
export const HINDSIGHT_BACKUP_APPLY_MAX_BYTES = 512 * 1024;
export const HINDSIGHT_BACKUP_PROOF_MAX_BYTES = 2 * 1024 * 1024;
export const HINDSIGHT_BACKUP_MANIFEST_MAX_BYTES = 4 * 1024 * 1024;
// Compact {version:2,nonce:<36-character UUID>,request:<object>} adds fewer than 128 bytes.
// The wrapper allowance is additional to, never deducted from, the complete valid request budget.
export const HINDSIGHT_BACKUP_OBSERVATION_WRAPPER_MAX_BYTES = 128;
export const HINDSIGHT_BACKUP_OBSERVATION_REQUEST_MAX_BYTES = HINDSIGHT_BACKUP_V2_REQUEST_MAX_BYTES
  + HINDSIGHT_BACKUP_OBSERVATION_WRAPPER_MAX_BYTES;
export const HINDSIGHT_TEMPLATE_BACKUP_HASH_DOMAINS = [
  "request", "receipts", "database", "inherited", "context", "observation", "attestation", "history", "defaults", "hold", "transition",
] as const;
export type HindsightTemplateBackupHashDomain = typeof HINDSIGHT_TEMPLATE_BACKUP_HASH_DOMAINS[number];

export function hindsightTemplateBackupHashJson(domain: HindsightTemplateBackupHashDomain, value: unknown): string {
  return hindsightCurrentStateJson({ domain: "taki-template-backup-" + domain + ".v1", value });
}
/** Byte measurement is for already parsed values; untrusted transports must first enforce their streaming/file bound. */
export function hindsightBackupJsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}
export function normalizeHindsightBackupRequestV2(value: HindsightBackupNativeRequestV2): HindsightBackupNativeRequestV2 {
  return { ...value, nativeBankIds: [...value.nativeBankIds].sort(compareUtf8), operationIds: [...value.operationIds].sort(),
    templates: [...value.templates].sort((left, right) => compareUtf8(left.target.bank_id, right.target.bank_id))
      .map((bank) => ({ ...bank, selected: bank.selected === null ? null
        : { ...bank.selected, request: normalizeHindsightTemplateRequest(bank.selected.request) } })) };
}
export function hindsightTemplateBackupRequestValue(value: HindsightBackupNativeRequestV2) {
  return Object.fromEntries(Object.entries(normalizeHindsightBackupRequestV2(value)).filter(([key]) => key !== "requestHash"));
}
export function hindsightTemplateBackupReceiptsValue(target: HindsightTemplateTarget, tuples: readonly HindsightTemplateBackupReceiptTuple[]) {
  const receipts = tuples.map((tuple) => HindsightTemplateBackupReceiptTupleSchema.parse(tuple))
    .sort((left, right) => left.request_id < right.request_id ? -1 : left.request_id > right.request_id ? 1 : 0);
  if (new Set(receipts.map((receipt) => receipt.request_id)).size !== receipts.length) throw new Error("HINDSIGHT_BACKUP_TEMPLATE_RECEIPTS_INVALID");
  return { target: HindsightTemplateTargetSchema.parse(target), receipts };
}

type Projection = Pick<HindsightTemplateSnapshot, "contract_version" | "target" | "selectors" | "config">
  & { models: unknown[]; directives: unknown[] };
/** The caller supplies the normalized B1 definition projection; only inherited config is removed. */
export function hindsightTemplateBackupDatabaseValue(projection: Projection) {
  return { ...projection, config: projection.config.map(({ key, stored }) => ({ key, stored })) };
}
export function hindsightTemplateBackupInheritedValue(projection: Pick<Projection, "target" | "config">) {
  return { target: projection.target, config: projection.config.map(({ key, inherited }) => ({ key, inherited })) };
}
export function hindsightTemplateBackupObservationValue(target: HindsightTemplateTarget,
  value: HindsightTemplateBackupConfigurationObservation) {
  const observation = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "observationHash"));
  return { target, observation };
}
function compareUtf8(left: string, right: string): number {
  const encoder = new TextEncoder(); const a = encoder.encode(left); const b = encoder.encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0); if (difference) return difference;
  }
  return a.length - b.length;
}
